import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { buildJudgePrompt } from "@/server/ai/prompts";

/** Veredicto estructurado del juez (FR-032, contrato ai.md). */
export const Verdict = z.object({
  veredicto: z.enum(["verde", "amarillo", "rojo"]),
  hallazgos: z.array(
    z.object({
      tipo: z.enum([
        "alucinacion",
        "fuera_de_kb",
        "debio_escalar",
        "tono",
        "afirmacion_sin_evidencia",
      ]),
      evidencia: z.string(),
      sugerencia: z
        .object({ pregunta: z.string(), respuesta: z.string() })
        .optional(),
    })
  ),
});

export type VerdictType = z.infer<typeof Verdict>;

export type JudgeOutcome =
  | {
      status: "done";
      verdict: VerdictType;
      /** Modelo y latencia del juez (Laboratorio). */
      model: string;
      latencyMs: number;
    }
  | { status: "judge_failed"; detail: string };

/**
 * UN turno del juez por conversación, con UNA reintentona por contexto.
 *
 * Capas de recuperación:
 *  1) reintentos de validación de JSON dentro de `chatJson` (salida inválida);
 *  2) si aun así falla, UN segundo intento ADICIONAL con el transcript
 *     compactado, para que un transcript largo (que empuja al modelo a
 *     respuestas truncadas o inválidas) no convierta al caso en `judge_failed`.
 *
 * Si ambos intentos fallan, el caso queda `judge_failed`: veredicto en null,
 * excluido de la mediana de su persona en el score, y con el diagnóstico
 * persistido en `hallazgos` por el runner.
 */

/** Máximo de caracteres por turno en el transcript compactado del reintento. */
export const COMPACT_TURN_MAX_CHARS = 400;

/** Máximo de turnos que se conservan en el transcript compactado. */
export const COMPACT_TURN_LIMIT = 40;

function clip(text: string, max = COMPACT_TURN_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Compacta el transcript para el reintento: recorta cada turno y, si supera el
 * tope de turnos, conserva los primeros y los últimos marcando el hueco. Pura y
 * exportada para poder verificarla aislada.
 */
export function compactTranscript(
  transcript: { role: "cliente" | "agente"; text: string }[]
): { role: "cliente" | "agente"; text: string }[] {
  const clipped = transcript.map((turn) => ({
    role: turn.role,
    text: clip(turn.text),
  }));
  if (clipped.length <= COMPACT_TURN_LIMIT) return clipped;

  const half = Math.floor(COMPACT_TURN_LIMIT / 2);
  const head = clipped.slice(0, half);
  const tail = clipped.slice(clipped.length - (COMPACT_TURN_LIMIT - half));
  return [
    ...head,
    { role: "agente", text: "(…turnos intermedios omitidos…)" },
    ...tail,
  ];
}

export async function judgeCase(input: {
  personaKey: string;
  /** Etiqueta y descripción de la persona: la expectativa que el juez verifica. */
  personaLabel?: string;
  personaDescription?: string;
  transcript: { role: "cliente" | "agente"; text: string }[];
  kbText: string;
  behaviorText: string;
  catalogText: string;
  zonesText: string;
}): Promise<JudgeOutcome> {
  const ask = (
    transcript: { role: "cliente" | "agente"; text: string }[]
  ) => {
    const { system, user } = buildJudgePrompt({
      persona: input.personaKey,
      personaLabel: input.personaLabel,
      personaDescription: input.personaDescription,
      transcript,
      kbText: input.kbText,
      behaviorText: input.behaviorText,
      catalogText: input.catalogText,
      zonesText: input.zonesText,
    });
    return chatJson(
      Verdict,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { judge: true }
    );
  };

  const first = await ask(input.transcript);
  if (first.ok) {
    return {
      status: "done",
      verdict: first.data,
      model: first.model,
      latencyMs: first.latencyMs,
    };
  }

  // Segundo intento con contexto acotado (transcript compactado).
  const second = await ask(compactTranscript(input.transcript));
  if (second.ok) {
    return {
      status: "done",
      verdict: second.data,
      model: second.model,
      latencyMs: second.latencyMs,
    };
  }

  // Diagnóstico operativo: el caso queda visible como judge_failed y aquí
  // queda el porqué de ambos intentos (incluye el raw= truncado del proveedor).
  console.error(
    `[lab] juez falló para ${input.personaKey} tras 2 intentos: ` +
      `${second.error} — ${second.detail} ` +
      `(primer intento: ${first.error} — ${first.detail})`
  );
  return { status: "judge_failed", detail: second.detail };
}

/** Mediana aritmética de una lista no vacía: par → promedio de los dos centrales. */
function medianOf(puntos: number[]): number {
  const sorted = [...puntos].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Score 0-100 de la corrida: promedio de la MEDIANA por persona (FR-033).
 *
 * Cada persona se evalúa N veces; para poder atribuir una mejora al agente y no
 * al ruido, el valor de cada persona es la mediana de los puntos de sus
 * repeticiones juzgadas (verde = 1 · amarillo = 0.5 · rojo = 0). `judge_failed`
 * se excluye del cálculo de su persona. El score de la corrida es el promedio
 * de esas medianas, redondeado. Si ninguna persona tiene al menos una
 * repetición juzgada, devuelve null.
 *
 * Compatibilidad: con una sola repetición por persona la mediana es ese valor,
 * así que el score de las corridas anteriores (un caso por persona) no cambia.
 */
export function computeScore(
  cases: { persona: string; status: string; veredicto: string | null }[]
): number | null {
  const porPersona = new Map<string, number[]>();
  for (const c of cases) {
    if (c.status !== "done" || c.veredicto === null) continue;
    const puntos =
      c.veredicto === "verde" ? 1 : c.veredicto === "amarillo" ? 0.5 : 0;
    const acc = porPersona.get(c.persona) ?? [];
    acc.push(puntos);
    porPersona.set(c.persona, acc);
  }
  if (porPersona.size === 0) return null;

  const medianas = [...porPersona.values()].map((puntos) => medianOf(puntos));
  const promedio = medianas.reduce((acc, m) => acc + m, 0) / medianas.length;
  return Math.round(100 * promedio);
}

/**
 * Dispersión por persona: cuántas repeticiones se juzgaron, sus veredictos y
 * si la persona es inestable (más de un veredicto distinto en la misma
 * corrida). Los veredictos se ordenan por `repeatIndex` cuando está disponible.
 *
 * Una corrida con personas inestables NO permite atribuir cambios: el ruido del
 * instrumento es del mismo orden que la señal, así que una diferencia de score
 * puede ser variación del modelo y no efecto de una edición. `inestables` es
 * cuántas personas quedaron en esa situación.
 */
export function computeDispersion(
  cases: {
    persona: string;
    status: string;
    veredicto: string | null;
    repeatIndex?: number;
  }[]
): {
  personas: {
    persona: string;
    veredictos: string[];
    inestable: boolean;
    juzgadas: number;
  }[];
  inestables: number;
} {
  const porPersona = new Map<
    string,
    { repeatIndex: number; veredicto: string }[]
  >();
  for (const c of cases) {
    const acc = porPersona.get(c.persona) ?? [];
    // El caso se conserva aunque no esté juzgado: la persona aparece con
    // `juzgadas: 0` en lugar de desaparecer del reporte.
    if (c.status === "done" && c.veredicto !== null) {
      acc.push({ repeatIndex: c.repeatIndex ?? 0, veredicto: c.veredicto });
    }
    porPersona.set(c.persona, acc);
  }

  const personas = [...porPersona.entries()].map(([persona, reps]) => {
    const ordenadas = [...reps].sort((a, b) => a.repeatIndex - b.repeatIndex);
    const veredictos = ordenadas.map((r) => r.veredicto);
    return {
      persona,
      veredictos,
      inestable: new Set(veredictos).size > 1,
      juzgadas: veredictos.length,
    };
  });

  return {
    personas,
    inestables: personas.filter((p) => p.inestable).length,
  };
}
