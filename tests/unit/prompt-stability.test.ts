import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/ai";
import type { PublicProduct } from "@/lib/catalog";
import { LAMAS_FOODS_PROFILE } from "@/server/seed/business-profile";
import {
  appendTemporalNote,
  buildAgentSystemPrompt,
  CLOSING_FAREWELL,
  NIVEL_1_VERDAD_DEL_SISTEMA,
  buildAnnotationSystemPrompt,
  CLIENT_FILE_HEADER,
  ESTADO_DEL_TURNO_NOTA,
  renderAnnotationTurnState,
  renderTurnState,
  renderVoice,
  TEMPORAL_NOTE_MARK,
} from "@/server/ai/prompts";

/**
 * F1 — invariante de caché: NADA que cambie por turno entra a un mensaje
 * `system`. El proveedor solo acredita caché con un system idéntico byte a
 * byte, y la etapa, la ficha y la fecha cambian en cada turno. Ese estado viaja
 * en una nota interna al final del último mensaje del cliente.
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
  voice: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const STAGES = [{ name: "Nuevo" }, { name: "Calificado" }, { name: "Ganado" }];
const FIXED_NOW = new Date("2026-09-17T15:30:00Z");

describe("F1 — el system prompt de conversación es función pura de la configuración", () => {
  it("no contiene etapa, ficha ni fecha, y es idéntico entre builds", () => {
    const build = () => buildAgentSystemPrompt({ profile: PROFILE, kb: [], stages: STAGES });
    const prompt = build();
    expect(prompt).not.toContain(CLIENT_FILE_HEADER);
    expect(prompt).not.toContain("Etapa actual del lead:");
    expect(prompt).not.toContain("Fecha y hora actuales:");
    expect(prompt).toBe(build());
  });

  it("le explica al modelo dónde llega el estado del turno", () => {
    const prompt = buildAgentSystemPrompt({ profile: PROFILE, kb: [], stages: STAGES });
    expect(prompt).toContain(ESTADO_DEL_TURNO_NOTA);
    expect(ESTADO_DEL_TURNO_NOTA).toContain(TEMPORAL_NOTE_MARK);
  });
});

describe("F1 — el system prompt de anotación tampoco lleva la etapa actual", () => {
  it("no contiene la etapa actual", () => {
    const prompt = buildAnnotationSystemPrompt({ profile: PROFILE, stages: STAGES });
    expect(prompt).not.toContain("Etapa actual del lead:");
    for (const s of STAGES) expect(prompt).toContain(s.name);
  });
});

describe("renderTurnState", () => {
  it("junta marcador, etapa, ficha y fecha en un solo bloque", () => {
    const state = renderTurnState({
      stage: "Calificado",
      clientFile: { name: "Ana", comuna: "Macul" },
      now: FIXED_NOW,
      timeZone: "America/Santiago",
    });
    expect(state.startsWith(TEMPORAL_NOTE_MARK)).toBe(true);
    expect(state).toContain("Etapa actual del lead: Calificado");
    expect(state).toContain(CLIENT_FILE_HEADER);
    expect(state).toContain("- Nombre: Ana");
    expect(state).toContain("- Comuna: Macul");
    expect(state).toContain("Fecha y hora actuales:");
  });

  it("sin ficha omite el bloque de ficha y declara la etapa ausente", () => {
    const state = renderTurnState({
      stage: null,
      clientFile: null,
      now: FIXED_NOW,
      timeZone: "America/Santiago",
    });
    expect(state).not.toContain(CLIENT_FILE_HEADER);
    expect(state).toContain("Etapa actual del lead: (sin etapa)");
  });

  it("adjunto al último mensaje del cliente deja el system byte a byte igual", () => {
    const system = buildAgentSystemPrompt({ profile: PROFILE, kb: [], stages: STAGES });
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: "hola" },
      { role: "assistant", content: "{\"reply\":\"Hola\"}" },
      { role: "user", content: "precio?" },
    ];
    const state = renderTurnState({
      stage: "Nuevo",
      clientFile: { name: "Ana" },
      now: FIXED_NOW,
      timeZone: "America/Santiago",
    });
    const out = appendTemporalNote(messages, state);
    expect(out[0]).toEqual(messages[0]);
    expect(out[0]!.content).toBe(system);
    expect(out).toHaveLength(4);
    const last = out[out.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content.startsWith("precio?")).toBe(true);
    expect(last.content.endsWith(state)).toBe(true);
  });
});

describe("renderAnnotationTurnState", () => {
  it("lleva marcador y etapa; sin etapa lo declara", () => {
    expect(renderAnnotationTurnState("Calificado")).toBe(
      `${TEMPORAL_NOTE_MARK} Etapa actual del lead: Calificado`
    );
    expect(renderAnnotationTurnState(null)).toContain("(sin etapa)");
  });
});

describe("contrato de anotación (F2)", () => {
  it("pide extraer solo lo que dijo el CLIENTE e ignorar lo que dijo el agente", () => {
    const prompt = buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
    });
    expect(prompt).toContain("Ignore lo que dijo el agente");
    expect(prompt).toContain("para el equipo humano");
  });
});

/**
 * F4 — tamaño del system prompt con el perfil REAL de desarrollo (Lamas Foods):
 * 12 productos, 11 zonas, 5 etapas. La medición de la auditoría daba ≈12.000
 * caracteres (~3.300 tokens) de reglamento; la meta es ≤ 8.500 (~2.100 tokens)
 * sin perder las garantías de N1/N2 ni las fuentes de la voz del negocio.
 */
describe("F4 — poda del system prompt (perfil Lamas Foods)", () => {
  const profile = {
    ...PROFILE,
    name: LAMAS_FOODS_PROFILE.name,
    tone: LAMAS_FOODS_PROFILE.tone,
    instructions: LAMAS_FOODS_PROFILE.instructions,
    escalationRules: LAMAS_FOODS_PROFILE.escalationRules,
    greeting: LAMAS_FOODS_PROFILE.greeting,
  };
  const producto = (
    producto: string,
    masa: string,
    formato: string,
    unidades: number,
    neto: number
  ): PublicProduct => ({
    producto,
    masa,
    formato,
    unidadesPorBolsa: unidades,
    precioUnitarioNeto: neto / unidades,
    precioBolsaNeto: neto,
    precioBolsaConIva: Math.round(neto * 1.19 * 100) / 100,
    imagen: null,
    activo: true,
    notas: null,
  });
  const catalog: PublicProduct[] = [
    producto("Pan ciabatta", "Regular", "Estandar", 6, 2400),
    producto("Pan de completo", "Papa", "30 cm", 6, 3600),
    producto("Pan de completo", "Papa", "20 cm", 10, 3600),
    producto("Pan de completo", "Papa", "15 cm", 12, 4080),
    producto("Pan de hamburguesa", "Brioche", "12 cm", 6, 2220),
    producto("Pan de hamburguesa", "Brioche", "11 cm", 9, 3150),
    producto("Pan de hamburguesa", "Brioche", "10 cm", 12, 3960),
    producto("Pan de hamburguesa", "Papa", "10 cm", 12, 4560),
    producto("Pan de hamburguesa", "Papa", "11 cm", 9, 3600),
    producto("Pan de hamburguesa", "Papa", "12 cm", 6, 2520),
    producto("Pan de molde", "Blanco XL", "22 rebanadas 14x14 cm", 1, 3600),
    producto("Pan de molde", "Brioche", "Unidad", 1, 2600),
  ];
  const zones = [
    "La Florida", "La Reina", "Las Condes", "Macul", "Nunoa", "Penalolen",
    "Providencia", "San Joaquin", "San Miguel", "Santiago", "Vitacura",
  ].map((comuna) => ({ comuna, costoDespacho: comuna === "Vitacura" ? 6000 : 5000 }));
  const stages = [
    { name: "Nuevo" },
    { name: "En conversación" },
    { name: "Interesado" },
    { name: "Cliente", kind: "won" },
    { name: "Perdido", kind: "lost" },
  ];

  const prompt = buildAgentSystemPrompt({ profile, kb: [], stages, catalog, zones });

  it(`ocupa ≤ 8.500 caracteres (actual: ${prompt.length})`, () => {
    expect(prompt.length).toBeLessThanOrEqual(8500);
  });

  it("conserva las garantías y saca las fórmulas de call center", () => {
    for (const line of NIVEL_1_VERDAD_DEL_SISTEMA) expect(prompt).toContain(line);
    expect(prompt).toContain("handoff");
    expect(prompt).not.toContain("Estimado");
    expect(prompt.toLowerCase()).not.toContain("quedamos a su disposición");
    expect(prompt).not.toContain("knowledge base vacío");
    expect(prompt).toContain("FUENTES DE VERDAD");
  });

  it("el catálogo va agrupado por producto y masa, con los números exactos", () => {
    expect(prompt).toContain("Pan de hamburguesa — masa Brioche:");
    expect(prompt).toContain("- 12 cm · bolsa de 6 · $2.220 neto · $2.641,80 con IVA");
    expect(prompt).not.toContain("Pan de hamburguesa — masa Brioche — formato 12 cm");
  });

  it("el cierre determinista no usa fórmula telefónica", () => {
    expect(CLOSING_FAREWELL.toLowerCase()).not.toContain("a la orden");
    expect(CLOSING_FAREWELL.toLowerCase()).not.toContain("disposición");
  });
});

describe("F6 — voz estructurada", () => {
  const voice = { tratamiento: "usted" as const, pais: "Chile", largo: "medio" as const };

  it("compone una sola línea con tratamiento, país y largo, más los matices", () => {
    const line = renderVoice(voice, "Cordial y cercano.");
    expect(line).toBe(
      "Voz: trato de usted, español de Chile, mensajes de 2 a 3 líneas. Matices: Cordial y cercano."
    );
  });

  it("omite los matices si el tono libre está vacío", () => {
    expect(renderVoice(voice, "")).toBe(
      "Voz: trato de usted, español de Chile, mensajes de 2 a 3 líneas."
    );
    expect(renderVoice(voice, null)).not.toContain("Matices");
  });

  it("corto → 1 a 2 líneas y trato de tú", () => {
    const line = renderVoice({ tratamiento: "tu", pais: "México", largo: "corto" }, null);
    expect(line).toContain("trato de tú");
    expect(line).toContain("español de México");
    expect(line).toContain("1 a 2 líneas");
  });

  it("sin voz estructurada cae en la línea de tono de antes, o null si no hay nada", () => {
    expect(renderVoice(null, "Directo")).toBe("Tono: Directo");
    expect(renderVoice(undefined, null)).toBeNull();
    expect(renderVoice(null, "  ")).toBeNull();
  });

  it("el system usa la línea de voz cuando el perfil la tiene", () => {
    const prompt = buildAgentSystemPrompt({
      profile: { ...PROFILE, voice },
      kb: [],
      stages: STAGES,
    });
    expect(prompt).toContain("Voz: trato de usted, español de Chile");
    expect(prompt).not.toContain("Tono: Directo y cordial");
  });
});
