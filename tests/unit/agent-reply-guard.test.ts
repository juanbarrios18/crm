import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubAgentTurnEnv } from "./support/agent-turn-env";

/**
 * El modelo chico suele devolver reply vacío y dejar al cliente colgado. El
 * pipeline pide UNA corrección de la llamada de conversación; la anotación
 * (segunda llamada) conserva su propio dato del lead.
 */

const graphRequest = vi.fn();

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const responses: unknown[] = [];
let call = 0;

vi.mock("@/lib/ai", () => ({
  chatJson: vi.fn(() =>
    Promise.resolve({
      ok: true,
      data: responses[Math.min(call++, responses.length - 1)],
      raw: "{}",
      model: "m",
      latencyMs: 10,
      usage: null,
      provider: "t",
    })
  ),
}));

const selectQueue: unknown[][] = [];
const inserts: { values: unknown }[] = [];

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

/**
 * F5: el guard determinista corre antes de entregar. Con catálogo vacío, todo
 * precio es una violación. Orden de invocación del mock: conversación,
 * anotación, y recién después la corrección del guard.
 */
const CONVERSATION_ROWS = [
  {
    id: "cv_1",
    organizationId: "org_1",
    contactId: "ct_1",
    isTest: true,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  },
];
const PROFILE_ROWS = [
  {
    id: "agp_1",
    organizationId: "org_1",
    enabled: true,
    name: "A",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: "Hola, somos el equipo comercial. ¿Qué pan necesita?",
  },
];

function pushSelects(
  history: unknown[] = [
    { id: "m1", direction: "in", text: "cuánto sale?", createdAt: new Date() },
  ],
  contactRows: unknown[] = []
) {
  selectQueue.push(
    CONVERSATION_ROWS,
    PROFILE_ROWS,
    history,
    [],
    [{ id: "stg_new", name: "Nuevo", position: 0, kind: "open" }],
    [],
    contactRows,
    []
  );
}

function deliveredText(): string | undefined {
  const reply = inserts.find(
    (i) =>
      typeof i.values === "object" &&
      i.values !== null &&
      (i.values as { direction?: string }).direction === "out"
  );
  return reply ? (reply.values as { text: string }).text : undefined;
}

describe("pipeline: guard determinista de la respuesta (F5)", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    selectQueue.length = 0;
    inserts.length = 0;
    responses.length = 0;
    call = 0;
    stubAgentTurnEnv();
  });

  it("precio fuera del catálogo → una corrección y se entrega la corregida", async () => {
    responses.push(
      { reply: "Sale $9.999 neto." }, // conversación: viola
      { stage: "Nuevo" }, // anotación
      { reply: "Ese precio lo confirmo con el equipo." } // corrección del guard
    );
    pushSelects();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(deliveredText()).toBe("Ese precio lo confirmo con el equipo.");
    expect(call).toBe(3);
  });

  it("si la corrección también viola → respuesta segura", async () => {
    responses.push(
      { reply: "Sale $9.999 neto." },
      { stage: "Nuevo" },
      { reply: "Insisto: $9.999 neto." }
    );
    pushSelects();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const { SAFE_FALLBACK_REPLY } = await import("@/server/ai/reply-guard");
    await runAgentTurn("cv_1");
    expect(deliveredText()).toBe(SAFE_FALLBACK_REPLY);
    expect(call).toBe(3);
  });

  it("saludo repetido en el segundo turno → una corrección y se entrega la respuesta real (F5b)", async () => {
    responses.push(
      { reply: "Hola, somos el equipo comercial. ¿Qué pan necesita?" }, // repite el saludo
      { stage: "Nuevo" },
      { reply: "Ese dato lo confirmo con el equipo y le escribo." }
    );
    pushSelects([
      { id: "m1", direction: "in", text: "hola", createdAt: new Date(1) },
      {
        id: "m2",
        direction: "out",
        origin: "ai",
        aiGenerated: true,
        text: "Hola, somos el equipo comercial. ¿Qué pan necesita?",
        createdAt: new Date(2),
      },
      { id: "m3", direction: "in", text: "me mandan la boleta al correo?", createdAt: new Date(3) },
    ]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(deliveredText()).toBe("Ese dato lo confirmo con el equipo y le escribo.");
    expect(call).toBe(3);
  });

  it("saludo repetido irrecuperable → se entrega la original, no el fallback (PROD run_pk41)", async () => {
    responses.push(
      { reply: "Hola, somos el equipo comercial. ¿Qué pan necesita? Cuénteme qué busca." },
      { stage: "Nuevo" },
      { reply: "Hola, somos el equipo comercial. ¿Qué pan necesita?" }
    );
    pushSelects([
      { id: "m1", direction: "in", text: "hola", createdAt: new Date(1) },
      {
        id: "m2",
        direction: "out",
        origin: "ai",
        aiGenerated: true,
        text: "Hola, somos el equipo comercial. ¿Qué pan necesita?",
        createdAt: new Date(2),
      },
      { id: "m3", direction: "in", text: "me mandan la boleta al correo?", createdAt: new Date(3) },
    ]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const { SAFE_FALLBACK_REPLY } = await import("@/server/ai/reply-guard");
    await runAgentTurn("cv_1");
    expect(deliveredText()).toBe(
      "Hola, somos el equipo comercial. ¿Qué pan necesita? Cuénteme qué busca."
    );
    expect(deliveredText()).not.toBe(SAFE_FALLBACK_REPLY);
  });

  it("nombre repetido irrecuperable → se entrega sin el nombre, no el fallback (T001)", async () => {
    responses.push(
      { reply: "Roberto, con gusto le ayudo con su consulta." }, // segunda mención
      { stage: "Nuevo" },
      { reply: "Roberto, muchas gracias por escribirnos." } // la corrección insiste
    );
    pushSelects(
      [
        { id: "m1", direction: "in", text: "hola", createdAt: new Date(1) },
        {
          id: "m2",
          direction: "out",
          origin: "ai",
          aiGenerated: true,
          text: "Hola, Roberto. Somos el equipo comercial de Lamas Foods.",
          createdAt: new Date(2),
        },
        { id: "m3", direction: "in", text: "cuánto sale?", createdAt: new Date(3) },
      ],
      [{ id: "ct_1", name: "Roberto Gonzalez" }]
    );
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    const { SAFE_FALLBACK_REPLY } = await import("@/server/ai/reply-guard");
    await runAgentTurn("cv_1");
    expect(deliveredText()).toBe("Con gusto le ayudo con su consulta.");
    expect(deliveredText()).not.toBe(SAFE_FALLBACK_REPLY);
    expect(call).toBe(3);
  });
});
