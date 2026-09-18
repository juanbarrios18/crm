import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isOrphanRun } from "@/server/lab/orphan-runs";

/**
 * Limpieza al arranque (FR-034): corridas del Laboratorio que quedaron
 * "running" tras un reinicio → fallidas. Solo corre en el runtime Node.
 *
 * Qué se considera huérfana lo decide `isOrphanRun`: en producción, toda
 * corrida `running`; en desarrollo, solo las más viejas que la gracia, porque
 * `pnpm lab:run` corre en otro proceso y un arranque de `pnpm dev` no la mata.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    const db = getDb();
    const running = await db
      .select({ id: schema.agentTestRun.id, startedAt: schema.agentTestRun.startedAt })
      .from(schema.agentTestRun)
      .where(eq(schema.agentTestRun.status, "running"));
    const now = new Date();
    const isProduction = process.env.NODE_ENV === "production";
    const orphans = running.filter((r) =>
      isOrphanRun({ startedAt: r.startedAt, now, isProduction })
    );
    for (const run of orphans) {
      await db
        .update(schema.agentTestRun)
        .set({
          status: "failed",
          error: "Interrumpida por un reinicio del servidor",
          finishedAt: now,
        })
        .where(eq(schema.agentTestRun.id, run.id));
    }
    if (orphans.length > 0) {
      console.log(
        `[boot] ${orphans.length} corrida(s) del Laboratorio huérfana(s) marcada(s) como fallida(s)`
      );
    }
    const respetadas = running.length - orphans.length;
    if (respetadas > 0) {
      console.log(
        `[boot] ${respetadas} corrida(s) running reciente(s) respetada(s) (posible corrida headless)`
      );
    }
  } catch (err) {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    console.error("[boot] limpieza de corridas huérfanas falló:", err);
  }
}
