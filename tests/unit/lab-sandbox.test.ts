import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubAgentTurnEnv } from "./support/agent-turn-env";

/**
 * FR-031/FR-082: el turno del agente sobre una conversación is_test persiste
 * la respuesta en BD y JAMÁS invoca el cliente Graph (spy sobre lib/meta).
 */

const graphRequest = vi.fn();

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

// El turno hace DOS llamadas (conversación y anotación). Cada resultado simulado
// puede declarar `delayMs` para que el mock tarde lo que tarda una llamada real:
// así el test puede distinguir una latencia medida en paralelo de una sumada.
const aiResults: unknown[] = [];
let aiCall = 0;
/** Momento (epoch ms) en que resolvió cada llamada simulada, por índice. */
const aiResolvedAt: number[] = [];

type MockAiResult = Record<string, unknown> & { delayMs?: number };

vi.mock("@/lib/ai", () => ({
  chatJson: vi.fn(() => {
    const index = aiCall;
    const raw = aiResults[Math.min(index, aiResults.length - 1)] as
      | MockAiResult
      | undefined;
    aiCall++;
    if (!raw) return Promise.resolve(undefined);
    const { delayMs = 0, ...payload } = raw;
    const settle = () => {
      aiResolvedAt[index] = Date.now();
      return payload;
    };
    if (delayMs <= 0) return Promise.resolve().then(settle);
    return new Promise((resolve) => setTimeout(() => resolve(settle()), delayMs));
  }),
}));

// BD simulada: cola de resultados de select + capturas de insert/update.
const selectQueue: unknown[][] = [];
const inserts: { table: unknown; values: unknown }[] = [];
/** Momento (epoch ms) en que se persistió el mensaje saliente del turno. */
let outboundInsertedAt = 0;

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => void
  ) => Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        if (
          typeof values === "object" &&
          values !== null &&
          (values as { direction?: string }).direction === "out"
        ) {
          outboundInsertedAt = Date.now();
        }
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([values]),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve([values]).then(resolve),
        };
        return chain;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const chain = {
            returning: () => Promise.resolve([{}]),
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve([{}]).then(resolve),
          };
          return chain;
        },
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy(
          {},
          { get: (_t2, col) => `${String(tableName)}.${String(col)}` }
        ),
    }
  ),
}));

describe("sandbox del Laboratorio en el pipeline del agente", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    selectQueue.length = 0;
    inserts.length = 0;
    aiResults.length = 0;
    aiResolvedAt.length = 0;
    outboundInsertedAt = 0;
    aiCall = 0;
    stubAgentTurnEnv();
  });

  /** Cola de selects válida para un turno simple sobre `is_test`. */
  function pushTurnSelects(conversationId: string) {
    selectQueue.push(
      [
        {
          id: conversationId,
          organizationId: "org_1",
          contactId: "ct_lab",
          isTest: true,
          aiEnabled: true,
          handoffAt: null,
          handoffReason: null,
          lastInboundAt: new Date(),
        },
      ],
      [
        {
          id: "agp_1",
          organizationId: "org_1",
          enabled: false,
          name: "Asistente",
          tone: null,
          instructions: null,
          escalationRules: null,
          greeting: null,
        },
      ], // perfil (apagado: el Lab evalúa igual)
      [
        {
          id: "msg_1",
          direction: "in",
          text: "¿tienen taladros?",
          createdAt: new Date(),
        },
      ], // historial
      [], // kb
      [] // etapas
    );
  }

  it("turno sobre conversación is_test → persiste la respuesta y NO llama a Graph", async () => {
    // Cada llamada simulada tarda lo mismo. En paralelo el tramo dura ~180 ms;
    // si el pipeline las encadenara, duraría ~360 ms. Esa brecha es el invariante
    // que distingue "máximo de las dos llamadas" de "suma de las dos llamadas".
    const CALL_MS = 180;
    aiResults.push(
      {
        ok: true,
        data: { reply: "respuesta simulada" },
        raw: "{}",
        model: "modelo-test",
        latencyMs: 250,
        usage: { promptTokens: 2100, completionTokens: 80, cachedTokens: 1900 },
        provider: "DeepInfra",
        delayMs: CALL_MS,
      },
      {
        ok: true,
        data: {},
        raw: "{}",
        model: "modelo-test",
        latencyMs: 50,
        usage: { promptTokens: 200, completionTokens: 10, cachedTokens: 100 },
        provider: "DeepInfra",
        delayMs: CALL_MS,
      }
    );
    const testConversation = {
      id: "cv_lab",
      organizationId: "org_1",
      contactId: "ct_lab",
      isTest: true,
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      lastInboundAt: new Date(),
    };
    selectQueue.push(
      [testConversation], // conversación
      [{ id: "agp_1", organizationId: "org_1", enabled: false, name: "Asistente", tone: null, instructions: null, escalationRules: null, greeting: null }], // perfil (apagado: el Lab evalúa igual)
      [
        {
          id: "msg_1",
          direction: "in",
          text: "¿tienen taladros?",
          createdAt: new Date(),
        },
      ], // historial
      [], // kb
      [] // etapas
    );

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const timing = await runAgentTurn("cv_lab");

    expect(graphRequest).not.toHaveBeenCalled();
    // Los TOKENS se suman: el costo real del turno es la suma de las dos
    // llamadas, no el de una sola.
    expect(timing?.model).toBe("modelo-test");
    expect(timing?.promptTokens).toBe(2300);
    expect(timing?.completionTokens).toBe(90);
    expect(timing?.cachedTokens).toBe(2000);
    expect(timing?.provider).toBe("DeepInfra");
    // La LATENCIA no se suma (P1): la conversación y la anotación corren en
    // paralelo, así que el cliente esperó el máximo de las dos (~180 ms), nunca
    // la suma (~360 ms).
    expect(timing?.latencyMs).toBeGreaterThanOrEqual(CALL_MS);
    expect(timing?.latencyMs).toBeLessThan(CALL_MS * 2 - 20);
    // la respuesta quedó persistida como mensaje saliente ai_generated
    const messageInsert = inserts.find(
      (i) =>
        typeof i.values === "object" &&
        i.values !== null &&
        (i.values as { direction?: string }).direction === "out"
    );
    expect(messageInsert).toBeDefined();
    expect((messageInsert!.values as { aiGenerated: boolean }).aiGenerated).toBe(
      true
    );
    expect((messageInsert!.values as { text: string }).text).toBe(
      "respuesta simulada"
    );
  });

  it("P1: la entrega NO espera la anotación y el turno igual cierra la extracción", async () => {
    // La conversación responde rápido; la anotación tarda mucho más. Si la
    // entrega esperara la extracción (comportamiento previo a P1), el mensaje
    // saliente se persistiría DESPUÉS de que la anotación resuelva.
    const CONV_MS = 20;
    const ANNOT_MS = 250;
    aiResults.push(
      {
        ok: true,
        data: { reply: "respuesta simulada" },
        raw: "{}",
        model: "modelo-test",
        latencyMs: CONV_MS,
        usage: null,
        provider: "p",
        delayMs: CONV_MS,
      },
      {
        ok: true,
        data: {},
        raw: "{}",
        model: "modelo-test",
        latencyMs: ANNOT_MS,
        usage: null,
        provider: "p",
        delayMs: ANNOT_MS,
      }
    );
    pushTurnSelects("cv_p1");

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const timing = await runAgentTurn("cv_p1");

    // 1) La respuesta salió ANTES de que la anotación terminara: el cliente no
    //    pagó la latencia de la extracción.
    expect(aiResolvedAt[1]).toBeGreaterThan(0);
    expect(outboundInsertedAt).toBeGreaterThan(0);
    expect(outboundInsertedAt).toBeLessThan(aiResolvedAt[1]!);

    // 2) El turno, igual, esperó la anotación antes de retornar: el Laboratorio
    //    mide el turno completo y el `finalStage` no queda a medias.
    expect(timing?.latencyMs).toBeGreaterThanOrEqual(ANNOT_MS);
  });
});
