import { describe, expect, it } from "vitest";
import { buildJudgePrompt } from "@/server/ai/prompts";

/**
 * 008 — Reglas del juez corregidas contra la configuración real.
 *
 * El baseline tenía falsos positivos sistemáticos: el juez castigaba el saludo
 * que configuró el dueño (17 de 25 hallazgos de tono), marcaba `fuera_de_kb`
 * respuestas respaldadas por el comportamiento configurado, trataba un rechazo
 * de cobertura como alucinación, ignoraba la línea de handoff y tomaba una
 * afirmación de capacidad como una acción realizada.
 *
 * Estas pruebas fijan las reglas en el prompt: si alguien las revierte, se ve.
 */

const prompt = () =>
  buildJudgePrompt({
    persona: "pregunton_precios",
    personaLabel: "Preguntón de precios",
    personaDescription: "Salta de precio en precio.",
    transcript: [{ role: "cliente", text: "¿a cuánto?" }],
    kbText: "",
    behaviorText: "Instrucciones: ...",
    catalogText: "catálogo",
    zonesText: "zonas",
  });

describe("buildJudgePrompt (008) — las cuatro fuentes y el rechazo", () => {
  it("un rechazo explícito nunca es alucinación", () => {
    expect(prompt().system).toContain("Un RECHAZO explícito nunca es alucinación");
  });

  it("fuera_de_kb exige ausencia en las cuatro fuentes, no solo en el conocimiento", () => {
    expect(prompt().system).toContain("que no está en NINGUNA de las cuatro fuentes");
  });

  it("una capacidad configurada no es una acción realizada", () => {
    expect(prompt().system).toContain(
      "Una afirmación de CAPACIDAD no es una acción realizada"
    );
  });
});

describe("buildJudgePrompt (008) — escalado y voz configurada", () => {
  it("la línea de handoff cuenta como escalado ocurrido", () => {
    expect(prompt().system).toContain("el escalado OCURRIÓ");
  });

  it("reproducir el saludo o el tono configurados no es un hallazgo", () => {
    expect(prompt().system).toContain(
      "Reproducir el saludo o el tono que el negocio configuró NO es un hallazgo"
    );
  });

  it("la regla anti-call-center ya no es universal: exige que la voz NO la contenga", () => {
    expect(prompt().system).toContain("SIN que la voz configurada las contenga");
    // La redacción vieja castigaba la fórmula sin mirar la configuración.
    expect(prompt().system).not.toContain(
      "usa fórmulas de call center o lenguaje de atención telefónica en vez de conversación natural"
    );
  });
});

describe("buildJudgePrompt (008) — el saludo configurado llega al juez", () => {
  it("el comportamiento configurado se renderiza en el mensaje del usuario", () => {
    const built = buildJudgePrompt({
      persona: "p1",
      transcript: [{ role: "agente", text: "Hola" }],
      kbText: "kb",
      behaviorText: "Saludo configurado: Hola, somos el equipo comercial.",
      catalogText: "catálogo",
      zonesText: "zonas",
    });
    expect(built.user).toContain("COMPORTAMIENTO CONFIGURADO:");
    expect(built.user).toContain(
      "Saludo configurado: Hola, somos el equipo comercial."
    );
  });
});
