/**
 * CLI del seed de catálogo: `pnpm seed:products --file=<csv>` (local) o
 * `node seed-products.mjs --file=...` dentro del contenedor. Idempotente:
 * upsert por clave de SKU. Se bundlea con esbuild (alias @ → ./src).
 */
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { upsertProductsFromCsv } from "@/server/catalog/import";

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

function fileArg(): string | null {
  const eq = process.argv.find((a) => a.startsWith("--file="));
  if (eq) return eq.slice("--file=".length);
  const i = process.argv.indexOf("--file");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const file = fileArg();
if (!file) {
  console.error("[seed] Falta --file=<ruta.csv>");
  process.exit(1);
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[seed] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const orgs = await db.select().from(schema.organization).limit(1);
const org = orgs[0];
if (!org) {
  console.error(
    "[seed] No hay organización: regístrate primero en la app y vuelve a correr el seed"
  );
  await sql.end();
  process.exit(1);
}

let csvText: string;
try {
  csvText = readFileSync(file, "utf8");
} catch (err) {
  console.error(`[seed] No se pudo leer el CSV: ${file}`, err);
  await sql.end();
  process.exit(1);
}

const result = await upsertProductsFromCsv(db, org.id, csvText);
console.log(
  `[seed] Catálogo cargado: ${result.inserted} insertados, ${result.updated} actualizados`
);
await sql.end();
process.exit(0);