import { beforeEach, describe, expect, it, vi } from "vitest";

const chatJson = vi.fn();

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

import { computeScore, judgeCase } from "@/server/lab/judge";
import { buildJudgePrompt } from "@/server/ai/prompts";

describe("judgeCase (FR-032)", () => {
  beforeEach(() => chatJson.mockReset());

  it("veredicto válido → done con modelo y latencia del juez", async () => {
    chatJson.mockResolvedValue({
      ok: true,
      data: { veredicto: "verde", hallazgos: [] },
      raw: "{}",
      model: "juez-test",
      latencyMs: 432,
    });
    const outcome = await judgeCase({
      personaKey: "comprador_decidido",
      transcript: [{ role: "cliente", text: "hola" }],
      kbText: "kb",
      behaviorText: "b",
      catalogText: "cat",
      zonesText: "zones",
    });
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.model).toBe("juez-test");
      expect(outcome.latencyMs).toBe(432);
    }
    // usa el modelo del juez (opts.judge)
    expect(chatJson.mock.calls[0]![2]).toMatchObject({ judge: true });
  });

  it("salida inválida tras reintentos internos → judge_failed (no lanza)", async () => {
    chatJson.mockResolvedValue({
      ok: false,
      error: "invalid_output",
      detail: "no cumple el esquema (raw=...)",
    });
    const outcome = await judgeCase({
      personaKey: "fuera_de_kb",
      transcript: [],
      kbText: "",
      behaviorText: "",
      catalogText: "",
      zonesText: "",
    });
    expect(outcome.status).toBe("judge_failed");
  });
});

describe("buildJudgePrompt (ground truth del juez)", () => {
  it("incluye catálogo y zonas como fuente de verdad", () => {
    const { user } = buildJudgePrompt({
      persona: "comprador_decidido",
      transcript: [],
      kbText: "",
      behaviorText: "",
      catalogText: "Pan de hamburguesa — $2.220 neto",
      zonesText: "Macul: $5.000 de despacho",
    });
    expect(user).toContain("CATÁLOGO DE PRODUCTOS");
    expect(user).toContain("$2.220 neto");
    expect(user).toContain("ZONAS DE ENVÍO");
    expect(user).toContain("Macul");
  });

  it("instruye que precio/comuna del catálogo NO es alucinación", () => {
    const { system } = buildJudgePrompt({
      persona: "comprador_decidido",
      transcript: [],
      kbText: "",
      behaviorText: "",
      catalogText: "",
      zonesText: "",
    });
    expect(system).toContain("NO es alucinación");
  });
});

describe("computeScore (FR-033: judge_failed excluido del denominador)", () => {
  it("pondera verde=1, amarillo=0.5, rojo=0", () => {
    const score = computeScore([
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "amarillo" },
      { status: "done", veredicto: "rojo" },
    ]);
    expect(score).toBe(50); // (1 + 0.5 + 0) / 3 = 0.5
  });

  it("judge_failed NO cuenta en el denominador", () => {
    const score = computeScore([
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "verde" },
      { status: "judge_failed", veredicto: null },
    ]);
    expect(score).toBe(100); // 2/2, no 2/3
  });

  it("todo judge_failed → sin score (null)", () => {
    expect(
      computeScore([{ status: "judge_failed", veredicto: null }])
    ).toBeNull();
  });

  it("6 verdes → 100; 6 rojos → 0", () => {
    const verdes = Array(6).fill({ status: "done", veredicto: "verde" });
    const rojos = Array(6).fill({ status: "done", veredicto: "rojo" });
    expect(computeScore(verdes)).toBe(100);
    expect(computeScore(rojos)).toBe(0);
  });
});
