/**
 * Verificación determinista del pipeline en el Laboratorio (FR-030): si la
 * persona debía avanzar de etapa por intención de compra y el lead no se movió,
 * es un defecto del flujo. Se agrega un hallazgo `pipeline` y no se permite un
 * veredicto verde. Puro y sin dependencias: testeable aislado.
 */
export type VerdictLevel = "verde" | "amarillo" | "rojo";

export function applyPipelineCheck(input: {
  expectAdvance: boolean;
  advanced: boolean;
  initialStage: string | null;
  finalStage: string | null;
  veredicto: VerdictLevel;
  hallazgos: unknown[];
}): { veredicto: VerdictLevel; hallazgos: unknown[] } {
  if (!input.expectAdvance || input.advanced) {
    return { veredicto: input.veredicto, hallazgos: input.hallazgos };
  }
  const hallazgo = {
    tipo: "pipeline",
    evidencia:
      `El lead debía avanzar de etapa por la intención de compra, pero ` +
      `quedó en "${input.finalStage ?? "sin etapa"}" (inicio: "${input.initialStage ?? "sin etapa"}").`,
  };
  return {
    veredicto: input.veredicto === "verde" ? "amarillo" : input.veredicto,
    hallazgos: [hallazgo, ...input.hallazgos],
  };
}
