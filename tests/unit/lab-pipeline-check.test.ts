import { describe, expect, it } from "vitest";
import { applyPipelineCheck } from "@/server/lab/pipeline-check";

/**
 * Check determinista del pipeline en el Laboratorio: si la persona debía
 * avanzar y el lead no se movió, se agrega un hallazgo `pipeline` y el
 * veredicto no puede quedar verde.
 */

describe("applyPipelineCheck", () => {
  it("agrega hallazgo y baja verde→amarillo si no avanzó", () => {
    const out = applyPipelineCheck({
      expectAdvance: true,
      advanced: false,
      initialStage: "Nuevo",
      finalStage: "Nuevo",
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.veredicto).toBe("amarillo");
    expect(out.hallazgos).toHaveLength(1);
    expect((out.hallazgos[0] as { tipo: string }).tipo).toBe("pipeline");
    expect((out.hallazgos[0] as { evidencia: string }).evidencia).toContain(
      "Nuevo"
    );
  });

  it("no cambia nada si avanzó", () => {
    const out = applyPipelineCheck({
      expectAdvance: true,
      advanced: true,
      initialStage: "Nuevo",
      finalStage: "Interesado",
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.veredicto).toBe("verde");
    expect(out.hallazgos).toHaveLength(0);
  });

  it("no cambia nada si no se esperaba avance", () => {
    const out = applyPipelineCheck({
      expectAdvance: false,
      advanced: false,
      initialStage: "Nuevo",
      finalStage: "Nuevo",
      veredicto: "rojo",
      hallazgos: [{ tipo: "tono" }],
    });
    expect(out.veredicto).toBe("rojo");
    expect(out.hallazgos).toHaveLength(1);
  });

  it("preserva un veredicto ya rojo y prepende el hallazgo", () => {
    const out = applyPipelineCheck({
      expectAdvance: true,
      advanced: false,
      initialStage: "Nuevo",
      finalStage: "Nuevo",
      veredicto: "rojo",
      hallazgos: [{ tipo: "alucinacion" }],
    });
    expect(out.veredicto).toBe("rojo");
    expect((out.hallazgos[0] as { tipo: string }).tipo).toBe("pipeline");
    expect(out.hallazgos).toHaveLength(2);
  });
});
