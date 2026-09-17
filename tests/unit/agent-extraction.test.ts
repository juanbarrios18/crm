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

vi.mock("@/lib/ai", () => ({
  chatJson: vi.fn(() => {
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

function queue(opts: { lead?: unknown[]; stages?: unknown[] } = {}) {
  selectQueue.push(
    [CONV],
    [PROFILE],
    HISTORY,
    [], // kb
    opts.stages ?? STAGES,
    opts.lead ?? [], // lead actual
    [], // catálogo
    [] // zonas
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
});
