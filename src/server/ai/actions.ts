import { z } from "zod";

/**
 * Contratos de salida del agente, UNO por llamada.
 *
 * Antes UNA sola llamada hacía dos trabajos a la vez (conversar y llenar la
 * ficha del CRM) y el modelo terminaba hablándole al esquema en vez de al
 * cliente. Ahora el turno hace DOS llamadas con contratos disjuntos:
 * - `ConversationReply` — la llamada de conversación: solo produce el texto que
 *   recibe el cliente.
 * - `LeadExtraction` — la llamada de anotación: solo extrae datos del lead.
 *
 * El servidor valida cada salida con Zod: lo que no valida no se ejecuta.
 */

/** Llamada 1 — conversación: el modelo solo produce texto para el cliente. */
export const ConversationReply = z.object({
  reply: z.string(),
  handoff: z.boolean().optional(),
});

export type ConversationReplyType = z.infer<typeof ConversationReply>;

/**
 * Llamada 2 — anotación: el modelo solo extrae datos del lead.
 *
 * A PROPÓSITO sin `superRefine` que exija al menos un campo: la extracción puede
 * venir vacía (no había nada que anotar) y eso NO es un error. La decisión de
 * escribir o no la toma el pipeline.
 */
export const LeadExtraction = z.object({
  stage: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  empresa: z.string().min(1).max(200).optional(),
  rubro: z.string().min(1).max(200).optional(),
  comuna: z.string().min(1).max(120).optional(),
  rut: z.string().min(1).max(40).optional(),
  razonSocial: z.string().min(1).max(200).optional(),
  giro: z.string().min(1).max(200).optional(),
  direccionFacturacion: z.string().min(1).max(300).optional(),
  email: z.string().min(1).max(200).optional(),
  frecuenciaDespacho: z.string().min(1).max(120).optional(),
  volumenSemanal: z.string().min(1).max(120).optional(),
  productoInteres: z.string().min(1).max(200).optional(),
  formato: z.string().min(1).max(120).optional(),
});

export type LeadExtractionType = z.infer<typeof LeadExtraction>;

/**
 * Marcadores de posición que un modelo puede devolver cuando copia la FORMA del
 * ejemplo del contrato en vez de omitir un campo vacío.
 *
 * Medido en F9: al adelgazar el prompt de anotación, el modelo empezó a devolver
 * `"..."` como valor de campos que no tenía —el ejemplo del contrato con
 * placeholders pesaba más sin el resto del contexto—. Zod lo acepta (cumple
 * `min(1)`) y el valor terminaba escrito en el contacto, contaminando la ficha y
 * el prompt de los turnos siguientes.
 *
 * Se descartan al ESCRIBIR, no se rechaza la extracción: perder el resto de los
 * campos por un placeholder sería peor que ignorar el placeholder.
 */
const PLACEHOLDERS = new Set([
  "...",
  "..",
  "-",
  "—",
  "n/a",
  "na",
  "null",
  "undefined",
  "sin dato",
  "sin datos",
  "no aplica",
  "no informado",
]);

/** ¿El valor es un marcador de posición en vez de un dato? */
export function isPlaceholderValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return PLACEHOLDERS.has(value.trim().toLowerCase());
}

/**
 * Normaliza un nombre de etapa para comparar: sin tildes, minúsculas, sin
 * espacios sobrantes. El modelo suele devolver variaciones ("Interesados",
 * "EN CONVERSACIÓN", "en conversacion") que no deben fallar la resolución.
 */
function normalizeStageName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    // Quita anotaciones que el modelo copia del prompt: "(ganado)", "[perdido]".
    .replace(/[([{][^)\]}]*[)\]}]+/g, " ")
    // Quita el sufijo de tipo suelto: "cliente - ganado", "cliente — perdido".
    .replace(/\s*[-–—]\s*(ganado|perdido|won|lost)\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tolerancia de plural simple en español: "interesados" → "interesado". */
function singularize(value: string): string {
  return value.endsWith("s") ? value.slice(0, -1) : value;
}

/**
 * Resuelve el nombre de etapa devuelto por el modelo contra las etapas reales
 * de la organización: exacto → normalizado (sin tildes/case/espacios) →
 * singular/plural. Sin match: `null` (nunca mover a ciegas).
 */
export function resolveStage(
  requested: string,
  stages: { id: string; name: string }[]
): { id: string; name: string } | null {
  const exact = stages.find((s) => s.name === requested.trim());
  if (exact) return exact;
  const target = normalizeStageName(requested);
  if (!target) return null;
  const normalized = stages.find((s) => normalizeStageName(s.name) === target);
  if (normalized) return normalized;
  const targetSingular = singularize(target);
  return (
    stages.find(
      (s) => singularize(normalizeStageName(s.name)) === targetSingular
    ) ?? null
  );
}
