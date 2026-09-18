import { z } from "zod";

/**
 * Voz estructurada del agente (F6).
 *
 * El tono dejó de ser solo texto libre: el tratamiento, el país (dialecto) y el
 * largo de los mensajes son campos, y el código compone la línea de voz del
 * prompt a partir de ellos. El texto libre (`tone`) queda como matiz opcional.
 * Es la configuración que el dueño puede cambiar desde el CRM sin tocar código.
 */
export const AgentVoiceSchema = z.object({
  tratamiento: z.enum(["usted", "tu"]),
  pais: z.string().trim().min(1).max(60),
  largo: z.enum(["corto", "medio"]),
});

export type AgentVoice = z.infer<typeof AgentVoiceSchema>;
