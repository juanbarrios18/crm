import { findVoseo } from "@/lib/voice-register";
import type { VerdictLevel } from "@/server/lab/pipeline-check";

/**
 * Verificación determinista de dialecto en el Laboratorio.
 *
 * El juez LLM podía pasar por alto un agente que respondía con voseo rioplatense
 * a un cliente que escribe en otro registro. Este check cierra ese punto ciego
 * sin depender del modelo: escanea SOLO los turnos del agente y, si encuentra
 * voseo, agrega un hallazgo `dialecto` y fuerza el veredicto a `rojo`.
 *
 * Por qué `rojo` y no `amarillo`: el voseo rioplatense es incorrecto en TODAS
 * las superficies del producto (un negocio chileno o mexicano no lo usa), la
 * detección es determinista por lista explícita de lexemas —sin falsos
 * positivos por terminación, ver `src/lib/voice-register.ts`—, y es exactamente
 * el defecto que el instrumento no estaba viendo. Un falso positivo real es
 * improbable.
 *
 * Limitación conocida: si el cliente escribiera en voseo y el agente lo CITARA
 * textualmente, el turno del agente se marcaría. Hoy ninguna persona del
 * Laboratorio escribe en voseo rioplatense, así que el caso no ocurre. Los
 * turnos del cliente NUNCA se escanean: los guiones de las personas son la voz
 * del cliente, no la del agente.
 *
 * Puro y sin dependencias de BD: testeable aislado, igual que `applyPipelineCheck`.
 */

/** Máximo de caracteres del fragmento que se cita en la evidencia. */
const EVIDENCE_MAX_CHARS = 240;

function clip(text: string, max = EVIDENCE_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function applyDialectCheck(input: {
  transcript: { role: "cliente" | "agente"; text: string }[];
  veredicto: VerdictLevel;
  hallazgos: unknown[];
}): { veredicto: VerdictLevel; hallazgos: unknown[] } {
  // Una sola evidencia por palabra distinta: el mismo lexema repetido en varios
  // turnos no infla el reporte.
  const found = new Map<string, { turno: number; fragmento: string }>();

  input.transcript.forEach((turn, index) => {
    if (turn.role !== "agente") return;
    for (const { word } of findVoseo(turn.text)) {
      const key = word.toLowerCase();
      if (found.has(key)) continue;
      found.set(key, { turno: index + 1, fragmento: clip(turn.text) });
    }
  });

  if (found.size === 0) {
    return { veredicto: input.veredicto, hallazgos: input.hallazgos };
  }

  const nuevos = [...found.entries()].map(([word, meta]) => ({
    tipo: "dialecto",
    evidencia:
      `El turno ${meta.turno} del agente usa "${word}" (voseo rioplatense): ` +
      `"${meta.fragmento}"`,
  }));

  return {
    veredicto: "rojo",
    hallazgos: [...nuevos, ...input.hallazgos],
  };
}
