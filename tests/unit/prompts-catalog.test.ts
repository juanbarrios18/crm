import { describe, expect, it } from "vitest";
import {
  buildAgentSystemPrompt,
  renderCatalog,
  renderDeliveryZones,
} from "@/server/ai/prompts";

/**
 * 005 — Prompt del agente (T016). El catálogo y las zonas se inyectan como
 * contexto (FR-030), siempre la proyección PÚBLICA; el costo interno NUNCA
 * aparece (FR-031).
 */

const PROFILE = {
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

const STAGES = [{ name: "Nuevo" }, { name: "Calificado" }, { name: "Ganado" }];

const CATALOG = [
  {
    producto: "Pan de hamburguesa",
    masa: "Brioche",
    formato: "12 cm",
    unidadesPorBolsa: 6,
    precioUnitarioNeto: 370,
    precioBolsaNeto: 2220,
    precioBolsaConIva: 2641.8,
    activo: true,
    notas: null,
  },
];

const ZONES = [{ comuna: "Macul", costoDespacho: 4500 }];

function build(input: Partial<Parameters<typeof buildAgentSystemPrompt>[0]> = {}) {
  return buildAgentSystemPrompt({
    profile: PROFILE,
    kb: [],
    stages: STAGES,
    catalog: CATALOG,
    zones: ZONES,
    ...input,
  });
}

describe("renderCatalog", () => {
  it("incluye los datos públicos del producto", () => {
    const text = renderCatalog(CATALOG);
    expect(text).toContain("Pan de hamburguesa");
    expect(text).toContain("$2.220 neto");
    expect(text).toContain("$2.641,80 con IVA");
  });

  it("formatea precios con separador de miles y coma decimal", () => {
    const text = renderCatalog([
      { ...CATALOG[0]!, precioBolsaNeto: 4855.2, precioBolsaConIva: 1000 },
    ]);
    expect(text).toContain("$4.855,20 neto");
    expect(text).toContain("$1.000 con IVA");
  });

  it("declara catálogo vacío", () => {
    expect(renderCatalog([])).toContain("vacío");
  });
});

describe("renderDeliveryZones", () => {
  it("incluye comuna y tarifa", () => {
    const text = renderDeliveryZones(ZONES);
    expect(text).toContain("Macul");
    expect(text).toContain("$4.500");
  });

  it("declara comuna sin tarifa en vez de inventar", () => {
    const text = renderDeliveryZones([{ comuna: "Vitacura", costoDespacho: null }]);
    expect(text).toContain("sin tarifa definida");
  });
});

describe("buildAgentSystemPrompt", () => {
  it("inyecta el catálogo y las zonas como contexto", () => {
    const prompt = build();
    expect(prompt).toContain("CATÁLOGO DE PRODUCTOS");
    expect(prompt).toContain("Pan de hamburguesa");
    expect(prompt).toContain("ZONAS DE ENVÍO");
    expect(prompt).toContain("Macul");
  });

  it("NUNCA incluye el costo interno (COGS) en el prompt", () => {
    const prompt = build();
    // "costo de despacho" (tarifa pública) SÍ es legítimo; lo privado no:
    expect(prompt).not.toContain("COGS");
    expect(prompt).not.toContain("margen");
    expect(prompt).not.toContain("product_cost");
    expect(prompt).not.toContain("costo del producto");
    // el catálogo renderizado no expone el campo costo (sin clave "costo": "")
    expect(prompt).not.toMatch(/precio.*costo/i);
  });

  it("omite las secciones si no hay catálogo ni zonas", () => {
    const prompt = build({ catalog: [], zones: [] });
    expect(prompt).not.toContain("CATÁLOGO DE PRODUCTOS");
    expect(prompt).not.toContain("ZONAS DE ENVÍO");
  });

  it("instruye a mover de etapa con el campo stage y nombres EXACTOS", () => {
    const prompt = build();
    for (const stage of STAGES) {
      expect(prompt).toContain(stage.name);
    }
    expect(prompt).toContain('"stage"');
    expect(prompt).toContain("Etapa actual del lead");
    expect(prompt.toLowerCase()).toContain("nombre exacto");
    // Regresión: el prompt no debe hardcodear una etapa fuera de la lista.
    expect(prompt).not.toContain("interesados");
  });
});