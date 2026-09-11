import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { extractJson } from "@/lib/ai";

// chatJson lee getEnv() que cachea; se importa fresco en cada test de chatJson
// (los envs cambian entre tests) vía vi.resetModules.
async function getChatJson() {
  const mod = await import("@/lib/ai");
  return mod.chatJson;
}

describe("extractJson (extracción robusta)", () => {
  it("JSON limpio", () => {
    expect(extractJson('{"action":"none"}')).toEqual({ action: "none" });
  });

  it("bloque ```json con texto alrededor", () => {
    const raw = 'Claro, aquí está:\n```json\n{"action":"reply","text":"hola"}\n```\nEspero que sirva.';
    expect(extractJson(raw)).toEqual({ action: "reply", text: "hola" });
  });

  it("JSON incrustado en prosa (primer { al último })", () => {
    const raw = 'La acción que tomaré es {"action":"handoff","reason":"cliente"} por lo dicho.';
    expect(extractJson(raw)).toEqual({ action: "handoff", reason: "cliente" });
  });

  it("sin JSON → null", () => {
    expect(extractJson("no tengo nada que decir")).toBeNull();
  });
});

describe("chatJson (reintentos y errores tipados)", () => {
  const schema = z.object({ action: z.literal("reply"), text: z.string() });

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    vi.stubEnv("OPENROUTER_MODEL", "modelo-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function providerResponse(content: string) {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: {
          prompt_tokens: 123,
          completion_tokens: 7,
          prompt_tokens_details: { cached_tokens: 100 },
        },
        provider: "TestProvider",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  it("salida inválida al primer intento → reintenta con STRICT y triunfa", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(providerResponse("no soy json"))
      .mockResolvedValueOnce(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await (await getChatJson())(schema, [
      { role: "user", content: "hola" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // el reintento agrega la instrucción STRICT
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(JSON.stringify(secondBody.messages)).toContain("STRICT");
  });

  it("proveedor caído (500 persistente) → error tipado, jamás excepción", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("boom", { status: 500 }))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await (await getChatJson())(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("provider_error");
    expect(fetchMock).toHaveBeenCalledTimes(3); // agotó los 3 intentos
  });

  it("salida que nunca cumple el esquema → invalid_output", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(providerResponse('{"action":"otra_cosa"}'))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await (await getChatJson())(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_output");
  });

  it("sin token → not_configured sin tocar la red", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await (await getChatJson())(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("devuelve el modelo usado y la latencia en ms del intento exitoso", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await (await getChatJson())(schema, [
      { role: "user", content: "hola" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBe("modelo-test");
      expect(typeof result.latencyMs).toBe("number");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("expone tokens y provider del intento exitoso", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await (await getChatJson())(schema, [
      { role: "user", content: "hola" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage).toEqual({
        promptTokens: 123,
        completionTokens: 7,
        cachedTokens: 100,
      });
      expect(result.provider).toBe("TestProvider");
    }
  });

  it("la latencia mide solo el intento exitoso (los fallidos no suman)", async () => {
    const slowFirst = () =>
      new Promise<Response>((res) =>
        setTimeout(() => res(providerResponse("no soy json")), 30)
      );
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(slowFirst)
      .mockResolvedValueOnce(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await (await getChatJson())(schema, [
      { role: "user", content: "hola" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.latencyMs).toBeLessThan(30);
  });

  it("envía reasoning.effort cuando OPENROUTER_REASONING_EFFORT está definido", async () => {
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "medium");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await (await getChatJson())(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.reasoning).toEqual({ effort: "medium" });
  });

  it("NO envía reasoning si OPENROUTER_REASONING_EFFORT está vacío", async () => {
    vi.stubEnv("OPENROUTER_REASONING_EFFORT", "");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await (await getChatJson())(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.reasoning).toBeUndefined();
  });

  it("fuerza response_format json_object en el body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await (await getChatJson())(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});
