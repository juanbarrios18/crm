import { asc } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  buildAgentSystemPrompt,
  NIVEL_1_VERDAD_DEL_SISTEMA,
  NIVEL_2_CONDUCTA_UNIVERSAL,
} from "@/server/ai/prompts";
import { getActiveProductsPublic, getActiveZones } from "@/server/catalog/queries";

/**
 * Panel de transparencia del agente.
 *
 * Expone las reglas de código (N1 + N2) tal como están en el producto y el
 * prompt EFECTIVO que recibe el agente con los datos reales de la organización.
 * La interfaz no reescribe ninguna regla: las muestra y las agrupa por tema.
 *
 * El prompt que se devuelve es el BASE: sin la ficha del cliente de turno ni el
 * historial de la conversación (esos se agregan en cada turno del pipeline).
 */

export const dynamic = "force-dynamic";

const CLIENT_FILE_NOTE =
  "Vista previa del prompt base: incluye la configuración, el conocimiento, el " +
  "catálogo y las etapas de esta instancia. No incluye la ficha de un cliente " +
  "concreto ni el historial de la conversación, que se agregan en cada turno.";

export const GET = withAuth(async (session) => {
  const db = getDb();

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) {
    return apiError(404, "not_found", "Perfil del agente no encontrado");
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, session.organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));

  const stages = await db
    .select({
      id: schema.pipelineStage.id,
      name: schema.pipelineStage.name,
      position: schema.pipelineStage.position,
      kind: schema.pipelineStage.kind,
    })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const catalog = await getActiveProductsPublic(session.organizationId);
  const zones = await getActiveZones(session.organizationId);

  const effectivePrompt = buildAgentSystemPrompt({
    profile,
    kb,
    stages,
    currentStage: null,
    catalog,
    zones,
  });

  return Response.json({
    // Referencias directas a las constantes del producto: la interfaz NUNCA
    // recibe una copia reescrita de las reglas.
    rules: {
      nivel1: NIVEL_1_VERDAD_DEL_SISTEMA,
      nivel2: NIVEL_2_CONDUCTA_UNIVERSAL,
    },
    effectivePrompt,
    clientFileNote: CLIENT_FILE_NOTE,
  });
});
