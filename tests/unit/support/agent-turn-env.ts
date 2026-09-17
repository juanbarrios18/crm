import { vi } from "vitest";

/**
 * Entorno mínimo válido para ejercitar el TURNO del agente (`runAgentTurn`).
 *
 * No alcanza con el token del proveedor: el turno llama a `getEnv()`, que valida
 * la configuración completa —incluida `BUSINESS_TIMEZONE` para la línea temporal
 * del prompt—. Un test que invoque el turno necesita estas variables o `getEnv`
 * lanza.
 *
 * Se centraliza acá para que agregar una variable requerida no obligue a tocar
 * cada test del pipeline. Lo que cada test quiera variar (por ejemplo un token
 * vacío para probar `not_configured`) se pasa por `extra` DESPUÉS de los valores
 * base, así que gana el del test.
 */
export function stubAgentTurnEnv(extra: Record<string, string> = {}): void {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  for (const [key, value] of Object.entries(extra)) {
    vi.stubEnv(key, value);
  }
}
