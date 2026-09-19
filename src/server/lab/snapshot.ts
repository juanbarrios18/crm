import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  renderCatalog,
  renderDeliveryZones,
  renderKb,
  renderVoice,
} from "@/server/ai/prompts";
import {
  getActiveProductsPublic,
  getActiveZones,
} from "@/server/catalog/queries";
import type { PublicProduct } from "@/lib/catalog";

/**
 * 008 — Instantánea de configuración del Laboratorio.
 *
 * El prompt del juez NO se persiste: se rearma desde la configuración viva de la
 * organización en el momento de juzgar. Eso hace que una corrida deje de ser
 * reconstruible en cuanto la configuración cambia, y que su verificación quede
 * no falsable: no se puede volver a juzgar el mismo material contra las fuentes
 * con las que se juzgó.
 *
 * Acá se congelan esas cuatro fuentes (conocimiento, comportamiento, catálogo y
 * zonas, ya renderizadas) más un hash de contenido. Es lo que permite re-juzgar
 * offline y comparar dos mediciones sobre el mismo material.
 *
 * `catalog` y `zones` también se devuelven en crudo porque el chequeo
 * determinista de hechos compara contra los objetos, no contra el texto; solo las
 * cuatro cadenas se persisten, que es lo único que el juez consume.
 */

/** Fuentes de verdad de un juicio, en el formato exacto que consume el juez. */
export type GroundTruth = {
  kbText: string;
  behaviorText: string;
  catalogText: string;
  zonesText: string;
  catalog: PublicProduct[];
  zones: Awaited<ReturnType<typeof getActiveZones>>;
};

/**
 * Lo que se persiste por corrida. `version` permite evolucionar la forma sin
 * reinterpretar filas viejas: una instantánea de otra versión se descarta en vez
 * de juzgarse mal.
 */
export const ConfigSnapshotSchema = z.object({
  version: z.literal(1),
  kbText: z.string(),
  behaviorText: z.string(),
  catalogText: z.string(),
  zonesText: z.string(),
});

export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;

/**
 * Arma las fuentes de verdad de la organización. Es la única construcción de
 * estas cadenas: el runner la usa para juzgar y la instantánea la congela, así
 * que lo que se persiste es exactamente lo que se usó.
 */
export async function buildGroundTruth(
  organizationId: string
): Promise<GroundTruth> {
  const db = getDb();

  const kbEntries = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));
  const kbText = renderKb(kbEntries);

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  const behaviorText = profile
    ? [
        `Nombre: ${profile.name}`,
        // F6: el juez evalúa contra la voz configurada (estructurada + matiz).
        renderVoice(profile.voice, profile.tone),
        profile.instructions ? `Instrucciones: ${profile.instructions}` : null,
        // 008: el SALUDO viaja al juez. Sin él, el juez no tenía forma de saber
        // que el saludo del agente lo configuró el negocio, y lo marcaba como
        // fórmula de call center: 17 de los 25 hallazgos de tono del baseline.
        profile.greeting ? `Saludo configurado: ${profile.greeting}` : null,
        profile.escalationRules
          ? `Escalado: ${profile.escalationRules}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const catalog = await getActiveProductsPublic(organizationId);
  const zones = await getActiveZones(organizationId);
  const catalogText = renderCatalog(catalog);
  const zonesText = renderDeliveryZones(zones);

  return { kbText, behaviorText, catalogText, zonesText, catalog, zones };
}

/** Reduce las fuentes a lo persistible: solo las cadenas que consume el juez. */
export function toSnapshot(ground: {
  kbText: string;
  behaviorText: string;
  catalogText: string;
  zonesText: string;
}): ConfigSnapshot {
  return {
    version: 1,
    kbText: ground.kbText,
    behaviorText: ground.behaviorText,
    catalogText: ground.catalogText,
    zonesText: ground.zonesText,
  };
}

/**
 * Hash de contenido de la instantánea. Se calcula sobre una serialización con
 * claves en orden fijo (no sobre `JSON.stringify` del objeto) para que un cambio
 * de orden al construir el objeto no produzca un hash distinto del mismo
 * contenido.
 */
export function hashSnapshot(snapshot: ConfigSnapshot): string {
  const canonical = JSON.stringify({
    version: snapshot.version,
    behaviorText: snapshot.behaviorText,
    catalogText: snapshot.catalogText,
    kbText: snapshot.kbText,
    zonesText: snapshot.zonesText,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Persiste la instantánea y su hash en la corrida, dentro de la organización. */
export async function persistSnapshot(
  organizationId: string,
  runId: string,
  snapshot: ConfigSnapshot
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.agentTestRun)
    .set({ configSnapshot: snapshot, configHash: hashSnapshot(snapshot) })
    .where(
      and(
        eq(schema.agentTestRun.id, runId),
        eq(schema.agentTestRun.organizationId, organizationId)
      )
    );
}

/**
 * Carga la instantánea de una corrida. Devuelve `null` cuando no existe o no
 * valida: el llamador decide si eso es un error (re-juzgar exige instantánea) o
 * un caso normal (una corrida que no la necesitaba).
 */
export async function loadSnapshot(
  organizationId: string,
  runId: string
): Promise<ConfigSnapshot | null> {
  const db = getDb();
  const rows = await db
    .select({ configSnapshot: schema.agentTestRun.configSnapshot })
    .from(schema.agentTestRun)
    .where(
      and(
        eq(schema.agentTestRun.id, runId),
        eq(schema.agentTestRun.organizationId, organizationId)
      )
    )
    .limit(1);

  const parsed = ConfigSnapshotSchema.safeParse(rows[0]?.configSnapshot);
  return parsed.success ? parsed.data : null;
}
