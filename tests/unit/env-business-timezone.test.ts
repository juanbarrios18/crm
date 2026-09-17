import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubAgentTurnEnv } from "./support/agent-turn-env";

/**
 * P6 — `BUSINESS_TIMEZONE` es configuración del negocio y define la fecha y hora
 * que el agente ve en su prompt. Un valor inexistente debe fallar al arrancar,
 * no en cada turno: si no, el turno del agente tira una excepción en producción
 * con cada mensaje entrante.
 */

async function freshGetEnv() {
  vi.resetModules();
  const mod = await import("@/lib/env");
  return mod.getEnv();
}

describe("BUSINESS_TIMEZONE", () => {
  beforeEach(() => {
    stubAgentTurnEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("usa America/Santiago cuando no está configurada", async () => {
    const env = await freshGetEnv();
    expect(env.BUSINESS_TIMEZONE).toBe("America/Santiago");
  });

  it("una cadena vacía equivale a ausente (default)", async () => {
    stubAgentTurnEnv({ BUSINESS_TIMEZONE: "" });
    const env = await freshGetEnv();
    expect(env.BUSINESS_TIMEZONE).toBe("America/Santiago");
  });

  it("acepta una zona IANA válida", async () => {
    stubAgentTurnEnv({ BUSINESS_TIMEZONE: "America/Bogota" });
    const env = await freshGetEnv();
    expect(env.BUSINESS_TIMEZONE).toBe("America/Bogota");
  });

  it("rechaza una zona inexistente con un mensaje accionable", async () => {
    stubAgentTurnEnv({ BUSINESS_TIMEZONE: "America/NoExiste" });
    await expect(freshGetEnv()).rejects.toThrow(/BUSINESS_TIMEZONE/);
  });

  it("rechaza un valor que no es una zona horaria", async () => {
    stubAgentTurnEnv({ BUSINESS_TIMEZONE: "Chile/Verano" });
    await expect(freshGetEnv()).rejects.toThrow(/BUSINESS_TIMEZONE/);
  });
});
