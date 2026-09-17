import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HUMAN_ORIGIN_MARK } from "@/server/ai/history";
import {
  NIVEL_1_VERDAD_DEL_SISTEMA,
  NIVEL_2_CONDUCTA_UNIVERSAL,
} from "@/server/ai/prompts";
import { isRuleEntry, summarizeRules } from "@/server/ai/rule-summary";

/**
 * Panel de transparencia: resumen humano de las reglas (N1 + N2) y contrato del
 * endpoint que alimenta la interfaz.
 *
 * Las reglas NO se copian en el test ni en la ruta: se referencian las
 * constantes del producto, así que el test falla si alguien "ajusta" una regla
 * solo para el panel.
 */

const PROFILE_ROW = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Asistente comercial",
  tone: "Directo y cordial",
  instructions: "Ofrece despacho y retiro según las reglas del negocio.",
  escalationRules: "Escala si piden crédito o un humano.",
  greeting: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const selectQueue: unknown[][] = [];

/** Cadena Drizzle simulada: encadenable y "awaitable". */
function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "limit"]) {
    chain[method] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
  }),
  schema: new Proxy(
    {},
    {
      get: (_target, tableName) =>
        new Proxy(
          {},
          { get: (_t2, column) => `${String(tableName)}.${String(column)}` }
        ),
    }
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    // Se saltea la sesión real: el endpoint se prueba con una organización fija.
    withAuth:
      (
        handler: (session: {
          userId: string;
          organizationId: string;
          role: string;
        }) => Promise<Response>
      ) =>
      () =>
        handler({ userId: "u_1", organizationId: "org_1", role: "owner" }),
  };
});

vi.mock("@/server/catalog/queries", () => ({
  getActiveProductsPublic: vi.fn(async () => []),
  getActiveZones: vi.fn(async () => []),
}));

const { GET } = await import("@/app/api/agent/prompt/route");

beforeEach(() => {
  selectQueue.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("summarizeRules", () => {
  it("agrupa en 5 a 7 temas y no pierde ninguna regla", () => {
    const groups = summarizeRules(
      NIVEL_1_VERDAD_DEL_SISTEMA,
      NIVEL_2_CONDUCTA_UNIVERSAL
    );

    expect(groups.length).toBeGreaterThanOrEqual(5);
    expect(groups.length).toBeLessThanOrEqual(7);

    // Los títulos de sección de las constantes no son reglas y no se muestran.
    const reglas = [
      ...NIVEL_1_VERDAD_DEL_SISTEMA,
      ...NIVEL_2_CONDUCTA_UNIVERSAL,
    ].filter(isRuleEntry);

    const total = groups.reduce((acc, group) => acc + group.rules.length, 0);
    expect(total).toBe(reglas.length);

    const flat = groups.flatMap((group) => group.rules);
    for (const rule of reglas) {
      expect(flat).toContain(rule);
    }
    expect(flat).not.toContain("Reglas duras:");
  });

  it("una regla nueva se muestra sin tocar el helper (cae en Otros)", () => {
    const invented = "Los pedidos mayoristas se confirman los martes.";
    const nivel2 = [...NIVEL_2_CONDUCTA_UNIVERSAL, invented];

    const groups = summarizeRules(NIVEL_1_VERDAD_DEL_SISTEMA, nivel2);
    const otros = groups.find((group) => group.topic === "Otros");

    expect(otros?.rules).toContain(invented);
    const reglas = [...NIVEL_1_VERDAD_DEL_SISTEMA, ...nivel2].filter(
      isRuleEntry
    );
    expect(
      groups.reduce((acc, group) => acc + group.rules.length, 0)
    ).toBe(reglas.length);
  });

  it("el resumen se deriva del texto de las reglas", () => {
    const base = summarizeRules(
      NIVEL_1_VERDAD_DEL_SISTEMA,
      NIVEL_2_CONDUCTA_UNIVERSAL
    );
    const escalation = base.find(
      (group) => group.topic === "Escalamiento a una persona"
    );
    const target = escalation?.rules[0];
    expect(target).toBeDefined();

    const altered = NIVEL_2_CONDUCTA_UNIVERSAL.map((rule) =>
      rule === target ? "Tema sin clasificar." : rule
    );
    const changed = summarizeRules(NIVEL_1_VERDAD_DEL_SISTEMA, altered);

    expect(JSON.stringify(changed)).not.toBe(JSON.stringify(base));
    expect(
      changed.find((group) => group.topic === "Otros")?.rules
    ).toContain("Tema sin clasificar.");
    expect(
      changed.some((group) => group.topic === "Escalamiento a una persona")
    ).toBe(false);
  });

  it("la marca de saliente humano no cae en el grupo de escalado (P5)", () => {
    const groups = summarizeRules(
      NIVEL_1_VERDAD_DEL_SISTEMA,
      NIVEL_2_CONDUCTA_UNIVERSAL
    );
    const markRule = NIVEL_2_CONDUCTA_UNIVERSAL.find((rule) =>
      rule.includes(HUMAN_ORIGIN_MARK)
    );
    expect(markRule).toBeDefined();

    // La regla habla de mensajes escritos por personas del equipo, no de cuándo
    // escalar: mencionar "una persona del equipo" no debe mandarla al grupo de
    // escalado.
    expect(
      groups.find((group) => group.topic === "Escalamiento a una persona")?.rules
    ).not.toContain(markRule);
    expect(
      groups.find((group) => group.topic === "Mensajes de personas del equipo")
        ?.rules
    ).toContain(markRule);
  });
});

describe("GET /api/agent/prompt", () => {
  it("devuelve las reglas referenciadas y el prompt efectivo", async () => {
    selectQueue.push(
      [PROFILE_ROW],
      [], // knowledge base
      [{ id: "stg_1", name: "Nuevo", position: 0, kind: "open" }]
    );

    const res = await GET();
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      rules: { nivel1: string[]; nivel2: string[] };
      effectivePrompt: string;
      clientFileNote: string;
    };

    // Deep-equal contra las constantes del producto: la ruta no redeclara reglas.
    expect(json.rules.nivel1).toEqual([...NIVEL_1_VERDAD_DEL_SISTEMA]);
    expect(json.rules.nivel2).toEqual([...NIVEL_2_CONDUCTA_UNIVERSAL]);

    expect(json.effectivePrompt).toContain("NO envía correos");
    expect(json.effectivePrompt).toContain(PROFILE_ROW.name);
    expect(json.clientFileNote.length).toBeGreaterThan(0);
  });
});
