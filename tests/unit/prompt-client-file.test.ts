import { describe, expect, it } from "vitest";
import {
  buildAgentSystemPrompt,
  capNotes,
  CLIENT_FILE_HEADER,
  CLIENT_FILE_NOTES_MAX_CHARS,
  NOTES_TRUNCATED_MARK,
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

  it("ubica la ficha en la COLA dinámica, después de todo lo estable (P4a)", () => {
    const prompt = build({ clientFile: { name: "Ana" } });
    // Lo estable va primero y de forma contigua; el proveedor cachea por
    // prefijo, así que si algo que cambia por turno se cuela antes, se pierde
    // la caché de todo lo que sigue.
    const estable = [
      'Usted es "Asistente comercial"',
      "Tono:",
      "Instrucciones del negocio:",
      "Reglas de escalado a humano:",
      "CONOCIMIENTO DEL NEGOCIO",
      "CATÁLOGO DE PRODUCTOS",
      "ZONAS DE ENVÍO",
      "Etapas del pipeline",
      "En cada turno responde ÚNICAMENTE", // bloque fijo de reglas
    ];
    const dinamico = ["Etapa actual del lead:", CLIENT_FILE_HEADER];

    const lastEstable = Math.max(...estable.map((s) => prompt.indexOf(s)));
    const firstDinamico = Math.min(...dinamico.map((s) => prompt.indexOf(s)));
    expect(lastEstable).toBeGreaterThanOrEqual(0);
    expect(lastEstable).toBeLessThan(firstDinamico);

    // Y dentro de la cola dinámica se conserva el orden: la ficha cierra el
    // prompt (P1: la línea temporal ya no vive acá).
    const etapaAt = prompt.indexOf("Etapa actual del lead:");
    const fichaAt = prompt.indexOf(CLIENT_FILE_HEADER);
    expect(etapaAt).toBeLessThan(fichaAt);
    expect(prompt).not.toContain("Fecha y hora actuales:");
  });

  it("el bloque de reglas fijas queda ANTES de la etapa actual y de la ficha (P4a)", () => {
    const prompt = build({ clientFile: { name: "Ana" } });
    const rulesAt = prompt.indexOf("En cada turno responde ÚNICAMENTE");
    expect(rulesAt).toBeGreaterThanOrEqual(0);
    expect(rulesAt).toBeLessThan(prompt.indexOf("Etapa actual del lead:"));
    expect(rulesAt).toBeLessThan(prompt.indexOf(CLIENT_FILE_HEADER));
  });
});

/**
 * P6 — tope de LECTURA de las notas. `appendLeadNote` acumula una línea por
 * turno y las notas crecen sin techo en la base: sin tope, con el tiempo la
 * ficha se come el prompt. El tope NO toca la escritura.
 */
describe("capNotes (P6)", () => {
  it("no toca un texto que cabe en el tope", () => {
    const notes = "[IA] Consultó por pan de hamburguesa.";
    expect(capNotes(notes)).toBe(notes);
    expect(capNotes(notes)).not.toContain(NOTES_TRUNCATED_MARK);
  });

  it("recorta espacios sobrantes sin agregar marca", () => {
    expect(capNotes("  [IA] algo  ")).toBe("[IA] algo");
  });

  it("con 30 notas conserva las MÁS RECIENTES y no supera el tope", () => {
    // Notas de largo realista (~70 caracteres): 30 de ellas superan el tope.
    const notes = Array.from(
      { length: 30 },
      (_, i) => `[IA] nota numero ${i + 1}: consulto por despacho y precios`
    ).join("\n");
    const capped = capNotes(notes);

    expect(notes.length).toBeGreaterThan(CLIENT_FILE_NOTES_MAX_CHARS);
    expect(capped.length).toBeLessThanOrEqual(CLIENT_FILE_NOTES_MAX_CHARS);
    expect(capped).toContain(NOTES_TRUNCATED_MARK);
    // La última nota siempre sobrevive: es la más reciente.
    expect(capped).toContain("nota numero 30:");
    // La primera ya no está.
    expect(capped).not.toContain("nota numero 1:");
  });

  it("corta en un salto de línea, sin partir una nota por la mitad", () => {
    const notes = Array.from(
      { length: 200 },
      (_, i) => `[IA] nota ${i + 1}`
    ).join("\n");
    const capped = capNotes(notes);
    const body = capped.slice(NOTES_TRUNCATED_MARK.length + 1);
    // El cuerpo arranca en el inicio de una nota, no a mitad de una.
    expect(body.startsWith("[IA] nota ")).toBe(true);
  });

  it("es determinista: el mismo texto da el mismo recorte", () => {
    const notes = Array.from({ length: 100 }, (_, i) => `[IA] n${i}`).join("\n");
    expect(capNotes(notes)).toBe(capNotes(notes));
  });
});

describe("buildAgentSystemPrompt con notas extensas (P6)", () => {
  it("la ficha no supera el tope aunque la base tenga 30 notas", () => {
    const notes = Array.from(
      { length: 30 },
      (_, i) => `[IA] nota numero ${i + 1}: consulto por despacho y precios`
    ).join("\n");
    const prompt = build({
      profile: { ...PROFILE, instructions: "x" },
      clientFile: { name: "Ana", notes },
    });
    // La ficha cierra el prompt (P1: la línea temporal ya no viaja en el system),
    // así que el bloque va desde su encabezado hasta el final.
    const start = prompt.indexOf(CLIENT_FILE_HEADER);
    const block = prompt.slice(start);
    expect(block).toContain(NOTES_TRUNCATED_MARK);
    expect(block).toContain("nota numero 30:");
    expect(block).not.toContain("nota numero 1:");
    expect(block.length).toBeLessThan(CLIENT_FILE_NOTES_MAX_CHARS + 200);
    // Y el prompt SIN tope habría sido notoriamente más grande.
    expect(prompt).not.toContain("nota numero 1:");
  });

  it("sin notas la ficha es idéntica a la de antes del tope", () => {
    expect(renderClientFile({ name: "Ana", notes: null })).toBe(
      `${CLIENT_FILE_HEADER}\n- Nombre: Ana`
    );
    expect(renderClientFile({ name: "Ana", notes: "   " })).toBe(
      `${CLIENT_FILE_HEADER}\n- Nombre: Ana`
    );
  });

  it("con notas cortas la ficha conserva el texto tal cual", () => {
    expect(renderClientFile({ notes: "[IA] pidió despacho a Macul" })).toBe(
      `${CLIENT_FILE_HEADER}\n- Notas previas: [IA] pidió despacho a Macul`
    );
  });
});
