import { describe, expect, it } from "vitest";
import { resolveStage } from "@/server/ai/actions";

/**
 * Resolución de etapas del agente (FR-021): el modelo devuelve el nombre de
 * etapa con variaciones (case, tildes, singular/plural) y debe resolver contra
 * las etapas reales de la organización. Un nombre inexistente devuelve null
 * (el pipeline lo degrada, jamás mueve a ciegas).
 */

const STAGES = [
  { id: "stg_nuevo", name: "Nuevo" },
  { id: "stg_conv", name: "En conversación" },
  { id: "stg_int", name: "Interesado" },
  { id: "stg_won", name: "Cliente" },
  { id: "stg_lost", name: "Perdido" },
];

describe("resolveStage", () => {
  it("resuelve el nombre exacto", () => {
    expect(resolveStage("Interesado", STAGES)?.id).toBe("stg_int");
  });

  it("ignora mayúsculas y espacios sobrantes", () => {
    expect(resolveStage("  interesado  ", STAGES)?.id).toBe("stg_int");
    expect(resolveStage("EN CONVERSACIÓN", STAGES)?.id).toBe("stg_conv");
  });

  it("ignora tildes", () => {
    expect(resolveStage("en conversacion", STAGES)?.id).toBe("stg_conv");
    expect(resolveStage("Conversación", STAGES)).toBeNull();
  });

  it("tolera singular/plural (bug original: 'interesados')", () => {
    expect(resolveStage("interesados", STAGES)?.id).toBe("stg_int");
    expect(resolveStage("Interesados", STAGES)?.id).toBe("stg_int");
    expect(resolveStage("clientes", STAGES)?.id).toBe("stg_won");
  });

  it("ignora anotaciones de tipo copiadas del prompt (regresión)", () => {
    expect(resolveStage("Cliente (ganado)", STAGES)?.id).toBe("stg_won");
    expect(resolveStage("Perdido [perdido]", STAGES)?.id).toBe("stg_lost");
    expect(resolveStage("Cliente - ganado", STAGES)?.id).toBe("stg_won");
  });

  it("devuelve null si la etapa no existe", () => {
    expect(resolveStage("Cotizado", STAGES)).toBeNull();
    expect(resolveStage("", STAGES)).toBeNull();
    expect(resolveStage("   ", STAGES)).toBeNull();
  });
});
