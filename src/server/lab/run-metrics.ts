import type { ChatTiming } from "@/lib/ai";

/**
 * Resumen determinista de una corrida del Laboratorio (F0 del plan de
 * optimización de la interacción LLM).
 *
 * La caché y los tokens facturados son el criterio de éxito de las fases de
 * optimización, pero hasta acá vivían solo en `agent_test_case.turn_metrics` y
 * se consultaban a mano. Este resumen los pone en el informe de `pnpm lab:run`
 * para que cada fase se lea contra la anterior sin SQL.
 *
 * `turn_metrics` guarda UN registro por turno con las llamadas del turno ya
 * sumadas (conversación + anotación + corrección), así que acá no se separan
 * por llamada. Puro y sin BD.
 */

export type RunCaseLike = {
  turnMetrics: unknown;
  hallazgos: unknown;
};

export type RunSummary = {
  turnos: number;
  promptTokens: number;
  cachedTokens: number;
  /** Porcentaje de tokens de prompt acreditados como caché, con un decimal. */
  cachePct: number;
  /** (prompt − caché) / turnos. */
  facturadosPorTurno: number;
  turnosConCache: number;
  hallazgosPorTipo: Record<string, number>;
  /** Correcciones del guard determinista (F5), sumadas sobre los turnos. */
  guardViolations: number;
};

function isTiming(value: unknown): value is ChatTiming {
  return typeof value === "object" && value !== null && "promptTokens" in value;
}

export function summarizeRun(cases: RunCaseLike[]): RunSummary {
  let turnos = 0;
  let promptTokens = 0;
  let cachedTokens = 0;
  let turnosConCache = 0;
  let guardViolations = 0;
  const hallazgosPorTipo: Record<string, number> = {};

  for (const c of cases) {
    const metrics = Array.isArray(c.turnMetrics) ? c.turnMetrics : [];
    for (const m of metrics) {
      if (!isTiming(m)) continue;
      turnos += 1;
      promptTokens += m.promptTokens ?? 0;
      const cached = m.cachedTokens ?? 0;
      cachedTokens += cached;
      if (cached > 0) turnosConCache += 1;
      guardViolations += (m as { guardViolations?: number }).guardViolations ?? 0;
    }
    const hallazgos = Array.isArray(c.hallazgos) ? c.hallazgos : [];
    for (const h of hallazgos) {
      const tipo =
        typeof h === "object" && h !== null && typeof (h as { tipo?: unknown }).tipo === "string"
          ? (h as { tipo: string }).tipo
          : "desconocido";
      hallazgosPorTipo[tipo] = (hallazgosPorTipo[tipo] ?? 0) + 1;
    }
  }

  const cachePct =
    promptTokens > 0 ? Math.round((cachedTokens / promptTokens) * 1000) / 10 : 0;
  const facturadosPorTurno =
    turnos > 0 ? (promptTokens - cachedTokens) / turnos : 0;

  return {
    turnos,
    promptTokens,
    cachedTokens,
    cachePct,
    facturadosPorTurno,
    turnosConCache,
    hallazgosPorTipo,
    guardViolations,
  };
}
