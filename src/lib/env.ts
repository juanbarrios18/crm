import { z } from "zod";

/**
 * Validación central del entorno.
 *
 * Lazy + memoizada: se evalúa en el primer uso en runtime, nunca al importar.
 * Durante `next build` no hay secretos (la imagen se construye sin ellos), así
 * que en esa fase se aceptan placeholders — los valores reales llegan al boot.
 */

const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  // Host del CRM cuando la web pública vive en la raíz del dominio. Si falta,
  // se deriva de APP_BASE_URL y, en su defecto, de la convención `admin.*`
  // (ver src/lib/hosts.ts).
  ADMIN_HOST: z.string().optional(),
  // URL absoluta de la web pública, para canonical y Open Graph. Si falta se
  // deriva de APP_BASE_URL quitándole el prefijo `admin.`.
  SITE_BASE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message:
        "ENCRYPTION_KEY debe ser 32 bytes en base64 (genera con: openssl rand -base64 32)",
    }),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default("v25.0"),
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  OPENROUTER_API_TOKEN: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api"),
  OPENROUTER_MODEL: z.string().optional(),
  OPENROUTER_JUDGE_MODEL: z.string().optional(),
  // Modelo de la llamada de ANOTACIÓN (P2). La anotación es extracción, no
  // conversación: un modelo más barato suele alcanzar y baja el costo por turno.
  // Vacío/ausente → usa OPENROUTER_MODEL, como antes.
  OPENROUTER_ANNOTATION_MODEL: z.string().optional(),
  // Nivel de razonamiento del modelo ("low" | "medium" | "high"), si el modelo
  // lo soporta (p. ej. nvidia/nemotron-3-ultra acepta medium/high). Vacío/ausente
  // → usa el default del proveedor. Se manda en el body como `reasoning`/`reasoning_effort`.
  OPENROUTER_REASONING_EFFORT: z
    .enum(["low", "medium", "high"])
    .optional(),
  // Temperatura de muestreo (0-2), opcional. Ausente/vacía → no se envía la
  // clave y el modelo usa su default. Bajarla reduce la variedad de la salida y
  // mejora la repetibilidad de datos del negocio (precios, plazos); subirla
  // aumenta la variedad. chatJson comparte el mismo callProvider, así que la
  // variable alcanza a conversación, anotación y juez por igual.
  OPENROUTER_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  // F3: temperatura propia de la ANOTACIÓN. Es extracción, no conversación:
  // se quiere determinismo. Ausente → 0 (el pipeline lo resuelve así).
  OPENROUTER_ANNOTATION_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  ALLOW_SIGNUP: z.string().optional(),
  // Zona horaria del negocio para la línea de fecha y hora del prompt (P6). Se
  // valida contra Intl: un valor inexistente debe fallar al arrancar, no en cada
  // turno. Es un dato del negocio, así que es configurable.
  BUSINESS_TIMEZONE: z
    .string()
    .default("America/Santiago")
    .refine(isValidTimeZone, {
      message:
        "BUSINESS_TIMEZONE debe ser una zona horaria IANA válida (p. ej. America/Santiago)",
    }),
  AGENT_COALESCE_MS: z.coerce.number().int().min(0).default(6000),
  WA_MOCK_ENABLED: z.string().optional(),
  // Gate de adjuntos entrantes (008): por defecto los archivos adjuntos de
  // WhatsApp se ignoran y se responde un aviso. `true` re-habilita el
  // procesamiento completo (descarga + almacenamiento).
  WA_INBOUND_MEDIA_ENABLED: z.string().optional(),
  // API key de un cerebro externo que conduzca la conversación por /api/bot/*.
  // Sin ella, toda esa superficie responde 401.
  BOT_API_KEY: z.string().optional(),
  // 008: volumen local de adjuntos (constitución II: sin S3/R2).
  MEDIA_DIR: z.string().default("./.dev-media"),
  // 006 — Web Push (VAPID, estándar W3C). Sin estas claves el push queda
  // deshabilitado y la app funciona normal. Genera un par con:
  //   node scripts/generate-vapid.mjs
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@localhost"),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;

/** ¿Intl reconoce esta zona horaria? Un typo debe fallar al arrancar. */
function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("es-CL", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const BUILD_PLACEHOLDERS: Record<string, string> = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  BETTER_AUTH_SECRET: "placeholder-build-secret",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "placeholder-verify-token",
};

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  // Los strings vacíos cuentan como ausentes: los compose/paneles suelen
  // inyectar VAR="" para opcionales y eso debe activar los defaults.
  const source = isBuild
    ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(process.env) }
    : stripEmpty(process.env);
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n  ${missing}\n` +
        "Revisa .env.example para la guía de cada variable."
    );
  }
  cached = parsed.data;
  return cached;
}

function stripEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/** true si el entorno de pruebas interno (mocks) está habilitado y NO es producción. */
export function isMockEnabled(): boolean {
  return (
    process.env.WA_MOCK_ENABLED === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

/**
 * ¿La URL apunta a este entorno local? El proveedor del entorno de pruebas es
 * el ai-mock que sirve la propia app, jamás un host de afuera.
 */
export function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/** true si hay proveedor de IA configurado (token presente y no vacío). */
export function isAiConfigured(): boolean {
  const token = process.env.OPENROUTER_API_TOKEN;
  return typeof token === "string" && token.trim().length > 0;
}

/**
 * true si el procesamiento de adjuntos entrantes de WhatsApp está habilitado.
 * Por defecto (ausente/vacío/false) los adjuntos entrantes se ignoran y se
 * responde un aviso de "no soportados".
 */
export function isInboundMediaEnabled(): boolean {
  return process.env.WA_INBOUND_MEDIA_ENABLED === "true";
}
