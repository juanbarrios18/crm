import { beforeEach, describe, expect, it, vi } from "vitest";

const chatJson = vi.fn();

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

import {
  compactTranscript,
  computeDispersion,
  computeScore,
  judgeCase,
} from "@/server/lab/judge";
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

  it("reintenta con el transcript compactado cuando el primer intento falla", async () => {
    chatJson
      .mockResolvedValueOnce({
        ok: false,
        error: "invalid_output",
        detail: "primer intento inválido",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { veredicto: "verde", hallazgos: [] },
        raw: "{}",
        model: "juez-test",
        latencyMs: 10,
      });

    const longTranscript = Array.from({ length: 60 }, (_, i) => ({
      role: (i % 2 === 0 ? "cliente" : "agente") as "cliente" | "agente",
      text: `turno ${i} ${"x".repeat(500)}`,
    }));

    const outcome = await judgeCase({
      personaKey: "errores_modismos",
      transcript: longTranscript,
      kbText: "",
      behaviorText: "",
      catalogText: "",
      zonesText: "",
    });

    expect(outcome.status).toBe("done");
    expect(chatJson).toHaveBeenCalledTimes(2);
    const secondUser = (
      chatJson.mock.calls[1]![1] as { role: string; content: string }[]
    )[1]!.content;
    expect(secondUser).toContain("turnos intermedios omitidos");
    expect(secondUser).not.toContain("x".repeat(500));
  });
});

describe("compactTranscript", () => {
  it("recorta cada turno a un máximo razonable", () => {
    const out = compactTranscript([{ role: "agente", text: "x".repeat(900) }]);
    expect(out[0]!.text.length).toBeLessThanOrEqual(401);
    expect(out[0]!.text.endsWith("…")).toBe(true);
  });

  it("conserva los extremos y marca el hueco si supera el tope de turnos", () => {
    const transcript = Array.from({ length: 60 }, (_, i) => ({
      role: "agente" as const,
      text: `t${i}`,
    }));
    const out = compactTranscript(transcript);
    expect(out).toHaveLength(41); // 40 turnos + marcador
    expect(out[0]!.text).toBe("t0");
    expect(out.at(-1)!.text).toBe("t59");
    expect(out.some((t) => t.text.includes("turnos intermedios omitidos"))).toBe(
      true
    );
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

  it("instruye marcar afirmaciones sin evidencia (acciones no verificables)", () => {
    const { system } = buildJudgePrompt({
      persona: "reclama_no_recibido",
      transcript: [],
      kbText: "",
      behaviorText: "",
      catalogText: "",
      zonesText: "",
    });
    expect(system).toContain("afirmacion_sin_evidencia");
    expect(system).toContain("NO puede verificar");
  });

  it("incluye el criterio de registro contra la voz configurada y el cliente", () => {
    const { system } = buildJudgePrompt({
      persona: "errores_modismos",
      transcript: [],
      kbText: "",
      behaviorText: "",
      catalogText: "",
      zonesText: "",
    });
    expect(system).toContain("REGISTRO");
    expect(system).toContain("VOZ CONFIGURADA");
    expect(system).toContain("fórmulas de call center");
    // Sin cita textual no hay hallazgo de tono.
    expect(system).toContain("DEBE citar textualmente");
  });

  it("recibe la expectativa de la persona, no solo su clave", () => {
    const { user } = buildJudgePrompt({
      persona: "errores_modismos",
      personaLabel: "Errores y modismos",
      personaDescription:
        "Escribe con faltas y modismos chilenos, y cierra sin comprar: el agente debe despedirse cordial.",
      transcript: [],
      kbText: "",
      behaviorText: "",
      catalogText: "",
      zonesText: "",
    });
    // La clave se conserva (el ai-mock despacha por ella) y la expectativa llega.
    expect(user).toContain("errores_modismos");
    expect(user).toContain("Errores y modismos");
    expect(user).toContain("el agente debe despedirse cordial");
  });

  it("degrada a la sola clave si no hay etiqueta ni descripción", () => {
    const { user } = buildJudgePrompt({
      persona: "fuera_de_kb",
      transcript: [],
      kbText: "",
      behaviorText: "",
      catalogText: "",
      zonesText: "",
    });
    expect(user).toContain("PERSONA SIMULADA: fuera_de_kb");
  });
});

describe("computeScore (FR-033: mediana por persona)", () => {
  it("compatibilidad: una repetición por persona conserva el score anterior", () => {
    const score = computeScore([
      { persona: "p1", status: "done", veredicto: "verde" },
      { persona: "p2", status: "done", veredicto: "amarillo" },
      { persona: "p3", status: "done", veredicto: "rojo" },
    ]);
    expect(score).toBe(50); // medianas 1, 0.5, 0 → promedio 0.5
  });

  it("mediana por persona: verde + rojo → 0.5", () => {
    const score = computeScore([
      { persona: "p1", status: "done", veredicto: "verde" },
      { persona: "p1", status: "done", veredicto: "rojo" },
    ]);
    expect(score).toBe(50);
  });

  it("la mediana neutraliza una repetición atípica de la misma persona", () => {
    const score = computeScore([
      { persona: "p1", status: "done", veredicto: "verde" },
      { persona: "p1", status: "done", veredicto: "verde" },
      { persona: "p1", status: "done", veredicto: "rojo" },
    ]);
    expect(score).toBe(100); // mediana = verde, no 2/3
  });

  it("promedia las medianas de varias personas", () => {
    const score = computeScore([
      { persona: "p1", status: "done", veredicto: "verde" },
      { persona: "p1", status: "done", veredicto: "verde" },
      { persona: "p1", status: "done", veredicto: "verde" },
      { persona: "p2", status: "done", veredicto: "verde" },
      { persona: "p2", status: "done", veredicto: "rojo" },
      { persona: "p2", status: "done", veredicto: "rojo" },
    ]);
    expect(score).toBe(50); // medianas 1 y 0
  });

  it("judge_failed queda fuera de la mediana de su persona", () => {
    const score = computeScore([
      { persona: "p1", status: "done", veredicto: "verde" },
      { persona: "p1", status: "judge_failed", veredicto: null },
    ]);
    expect(score).toBe(100);
  });

  it("una persona con todas sus repeticiones fallidas no entra al promedio", () => {
    const score = computeScore([
      { persona: "p1", status: "done", veredicto: "verde" },
      { persona: "p2", status: "judge_failed", veredicto: null },
    ]);
    expect(score).toBe(100);
  });

  it("todo judge_failed → sin score (null)", () => {
    expect(
      computeScore([{ persona: "p1", status: "judge_failed", veredicto: null }])
    ).toBeNull();
  });

  it("todos verdes → 100; todos rojos → 0", () => {
    const verdes = Array.from({ length: 6 }, (_, i) => ({
      persona: `p${i}`,
      status: "done",
      veredicto: "verde",
    }));
    const rojos = Array.from({ length: 6 }, (_, i) => ({
      persona: `p${i}`,
      status: "done",
      veredicto: "rojo",
    }));
    expect(computeScore(verdes)).toBe(100);
    expect(computeScore(rojos)).toBe(0);
  });
});

describe("computeDispersion", () => {
  it("persona estable (mismo veredicto) no es inestable", () => {
    const d = computeDispersion([
      { persona: "p1", status: "done", veredicto: "verde", repeatIndex: 0 },
      { persona: "p1", status: "done", veredicto: "verde", repeatIndex: 1 },
      { persona: "p1", status: "done", veredicto: "verde", repeatIndex: 2 },
    ]);
    expect(d.inestables).toBe(0);
    expect(d.personas).toEqual([
      {
        persona: "p1",
        veredictos: ["verde", "verde", "verde"],
        inestable: false,
        juzgadas: 3,
      },
    ]);
  });

  it("persona inestable (rojo y verde) se cuenta y ordena por repeatIndex", () => {
    const d = computeDispersion([
      { persona: "p1", status: "done", veredicto: "rojo", repeatIndex: 1 },
      { persona: "p1", status: "done", veredicto: "verde", repeatIndex: 0 },
      { persona: "p2", status: "done", veredicto: "amarillo", repeatIndex: 0 },
    ]);
    expect(d.inestables).toBe(1);
    const p1 = d.personas.find((p) => p.persona === "p1")!;
    expect(p1.inestable).toBe(true);
    expect(p1.veredictos).toEqual(["verde", "rojo"]); // ordenados por repeatIndex
    expect(p1.juzgadas).toBe(2);
  });

  it("judge_failed no cuenta como repetición juzgada", () => {
    const d = computeDispersion([
      { persona: "p1", status: "done", veredicto: "verde", repeatIndex: 0 },
      { persona: "p1", status: "judge_failed", veredicto: null, repeatIndex: 1 },
    ]);
    const p1 = d.personas.find((p) => p.persona === "p1")!;
    expect(p1.juzgadas).toBe(1);
    expect(p1.inestable).toBe(false);
    expect(d.inestables).toBe(0);
  });

  it("persona sin repeticiones juzgadas: juzgadas 0 y no inestable", () => {
    const d = computeDispersion([
      { persona: "p1", status: "judge_failed", veredicto: null, repeatIndex: 0 },
    ]);
    expect(d.personas).toEqual([
      { persona: "p1", veredictos: [], inestable: false, juzgadas: 0 },
    ]);
    expect(d.inestables).toBe(0);
  });
});
