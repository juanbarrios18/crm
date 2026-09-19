import { z } from "zod";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { judgeCase } from "@/server/lab/judge";
import { hashSnapshot, loadSnapshot } from "@/server/lab/snapshot";
import { PERSONAS } from "@/server/lab/personas";

/**
 * 008 — Re-evaluación offline del Laboratorio.
 *
 * Vuelve a juzgar los transcripts de una corrida ya guardada SIN ejecutar al
 * agente. Es lo que permite medir un cambio del instrumento sin gastar una
 * corrida completa y sin arrastrar la varianza del agente: el material es
 * idéntico, lo único que cambia es el juez.
 *
 * Qué se persiste es una OBSERVACIÓN DEL JUEZ, no el veredicto final del caso:
 * los chequeos deterministas (pipeline, dialecto, hechos) no se vuelven a
 * aplicar. Son código, no instrumento, y su repetibilidad se prueba con sus
 * propios tests unitarios. Mezclarlos acá haría que una diferencia entre el
 * baseline y la re-evaluación no se pudiera atribuir al juez.
 *
 * Requiere que la corrida origen tenga instantánea de configuración: sin las
 * fuentes con las que se juzgó, el prompt del juez se rearmaría desde la
 * configuración viva y la comparación sería entre dos cosas distintas.
 */

const TurnSchema = z.object({
  role: z.enum(["cliente", "agente"]),
  text: z.string(),
});
const TranscriptSchema = z.array(TurnSchema);

/**
 * Juicios en paralelo. El juez tarda ~30 s por llamada; en serie, 39 casos × 3
 * pasadas superan la hora. Mismo orden de magnitud que la concurrencia del
 * runner (`LAB_CONCURRENCY`).
 */
const REJUDGE_CONCURRENCY = 4;

export type StoredTurn = z.infer<typeof TurnSchema>;

/** La corrida no se puede re-juzgar: le falta la instantánea de configuración. */
export class SnapshotMissingError extends Error {
  constructor(runId: string) {
    super(
      `La corrida ${runId} no tiene instantánea de configuración. Sin las fuentes ` +
        "con las que se juzgó, re-juzgar compararía contra la configuración vigente."
    );
    this.name = "SnapshotMissingError";
  }
}

export type RejudgeSummary = {
  /** Corrida de re-evaluación creada (agrupa las pasadas). */
  runId: string;
  sourceRunId: string;
  cases: number;
  passes: number;
  /** Pasadas nuevas juzgadas en esta ejecución. */
  judged: number;
  /** Pasadas que ya existían y se respetaron (reanudación). */
  reused: number;
  /** Pasadas que el juez no pudo resolver (quedan visibles, no se descartan). */
  failed: number;
};

function parseTranscript(raw: unknown): StoredTurn[] {
  const parsed = TranscriptSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Re-juzga una corrida `passes` veces. Es reanudable: una pasada ya registrada
 * se saltea, así que una interrupción no duplica juicios ni vuelve a gastar
 * llamadas del proveedor.
 */
export async function rejudgeRun(input: {
  organizationId: string;
  sourceRunId: string;
  passes: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<RejudgeSummary> {
  if (input.passes < 1) throw new Error("passes debe ser >= 1");

  const db = getDb();
  const snapshot = await loadSnapshot(input.organizationId, input.sourceRunId);
  if (!snapshot) throw new SnapshotMissingError(input.sourceRunId);

  const sourceCases = await db
    .select({
      id: schema.agentTestCase.id,
      persona: schema.agentTestCase.persona,
      transcript: schema.agentTestCase.transcript,
    })
    .from(schema.agentTestCase)
    .where(
      and(
        eq(schema.agentTestCase.runId, input.sourceRunId),
        eq(schema.agentTestCase.organizationId, input.organizationId)
      )
    )
    .orderBy(
      asc(schema.agentTestCase.repeatIndex),
      asc(schema.agentTestCase.persona)
    );

  if (sourceCases.length === 0) {
    throw new Error(
      `La corrida ${input.sourceRunId} no tiene casos: no hay material para re-juzgar.`
    );
  }

  const env = getEnv();
  const judgeModel =
    env.OPENROUTER_JUDGE_MODEL ?? env.OPENROUTER_MODEL ?? null;

  // Reanudación real: si una re-evaluación anterior de esta misma corrida quedó
  // sin terminar (proceso muerto, timeout), se REUSA su fila. Crear una nueva en
  // cada intento dejaría las pasadas ya pagadas en una corrida huérfana y las
  // volvería a juzgar todas.
  const reusable = await db
    .select({ id: schema.agentTestRun.id })
    .from(schema.agentTestRun)
    .where(
      and(
        eq(schema.agentTestRun.organizationId, input.organizationId),
        eq(schema.agentTestRun.kind, "rejudge"),
        eq(schema.agentTestRun.sourceRunId, input.sourceRunId),
        ne(schema.agentTestRun.status, "done")
      )
    )
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(1);

  const runId = reusable[0]?.id ?? newId("testRun");
  if (!reusable[0]) {
    // La corrida de re-evaluación lleva su propia instantánea: queda
    // auto-descripta y se puede comparar contra otra sin depender de la origen.
    await db.insert(schema.agentTestRun).values({
      id: runId,
      organizationId: input.organizationId,
      status: "running",
      kind: "rejudge",
      sourceRunId: input.sourceRunId,
      judgeModel,
      configSnapshot: snapshot,
      configHash: hashSnapshot(snapshot),
    });
  } else {
    await db
      .update(schema.agentTestRun)
      .set({ status: "running" })
      .where(eq(schema.agentTestRun.id, runId));
  }

  const existing = await db
    .select({
      sourceCaseId: schema.agentTestJudgment.sourceCaseId,
      pass: schema.agentTestJudgment.pass,
    })
    .from(schema.agentTestJudgment)
    .where(eq(schema.agentTestJudgment.runId, runId));
  const seen = new Set(existing.map((e) => `${e.sourceCaseId}:${e.pass}`));

  const byKey = new Map(PERSONAS.map((p) => [p.key, p]));
  const total = sourceCases.length * input.passes;
  let judged = 0;
  let failed = 0;
  let done = 0;

  // Pasadas ya registradas: cuentan para el progreso y NO se vuelven a tocar.
  const pending: { sourceCase: (typeof sourceCases)[number]; pass: number }[] =
    [];
  for (const sourceCase of sourceCases) {
    for (let pass = 1; pass <= input.passes; pass++) {
      if (seen.has(`${sourceCase.id}:${pass}`)) done += 1;
      else pending.push({ sourceCase, pass });
    }
  }
  const reused = done;

  // Pool acotado: el juez tarda ~30 s por llamada. En serie, una re-evaluación de
  // 39 casos × 3 pasadas supera la hora; el runner del Laboratorio usa la misma
  // concurrencia para sus 39 casos.
  const worker = async (): Promise<void> => {
    for (;;) {
      const task = pending.shift();
      if (!task) return;

      const transcript = parseTranscript(task.sourceCase.transcript);
      const persona = byKey.get(task.sourceCase.persona);
      const outcome =
        transcript.length === 0
          ? { status: "judge_failed" as const, detail: "transcript vacío" }
          : await judgeCase({
              personaKey: task.sourceCase.persona,
              personaLabel: persona?.label,
              personaDescription: persona?.description,
              transcript,
              kbText: snapshot.kbText,
              behaviorText: snapshot.behaviorText,
              catalogText: snapshot.catalogText,
              zonesText: snapshot.zonesText,
            });

      const ok = outcome.status === "done";
      await db.insert(schema.agentTestJudgment).values({
        id: newId("testJudgment"),
        organizationId: input.organizationId,
        runId,
        sourceCaseId: task.sourceCase.id,
        pass: task.pass,
        status: ok ? "done" : "judge_failed",
        veredicto: ok ? outcome.veredicto : null,
        hallazgos: ok
          ? outcome.hallazgos
          : [{ tipo: "judge_failed", evidencia: outcome.detail }],
        judgeLatencyMs: ok ? outcome.latencyMs : null,
      });

      if (ok) judged += 1;
      else failed += 1;
      done += 1;
      input.onProgress?.(done, total);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(REJUDGE_CONCURRENCY, pending.length) },
      () => worker()
    )
  );

  await db
    .update(schema.agentTestRun)
    .set({ status: "done", finishedAt: new Date() })
    .where(
      and(
        eq(schema.agentTestRun.id, runId),
        eq(schema.agentTestRun.organizationId, input.organizationId)
      )
    );

  return {
    runId,
    sourceRunId: input.sourceRunId,
    cases: sourceCases.length,
    passes: input.passes,
    judged,
    reused,
    failed,
  };
}
