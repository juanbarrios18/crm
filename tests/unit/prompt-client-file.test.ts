import { describe, expect, it } from "vitest";
import {
  buildAgentSystemPrompt,
  CLIENT_FILE_HEADER,
  renderClientFile,
  type ClientFile,
} from "@/server/ai/prompts";

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
    expect(block).toContain("- Notas previas: [IA] Pidió cotización formal.");
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
    const block = renderClientFile({ empresa: "  Lamas  ", notes: "  urgente " });
    expect(block).toContain("- Empresa: Lamas");
    expect(block).toContain("- Notas previas: urgente");
    expect(block).not.toContain("  Lamas");
  });

  it("produce bloque cuando el único dato es el nombre", () => {
    const block = renderClientFile({ name: "Ana" });
    expect(block).not.toBeNull();
    expect(block).toContain(CLIENT_FILE_HEADER);
    expect(block).toContain("- Nombre: Ana");
  });
});

describe("buildAgentSystemPrompt con ficha del cliente", () => {
  it("sin datos el prompt es idéntico al de hoy (sin sección vacía)", () => {
    const base = build();
    expect(build({ clientFile: null })).toBe(base);
    expect(build({ clientFile: undefined })).toBe(base);
    expect(build({ clientFile: EMPTY_FICHA })).toBe(base);
    expect(build({ clientFile: BLANK_FICHA })).toBe(base);
    expect(base).not.toContain(CLIENT_FILE_HEADER);
  });

  it("inyecta el bloque con los datos cargados", () => {
    const prompt = build({ clientFile: FICHA });
    expect(prompt).toContain(CLIENT_FILE_HEADER);
    expect(prompt).toContain("- Nombre: Ana Pérez");
    expect(prompt).toContain("- Comuna: Macul");
    expect(prompt).toContain("- Correo: compras@lamas.cl");
  });

  it("ubica el bloque después de la etapa actual y antes de las reglas fijas", () => {
    const prompt = build({ clientFile: { name: "Ana" } });
    const stageAt = prompt.indexOf("Etapa actual del lead:");
    const fichaAt = prompt.indexOf(CLIENT_FILE_HEADER);
    const rulesAt = prompt.indexOf("En cada turno responde ÚNICAMENTE");
    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(fichaAt).toBeGreaterThan(stageAt);
    expect(rulesAt).toBeGreaterThan(fichaAt);
  });
});
