import type { getDb } from "@/lib/db";
import { upsertZone } from "@/server/catalog/queries";

/**
 * 005 — Import idempotente de zonas de envío desde CSV.
 *
 * Formato esperado (CSV de Lamas Foods):
 * comuna,costo_despacho_neto,activo,notas
 *
 * El costo es la tarifa PÚBLICA que paga el cliente. `activo` en SI/NO.
 * Upsert por (organization_id, comuna): re-importar no duplica (Principio IV).
 */

type ZoneRow = {
  comuna: string;
  costoDespacho: number | null;
  activa: boolean;
};

export type { ZoneRow };

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

export function parseZonesCsv(csvText: string): ZoneRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];
  const [, ...rows] = lines; // salta el encabezado

  return rows.map((line) => {
    const [comuna, costo, activo] = parseCsvLine(line);
    if (!comuna || comuna.trim() === "" || costo === undefined) {
      throw new Error(`Fila inválida (faltan columnas): ${line}`);
    }
    const activoNorm = (activo ?? "").trim().toUpperCase();
    const activa = activoNorm !== "NO" && activoNorm !== "FALSE";
    const costoTrim = costo.trim();
    const costoDespacho = costoTrim === "" ? null : Number(costoTrim.replace(",", "."));
    if (costoDespacho !== null && !Number.isFinite(costoDespacho)) {
      throw new Error(`costo inválido en: ${line}`);
    }
    return { comuna: comuna.trim(), costoDespacho, activa };
  });
}

/** Upsert idempotente de zonas desde CSV. */
export async function upsertZonesFromCsv(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  csvText: string
): Promise<{ upserted: number }> {
  return upsertZoneRows(db, organizationId, parseZonesCsv(csvText));
}

/** Upsert idempotente de zonas ya normalizadas (usado por los seeds de código). */
export async function upsertZoneRows(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  rows: ZoneRow[]
): Promise<{ upserted: number }> {
  for (const row of rows) {
    await upsertZone(db, organizationId, row.comuna, row.costoDespacho, row.activa);
  }
  return { upserted: rows.length };
}