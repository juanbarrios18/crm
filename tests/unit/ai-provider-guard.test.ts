import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { isLocalUrl } from "@/lib/env";
import { testProviderGuard } from "@/lib/ai";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("testProviderGuard: el entorno de pruebas no gasta dinero", () => {
  it("mocks activos + proveedor remoto → bloqueado", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    const motivo = testProviderGuard("https://openrouter.ai/api");
    expect(motivo).not.toBeNull();
    expect(motivo).toContain("no puede apuntar a una API real");
  });

  it("mocks activos + ai-mock local → permitido", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(
      testProviderGuard("http://localhost:3000/api/dev/ai-mock")
    ).toBeNull();
  });

  it("mocks activos en producción → permitido (el gate de mocks ya da 404)", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect(testProviderGuard("https://openrouter.ai/api")).toBeNull();
  });

  it("mocks apagados + proveedor remoto → permitido (corrida real deliberada)", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(testProviderGuard("https://openrouter.ai/api")).toBeNull();
  });

  it("el juez queda cubierto: chatJson es la única frontera del proveedor", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(testProviderGuard("https://api.openai.com/v1")).not.toBeNull();
  });

  it("chatJson NO hace ni una request cuando el proveedor es remoto", async () => {
    // El stub de fetch es la aserción real: si nadie lo llama, no hay gasto.
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/test");
    vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-test-suficientemente-largo");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-token-de-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-de-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api");

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { chatJson } = await import("@/lib/ai");
    const res = await chatJson(z.object({ ok: z.boolean() }), [
      { role: "user", content: "hola" },
    ]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain("no puede apuntar a una API real");
    // El bloqueo es RUIDOSO: no degrada en silencio.
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("isLocalUrl", () => {
  it("reconoce las formas locales", () => {
    for (const url of [
      "http://localhost:3000/api/dev/ai-mock",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      "https://localhost",
    ]) {
      expect(isLocalUrl(url)).toBe(true);
    }
  });

  it("rechaza hosts remotos que se parecen a localhost", () => {
    // Comparación por hostname exacto: "localhost" no matchea un dominio ajeno
    // que lo contenga, ni un host real disfrazado.
    for (const url of [
      "https://openrouter.ai/api",
      "https://localhost.evil.com",
      "https://graph.facebook.com",
      "no-es-una-url",
      "",
    ]) {
      expect(isLocalUrl(url)).toBe(false);
    }
  });
});
