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

/* ============================================================
 * 008 — Confiabilidad del instrumento
 * ============================================================ */

export type JudgeOutcomeLike = {
  status: string;
  veredicto: string | null;
};

/**
 * Tasa de casos sin veredicto de una corrida.
 *
 * `computeScore` los excluye de la mediana de su persona, así que hasta ahora
 * desaparecían del resultado sin aparecer en ninguna métrica. Un instrumento que
 * descarta el 10% de los casos en silencio no es medible: acá se hace visible.
 */
export function computeJudgeFailureRate(cases: JudgeOutcomeLike[]): {
  failed: number;
  total: number;
  /** Proporción 0..1 de casos sin veredicto. */
  rate: number;
} {
  const total = cases.length;
  const failed = cases.filter(
    (c) => c.status !== "done" || c.veredicto === null
  ).length;
  return { failed, total, rate: total > 0 ? failed / total : 0 };
}

export type JudgmentLike = {
  sourceCaseId: string;
  pass: number;
  status: string;
  veredicto: string | null;
};

/**
 * Pasadas VÁLIDAS mínimas para poder juzgar la estabilidad de un caso. Con un
 * solo veredicto no hay nada que comparar: el caso es inobservable, no estable.
 */
export const MIN_VALID_PASSES = 2;

export type CaseDisagreement = {
  sourceCaseId: string;
  /**
   * Veredictos VÁLIDOS observados, en orden de pasada. Excluye las pasadas que el
   * juez no resolvió: un fallo del instrumento no es un veredicto.
   */
  veredictos: string[];
  /** Más de un veredicto distinto entre pasadas válidas del MISMO material. */
  unstable: boolean;
  /** Pasadas que el juez no resolvió para este caso (timeout, salida inválida). */
  failedPasses: number;
  /**
   * El caso quedó con menos de `MIN_VALID_PASSES` veredictos: no alcanza para
   * afirmar estabilidad ni inestabilidad. Se excluye del piso en lugar de
   * contarse como estable, que es lo que hacía antes.
   */
  insufficient: boolean;
};

export type Disagreement = {
  cases: CaseDisagreement[];
  /** Casos observados, incluidos los que no se pudieron evaluar. */
  totalCases: number;
  /** Casos con al menos `MIN_VALID_PASSES` veredictos: los únicos evaluables. */
  evaluableCases: number;
  unstableCases: number;
  /** Casos con menos de `MIN_VALID_PASSES` veredictos. */
  insufficientCases: number;
  /** Pasadas sin veredicto sobre todo el material. */
  failedPasses: number;
  /**
   * Piso de ruido: proporción 0..1 de casos EVALUABLES que cambian de veredicto
   * entre pasadas del mismo material. Es la referencia contra la que se decide si
   * una diferencia de score es señal o variación del juez.
   *
   * Las pasadas fallidas NO cuentan como desacuerdo: su tasa se mide aparte con
   * `computeJudgeFailureRate` y mezclarlas hacía que un timeout se leyera como
   * variabilidad del juez. El denominador son los casos evaluables, no todos.
   */
  noiseFloor: number;
};

/**
 * Dispersión entre pasadas del MISMO material (008).
 *
 * Distinta de `computeDispersion` (judge.ts), que mide inestabilidad entre
 * repeticiones DISTINTAS de una persona — donde el material también cambia. Acá
 * el transcript es idéntico y lo único que varía es el juez, así que esto sí es
 * el ruido del instrumento.
 */
export function computeDisagreement(
  judgments: JudgmentLike[]
): Disagreement {
  const byCase = new Map<string, { veredictos: string[]; failedPasses: number }>();
  for (const judgment of [...judgments].sort((a, b) => a.pass - b.pass)) {
    const entry = byCase.get(judgment.sourceCaseId) ?? {
      veredictos: [],
      failedPasses: 0,
    };
    if (judgment.status === "done" && judgment.veredicto !== null) {
      entry.veredictos.push(judgment.veredicto);
    } else {
      entry.failedPasses += 1;
    }
    byCase.set(judgment.sourceCaseId, entry);
  }

  const cases: CaseDisagreement[] = [...byCase.entries()].map(
    ([sourceCaseId, entry]) => ({
      sourceCaseId,
      veredictos: entry.veredictos,
      unstable: new Set(entry.veredictos).size > 1,
      failedPasses: entry.failedPasses,
      insufficient: entry.veredictos.length < MIN_VALID_PASSES,
    })
  );

  const evaluable = cases.filter((c) => !c.insufficient);
  const unstableCases = evaluable.filter((c) => c.unstable).length;
  const totalCases = cases.length;
  const insufficientCases = totalCases - evaluable.length;
  const failedPasses = cases.reduce((acc, c) => acc + c.failedPasses, 0);

  return {
    cases,
    totalCases,
    evaluableCases: evaluable.length,
    unstableCases,
    insufficientCases,
    failedPasses,
    noiseFloor: evaluable.length > 0 ? unstableCases / evaluable.length : 0,
  };
}