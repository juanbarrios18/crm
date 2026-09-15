import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * 008 — Costos internos del catálogo (PRIVADO, COGS).
 *
 * El costo vive en un ledger append-only (`product_cost_movement`): cada fila
 * es un movimiento con `vigenteDesde`, no un estado mutable. La selección del
 * costo vigente/histórico es LÓGICA PURA (`selectCostAt`, `selectCurrentCost`,
 * `computeMargin`) testeable sin BD; las queries solo la alimentan.
 *
 * `margen` NO se persiste: es derivado y se calcula on-demand, de modo que
 * nunca se pudre cuando cambia el precio o el costo.
 *
 * Ninguna salida pública (agente comercial, endpoint web, queries.ts) consulta
 * esta tabla. La separación es estructural: el costo interno queda fuera del
 * query path de toda salida al cliente. Toda lectura de dominio pasa por
 * `scoped(...)` (Constitución III).
 */

/** Un movimiento de costo ya normalizado (numeric de drizzle → number). */
export type CostMovement = {
  costoUnitario: number;
  vigenteDesde: Date;
  createdAt: Date;
};

/** Origen del dato de costo. */
export type CostOrigin = "manual" | "compra" | "importacion";

/** Se lanza cuando el costo recibido no es un número finito no negativo. */
export class CostError extends Error {}

/** `a` es posterior a `b`: `vigenteDesde` DESC y luego `createdAt` DESC. */
function isLater(a: CostMovement, b: CostMovement): boolean {
  const byVigente = a.vigenteDesde.getTime() - b.vigenteDesde.getTime();
  if (byVigente !== 0) return byVigente > 0;
  return a.createdAt.getTime() > b.createdAt.getTime();
}

/**
 * El movimiento vigente en una fecha: el último con `vigenteDesde <= at`.
 * `null` si no hay ninguno. No muta el array de entrada.
 */
export function selectCostAt(
  movements: CostMovement[],
  at: Date
): CostMovement | null {
  let best: CostMovement | null = null;
  const cutoff = at.getTime();
  for (const movement of movements) {
    if (movement.vigenteDesde.getTime() > cutoff) continue;
    if (best === null || isLater(movement, best)) best = movement;
  }
  return best;
}

/**
 * El costo vigente ahora: los movimientos con `vigenteDesde` futuro NO cuentan.
 */
export function selectCurrentCost(
  movements: CostMovement[],
  now: Date = new Date()
): CostMovement | null {
  return selectCostAt(movements, now);
}

/**
 * Margen bruto sobre precio neto unitario: `(precio - costo) / precio`,
 * redondeado a 4 decimales. `null` si el precio no es un número positivo
 * (no hay base de comparación). Un costo mayor al precio devuelve margen
 * negativo: es un dato válido, no un error.
 */
export function computeMargin(
  precioUnitarioNeto: number,
  costoUnitario: number
): number | null {
  if (!Number.isFinite(precioUnitarioNeto) || precioUnitarioNeto <= 0) {
    return null;
  }
  const margin = (precioUnitarioNeto - costoUnitario) / precioUnitarioNeto;
  return Math.round(margin * 10000) / 10000;
}

/** Normaliza el row de drizzle (`numeric` llega como string) a `CostMovement`. */
function toMovement(row: {
  costoUnitario: string;
  vigenteDesde: Date;
  createdAt: Date;
}): CostMovement {
  return {
    costoUnitario: Number(row.costoUnitario),
    vigenteDesde: row.vigenteDesde,
    createdAt: row.createdAt,
  };
}

/**
 * Registra un movimiento de costo (append-only). Valida el monto antes de
 * insertar: un costo no finito o negativo es un error de programación, no un
 * dato a persistir. La idempotencia la garantiza el índice parcial
 * `(organization_id, referencia)` cuando el hecho trae `referencia`.
 */
export async function recordProductCost(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  productId: string,
  costoUnitario: number,
  opts: {
    vigenteDesde?: Date;
    origen?: CostOrigin;
    referencia?: string | null;
    nota?: string | null;
  } = {}
): Promise<{ id: string }> {
  if (!Number.isFinite(costoUnitario) || costoUnitario < 0) {
    throw new CostError(
      `recordProductCost: costoUnitario inválido (${costoUnitario}); debe ser un número finito >= 0`
    );
  }
  const inserted = await db
    .insert(schema.productCostMovement)
    .values({
      id: newId("productCostMovement"),
      organizationId,
      productId,
      costoUnitario: String(costoUnitario),
      vigenteDesde: opts.vigenteDesde ?? new Date(),
      origen: opts.origen ?? "manual",
      referencia: opts.referencia ?? null,
      nota: opts.nota ?? null,
    })
    .returning({ id: schema.productCostMovement.id });
  if (!inserted[0]) {
    throw new Error("recordProductCost: no se pudo insertar el movimiento de costo");
  }
  return inserted[0];
}

/** Historia completa de un producto, más reciente primero. */
export async function getProductCostHistory(
  organizationId: string,
  productId: string
): Promise<CostMovement[]> {
  const db = getDb();
  const rows = await db
    .select({
      costoUnitario: schema.productCostMovement.costoUnitario,
      vigenteDesde: schema.productCostMovement.vigenteDesde,
      createdAt: schema.productCostMovement.createdAt,
    })
    .from(schema.productCostMovement)
    .where(
      scoped(
        schema.productCostMovement.organizationId,
        organizationId,
        eq(schema.productCostMovement.productId, productId)
      )
    )
    .orderBy(
      desc(schema.productCostMovement.vigenteDesde),
      desc(schema.productCostMovement.createdAt)
    );
  return rows.map(toMovement);
}

/**
 * Costo vigente por producto (`productId -> costoUnitario`). Solo incluye
 * productos con algún costo cargado. Reduce con la función pura
 * `selectCurrentCost` por producto: la lógica de selección vive en un solo
 * lugar.
 */
export async function getCurrentProductCosts(
  organizationId: string
): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select({
      productId: schema.productCostMovement.productId,
      costoUnitario: schema.productCostMovement.costoUnitario,
      vigenteDesde: schema.productCostMovement.vigenteDesde,
      createdAt: schema.productCostMovement.createdAt,
    })
    .from(schema.productCostMovement)
    .where(scoped(schema.productCostMovement.organizationId, organizationId));

  const byProduct = new Map<string, CostMovement[]>();
  for (const row of rows) {
    const movement = toMovement(row);
    const list = byProduct.get(row.productId);
    if (list) list.push(movement);
    else byProduct.set(row.productId, [movement]);
  }

  const now = new Date();
  const current = new Map<string, number>();
  for (const [productId, movements] of byProduct) {
    const vigente = selectCurrentCost(movements, now);
    if (vigente) current.set(productId, vigente.costoUnitario);
  }
  return current;
}
