import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El modelo chico suele devolver una acción sin texto (update_lead solo con
 * nota, o none) y dejar al cliente colgado. El pipeline pide UNA corrección y
 * adjunta el texto a la acción original, preservando la decisión.
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

describe("pipeline: corrección cuando la acción no trae respuesta", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    selectQueue.length = 0;
    inserts.length = 0;
    responses.length = 0;
    call = 0;
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  });

  it("update_lead sin reply → corrige y responde conservando la nota", async () => {
    responses.push(
      { action: "update_lead", note: "quiere transferir", stage: "Interesado" },
      {
        action: "update_lead",
        note: "x",
        reply: "Te paso los datos de transferencia.",
        stage: "Interesado",
      }
    );

    selectQueue.push(
      [
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
      ],
      [
        {
          id: "agp_1",
          organizationId: "org_1",
          enabled: true,
          name: "A",
          tone: null,
          instructions: null,
          escalationRules: null,
          greeting: null,
        },
      ],
      [{ id: "m1", direction: "in", text: "pásame los datos", createdAt: new Date() }],
      [],
      [
        { id: "stg_new", name: "Nuevo", position: 0, kind: "open" },
        { id: "stg_int", name: "Interesado", position: 2, kind: "open" },
      ],
      [],
      [],
      []
    );

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    const reply = inserts.find(
      (i) =>
        typeof i.values === "object" &&
        i.values !== null &&
        (i.values as { direction?: string }).direction === "out"
    );
    expect(reply).toBeDefined();
    expect((reply!.values as { text: string }).text).toBe(
      "Te paso los datos de transferencia."
    );
    expect(graphRequest).not.toHaveBeenCalled();
  });
});
