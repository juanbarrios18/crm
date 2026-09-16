import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { serializePublicProduct, type PublicProduct } from "@/lib/catalog";

/**
 * 005 — Catálogo comercial, cara ADMINISTRATIVA.
 *
 * A diferencia de `queries.ts` (solo activos, proyección pública de salida),
 * estas funciones listan activos e inactivos y permiten CRUD desde Ajustes.
 * Siguen la misma regla estructural: NUNCA tocan ni devuelven `product_cost`
 * (el costo interno es privado y vive en otra tabla). Toda query pasa por
 * `scoped()` — jamás un WHERE sin tenant.
 */

/** Tasa de IVA de referencia (Chile) para el precio de bolsa con impuesto. */
export const IVA_RATE = 1.19;

export type AdminProduct = PublicProduct & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminZone = {
  id: string;
  comuna: string;
  costoDespacho: number | null;
  activa: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductInput = {
  producto: string;
  masa: string;
  formato: string;
  unidadesPorBolsa: number;
  precioBolsaNeto: number;
  /** Ruta o URL de la foto pública. Null → placeholder en el catálogo. */
  imagen: string | null;
  activo: boolean;
  notas: string | null;
};

export type ProductUpdateInput = Partial<ProductInput>;

export type ZoneInput = {
  comuna: string;
  costoDespacho: number | null;
  activa: boolean;
};

export type ZoneUpdateInput = Partial<ZoneInput>;

/** Se lanza cuando un create/update viola un índice UNIQUE del catálogo. */
export class CatalogConflictError extends Error {}

/** Detecta la violación de unicidad de Postgres (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Cálculo PURO de precios derivados del catálogo.
 *   - unitario neto = bolsa neta / unidades (4 decimales)
 *   - bolsa con IVA = bolsa neta * 1.19 (2 decimales)
 * Exportado para poder testearlo sin base de datos.
 */
export function computePricing(
  precioBolsaNeto: number,
  unidadesPorBolsa: number
): { precioUnitarioNeto: number; precioBolsaConIva: number } {
  if (!Number.isFinite(precioBolsaNeto) || precioBolsaNeto < 0) {
    throw new Error("computePricing: precioBolsaNeto inválido");
  }
  if (!Number.isInteger(unidadesPorBolsa) || unidadesPorBolsa <= 0) {
    throw new Error("computePricing: unidadesPorBolsa inválido");
  }
  return {
    precioUnitarioNeto: roundTo(precioBolsaNeto / unidadesPorBolsa, 4),
    precioBolsaConIva: roundTo(precioBolsaNeto * IVA_RATE, 2),
  };
}

type ProductRow = typeof schema.product.$inferSelect;

function serializeAdminProduct(row: ProductRow): AdminProduct {
  return {
    id: row.id,
    ...serializePublicProduct(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type ZoneRow = typeof schema.deliveryZone.$inferSelect;

function serializeAdminZone(row: ZoneRow): AdminZone {
  return {
    id: row.id,
    comuna: row.comuna,
    costoDespacho: row.costoDespacho != null ? Number(row.costoDespacho) : null,
    activa: row.activa,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ============================================================
 * Productos
 * ============================================================ */

/** TODOS los productos (activos e inactivos), ordenados por SKU. */
export async function listProductsAdmin(
  organizationId: string
): Promise<AdminProduct[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.product)
    .where(scoped(schema.product.organizationId, organizationId))
    .orderBy(
      asc(schema.product.producto),
      asc(schema.product.masa),
      asc(schema.product.formato)
    );
  return rows.map(serializeAdminProduct);
}

export async function createProduct(
  organizationId: string,
  input: ProductInput
): Promise<AdminProduct> {
  const db = getDb();
  const { precioUnitarioNeto, precioBolsaConIva } = computePricing(
    input.precioBolsaNeto,
    input.unidadesPorBolsa
  );

  try {
    const inserted = await db
      .insert(schema.product)
      .values({
        id: newId("product"),
        organizationId,
        producto: input.producto,
        masa: input.masa,
        formato: input.formato,
        unidadesPorBolsa: input.unidadesPorBolsa,
        precioUnitarioNeto: String(precioUnitarioNeto),
        precioBolsaNeto: String(input.precioBolsaNeto),
        precioBolsaConIva: String(precioBolsaConIva),
        imagen: input.imagen,
        activo: input.activo,
        notas: input.notas,
      })
      .returning();
    if (!inserted[0]) throw new Error("createProduct: no se pudo insertar");
    return serializeAdminProduct(inserted[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CatalogConflictError(
        "Ya existe un producto con esa combinación de producto, masa y formato"
      );
    }
    throw err;
  }
}

/**
 * Actualiza solo los campos provistos; recomputa unitario/con IVA a partir del
 * precio de bolsa y las unidades resultantes. Devuelve null si la fila no
 * existe (o es de otra organización) para que la ruta responda 404.
 */
export async function updateProduct(
  organizationId: string,
  id: string,
  input: ProductUpdateInput
): Promise<AdminProduct | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.product)
    .where(
      scoped(
        schema.product.organizationId,
        organizationId,
        eq(schema.product.id, id)
      )
    )
    .limit(1);
  const current = rows[0];
  if (!current) return null;

  const unidadesPorBolsa = input.unidadesPorBolsa ?? current.unidadesPorBolsa;
  const precioBolsaNeto =
    input.precioBolsaNeto ?? Number(current.precioBolsaNeto);
  const { precioUnitarioNeto, precioBolsaConIva } = computePricing(
    precioBolsaNeto,
    unidadesPorBolsa
  );

  try {
    const updated = await db
      .update(schema.product)
      .set({
        producto: input.producto ?? current.producto,
        masa: input.masa ?? current.masa,
        formato: input.formato ?? current.formato,
        unidadesPorBolsa,
        precioUnitarioNeto: String(precioUnitarioNeto),
        precioBolsaNeto: String(precioBolsaNeto),
        precioBolsaConIva: String(precioBolsaConIva),
        imagen: input.imagen !== undefined ? input.imagen : current.imagen,
        activo: input.activo ?? current.activo,
        notas: input.notas !== undefined ? input.notas : current.notas,
        updatedAt: new Date(),
      })
      .where(
        scoped(
          schema.product.organizationId,
          organizationId,
          eq(schema.product.id, id)
        )
      )
      .returning();
    if (!updated[0]) return null;
    return serializeAdminProduct(updated[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CatalogConflictError(
        "Ya existe un producto con esa combinación de producto, masa y formato"
      );
    }
    throw err;
  }
}

/** Borra el producto; su `product_cost` cae por FK ON DELETE CASCADE. */
export async function deleteProduct(
  organizationId: string,
  id: string
): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(schema.product)
    .where(
      scoped(
        schema.product.organizationId,
        organizationId,
        eq(schema.product.id, id)
      )
    )
    .returning({ id: schema.product.id });
  return deleted.length > 0;
}

/* ============================================================
 * Zonas de envío
 * ============================================================ */

/** TODAS las zonas (activas e inactivas), ordenadas por comuna. */
export async function listZonesAdmin(
  organizationId: string
): Promise<AdminZone[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.deliveryZone)
    .where(scoped(schema.deliveryZone.organizationId, organizationId))
    .orderBy(asc(schema.deliveryZone.comuna));
  return rows.map(serializeAdminZone);
}

export async function createZone(
  organizationId: string,
  input: ZoneInput
): Promise<AdminZone> {
  const db = getDb();
  try {
    const inserted = await db
      .insert(schema.deliveryZone)
      .values({
        id: newId("deliveryZone"),
        organizationId,
        comuna: input.comuna,
        costoDespacho:
          input.costoDespacho != null ? String(input.costoDespacho) : null,
        activa: input.activa,
      })
      .returning();
    if (!inserted[0]) throw new Error("createZone: no se pudo insertar");
    return serializeAdminZone(inserted[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CatalogConflictError(
        "Ya existe una zona de envío para esa comuna"
      );
    }
    throw err;
  }
}

export async function updateZone(
  organizationId: string,
  id: string,
  input: ZoneUpdateInput
): Promise<AdminZone | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.deliveryZone)
    .where(
      scoped(
        schema.deliveryZone.organizationId,
        organizationId,
        eq(schema.deliveryZone.id, id)
      )
    )
    .limit(1);
  const current = rows[0];
  if (!current) return null;

  const costoDespacho =
    input.costoDespacho !== undefined
      ? input.costoDespacho
      : current.costoDespacho != null
        ? Number(current.costoDespacho)
        : null;

  try {
    const updated = await db
      .update(schema.deliveryZone)
      .set({
        comuna: input.comuna ?? current.comuna,
        costoDespacho:
          costoDespacho != null ? String(costoDespacho) : null,
        activa: input.activa ?? current.activa,
        updatedAt: new Date(),
      })
      .where(
        scoped(
          schema.deliveryZone.organizationId,
          organizationId,
          eq(schema.deliveryZone.id, id)
        )
      )
      .returning();
    if (!updated[0]) return null;
    return serializeAdminZone(updated[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new CatalogConflictError(
        "Ya existe una zona de envío para esa comuna"
      );
    }
    throw err;
  }
}

export async function deleteZone(
  organizationId: string,
  id: string
): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(schema.deliveryZone)
    .where(
      scoped(
        schema.deliveryZone.organizationId,
        organizationId,
        eq(schema.deliveryZone.id, id)
      )
    )
    .returning({ id: schema.deliveryZone.id });
  return deleted.length > 0;
}
