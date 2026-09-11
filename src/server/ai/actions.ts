import { z } from "zod";

/**
 * Acción tipada del agente: exactamente UNA por turno (FR-021).
 * El servidor valida cada acción contra sus allowlists (etapas de la org);
 * lo que no valida se degrada, nunca se ejecuta a ciegas.
 */
/**
 * Etapa objetivo del lead: campo INDEPENDIENTE de la acción, presente en toda
 * respuesta. El modelo clasifica el estado comercial en cada turno sin competir
 * con la elección de acción (con `move_stage` como acción única, el modelo
 * elegía `reply` y el lead nunca se movía).
 */
const stageField = { stage: z.string().min(1).optional() };

export const AgentAction = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("none"), ...stageField }),
    z.object({ action: z.literal("reply"), text: z.string().min(1), ...stageField }),
    z.object({
      action: z.literal("update_lead"),
      note: z.string().min(1).optional(),
      reply: z.string().optional(),
      ...stageField,
      // 005 — campos comerciales estructurados del lead (último valor gana).
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
    }),
    z.object({
      action: z.literal("move_stage"),
      stage: z.string().min(1),
      reply: z.string().optional(),
    }),
    z.object({
      action: z.literal("handoff"),
      reason: z.string().optional(),
      farewell: z.string().optional(),
      ...stageField,
    }),
  ])
  .superRefine((val, ctx) => {
    if (
      val.action === "update_lead" &&
      val.note === undefined &&
      val.empresa === undefined &&
      val.rubro === undefined &&
      val.comuna === undefined &&
      val.rut === undefined &&
      val.razonSocial === undefined &&
      val.giro === undefined &&
      val.direccionFacturacion === undefined &&
      val.email === undefined &&
      val.frecuenciaDespacho === undefined &&
      val.volumenSemanal === undefined &&
      val.productoInteres === undefined &&
      val.formato === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "update_lead requiere una nota o al menos un campo estructurado",
      });
    }
  });

export type AgentActionType = z.infer<typeof AgentAction>;

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
 * singular/plural. Sin match: degradar a reply/none (nunca mover a ciegas).
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

/** Degrada una move_stage sin etapa válida (FR-021 / contrato ai.md). */
export function degradeAction(action: AgentActionType): AgentActionType {
  if (action.action === "move_stage") {
    return action.reply
      ? { action: "reply", text: action.reply }
      : { action: "none" };
  }
  return action;
}
