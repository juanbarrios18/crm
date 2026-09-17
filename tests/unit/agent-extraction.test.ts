import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubAgentTurnEnv } from "./support/agent-turn-env";

/**
 * Separación conversación / anotación:
 * - la llamada de conversación entrega el texto al cliente;
 * - la llamada de anotación resuelve etapa y campos del lead, y es BEST-EFFORT:
 *   si falla, la conversación igual se entrega.
 */

const graphRequest = vi.fn();

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

// El turno hace DOS llamadas: la primera conversa, la segunda extrae. El mock
// devuelve resultados completos en secuencia (permite simular el fallo de la
// segunda).
const aiResults: unknown[] = [];
let aiCall = 0;

/** Argumentos de cada llamada al proveedor, para inspeccionar lo que se envía. */
const aiCalls: unknown[][] = [];

vi.mock("@/lib/ai", () => ({
  chatJson: vi.fn((...args: unknown[]) => {
    aiCalls.push(args);
    const result = aiResults[Math.min(aiCall, aiResults.length - 1)];
    aiCall++;
    return Promise.resolve(result);
  }),
}));

const selectQueue: unknown[][] = [];
const inserts: { values: unknown }[] = [];
const updates: { values: unknown }[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: unknown) => {
        inserts.push({ values });
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
      set: (values: unknown) => ({
        where: () => {
          updates.push({ values });
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

const CONV = {
  id: "cv_test",
  organizationId: "org_1",
  contactId: "ct_1",
  isTest: true,
  aiEnabled: true,
  handoffAt: null,
  handoffReason: null,
  lastInboundAt: new Date(),
};
const PROFILE = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Asistente",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
};
const HISTORY = [
  { id: "msg_1", direction: "in", text: "hola", createdAt: new Date() },
];
const STAGES = [
  { id: "stg_new", name: "Nuevo", position: 0, kind: "open" },
  { id: "stg_int", name: "Interesado", position: 2, kind: "open" },
];

function okReply(reply: string) {
  return {
    ok: true,
    data: { reply },
    raw: "{}",
    model: "modelo-test",
    latencyMs: 10,
    usage: null,
    provider: "test",
  };
}

function okExtraction(data: Record<string, unknown>) {
  return {
    ok: true,
    data,
    raw: "{}",
    model: "modelo-test",
    latencyMs: 10,
    usage: null,
    provider: "test",
  };
}

function failExtraction() {
  return { ok: false, error: "provider_error", detail: "proveedor caído" };
}

function queue(
  opts: { lead?: unknown[]; stages?: unknown[]; contact?: unknown[] } = {}
) {
  const contact = opts.contact ?? [{ id: "ct_1", notes: null }];
  selectQueue.push(
    [CONV],
    [PROFILE],
    HISTORY,
    [], // kb
    opts.stages ?? STAGES,
    opts.lead ?? [], // lead actual
    contact, // ficha del cliente (prompt de conversación)
    [], // catálogo
    [], // zonas
    contact // contacto que lee `appendLeadNote` al escribir
  );
}

const outboundReply = () =>
  inserts.find(
    (i) =>
      typeof i.values === "object" &&
      i.values !== null &&
      (i.values as { direction?: string }).direction === "out"
  );

const stageMove = () =>
  updates.find(
    (u) =>
      typeof u.values === "object" &&
      u.values !== null &&
      "stageId" in (u.values as object)
  );

const contactWrite = () =>
  updates.find(
    (u) =>
      typeof u.values === "object" &&
      u.values !== null &&
      "notes" in (u.values as object)
  );

describe("pipeline: llamada de anotación separada de la conversación", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    selectQueue.length = 0;
    inserts.length = 0;
    updates.length = 0;
    aiResults.length = 0;
    aiCall = 0;
    aiCalls.length = 0;
    stubAgentTurnEnv();
  });

  it("una extracción vacía no escribe nada y no rompe el turno", async () => {
    aiResults.push(okReply("hola"), okExtraction({}));
    queue();

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    expect(outboundReply()).toBeDefined();
    expect((outboundReply()!.values as { text: string }).text).toBe("hola");
    expect(contactWrite()).toBeUndefined();
    expect(stageMove()).toBeUndefined();
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("si la segunda llamada falla, la respuesta al cliente igual se entrega", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    aiResults.push(okReply("hola"), failExtraction());
    queue();

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    expect(outboundReply()).toBeDefined();
    expect((outboundReply()!.values as { text: string }).text).toBe("hola");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("la etapa de la extracción avanza el lead (solo avance)", async () => {
    aiResults.push(okReply("ok"), okExtraction({ stage: "interesados" }));
    queue();

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    expect((stageMove()!.values as { stageId: string }).stageId).toBe("stg_int");
  });

  it("una etapa inexistente solo avisa y no mueve el lead (allowlist)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    aiResults.push(okReply("ok"), okExtraction({ stage: "No Existe" }));
    queue();

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    expect(stageMove()).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("no retrocede: si el lead ya está en Interesado, no lo vuelve a Nuevo", async () => {
    aiResults.push(okReply("ok"), okExtraction({ stage: "Nuevo" }));
    queue({ lead: [{ stageId: "stg_int" }] });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    expect(stageMove()).toBeUndefined();
  });

  it("descarta marcadores de posición en vez de escribirlos en el contacto", async () => {
    // Hallazgo de la medición de F9: al adelgazar el prompt de anotación, el
    // modelo copiaba los "..." del ejemplo del contrato como si fueran datos.
    // Zod los acepta (cumplen min(1)); el guard los descarta al escribir.
    aiResults.push(
      okReply("hola"),
      okExtraction({ comuna: "...", productoInteres: "Pan de hamburguesa", email: "N/A" })
    );
    queue();

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    const write = contactWrite()!.values as Record<string, unknown>;
    // El dato real se escribe; los marcadores no.
    expect(write.productoInteres).toBe("Pan de hamburguesa");
    expect(write.comuna).toBeUndefined();
    expect(write.email).toBeUndefined();
  });

  it("una extracción donde TODO es marcador no escribe nada", async () => {
    aiResults.push(okReply("hola"), okExtraction({ comuna: "...", email: "N/A" }));
    queue();

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    expect(contactWrite()).toBeUndefined();
  });

  it("la nota tampoco acepta un marcador de posición", async () => {
    aiResults.push(okReply("hola"), okExtraction({ note: "..." }));
    queue();

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    expect(contactWrite()).toBeUndefined();
  });

  it("la anotación recibe SOLO los últimos 6 mensajes (P2)", async () => {
    // La conversación sigue viendo el hilo completo; la extracción no lo necesita
    // y es donde está el ahorro real de P2.
    aiResults.push(okReply("hola"), okExtraction({}));
    // La consulta real del pipeline ordena por `createdAt` DESC y después hace
    // `reverse()` para dejar el historial cronológico: el fixture tiene que
    // llegar en el mismo orden que la base (más nuevo primero).
    const largo = Array.from({ length: 12 }, (_, i) => i)
      .reverse()
      .map((i) => ({
        id: `msg_${i}`,
        direction: i % 2 === 0 ? "in" : "out",
        text: `mensaje ${i}`,
        aiGenerated: true,
        origin: "ai",
        createdAt: new Date(),
      }));
    selectQueue.push(
      [CONV],
      [PROFILE],
      largo, // historial
      [], // kb
      STAGES,
      [], // lead
      [{ id: "ct_1", notes: null }], // ficha
      [], // catálogo
      [], // zonas
      [{ id: "ct_1", notes: null }] // contacto de appendLeadNote
    );

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    const [conversationCall, annotationCall] = aiCalls as unknown as [
      [unknown, { role: string; content: string }[]],
      [unknown, { role: string; content: string }[]],
    ];
    // Conversación: system + los 12 mensajes.
    expect(conversationCall[1]).toHaveLength(13);
    // Anotación: system + los 6 últimos.
    expect(annotationCall[1]).toHaveLength(7);
    expect(annotationCall[1][1]!.content).toBe("mensaje 6");
    expect(annotationCall[1].at(-1)!.content).toBe("mensaje 11");
  });

  it("la anotación usa OPENROUTER_ANNOTATION_MODEL cuando está configurado", async () => {
    // `getEnv` memoiza por instancia de módulo: hay que reimportar para que lea
    // la variable nueva.
    vi.resetModules();
    stubAgentTurnEnv({ OPENROUTER_ANNOTATION_MODEL: "modelo-barato" });
    aiResults.push(okReply("hola"), okExtraction({}));
    queue();

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    // `aiCalls[i]` = [schema, messages, opts]
    const annotationOptions = (aiCalls[1] as unknown[])[2] as {
      model?: string;
    };
    expect(annotationOptions).toMatchObject({ model: "modelo-barato" });
  });
});
