import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { serializePublicProduct } from "@/lib/catalog";

/**
 * 005 — Queries del catálogo comercial.
 *
 * Solamente consulta la proyección PÚBLICA: `product` y `delivery_zone`, NUNCA
 * `product_cost`. La separación es estructural: el costo interno queda fuera del
 * query path de toda salida al cliente / web / agente comercial.
 */

/** Productos activos con la proyección pública. */
export async function getActiveProductsPublic(organizationId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.product)
    .where(
      scoped(
        schema.product.organizationId,
        organizationId,
        eq(schema.product.activo, true)
      )
    )
    .orderBy(asc(schema.product.producto), asc(schema.product.masa));
  return rows.map(serializePublicProduct);
}

/** Zonas de envío activas (comuna + tarifa pública). */
export async function getActiveZones(organizationId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.deliveryZone)
    .where(
      scoped(
        schema.deliveryZone.organizationId,
        organizationId,
        eq(schema.deliveryZone.activa, true)
      )
    )
    .orderBy(asc(schema.deliveryZone.comuna));
  return rows.map((z) => ({
    comuna: z.comuna,
    costoDespacho: z.costoDespacho != null ? Number(z.costoDespacho) : null,
    activa: z.activa,
  }));
}

/** Upsert idempotente de una zona por (organization_id, comuna). */
export async function upsertZone(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  comuna: string,
  costoDespacho: number | null,
  activa: boolean = true
): Promise<{ id: string }> {
  const existing = await db
    .select({ id: schema.deliveryZone.id })
    .from(schema.deliveryZone)
    .where(
      scoped(
        schema.deliveryZone.organizationId,
        organizationId,
        eq(schema.deliveryZone.comuna, comuna)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.deliveryZone)
      .set({
        costoDespacho: costoDespacho != null ? String(costoDespacho) : null,
        activa,
        updatedAt: new Date(),
      })
      .where(eq(schema.deliveryZone.id, existing[0].id));
    return { id: existing[0].id };
  }

  const inserted = await db
    .insert(schema.deliveryZone)
    .values({
      id: newId("deliveryZone"),
      organizationId,
      comuna,
      costoDespacho: costoDespacho != null ? String(costoDespacho) : null,
      activa,
    })
    .returning({ id: schema.deliveryZone.id });
  if (!inserted[0]) throw new Error("upsertZone: no se pudo insertar la zona");
  return inserted[0];
}