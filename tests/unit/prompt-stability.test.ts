import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/ai";
import {
  appendTemporalNote,
  buildAgentSystemPrompt,
  buildAnnotationSystemPrompt,
  CLIENT_FILE_HEADER,
  ESTADO_DEL_TURNO_NOTA,
  renderAnnotationTurnState,
  renderTurnState,
  TEMPORAL_NOTE_MARK,
} from "@/server/ai/prompts";

/**
 * F1 — invariante de caché: NADA que cambie por turno entra a un mensaje
 * `system`. El proveedor solo acredita caché con un system idéntico byte a
 * byte, y la etapa, la ficha y la fecha cambian en cada turno. Ese estado viaja
 * en una nota interna al final del último mensaje del cliente.
 */

const PROFILE = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Asistente comercial",
  tone: "Directo y cordial",
  instructions: "Ofrece despacho y retiro según las reglas del negocio.",
  escalationRules: "Escala si piden crédito o un humano.",
  greeting: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const STAGES = [{ name: "Nuevo" }, { name: "Calificado" }, { name: "Ganado" }];
const FIXED_NOW = new Date("2026-09-17T15:30:00Z");

describe("F1 — el system prompt de conversación es función pura de la configuración", () => {
  it("no contiene etapa, ficha ni fecha, y es idéntico entre builds", () => {
    const build = () => buildAgentSystemPrompt({ profile: PROFILE, kb: [], stages: STAGES });
    const prompt = build();
    expect(prompt).not.toContain(CLIENT_FILE_HEADER);
    expect(prompt).not.toContain("Etapa actual del lead:");
    expect(prompt).not.toContain("Fecha y hora actuales:");
    expect(prompt).toBe(build());
  });

  it("le explica al modelo dónde llega el estado del turno", () => {
    const prompt = buildAgentSystemPrompt({ profile: PROFILE, kb: [], stages: STAGES });
    expect(prompt).toContain(ESTADO_DEL_TURNO_NOTA);
    expect(ESTADO_DEL_TURNO_NOTA).toContain(TEMPORAL_NOTE_MARK);
  });
});

describe("F1 — el system prompt de anotación tampoco lleva la etapa actual", () => {
  it("no contiene la etapa actual", () => {
    const prompt = buildAnnotationSystemPrompt({ profile: PROFILE, stages: STAGES });
    expect(prompt).not.toContain("Etapa actual del lead:");
    for (const s of STAGES) expect(prompt).toContain(s.name);
  });
});

describe("renderTurnState", () => {
  it("junta marcador, etapa, ficha y fecha en un solo bloque", () => {
    const state = renderTurnState({
      stage: "Calificado",
      clientFile: { name: "Ana", comuna: "Macul" },
      now: FIXED_NOW,
      timeZone: "America/Santiago",
    });
    expect(state.startsWith(TEMPORAL_NOTE_MARK)).toBe(true);
    expect(state).toContain("Etapa actual del lead: Calificado");
    expect(state).toContain(CLIENT_FILE_HEADER);
    expect(state).toContain("- Nombre: Ana");
    expect(state).toContain("- Comuna: Macul");
    expect(state).toContain("Fecha y hora actuales:");
  });

  it("sin ficha omite el bloque de ficha y declara la etapa ausente", () => {
    const state = renderTurnState({
      stage: null,
      clientFile: null,
      now: FIXED_NOW,
      timeZone: "America/Santiago",
    });
    expect(state).not.toContain(CLIENT_FILE_HEADER);
    expect(state).toContain("Etapa actual del lead: (sin etapa)");
  });

  it("adjunto al último mensaje del cliente deja el system byte a byte igual", () => {
    const system = buildAgentSystemPrompt({ profile: PROFILE, kb: [], stages: STAGES });
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: "hola" },
      { role: "assistant", content: "{\"reply\":\"Hola\"}" },
      { role: "user", content: "precio?" },
    ];
    const state = renderTurnState({
      stage: "Nuevo",
      clientFile: { name: "Ana" },
      now: FIXED_NOW,
      timeZone: "America/Santiago",
    });
    const out = appendTemporalNote(messages, state);
    expect(out[0]).toEqual(messages[0]);
    expect(out[0]!.content).toBe(system);
    expect(out).toHaveLength(4);
    const last = out[out.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content.startsWith("precio?")).toBe(true);
    expect(last.content.endsWith(state)).toBe(true);
  });
});

describe("renderAnnotationTurnState", () => {
  it("lleva marcador y etapa; sin etapa lo declara", () => {
    expect(renderAnnotationTurnState("Calificado")).toBe(
      `${TEMPORAL_NOTE_MARK} Etapa actual del lead: Calificado`
    );
    expect(renderAnnotationTurnState(null)).toContain("(sin etapa)");
  });
});

describe("contrato de anotación (F2)", () => {
  it("pide extraer solo lo que dijo el CLIENTE e ignorar lo que dijo el agente", () => {
    const prompt = buildAnnotationSystemPrompt({
      profile: PROFILE,
      stages: STAGES,
    });
    expect(prompt).toContain("Ignore lo que dijo el agente");
    expect(prompt).toContain("para el equipo humano");
  });
});
