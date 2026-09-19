/**
 * CLI de re-evaluación del Laboratorio: `pnpm lab:rejudge`.
 *
 * Vuelve a juzgar los transcripts de una corrida existente SIN ejecutar al
 * agente, para medir un cambio del instrumento sin gastar una corrida completa.
 *
 * Modos:
 * - `--snapshot-run <id>`: congela las fuentes de verdad de la configuración
 *   vigente y las adjunta a esa corrida. Es lo que hace reconstruible una
 *   corrida después de que la configuración cambie.
 * - `--run <id> [--passes N]`: re-juzga la corrida N veces (default 3) y muestra
 *   la comparación contra el baseline.
 *
 * `--org <id>` fuerza la organización (por defecto, la primera).
 *
 * La base destino se elige con `DATABASE_URL` en el entorno: `--env-file` no
 * pisa una variable ya definida, así que
 *   DATABASE_URL=<url> pnpm lab:rejudge --run <id>
 * apunta a otra base sin tocar `.env`.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  buildGroundTruth,
  hashSnapshot,
  persistSnapshot,
  toSnapshot,
} from "@/server/lab/snapshot";
import { SnapshotMissingError, rejudgeRun } from "@/server/lab/rejudge";
import {
  computeDisagreement,
  computeJudgeFailureRate,
} from "@/server/lab/run-metrics";

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const db = getDb();

const orgIdArg = arg("--org");
const orgRows = orgIdArg
  ? await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, orgIdArg))
      .limit(1)
  : await db.select().from(schema.organization).limit(1);
const org = orgRows[0];
if (!org) {
  console.error("[lab-rejudge] no hay organización: use --org <id>");
  process.exit(1);
}

// ── Modo instantánea ────────────────────────────────────────────────────────
const snapshotRunId = arg("--snapshot-run");
if (snapshotRunId) {
  const ground = await buildGroundTruth(org.id);
  const snapshot = toSnapshot(ground);
  await persistSnapshot(org.id, snapshotRunId, snapshot);
  console.log(`[lab-rejudge] instantánea adjuntada a ${snapshotRunId}`);
  console.log(`[lab-rejudge] hash: ${hashSnapshot(snapshot)}`);
  console.log(
    `[lab-rejudge] tamaños: conocimiento ${snapshot.kbText.length} · ` +
      `comportamiento ${snapshot.behaviorText.length} · ` +
      `catálogo ${snapshot.catalogText.length} · ` +
      `zonas ${snapshot.zonesText.length}`
  );
  process.exit(0);
}

// ── Modo re-evaluación ──────────────────────────────────────────────────────
const sourceRunId = arg("--run");
if (!sourceRunId) {
  console.error(
    "[lab-rejudge] uso: --snapshot-run <id> | --run <id> [--passes N] [--org <id>]"
  );
  process.exit(1);
}
const passes = Number(arg("--passes") ?? "3");
if (!Number.isInteger(passes) || passes < 1) {
  console.error(`[lab-rejudge] --passes inválido: ${arg("--passes")}`);
  process.exit(1);
}

/** Cuenta hallazgos por tipo. */
function countByType(rows: { tipo: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.tipo] = (out[row.tipo] ?? 0) + 1;
  return out;
}

try {
  const summary = await rejudgeRun({
    organizationId: org.id,
    sourceRunId,
    passes,
    onProgress: (done, total) => {
      if (done === total || done % 25 === 0) {
        console.log(`[lab-rejudge] ${done}/${total} pasadas`);
      }
    },
  });
  console.log("[lab-rejudge] resumen:", JSON.stringify(summary, null, 2));

  // Baseline: veredictos y hallazgos del agente (incluyen los chequeos
  // deterministas; la comparación de tipos de abajo se lee por clase).
  const sourceCases = await db
    .select({
      persona: schema.agentTestCase.persona,
      status: schema.agentTestCase.status,
      veredicto: schema.agentTestCase.veredicto,
      hallazgos: schema.agentTestCase.hallazgos,
    })
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, sourceRunId));

  // Re-evaluación: cada fila es una pasada del juez sobre el mismo material.
  const judgments = await db
    .select({
      sourceCaseId: schema.agentTestJudgment.sourceCaseId,
      persona: schema.agentTestCase.persona,
      pass: schema.agentTestJudgment.pass,
      status: schema.agentTestJudgment.status,
      veredicto: schema.agentTestJudgment.veredicto,
      hallazgos: schema.agentTestJudgment.hallazgos,
    })
    .from(schema.agentTestJudgment)
    .innerJoin(
      schema.agentTestCase,
      eq(schema.agentTestJudgment.sourceCaseId, schema.agentTestCase.id)
    )
    .where(eq(schema.agentTestJudgment.runId, summary.runId))
    .orderBy(asc(schema.agentTestJudgment.pass));

  const flatten = (hallazgos: unknown): { tipo: string }[] => {
    if (!Array.isArray(hallazgos)) return [];
    return hallazgos
      .filter((h): h is { tipo?: unknown } => typeof h === "object" && h !== null)
      .map((h) => ({ tipo: String((h as { tipo?: unknown }).tipo ?? "?") }));
  };

  const verdicts = (rows: { veredicto: string | null }[]) => {
    const out: Record<string, number> = {};
    for (const row of rows) {
      const key = row.veredicto ?? "sin_veredicto";
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  };

  console.log("\n── Veredictos ─────────────────────────────");
  console.log("baseline (casos):   ", JSON.stringify(verdicts(sourceCases)));
  for (let pass = 1; pass <= passes; pass++) {
    const ofPass = judgments.filter((j) => j.pass === pass);
    console.log(`re-evaluación p${pass}:  `, JSON.stringify(verdicts(ofPass)));
  }

  console.log("\n── Hallazgos por tipo ─────────────────────");
  const baseTypes = countByType(sourceCases.flatMap((c) => flatten(c.hallazgos)));
  const rejudgeTypes = countByType(judgments.flatMap((j) => flatten(j.hallazgos)));
  const keys = [
    ...new Set([...Object.keys(baseTypes), ...Object.keys(rejudgeTypes)]),
  ].sort();
  console.log("tipo".padEnd(28), "baseline", " re-juez");
  for (const key of keys) {
    console.log(
      key.padEnd(28),
      String(baseTypes[key] ?? 0).padStart(8),
      String(rejudgeTypes[key] ?? 0).padStart(8)
    );
  }
  console.log("\n── Confiabilidad del instrumento ──────────");
  const baseFailure = computeJudgeFailureRate(sourceCases);
  console.log(
    `baseline:        ${baseFailure.failed}/${baseFailure.total} sin veredicto ` +
      `(${(baseFailure.rate * 100).toFixed(1)}%)`
  );
  for (let pass = 1; pass <= passes; pass++) {
    const ofPass = judgments.filter((j) => j.pass === pass);
    const f = computeJudgeFailureRate(ofPass);
    console.log(
      `re-evaluación p${pass}: ${f.failed}/${f.total} sin veredicto ` +
        `(${(f.rate * 100).toFixed(1)}%)`
    );
  }

  const floor = computeDisagreement(judgments);
  console.log("\n── Piso de ruido (mismo material, solo cambia el juez) ──");
  console.log(
    `casos inestables: ${floor.unstableCases}/${floor.totalCases} → ` +
      `piso ${(floor.noiseFloor * 100).toFixed(1)}%`
  );
  for (const c of floor.cases.filter((c) => c.unstable)) {
    console.log(`  ${c.sourceCaseId}: ${c.veredictos.join(" / ")}`);
  }
  console.log(
    "\n[lab-rejudge] toda diferencia de score por debajo del piso no es un resultado."
  );
} catch (err) {
  if (err instanceof SnapshotMissingError) {
    console.error(`[lab-rejudge] ${err.message}`);
    process.exit(2);
  }
  throw err;
}

process.exit(0);
