import type { z } from "zod";
import { getEnv, isAiConfigured, isLocalUrl, isMockEnabled } from "@/lib/env";

/**
 * Adaptador LLM OpenRouter-compatible — ÚNICA frontera con el proveedor de IA
 * (Constitución II). Regla operativa: la salida del modelo es impredecible;
 * todo consumo pasa por extracción robusta + Zod + reintentos, y un hipo del
 * proveedor jamás propaga excepción (resultado `error` tipado).
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Tokens reportados por el proveedor en el intento exitoso. */
export type ChatUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
};

export type ChatJsonResult<T> =
  | {
      ok: true;
      data: T;
      raw: string;
      model: string;
      latencyMs: number;
      usage: ChatUsage | null;
      provider: string | null;
    }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_output"; detail: string };

/** Métricas de un turno exitoso del modelo (telemetría del Laboratorio). */
export type ChatTiming = {
  model: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  provider: string | null;
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

/**
 * Guardrail del entorno de pruebas: con los mocks activos el proveedor TIENE que
 * ser el mock local. Un self-test no puede gastar dinero en una API real, ni por
 * una variable mal seteada.
 *
 * Devuelve el motivo del bloqueo, o `null` si el proveedor está permitido. Es
 * pura (no toca la red) para poder verificarla sin mocks.
 */
export function testProviderGuard(baseUrl: string): string | null {
  if (!isMockEnabled()) return null;
  if (isLocalUrl(baseUrl)) return null;
  return (
    `Modo pruebas (WA_MOCK_ENABLED=true) con proveedor remoto (${baseUrl}): el ` +
    "entorno de pruebas no puede apuntar a una API real. Ponga " +
    "OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock, o apague " +
    "WA_MOCK_ENABLED si quiere una corrida real deliberada."
  );
}

export async function chatJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: { model?: string; judge?: boolean; timeoutMs?: number }
): Promise<ChatJsonResult<T>> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin OPENROUTER_API_TOKEN configurado",
    };
  }
  const env = getEnv();

  // Bloqueo ANTES de tocar la red: en modo pruebas el proveedor remoto se
  // rechaza acá, así el gasto real es imposible aunque la variable esté mal.
  const blocked = testProviderGuard(env.OPENROUTER_BASE_URL);
  if (blocked) {
    console.error(`[ai] ${blocked}`);
    return { ok: false, error: "provider_error", detail: blocked };
  }

  const model =
    opts?.model ??
    (opts?.judge
      ? (env.OPENROUTER_JUDGE_MODEL ?? env.OPENROUTER_MODEL)
      : env.OPENROUTER_MODEL);
  if (!model?.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin OPENROUTER_MODEL configurado",
    };
  }

  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content:
                "STRICT: su respuesta anterior no fue JSON válido según el esquema. Responda ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.",
            },
          ];
    const startedAt = Date.now();
    try {
      const { content, usage, provider } = await callProvider(
        model,
        attemptMessages,
        opts?.timeoutMs
      );
      const latencyMs = Date.now() - startedAt;
      const extracted = extractJson(content);
      if (extracted === null) {
        lastDetail = `sin JSON extraíble (raw=${truncate(content)})`;
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastDetail = `no cumple el esquema: ${parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")} (raw=${truncate(content)})`;
        continue;
      }
      return { ok: true, data: parsed.data, raw: content, model, latencyMs, usage, provider };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return {
    ok: false,
    error: lastDetail.includes("esquema") || lastDetail.includes("JSON")
      ? "invalid_output"
      : "provider_error",
    detail: lastDetail,
  };
}

async function callProvider(
  model: string,
  messages: ChatMessage[],
  timeoutMs = 60_000
): Promise<{ content: string; usage: ChatUsage | null; provider: string | null }> {
  const env = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 006: nivel de razonamiento configurable por entorno, si el modelo lo soporta.
  const reasoningEffort = env.OPENROUTER_REASONING_EFFORT;
  const body: Record<string, unknown> = {
    model,
    messages,
    // 020: modo JSON estricto. Sin esto, modelos chicos (gemini-flash-lite)
    // devuelven texto plano y chatJson no puede extraer la acción → el turno
    // falla con "sin JSON extraíble". chatJson siempre quiere JSON.
    response_format: { type: "json_object" },
  };
  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }
  try {
    const res = await fetch(`${env.OPENROUTER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        // El token jamás se loguea; solo viaja en este header.
        Authorization: `Bearer ${env.OPENROUTER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`proveedor respondió ${res.status}: ${truncate(text)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
      provider?: string;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("respuesta del proveedor sin contenido");
    }
    const usage: ChatUsage | null = json.usage
      ? {
          promptTokens: json.usage.prompt_tokens ?? null,
          completionTokens: json.usage.completion_tokens ?? null,
          cachedTokens: json.usage.prompt_tokens_details?.cached_tokens ?? null,
        }
      : null;
    return { content, usage, provider: json.provider ?? null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracción robusta de JSON de una respuesta de modelo:
 * 1) bloque ```json ... ``` (o ``` ... ```), 2) el texto completo,
 * 3) del primer `{` al último `}`.
 */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
