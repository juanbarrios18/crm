/**
 * CLI del seed de catálogo comercial: `pnpm seed:catalog` (local) o
 * `node seed-catalog.mjs` dentro del contenedor.
 *
 * Carga el catálogo de productos y las zonas de envío de Lamas Foods SIN pasar
 * por CSV: los datos viven acá, versionados con el repo. Es idempotente
 * (upsert por clave natural), así que se puede re-correr en prod sin duplicar.
 *
 * Acepta `--org=<organizationId>` para apuntar a una organización concreta;
 * sin eso usa la primera (instancia de un solo negocio).
 * Se bundlea con esbuild (alias @ → ./src).
 */
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { upsertProductRows, type CatalogRow } from "@/server/catalog/import";
import { upsertZoneRows, type ZoneRow } from "@/server/catalog/zones-import";

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Tasa de IVA de referencia (Chile): con IVA = neto * 1.19. */
const IVA_RATE = 1.19;

/**
 * Producto de origen: se declara el precio NETO de la bolsa y las unidades.
 * Los derivados (unitario y con IVA) se calculan igual que en la UI de Ajustes,
 * para que el catálogo no dependa de valores escritos a mano.
 */
type ProductSeed = {
  producto: string;
  masa: string;
  formato: string;
  unidadesPorBolsa: number;
  precioBolsaNeto: number;
  notas?: string;
};

const PRODUCTS: ProductSeed[] = [
  // Pan de hamburguesa
  { producto: "Pan de hamburguesa", masa: "Brioche", formato: "12 cm", unidadesPorBolsa: 6, precioBolsaNeto: 2220 },
  { producto: "Pan de hamburguesa", masa: "Brioche", formato: "11 cm", unidadesPorBolsa: 9, precioBolsaNeto: 3150 },
  { producto: "Pan de hamburguesa", masa: "Brioche", formato: "10 cm", unidadesPorBolsa: 12, precioBolsaNeto: 3960 },
  { producto: "Pan de hamburguesa", masa: "Papa", formato: "12 cm", unidadesPorBolsa: 6, precioBolsaNeto: 2520 },
  { producto: "Pan de hamburguesa", masa: "Papa", formato: "11 cm", unidadesPorBolsa: 9, precioBolsaNeto: 3600 },
  { producto: "Pan de hamburguesa", masa: "Papa", formato: "10 cm", unidadesPorBolsa: 12, precioBolsaNeto: 4560 },
  // Pan de completo
  { producto: "Pan de completo", masa: "Papa", formato: "15 cm", unidadesPorBolsa: 12, precioBolsaNeto: 4080 },
  { producto: "Pan de completo", masa: "Papa", formato: "20 cm", unidadesPorBolsa: 10, precioBolsaNeto: 3600 },
  { producto: "Pan de completo", masa: "Papa", formato: "30 cm", unidadesPorBolsa: 6, precioBolsaNeto: 3600 },
  // Pan ciabatta (misma clave natural que el CSV de origen: "Sin masa"/"Estandar")
  { producto: "Pan ciabatta", masa: "Sin masa", formato: "Estandar", unidadesPorBolsa: 6, precioBolsaNeto: 2400 },
  // Pan de molde
  { producto: "Pan de molde", masa: "Brioche", formato: "Unidad", unidadesPorBolsa: 1, precioBolsaNeto: 2600 },
  {
    producto: "Pan de molde",
    masa: "Blanco XL",
    formato: "22 rebanadas 14x14 cm",
    unidadesPorBolsa: 1,
    precioBolsaNeto: 3600,
  },
];

/**
 * Comunas con cobertura (misma clave natural que el CSV de origen).
 * El matcheo con lo que escribe el cliente lo hace el modelo, así que se
 * conservan los nombres tal cual quedaron cargados para no duplicar filas.
 */
const ZONES: ZoneRow[] = [
  { comuna: "Vitacura", costoDespacho: 6000, activa: true },
  { comuna: "Las Condes", costoDespacho: 5000, activa: true },
  { comuna: "La Reina", costoDespacho: 5000, activa: true },
  { comuna: "Penalolen", costoDespacho: 5000, activa: true },
  { comuna: "La Florida", costoDespacho: 5000, activa: true },
  { comuna: "Providencia", costoDespacho: 5000, activa: true },
  { comuna: "Nunoa", costoDespacho: 5000, activa: true },
  { comuna: "Macul", costoDespacho: 5000, activa: true },
  { comuna: "San Miguel", costoDespacho: 5000, activa: true },
  { comuna: "San Joaquin", costoDespacho: 5000, activa: true },
  { comuna: "Santiago", costoDespacho: 5000, activa: true },
];

function toRows(): CatalogRow[] {
  return PRODUCTS.map((p) => ({
    producto: p.producto,
    masa: p.masa,
    formato: p.formato,
    unidadesPorBolsa: p.unidadesPorBolsa,
    precioUnitarioNeto: roundTo(p.precioBolsaNeto / p.unidadesPorBolsa, 4),
    precioBolsaNeto: p.precioBolsaNeto,
    precioBolsaConIva: roundTo(p.precioBolsaNeto * IVA_RATE, 2),
    activo: true,
    notas: p.notas ?? null,
  }));
}

function orgArg(): string | null {
  const eq = process.argv.find((a) => a.startsWith("--org="));
  return eq ? eq.slice("--org=".length) : null;
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[seed] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const explicitOrg = orgArg();
const orgs = explicitOrg
  ? await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, explicitOrg))
      .limit(1)
  : await db.select().from(schema.organization).limit(1);
const org = orgs[0];
if (!org) {
  console.error(
    "[seed] No hay organización: revisá --org=<id> o regístrate primero en la app"
  );
  await sql.end();
  process.exit(1);
}

const products = await upsertProductRows(db, org.id, toRows());
const zones = await upsertZoneRows(db, org.id, ZONES);

console.log(
  `[seed] Catálogo de "${org.name}": ${products.inserted} productos nuevos, ` +
    `${products.updated} actualizados; ${zones.upserted} zonas de envío.`
);
await sql.end();
process.exit(0);
