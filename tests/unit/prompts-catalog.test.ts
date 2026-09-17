import { describe, expect, it } from "vitest";
import { HUMAN_ORIGIN_MARK } from "@/server/ai/history";
import {
  buildAgentSystemPrompt,
  buildAnnotationSystemPrompt,
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
    imagen: null,
    activo: true,
    notas: null,
  },
];

const ZONES = [{ comuna: "Macul", costoDespacho: 4500 }];

/**
 * Momento fijo: el prompt incluye una línea con la fecha y hora del turno, así
 * que un `new Date()` real haría que dos builds del mismo caso difieran si el
 * reloj cruza el minuto entre uno y otro.
 */
const FIXED_NOW = new Date("2026-09-17T15:30:00Z");

function build(input: Partial<Parameters<typeof buildAgentSystemPrompt>[0]> = {}) {
  return buildAgentSystemPrompt({
    profile: PROFILE,
    kb: [],
    stages: STAGES,
    catalog: CATALOG,
    zones: ZONES,
    now: FIXED_NOW,
    timeZone: "America/Santiago",
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
    // El guardrail sobrevive al rename del ledger de costos (008):
    expect(prompt).not.toContain("product_cost_movement");
    expect(prompt).not.toContain("costoUnitario");
    expect(prompt).not.toContain("costo unitario");
    expect(prompt).not.toContain("costo del producto");
    // el catálogo renderizado no expone el campo costo (sin clave "costo": "")
    expect(prompt).not.toMatch(/precio.*costo/i);
  });

  it("omite las secciones si no hay catálogo ni zonas", () => {
    const prompt = build({ catalog: [], zones: [] });
    expect(prompt).not.toContain("CATÁLOGO DE PRODUCTOS");
    expect(prompt).not.toContain("ZONAS DE ENVÍO");
  });

  it("prohíbe afirmar acciones que el canal no puede realizar", () => {
    const prompt = build();
    expect(prompt).toContain("NUNCA afirme");
    expect(prompt).toContain("NO envía correos");
    expect(prompt).toContain("no recibió algo");
  });

  it("inyecta las etapas como CONTEXTO, no como contrato de salida del CRM", () => {
    const prompt = build();
    for (const stage of STAGES) {
      expect(prompt).toContain(stage.name);
    }
    expect(prompt).toContain("Etapa actual del lead");
    // El contrato de conversación solo produce texto para el cliente: los campos
    // del CRM (stage/empresa/comuna/rut) viven en el prompt de anotación.
    expect(prompt).toContain('"reply"');
    expect(prompt).not.toContain('"stage"');
    expect(prompt.toLowerCase()).not.toContain("nombre exacto");
    // Lo que no puede viajar es el CONTRATO de salida del CRM (las acciones y las
    // claves del esquema), no las palabras del dominio: "comuna" es legítima en
    // las reglas de conversación, porque es el dato que acota la cotización.
    expect(prompt).not.toContain("update_lead");
    expect(prompt).not.toContain("move_stage");
    expect(prompt).not.toContain('"empresa"');
    expect(prompt).not.toContain('"comuna"');
    expect(prompt).not.toContain('"rut"');
    // Regresión: el prompt no debe hardcodear una etapa fuera de la lista.
    expect(prompt).not.toContain("interesados");
  });
});

describe("contexto temporal (P6)", () => {
  it("la línea temporal va AL FINAL del prompt", () => {
    const prompt = build();
    const temporalAt = prompt.indexOf("Fecha y hora actuales:");
    expect(temporalAt).toBeGreaterThan(0);
    // Nada después de la línea temporal: es lo único que cambia por turno, así
    // que el prefijo estable queda cacheable.
    const after = prompt.slice(temporalAt);
    expect(after).toContain("Fecha y hora actuales:");
    for (const stable of [
      "En cada turno responde ÚNICAMENTE",
      "Etapa actual del lead:",
      "CONOCIMIENTO DEL NEGOCIO",
      "CATÁLOGO DE PRODUCTOS",
    ]) {
      expect(prompt.indexOf(stable)).toBeLessThan(temporalAt);
    }
    // Efectivamente es la última sección.
    expect(prompt.lastIndexOf("\n\n")).toBeLessThan(temporalAt);
  });

  it("formatea la fecha en la zona del negocio", () => {
    const prompt = build();
    expect(prompt).toContain("jueves, 17 de septiembre de 2026");
    expect(prompt).toContain("(zona America/Santiago)");
  });

  it("respeta una zona horaria distinta (el día puede cambiar)", () => {
    // 2026-09-17T02:00Z son las 23:00 del 16 en Santiago (UTC-3, horario de
    // verano chileno) y las 14:00 del 17 en Auckland (UTC+12): el mismo instante
    // cae en días distintos según la zona configurada.
    const instant = new Date("2026-09-17T02:00:00Z");
    expect(build({ now: instant, timeZone: "America/Santiago" })).toContain(
      "16 de septiembre de 2026"
    );
    expect(build({ now: instant, timeZone: "Pacific/Auckland" })).toContain(
      "17 de septiembre de 2026"
    );
  });
});

describe("marca de saliente humano (P5)", () => {
  it("el prompt de conversación explica la marca (N2)", () => {
    const prompt = build({
      kb: [],
    });
    expect(prompt).toContain(HUMAN_ORIGIN_MARK);
    // No alcanza con que la marca aparezca: N2 tiene que decir qué significa.
    expect(prompt).toContain("los escribió una persona del equipo");
  });

  it("el prompt de anotación NO explica la marca (no trae N2)", () => {
    const prompt = buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
      currentStage: null,
    });
    expect(prompt).not.toContain(HUMAN_ORIGIN_MARK);
  });
});

describe("buildAnnotationSystemPrompt", () => {
  it("describe la extracción con las etapas y la etapa actual", () => {
    const prompt = buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
      currentStage: "Calificado",
    });
    expect(prompt).toContain("Calificado");
    for (const stage of STAGES) {
      expect(prompt).toContain(stage.name);
    }
    expect(prompt).toContain("nombre EXACTO");
    expect(prompt.toLowerCase()).toContain("extraiga");
  });

  it("no incluye catálogo, zonas ni voz de marca (recorte deliberado)", () => {
    const prompt = buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
      currentStage: null,
    });
    expect(prompt).not.toContain("CATÁLOGO DE PRODUCTOS");
    expect(prompt).not.toContain("Pan de hamburguesa");
    expect(prompt).not.toContain("ZONAS DE ENVÍO");
    expect(prompt).not.toContain("Macul");
    expect(prompt).not.toContain("Tono:");
    expect(prompt).not.toContain("Saludo sugerido");
  });
});