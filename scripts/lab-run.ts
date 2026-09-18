/**
 * CLI headless del Laboratorio: `pnpm lab:run`.
 *
 * Antes de este script la única forma de disparar una corrida era
 * `POST /api/lab/runs`, que exige sesión autenticada. Un proceso desatendido no
 * puede abrir una sesión, así que no podía medir. Este script cierra ese hueco:
 * resuelve la organización, llama a `startRun`, espera el resultado y deja el
 * informe en stdout.
 *
 * Modos:
 * - `--check`: resuelve la organización, imprime el estado y sale sin disparar
 *   una corrida. Sirve para verificar el bundle sin consumir presupuesto.
 * - (sin argumentos): dispara una corrida y la espera.
 *
 * No levanta servidor y no abre sesión. Las conversaciones que produce son
 * `is_test`: nunca tocan la API de WhatsApp ni datos de clientes reales.
 *
 * Se bundlea con esbuild (alias @ → ./src), igual que los seeds del repo.
 */
import { readFileSync } from "node:fs";
import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { computeDispersion } from "@/server/lab/judge";
import { PERSONA_LABELS } from "@/server/lab/personas";
import { RunConflictError, startRun } from "@/server/lab/runner";
import { summarizeRun } from "@/server/lab/run-metrics";

/** Persona que motiva la medición: el cliente que escribe con modismos. */
const PERSONA_FOCO = "errores_modismos";

/**
 * Intervalo de sondeo del estado de la corrida. `executeRun` es fire-and-forget
 * dentro del mismo proceso, así que el script no recibe señal: sondea la tabla.
 */
const POLL_MS = 5_000;

/**
 * Pared de tiempo del script. Debe superar el timeout propio del runner
 * (30 minutos) para poder reportar el `failed` que ese timeout produce en vez
 * de abandonar la espera antes.
 */
const HARD_WALL_MS = 45 * 60 * 1000;

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[lab-run] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 2, onnotice: () => {} });
const db = drizzle(sql, { schema });

const checkOnly = process.argv.includes("--check");

const orgs = await db.select().from(schema.organization).limit(1);
const org = orgs[0];
if (!org) {
  console.error(
    "[lab-run] No hay organización: regístrese primero en la app y vuelva a intentar"
  );
  await sql.end();
  process.exit(1);
}

/** Corrida activa de la organización, si existe (el índice parcial lo garantiza). */
async function findRunningRunId(): Promise<string | null> {
  const rows = await db
    .select({ id: schema.agentTestRun.id })
    .from(schema.agentTestRun)
    .where(eq(schema.agentTestRun.status, "running"))
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

if (checkOnly) {
  const running = await findRunningRunId();
  console.log("[lab-run] modo --check: no se dispara ninguna corrida");
  console.log(`[lab-run] organización: ${org.id} (${org.name ?? "sin nombre"})`);
  console.log(`[lab-run] corrida activa: ${running ?? "ninguna"}`);
  console.log(
    `[lab-run] modelo agente: ${process.env.OPENROUTER_MODEL ?? "(default)"}`
  );
  console.log(
    `[lab-run] modelo juez:   ${process.env.OPENROUTER_JUDGE_MODEL ?? "(default)"}`
  );
  await sql.end();
  process.exit(0);
}

let runId: string;
try {
  runId = await startRun(org.id);
  console.log(`[lab-run] corrida disparada: ${runId}`);
} catch (err) {
  if (err instanceof RunConflictError) {
    // Hay una corrida en curso: se espera a esa, no se fuerza una nueva. El
    // lock de la base es la garantía; reintentar no lo esquiva.
    const running = await findRunningRunId();
    if (!running) {
      console.error(
        "[lab-run] conflicto reportado pero no hay corrida activa: estado inconsistente"
      );
      await sql.end();
      process.exit(1);
    }
    console.log(
      `[lab-run] ya hay una corrida en curso (${running}): se espera a esa`
    );
    runId = running;
  } else {
    console.error("[lab-run] no se pudo disparar la corrida:", err);
    await sql.end();
    process.exit(1);
  }
}

const startedAt = Date.now();
let status = "running";
let error: string | null = null;

while (true) {
  if (Date.now() - startedAt > HARD_WALL_MS) {
    console.error(
      `[lab-run] pared de 45 minutos superada esperando ${runId}: se abandona la espera`
    );
    await sql.end();
    process.exit(1);
  }

  const rows = await db
    .select()
    .from(schema.agentTestRun)
    .where(eq(schema.agentTestRun.id, runId))
    .limit(1);
  const run = rows[0];
  if (!run) {
    console.error(`[lab-run] la corrida ${runId} desapareció de la base`);
    await sql.end();
    process.exit(1);
  }

  if (run.status !== "running") {
    status = run.status;
    error = run.error;
    break;
  }

  const done = await db
    .select({ id: schema.agentTestCase.id })
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId));
  console.log(
    `[lab-run] en curso: ${done.length} casos creados, esperando… (${Math.round(
      (Date.now() - startedAt) / 1000
    )} s)`
  );
  await sleep(POLL_MS);
}

const runRows = await db
  .select()
  .from(schema.agentTestRun)
  .where(eq(schema.agentTestRun.id, runId))
  .limit(1);
const run = runRows[0]!;

const cases = await db
  .select()
  .from(schema.agentTestCase)
  .where(eq(schema.agentTestCase.runId, runId))
  .orderBy(
    asc(schema.agentTestCase.persona),
    asc(schema.agentTestCase.repeatIndex)
  );

const dispersion = computeDispersion(cases);

const lineas: string[] = [];
lineas.push("");
lineas.push("=".repeat(72));
lineas.push(`INFORME DE LA CORRIDA ${runId}`);
lineas.push("=".repeat(72));
lineas.push(`estado:       ${status}`);
lineas.push(`score:        ${run.score ?? "sin score"}`);
lineas.push(`modelo:       ${run.model ?? "(sin registrar)"}`);
lineas.push(`juez:         ${run.judgeModel ?? "(sin registrar)"}`);
lineas.push(
  `inicio:       ${run.startedAt.toISOString()}` +
    (run.finishedAt ? `   fin: ${run.finishedAt.toISOString()}` : "")
);
if (error) lineas.push(`error:        ${error}`);
lineas.push(
  `inestables:   ${dispersion.inestables} de ${dispersion.personas.length} personas`
);
// F0: tokens, caché y hallazgos por tipo son el criterio de éxito de las fases
// de optimización; van en el informe para comparar corridas sin SQL.
const resumen = summarizeRun(cases);
lineas.push("");
lineas.push("-- Tokens y caché (todas las llamadas del turno sumadas) --");
lineas.push(`turnos:            ${resumen.turnos}`);
lineas.push(`prompt tokens:     ${resumen.promptTokens}`);
lineas.push(
  `caché:             ${resumen.cachedTokens} (${resumen.cachePct} %) en ${resumen.turnosConCache} turnos`
);
lineas.push(`facturados/turno:  ${Math.round(resumen.facturadosPorTurno)}`);
lineas.push(`guard (correcciones): ${resumen.guardViolations}`);
lineas.push("");
lineas.push("-- Hallazgos por tipo --");
const tipos = Object.entries(resumen.hallazgosPorTipo).sort((a, b) => b[1] - a[1]);
if (tipos.length === 0) lineas.push("ninguno");
for (const [tipo, n] of tipos) lineas.push(`${tipo}: ${n}`);
lineas.push("");
lineas.push("-- Veredicto por persona --");
for (const p of dispersion.personas) {
  const label = PERSONA_LABELS[p.persona] ?? p.persona;
  lineas.push(
    `${p.inestable ? "INESTABLE" : "estable  "} ${p.persona} (${label}): ` +
      `${p.veredictos.join(", ")} [juzgadas: ${p.juzgadas}]`
  );
}

const casosFoco = cases.filter((c) => c.persona === PERSONA_FOCO);
lineas.push("");
lineas.push(
  `-- Transcript completo de ${PERSONA_FOCO} (${casosFoco.length} repeticiones) --`
);
for (const c of casosFoco) {
  lineas.push("");
  lineas.push(
    `[repetición ${c.repeatIndex}] veredicto: ${c.veredicto ?? "sin veredicto"} ` +
      `· estado: ${c.status} · etapa: ${c.initialStage ?? "?"} → ${c.finalStage ?? "?"}`
  );
  const hallazgos = (c.hallazgos ?? []) as {
    tipo: string;
    evidencia: string;
  }[];
  if (hallazgos.length === 0) {
    lineas.push("  hallazgos: ninguno");
  } else {
    for (const h of hallazgos) {
      lineas.push(`  hallazgo [${h.tipo}]: ${h.evidencia}`);
    }
  }
  const transcript = (c.transcript ?? []) as {
    role: "cliente" | "agente";
    text: string;
  }[];
  for (const turn of transcript) {
    const quien = turn.role === "cliente" ? "CLIENTE" : "AGENTE ";
    lineas.push(`  ${quien}: ${turn.text}`);
  }
}

console.log(lineas.join("\n"));

await sql.end();
process.exit(status === "done" ? 0 : 1);
