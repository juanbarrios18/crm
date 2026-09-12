import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export function serializeContact(c: typeof schema.contact.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    // 005 — datos comerciales del lead (enriquecidos por el agente).
    empresa: c.empresa ?? null,
    rubro: c.rubro ?? null,
    comuna: c.comuna ?? null,
    rut: c.rut ?? null,
    razonSocial: c.razonSocial ?? null,
    giro: c.giro ?? null,
    direccionFacturacion: c.direccionFacturacion ?? null,
    email: c.email ?? null,
    frecuenciaDespacho: c.frecuenciaDespacho ?? null,
    volumenSemanal: c.volumenSemanal ?? null,
    productoInteres: c.productoInteres ?? null,
    formato: c.formato ?? null,
  };
}

export async function getContactById(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Etapa actual del lead del contacto (si existe). */
export async function getContactStage(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const rows = await db
    .select({ stage: schema.pipelineStage, lead: schema.lead })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
