import { describe, expect, it } from "vitest";
import {
  computeDisagreement,
  computeJudgeFailureRate,
  summarizeRun,
} from "@/server/lab/run-metrics";

/**
 * Resumen de tokens, caché y hallazgos por corrida del Laboratorio (F0). Hasta
 * ahora la caché se miraba a mano con SQL después de cada corrida; esto la
 * vuelve parte del informe y comparable entre fases.
 */

const turn = (promptTokens: number, cachedTokens: number | null) => ({
  model: "m",
  latencyMs: 100,
  promptTokens,
  completionTokens: 50,
  cachedTokens,
  provider: null,
});

describe("summarizeRun", () => {
  it("agrega tokens, caché y facturados por turno", () => {
    const out = summarizeRun([
      { turnMetrics: [turn(1000, 0), turn(1000, 800)], hallazgos: [{ tipo: "tono" }] },
      { turnMetrics: [turn(2000, null)], hallazgos: [{ tipo: "hecho" }, { tipo: "tono" }] },
    ]);
    expect(out.turnos).toBe(3);
    expect(out.promptTokens).toBe(4000);
    expect(out.cachedTokens).toBe(800);
    expect(out.cachePct).toBe(20);
    expect(out.facturadosPorTurno).toBeCloseTo((4000 - 800) / 3);
    expect(out.turnosConCache).toBe(1);
    expect(out.hallazgosPorTipo).toEqual({ tono: 2, hecho: 1 });
  });

  it("no divide por cero en una corrida sin turnos", () => {
    const out = summarizeRun([{ turnMetrics: null, hallazgos: null }]);
    expect(out.turnos).toBe(0);
    expect(out.cachePct).toBe(0);
    expect(out.facturadosPorTurno).toBe(0);
  });
});

describe("summarizeRun — correcciones del guard (F5)", () => {
  it("suma guardViolations tratando la ausencia como 0", () => {
    const out = summarizeRun([
      { turnMetrics: [{ ...turn(100, 0), guardViolations: 2 }, turn(100, 0)], hallazgos: [] },
      { turnMetrics: [{ ...turn(100, 0), guardViolations: 1 }], hallazgos: [] },
    ]);
    expect(out.guardViolations).toBe(3);
  });
});

/**
 * 008 — Confiabilidad del instrumento. `computeScore` excluye de la mediana los
 * casos sin veredicto: hasta ahora desaparecían sin dejar rastro. Y el piso de
 * ruido es lo que permite decidir si una diferencia de score es señal.
 */
describe("computeJudgeFailureRate (008)", () => {
  it("cuenta como fallo el veredicto nulo aunque el status sea done", () => {
    const out = computeJudgeFailureRate([
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: null },
      { status: "judge_failed", veredicto: null },
    ]);
    expect(out.failed).toBe(2);
    expect(out.total).toBe(3);
    expect(out.rate).toBeCloseTo(2 / 3);
  });

  it("sin casos la tasa es 0 y no NaN", () => {
    const out = computeJudgeFailureRate([]);
    expect(out.total).toBe(0);
    expect(out.rate).toBe(0);
  });
});

describe("computeDisagreement (008) — piso de ruido", () => {
  const j = (
    sourceCaseId: string,
    pass: number,
    veredicto: string | null,
    status = "done"
  ) => ({ sourceCaseId, pass, status, veredicto });

  it("un caso con el mismo veredicto en todas las pasadas es estable", () => {
    const out = computeDisagreement([
      j("c1", 1, "verde"),
      j("c1", 2, "verde"),
      j("c1", 3, "verde"),
    ]);
    expect(out.unstableCases).toBe(0);
    expect(out.evaluableCases).toBe(1);
    expect(out.noiseFloor).toBe(0);
  });

  it("un solo cambio de veredicto marca el caso como inestable", () => {
    const out = computeDisagreement([
      j("c1", 1, "verde"),
      j("c1", 2, "amarillo"),
      j("c2", 1, "rojo"),
      j("c2", 2, "rojo"),
    ]);
    expect(out.unstableCases).toBe(1);
    expect(out.totalCases).toBe(2);
    expect(out.evaluableCases).toBe(2);
    expect(out.noiseFloor).toBe(0.5);
    expect(out.cases.find((c) => c.sourceCaseId === "c1")?.unstable).toBe(true);
  });

  it("una pasada fallida NO es desacuerdo: sale del piso y se reporta aparte", () => {
    const out = computeDisagreement([
      j("c1", 1, "verde"),
      j("c1", 2, null, "judge_failed"),
      j("c1", 3, "verde"),
    ]);
    expect(out.unstableCases).toBe(0);
    expect(out.noiseFloor).toBe(0);
    expect(out.failedPasses).toBe(1);
    const c1 = out.cases.find((c) => c.sourceCaseId === "c1");
    expect(c1?.veredictos).toEqual(["verde", "verde"]);
    expect(c1?.failedPasses).toBe(1);
    expect(c1?.insufficient).toBe(false);
  });

  it("un caso con una sola pasada válida es inobservable, no estable", () => {
    const out = computeDisagreement([
      j("c1", 1, "verde"),
      j("c1", 2, null, "judge_failed"),
    ]);
    expect(out.unstableCases).toBe(0);
    expect(out.insufficientCases).toBe(1);
    expect(out.evaluableCases).toBe(0);
    // Sin casos evaluables el piso es 0, no NaN.
    expect(out.noiseFloor).toBe(0);
    expect(out.cases[0]?.insufficient).toBe(true);
  });

  it("el denominador del piso excluye los casos inobservables", () => {
    const out = computeDisagreement([
      j("c1", 1, "verde"),
      j("c1", 2, "amarillo"),
      j("c2", 1, "verde"),
      j("c2", 2, null, "judge_failed"),
    ]);
    expect(out.totalCases).toBe(2);
    expect(out.evaluableCases).toBe(1);
    expect(out.insufficientCases).toBe(1);
    expect(out.unstableCases).toBe(1);
    expect(out.noiseFloor).toBe(1);
  });

  it("ordena los veredictos por pasada, sin importar el orden de entrada", () => {
    const out = computeDisagreement([
      j("c1", 3, "rojo"),
      j("c1", 1, "verde"),
      j("c1", 2, "amarillo"),
    ]);
    expect(out.cases[0]?.veredictos).toEqual(["verde", "amarillo", "rojo"]);
  });
});
