/**
 * CLI del seed de la configuración del negocio: `pnpm seed:business-profile`.
 *
 * Escribe la configuración de Lamas Foods (P0) en el `agent_profile` de la
 * organización. Es IDEMPOTENTE y re-ejecutable: si el perfil existe lo
 * actualiza, y si no lo crea. Se puede correr en prod sin duplicar nada.
 *
 * Acepta `--org=<organizationId>` para apuntar a una organización concreta; sin
 * eso usa la primera (instancia de un solo negocio).
 * Se bundlea con esbuild (alias @ → ./src).
 */
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { LAMAS_FOODS_PROFILE } from "@/server/seed/business-profile";

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

function orgArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--org="));
  return arg ? arg.slice("--org=".length) : null;
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
    "[seed] No hay organización: revise --org=<id> o regístrese primero en la app"
  );
  await sql.end();
  process.exit(1);
}

const existing = await db
  .select({ id: schema.agentProfile.id })
  .from(schema.agentProfile)
  .where(eq(schema.agentProfile.organizationId, org.id))
  .limit(1);

const patch = { ...LAMAS_FOODS_PROFILE, updatedAt: new Date() };

if (existing[0]) {
  await db
    .update(schema.agentProfile)
    .set(patch)
    .where(eq(schema.agentProfile.id, existing[0].id));
} else {
  await db.insert(schema.agentProfile).values({
    id: newId("agentProfile"),
    organizationId: org.id,
    enabled: false,
    ...patch,
  });
}

console.log(
  `[seed] Configuración de "${org.name}" ${existing[0] ? "actualizada" : "creada"}: ` +
    `saludo ${LAMAS_FOODS_PROFILE.greeting.length} chars, ` +
    `instrucciones ${LAMAS_FOODS_PROFILE.instructions.length} chars, ` +
    `escalado ${LAMAS_FOODS_PROFILE.escalationRules.length} chars.`
);
await sql.end();
process.exit(0);
