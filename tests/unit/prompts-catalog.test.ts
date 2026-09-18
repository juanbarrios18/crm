import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/ai";
import type { PublicProduct } from "@/lib/catalog";
import { HUMAN_ORIGIN_MARK } from "@/server/ai/history";
import {
  appendTemporalNote,
  buildAgentSystemPrompt,
  buildAnnotationSystemPrompt,
  renderCatalogVocabulary,
  renderCatalog,
  renderDeliveryZones,
  renderTemporalContext,
  renderAnnotationTurnState,
  renderTemporalNote,
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
 * Catálogo representativo con el tamaño REAL del de Lamas Foods (12 filas, 4
 * productos): el vocabulario que reemplaza a las instrucciones tiene que medirse
 * contra algo realista, no contra un producto de juguete.
 */
function fila(producto: string, masa: string, formato: string): PublicProduct {
  return {
    producto,
    masa,
    formato,
    unidadesPorBolsa: 6,
    precioUnitarioNeto: 0,
    precioBolsaNeto: 0,
    precioBolsaConIva: 0,
    imagen: null,
    activo: true,
    notas: null,
  };
}

const CATALOGO_REAL: PublicProduct[] = [
  fila("Pan ciabatta", "Regular", "Estandar"),
  fila("Pan de completo", "Papa", "15 cm"),
  fila("Pan de completo", "Papa", "20 cm"),
  fila("Pan de completo", "Papa", "30 cm"),
  fila("Pan de hamburguesa", "Brioche", "10 cm"),
  fila("Pan de hamburguesa", "Brioche", "11 cm"),
  fila("Pan de hamburguesa", "Brioche", "12 cm"),
  fila("Pan de hamburguesa", "Papa", "10 cm"),
  fila("Pan de hamburguesa", "Papa", "11 cm"),
  fila("Pan de hamburguesa", "Papa", "12 cm"),
  fila("Pan de molde", "Blanco XL", "22 rebanadas 14x14 cm"),
  fila("Pan de molde", "Brioche", "Unidad"),
];

/**
 * Momento fijo para las pruebas del contexto temporal: la fecha se formatea con
 * Intl, así que un instante real haría que dos builds difieran según el reloj.
 * El system prompt ya NO incluye la fecha (P1): este valor solo alimenta
 * `renderTemporalNote`.
 */
const FIXED_NOW = new Date("2026-09-17T15:30:00Z");

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
    expect(prompt).toContain("Nunca afirme haber hecho algo que este canal no puede hacer");
    expect(prompt).toContain("NO envía correos");
    expect(prompt).toContain("no recibió algo");
  });

  it("inyecta las etapas como CONTEXTO, no como contrato de salida del CRM", () => {
    const prompt = build();
    for (const stage of STAGES) {
      expect(prompt).toContain(stage.name);
    }
    // F1: la etapa ACTUAL ya no vive en el system (viaja en la nota del turno).
    expect(prompt).not.toContain("Etapa actual del lead");
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

describe("contexto temporal fuera del prefijo cacheable (P1)", () => {
  it("el system prompt NO contiene la fecha ni la hora (invariante de caché)", () => {
    const prompt = build();
    expect(prompt).not.toContain("Fecha y hora actuales:");
    // Dos builds del mismo estado son idénticos byte a byte: ningún dato que
    // cambie por reloj puede colarse en el prefijo que el proveedor cachea.
    expect(build()).toBe(build());
  });

  it("la nota temporal se marca como contexto interno del sistema", () => {
    const note = renderTemporalNote(FIXED_NOW, "America/Santiago");
    expect(note).toContain("CONTEXTO INTERNO DEL SISTEMA");
    expect(note).toContain("no es un mensaje del cliente");
    // El texto de la nota es exactamente el de la fuente única.
    expect(note).toContain(
      renderTemporalContext(FIXED_NOW, "America/Santiago")
    );
  });

  it("formatea la fecha en la zona del negocio", () => {
    const note = renderTemporalNote(FIXED_NOW, "America/Santiago");
    expect(note).toContain("jueves, 17 de septiembre de 2026");
    expect(note).toContain("(zona America/Santiago)");
  });

  it("respeta una zona horaria distinta (el día puede cambiar)", () => {
    // 2026-09-17T02:00Z son las 23:00 del 16 en Santiago (UTC-3, horario de
    // verano chileno) y las 14:00 del 17 en Auckland (UTC+12): el mismo instante
    // cae en días distintos según la zona configurada.
    const instant = new Date("2026-09-17T02:00:00Z");
    expect(renderTemporalNote(instant, "America/Santiago")).toContain(
      "16 de septiembre de 2026"
    );
    expect(renderTemporalNote(instant, "Pacific/Auckland")).toContain(
      "17 de septiembre de 2026"
    );
  });
});

describe("appendTemporalNote (P1)", () => {
  const NOTE = renderTemporalNote(FIXED_NOW, "America/Santiago");

  it("adjunta la nota al final del último mensaje del cliente", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system estable" },
      { role: "user", content: "hola" },
      { role: "assistant", content: "¿En qué le ayudo?" },
      { role: "user", content: "precio del pan" },
    ];
    const out = appendTemporalNote(messages, NOTE);
    const last = out[out.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content).toBe(`precio del pan\n\n${NOTE}`);
    // El system queda intacto: la nota nunca viaja en el prefijo cacheable.
    expect(out[0]!.content).toBe("system estable");
    expect(out[0]!.content).not.toContain("Fecha y hora actuales:");
  });

  it("no muta el arreglo de entrada", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hola" }];
    const out = appendTemporalNote(messages, NOTE);
    expect(messages[0]!.content).toBe("hola");
    expect(out).not.toBe(messages);
  });

  it("si el último mensaje no es del cliente, agrega uno nuevo (caso borde)", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "hola" },
      { role: "assistant", content: "respuesta" },
    ];
    const out = appendTemporalNote(messages, NOTE);
    expect(out).toHaveLength(4);
    expect(out[3]).toEqual({ role: "user", content: NOTE });
  });

  it("con arreglo vacío agrega un mensaje de contexto", () => {
    expect(appendTemporalNote([], NOTE)).toEqual([
      { role: "user", content: NOTE },
    ]);
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
    });
    expect(prompt).not.toContain(HUMAN_ORIGIN_MARK);
  });
});

describe("buildAnnotationSystemPrompt", () => {
  it("describe la extracción con las etapas; la etapa actual va en la nota del turno (F1)", () => {
    const prompt = buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
    });
    expect(prompt).not.toContain("Etapa actual del lead:");
    expect(renderAnnotationTurnState("Calificado")).toContain("Calificado");
    for (const stage of STAGES) {
      expect(prompt).toContain(stage.name);
    }
    expect(prompt).toContain("nombre EXACTO");
    expect(prompt.toLowerCase()).toContain("extraiga");
  });

  it("no incluye zonas ni voz de marca (recorte deliberado)", () => {
    const prompt = buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
    });
    // La sección de zonas trae cobertura y tarifa: nada de eso entra. Se afirma
    // sobre su contenido real (el formato de `renderDeliveryZones`, con tarifa),
    // no sobre un nombre de comuna suelto — el contrato sí puede citar una comuna
    // como EJEMPLO de forma.
    expect(prompt).not.toContain("ZONAS DE ENVÍO");
    expect(prompt).not.toContain("de despacho");
    expect(prompt).not.toContain("sin tarifa definida");
    expect(prompt).not.toContain("Tono:");
    expect(prompt).not.toContain("Saludo sugerido");
    expect(prompt).not.toContain("Reglas de escalado");
  });

  it("NO incluye las instrucciones del negocio: las etapas llevan su criterio (F3)", () => {
    const prompt = buildAnnotationSystemPrompt({
      profile: { ...PROFILE, instructions: "CONDICIONES COMERCIALES\n- pedido mínimo 15 bolsas" },
      stages: [
        { name: "Nuevo", kind: "open", criteria: "Primer contacto sin producto definido." },
        { name: "Interesado", kind: "open", criteria: null },
        { name: "Cliente", kind: "won", criteria: "Confirmó el pago." },
      ],
    });
    expect(prompt).not.toContain("CONDICIONES COMERCIALES");
    expect(prompt).not.toContain("pedido mínimo 15 bolsas");
    expect(prompt).toContain("criterio de entrada");
    expect(prompt).toContain("1. Nuevo — Primer contacto sin producto definido.");
    expect(prompt).toContain("2. Interesado\n");
    expect(prompt).toContain("3. Cliente (ganado) — Confirmó el pago.");
  });

  it("prohíbe los marcadores de posición (hallazgo de la medición de F9)", () => {
    const prompt = buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
      catalog: CATALOGO_REAL,
    });
    // El esqueleto usa "..." como valor y el modelo puede copiarlo como si
    // fuera un dato. Se conserva el esqueleto (guía la COBERTURA de campos) con
    // una regla explícita que lo prohíbe, y el pipeline además los descarta al
    // escribir con `isPlaceholderValue`.
    expect(prompt).toContain("NUNCA escriba los marcadores del ejemplo");
    expect(prompt).toContain('"stage":"<etapa>"');
  });

  it("incluye el vocabulario de productos SIN precios (P2)", () => {
    const prompt = buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
      catalog: CATALOG,
    });
    // El vocabulario que hace falta para reconocer producto y formato…
    expect(prompt).toContain("Pan de hamburguesa");
    expect(prompt).toContain("Brioche");
    expect(prompt).toContain("12 cm");
    // …y NADA de precios: la anotación no cotiza.
    expect(prompt).not.toContain("2.220");
    expect(prompt).not.toContain("2641");
    expect(prompt).not.toContain("IVA");
    expect(prompt).not.toContain("CATÁLOGO DE PRODUCTOS");
  });

  it("sin catálogo el prompt no cambia respecto de no tener productos", () => {
    const sinCatalogo = buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
    });
    expect(buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
      catalog: [],
    })).toBe(sinCatalogo);
    expect(sinCatalogo).not.toContain("PRODUCTOS DEL CATÁLOGO");
  });

});

describe("renderCatalogVocabulary (P2)", () => {
  it("agrupa masas y formatos por producto, sin precios", () => {
    const text = renderCatalogVocabulary([
      { ...CATALOG[0]!, masa: "Brioche", formato: "11 cm" },
      { ...CATALOG[0]!, masa: "Brioche", formato: "12 cm" },
      { ...CATALOG[0]!, masa: "Papa", formato: "12 cm" },
    ]);
    expect(text).toContain("Pan de hamburguesa: masas Brioche, Papa; formatos 11 cm, 12 cm");
    expect(text).not.toContain("$");
    expect(text).not.toContain("neto");
  });

  it("catálogo vacío → cadena vacía (el prompt no cambia)", () => {
    expect(renderCatalogVocabulary([])).toBe("");
  });
});