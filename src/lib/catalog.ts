import { z } from "zod";

/**
 * 005 — Catálogo comercial.
 *
 * La proyección PÚBLICA (`PublicProductSchema`) es el único contrato de salida para
 * clientes, web y agente comercial. El costo vive en `product_cost` y NO forma parte de
 * esta proyección: seguro por omisión (un campo nuevo no se expone hasta que se agrega
 * acá explícitamente). La proyección INTERNA (`InternalProductSchema`) es solo consumo
 * interno (reportes, asistente interno).
 */

/**
 * Normaliza un precio en formato local chileno a número: quita separadores de miles,
 * convierte coma decimal a punto.
 *   "2641,8"  → 2641.8
 *   "2.641,8" → 2641.8
 *   "4284"    → 4284
 */
export function parseLocalPrice(raw: string): number {
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    throw new Error(`precio inválido: "${raw}"`);
  }
  return value;
}

/**
 * Referencia de imagen aceptable para la web pública.
 *
 * Solo rutas internas (`/...`) o URLs `http(s)://`. Se rechazan `javascript:`,
 * `data:` y los esquemas relativos al protocolo (`//host`), porque el valor
 * termina en un `src` de la web pública: uno hostil sería XSS almacenado.
 */
export function isSafeImageRef(value: string): boolean {
  if (value.length === 0 || value.length > 2048) return false;
  // `//host/x.jpg` es relativo al protocolo: se sirve desde otro origen.
  if (value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Campos visibles al cliente (catálogo de venta). Strict: un campo desconocido falla. */export const PublicProductSchema = z
  .object({
    producto: z.string(),
    masa: z.string(),
    formato: z.string(),
    unidadesPorBolsa: z.number().int(),
    precioUnitarioNeto: z.number(),
    precioBolsaNeto: z.number(),
    precioBolsaConIva: z.number(),
    /** Ruta o URL de la foto para la web pública. Null → placeholder. */
    imagen: z.string().nullable(),
    activo: z.boolean(),
    notas: z.string().nullable(),
  })
  .strict();

export type PublicProduct = z.infer<typeof PublicProductSchema>;

/** Campos internos (costo COGS, margen). Solo consumo interno. */
export const InternalProductSchema = PublicProductSchema.extend({
  costo: z.number().nullable(),
  margen: z.number().nullable(),
}).strict();

export type InternalProduct = z.infer<typeof InternalProductSchema>;

type ProductRow = {
  producto: string;
  masa: string;
  formato: string;
  unidadesPorBolsa: number;
  precioUnitarioNeto: string | null;
  precioBolsaNeto: string | null;
  precioBolsaConIva: string | null;
  imagen: string | null;
  activo: boolean;
  notas: string | null;
};

type CostRow = {
  costo: string | null;
  margen: string | null;
};

/** Convierte un row de `product` (numeric como string) a la proyección pública. */
export function serializePublicProduct(row: ProductRow): PublicProduct {
  return PublicProductSchema.parse({
    producto: row.producto,
    masa: row.masa,
    formato: row.formato,
    unidadesPorBolsa: row.unidadesPorBolsa,
    precioUnitarioNeto: Number(row.precioUnitarioNeto),
    precioBolsaNeto: Number(row.precioBolsaNeto),
    precioBolsaConIva: Number(row.precioBolsaConIva),
    imagen: row.imagen,
    activo: row.activo,
    notas: row.notas,
  });
}

/** Convierte a la proyección interna (público + costo/margen del row de cost). */
export function serializeInternalProduct(
  row: ProductRow,
  cost: CostRow | null
): InternalProduct {
  return InternalProductSchema.parse({
    ...serializePublicProduct(row),
    costo: cost?.costo != null ? Number(cost.costo) : null,
    margen: cost?.margen != null ? Number(cost.margen) : null,
  });
}