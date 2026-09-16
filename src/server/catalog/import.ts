import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { parseLocalPrice } from "@/lib/catalog";

/**
 * 005 — Import idempotente del catálogo desde CSV.
 *
 * Formato esperado (igual al CSV de LamasFoods):
 * producto,masa,formato,unidades_por_bolsa,precio_unitario_neto,precio_bolsa_neto,precio_bolsa_con_iva,activo,notas
 *
 * Precios en formato local chileno ("2641,8", "2.641,8") → normalizados.
 * Upsert por clave natural (organization_id, producto, masa, formato): re-importar
 * no duplica (Principio IV).
 */

/** Fila normalizada del catálogo (misma forma para CSV y seeds de código). */
export type CatalogRow = {
  producto: string;
  masa: string;
  formato: string;
  unidadesPorBolsa: number;
  precioUnitarioNeto: number;
  precioBolsaNeto: number;
  precioBolsaConIva: number;
  activo: boolean;
  notas: string | null;
};

/** Parser CSV mínimo que respeta comillas (campo con coma). */
export function parseCatalogCsv(csvText: string): CatalogRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];
  // Salta encabezado: la primera línea no debe parsearse como fila de datos.
  const [header, ...rows] = lines;
  void header;

  return rows.map((line) => {
    const fields = parseCsvLine(line);
    const [
      producto,
      masa,
      formato,
      unidades,
      precioUnitario,
      precioBolsa,
      precioBolsaIva,
      activo,
      notas,
    ] = fields;

    const required: (string | undefined)[] = [
      producto,
      formato,
      unidades,
      precioUnitario,
      precioBolsa,
      precioBolsaIva,
      activo,
    ];
    // La masa puede venir vacía en el CSV (productos sin masa declarada);
    // se usa un valor por defecto para mantener la clave de SKU y NOT NULL.
    const masaNorm = masa?.trim() ? masa.trim() : "Sin masa";
    if (required.some((f) => f === undefined || f.trim() === "")) {
      throw new Error(`Fila inválida (faltan columnas): ${line}`);
    }

    const activoNorm = activo!.trim().toUpperCase();
    if (activoNorm !== "SI" && activoNorm !== "NO" && activoNorm !== "TRUE" && activoNorm !== "FALSE") {
      throw new Error(`activo inválido en: ${line}`);
    }

    return {
      producto: producto!.trim(),
      masa: masaNorm,
      formato: formato!.trim(),
      unidadesPorBolsa: Number(unidades!.trim()),
      precioUnitarioNeto: parseLocalPrice(precioUnitario!),
      precioBolsaNeto: parseLocalPrice(precioBolsa!),
      precioBolsaConIva: parseLocalPrice(precioBolsaIva!),
      activo: activoNorm === "SI" || activoNorm === "TRUE",
      notas: notas?.trim() ? notas.trim() : null,
    };
  });
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Upsert idempotente del catálogo desde CSV. */
export async function upsertProductsFromCsv(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  csvText: string
): Promise<{ inserted: number; updated: number }> {
  return upsertProductRows(db, organizationId, parseCatalogCsv(csvText));
}

/**
 * Upsert idempotente de filas ya normalizadas (misma clave natural que el CSV).
 * Es la puerta que usan los seeds de código, sin pasar por texto CSV.
 */
export async function upsertProductRows(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  rows: CatalogRow[]
): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await db
      .select({ id: schema.product.id })
      .from(schema.product)
      .where(
        sql`${schema.product.organizationId} = ${organizationId} AND ${schema.product.producto} = ${row.producto} AND ${schema.product.masa} = ${row.masa} AND ${schema.product.formato} = ${row.formato}`
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.product)
        .set({
          unidadesPorBolsa: row.unidadesPorBolsa,
          precioUnitarioNeto: String(row.precioUnitarioNeto),
          precioBolsaNeto: String(row.precioBolsaNeto),
          precioBolsaConIva: String(row.precioBolsaConIva),
          activo: row.activo,
          notas: row.notas,
          updatedAt: new Date(),
        })
        .where(eq(schema.product.id, existing[0].id));
      updated++;
    } else {
      await db.insert(schema.product).values({
        id: newId("product"),
        organizationId,
        producto: row.producto,
        masa: row.masa,
        formato: row.formato,
        unidadesPorBolsa: row.unidadesPorBolsa,
        precioUnitarioNeto: String(row.precioUnitarioNeto),
        precioBolsaNeto: String(row.precioBolsaNeto),
        precioBolsaConIva: String(row.precioBolsaConIva),
        activo: row.activo,
        notas: row.notas,
      });
      inserted++;
    }
  }

  return { inserted, updated };
}