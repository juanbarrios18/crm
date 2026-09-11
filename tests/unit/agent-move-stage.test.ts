import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regresión: el agente movía el lead solo con la acción `move_stage`, que el
 * modelo casi nunca elegía (prefería `reply`). Ahora la etapa viaja como campo
 * independiente en CUALQUIER acción y el pipeline la aplica. Además, la etapa
 * no retrocede.
 */

const graphRequest = vi.fn();

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

let nextAction: Record<string, unknown> = {};

vi.mock("@/lib/ai", () => ({
  chatJson: vi.fn(() =>
    Promise.resolve({
      ok: true,
      data: nextAction,
      raw: "{}",
      model: "modelo-test",
      latencyMs: 120,
      usage: null,
      provider: "test",
    })
  ),
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
  { id: "msg_1", direction: "in", text: "quiero comprar", createdAt: new Date() },
];
const STAGES = [
  { id: "stg_new", name: "Nuevo", position: 0, kind: "open" },
  { id: "stg_int", name: "Interesado", position: 2, kind: "open" },
];

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

describe("pipeline: etapa como campo independiente de la acción", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    selectQueue.length = 0;
    inserts.length = 0;
    updates.length = 0;
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  });

  it("una acción reply con stage mueve el lead y responde", async () => {
    nextAction = {
      action: "reply",
      text: "¡Genial! Te paso la info.",
      stage: "interesados",
    };
    queue();

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    const moved = updates.find(
      (u) =>
        typeof u.values === "object" &&
        u.values !== null &&
        (u.values as { stageId?: string }).stageId === "stg_int"
    );
    expect(moved).toBeDefined();
    expect(graphRequest).not.toHaveBeenCalled();

    const reply = inserts.find(
      (i) =>
        typeof i.values === "object" &&
        i.values !== null &&
        (i.values as { direction?: string }).direction === "out"
    );
    expect((reply!.values as { text: string }).text).toBe(
      "¡Genial! Te paso la info."
    );
  });

  it("no retrocede: si el lead ya está en Interesado, no lo vuelve a Nuevo", async () => {
    nextAction = { action: "reply", text: "ok", stage: "Nuevo" };
    queue({ lead: [{ stageId: "stg_int" }] });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_test");

    const moved = updates.find(
      (u) =>
        typeof u.values === "object" &&
        u.values !== null &&
        "stageId" in (u.values as object)
    );
    expect(moved).toBeUndefined();
  });
});
