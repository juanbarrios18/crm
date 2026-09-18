import { describe, expect, it } from "vitest";
import {
  buildAgentSystemPrompt,
  CLIENT_FILE_HEADER,
  renderClientFile,
  renderTurnState,
  type ClientFile,
} from "@/server/ai/prompts";

const NOW = new Date("2026-09-17T15:30:00Z");
const TZ = "America/Santiago";

/**
 * Ficha del cliente en el prompt (FR-030). El turno inyecta los datos
 * comerciales ya capturados para que el agente no los vuelva a preguntar.
 *
 * Dos ramas críticas: sin datos el prompt queda IDÉNTICO al de hoy (no se cuela
 * una sección vacía) y con datos aparece el bloque con cada campo cargado.
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

function build(input: Partial<Parameters<typeof buildAgentSystemPrompt>[0]> = {}) {
  return buildAgentSystemPrompt({
    profile: PROFILE,
    kb: [],
    stages: STAGES,
    ...input,
  });
}

/** Ficha con TODOS los campos nulos: no aporta ningún dato útil. */
const EMPTY_FICHA: ClientFile = {
  name: null,
  notes: null,
  empresa: null,
  rubro: null,
  comuna: null,
  rut: null,
  razonSocial: null,
  giro: null,
  direccionFacturacion: null,
  email: null,
  frecuenciaDespacho: null,
  volumenSemanal: null,
  productoInteres: null,
  formato: null,
};

/** Ficha con TODOS los campos en cadena vacía o solo espacios. */
const BLANK_FICHA: ClientFile = {
  name: "",
  notes: "   ",
  empresa: " ",
  rubro: "",
  comuna: "  ",
  rut: "",
  razonSocial: "",
  giro: "",
  direccionFacturacion: "",
  email: "",
  frecuenciaDespacho: "",
  volumenSemanal: " ",
  productoInteres: "",
  formato: "",
};

const FICHA: ClientFile = {
  name: "Ana Pérez",
  empresa: "Lamas Food",
  rubro: "Panadería",
  comuna: "Macul",
  rut: "76.123.456-7",
  razonSocial: "Lamas SpA",
  giro: "Fabricación de pan",
  direccionFacturacion: "Av. Siempre Viva 742",
  email: "compras@lamas.cl",
  frecuenciaDespacho: "Semanal",
  volumenSemanal: "200 bolsas",
  productoInteres: "Pan de hamburguesa",
  formato: "12 cm",
  notes: "[IA] Pidió cotización formal.",
};

describe("renderClientFile", () => {
  it("devuelve null sin ficha o con la ficha ausente", () => {
    expect(renderClientFile(null)).toBeNull();
    expect(renderClientFile(undefined)).toBeNull();
    expect(renderClientFile({})).toBeNull();
  });

  it("devuelve null cuando todos los campos están vacíos o solo espacios", () => {
    expect(renderClientFile(EMPTY_FICHA)).toBeNull();
    expect(renderClientFile(BLANK_FICHA)).toBeNull();
  });

  it("produce el bloque con encabezado y una viñeta por campo cargado", () => {
    const block = renderClientFile(FICHA);
    expect(block).not.toBeNull();
    expect(block).toContain(CLIENT_FILE_HEADER);
    expect(block).toContain("- Nombre: Ana Pérez");
    expect(block).toContain("- Empresa: Lamas Food");
    expect(block).toContain("- Rubro: Panadería");
    expect(block).toContain("- Comuna: Macul");
    expect(block).toContain("- RUT: 76.123.456-7");
    expect(block).toContain("- Razón social: Lamas SpA");
    expect(block).toContain("- Giro: Fabricación de pan");
    expect(block).toContain("- Dirección de facturación: Av. Siempre Viva 742");
    expect(block).toContain("- Correo: compras@lamas.cl");
    expect(block).toContain("- Frecuencia de despacho: Semanal");
    expect(block).toContain("- Volumen semanal: 200 bolsas");
    expect(block).toContain("- Producto de interés: Pan de hamburguesa");
    expect(block).toContain("- Formato: 12 cm");
    // F2: las notas [IA] nunca se renderizan aunque la ficha las traiga.
    expect(block).not.toContain("Notas previas");
    expect(block).not.toContain("[IA]");
  });

  it("omite las viñetas de los campos ausentes sin inventar valores", () => {
    const block = renderClientFile({ name: "Ana Pérez", empresa: "Lamas Food" });
    expect(block).not.toBeNull();
    expect(block).toContain("- Nombre: Ana Pérez");
    expect(block).toContain("- Empresa: Lamas Food");
    expect(block).not.toContain("- Comuna:");
    expect(block).not.toContain("- Notas previas:");
    expect(block).not.toContain("sin datos");
  });

  it("recorta los espacios de cada valor", () => {
    const block = renderClientFile({ empresa: "  Lamas  ", rubro: "  urgente " });
    expect(block).toContain("- Empresa: Lamas");
    expect(block).toContain("- Rubro: urgente");
    expect(block).not.toContain("  Lamas");
  });

  it("produce bloque cuando el único dato es el nombre", () => {
    const block = renderClientFile({ name: "Ana" });
    expect(block).not.toBeNull();
    expect(block).toContain(CLIENT_FILE_HEADER);
    expect(block).toContain("- Nombre: Ana");
  });
});

describe("la ficha del cliente viaja en la nota del turno, no en el system (F1)", () => {
  it("el system es idéntico con o sin ficha: la ficha no lo toca", () => {
    const base = build();
    expect(base).not.toContain(CLIENT_FILE_HEADER);
    expect(base).toBe(build());
  });

  it("renderTurnState omite el bloque cuando la ficha no aporta datos", () => {
    for (const ficha of [null, undefined, EMPTY_FICHA, BLANK_FICHA]) {
      const state = renderTurnState({ stage: "Nuevo", clientFile: ficha, now: NOW, timeZone: TZ });
      expect(state).not.toContain(CLIENT_FILE_HEADER);
    }
  });

  it("renderTurnState inyecta el bloque con los datos cargados", () => {
    const state = renderTurnState({ stage: "Nuevo", clientFile: FICHA, now: NOW, timeZone: TZ });
    expect(state).toContain(CLIENT_FILE_HEADER);
    expect(state).toContain("- Nombre: Ana Pérez");
    expect(state).toContain("- Comuna: Macul");
    expect(state).toContain("- Correo: compras@lamas.cl");
  });

  it("dentro de la nota del turno el orden es etapa → ficha → fecha", () => {
    const state = renderTurnState({ stage: "Nuevo", clientFile: { name: "Ana" }, now: NOW, timeZone: TZ });
    const etapaAt = state.indexOf("Etapa actual del lead:");
    const fichaAt = state.indexOf(CLIENT_FILE_HEADER);
    const fechaAt = state.indexOf("Fecha y hora actuales:");
    expect(etapaAt).toBeGreaterThanOrEqual(0);
    expect(etapaAt).toBeLessThan(fichaAt);
    expect(fichaAt).toBeLessThan(fechaAt);
  });

  it("el system prompt termina en el bloque de reglas fijas y no lleva fecha", () => {
    const prompt = build();
    expect(prompt).toContain("En cada turno responde ÚNICAMENTE");
    expect(prompt).not.toContain("Etapa actual del lead:");
    expect(prompt).not.toContain("Fecha y hora actuales:");
  });
});

/**
 * F2 — la ficha NUNCA incluye las notas. `appendLeadNote` sigue escribiendo las
 * notas `[IA]` en `contact.notes` para el equipo humano, pero ese registro lo
 * escribe el propio agente y realimentarlo al prompt lo hacía tomar notas de
 * conversaciones previas como pedidos reales (medido en F1).
 */
describe("la ficha nunca incluye notas (F2)", () => {
  it("ignora las notas aunque la ficha las traiga", () => {
    expect(renderClientFile({ name: "Ana", notes: "[IA] algo" })).toBe(
      `${CLIENT_FILE_HEADER}\n- Nombre: Ana`
    );
  });

  it("una ficha que SOLO tiene notas es una ficha vacía", () => {
    expect(renderClientFile({ notes: "[IA] algo" })).toBeNull();
    expect(renderClientFile({ notes: "[IA] a\n[IA] b\n[IA] c" })).toBeNull();
  });

  it("la nota del turno tampoco arrastra notas, por largas que sean", () => {
    const notes = Array.from(
      { length: 30 },
      (_, i) => `[IA] nota numero ${i + 1}: consulto por despacho y precios`
    ).join("\n");
    const state = renderTurnState({
      stage: "Nuevo",
      clientFile: { name: "Ana", notes },
      now: NOW,
      timeZone: TZ,
    });
    expect(state).toContain("- Nombre: Ana");
    expect(state).not.toContain("[IA]");
    expect(state).not.toContain("Notas previas");
    expect(state).not.toContain("nota numero");
  });
});
