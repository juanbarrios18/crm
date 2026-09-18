import { describe, expect, it } from "vitest";
import { summarizeRun } from "@/server/lab/run-metrics";

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
