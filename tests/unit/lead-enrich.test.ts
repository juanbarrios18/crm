import { describe, expect, it } from "vitest";
import { AgentAction } from "@/server/ai/actions";

/**
 * 005 — Enriquecimiento del lead (T013). `update_lead` acepta campos
 * comerciales estructurados (FR-021) y rechaza una actualización vacía.
 */

describe("AgentAction.update_lead", () => {
  it("acepta nota libre (comportamiento previo intacto)", () => {
    const result = AgentAction.safeParse({
      action: "update_lead",
      note: "Interesado en brioche 12 cm",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.action === "update_lead") {
      expect(result.data.note).toBe("Interesado en brioche 12 cm");
    }
  });

  it("acepta campos comerciales estructurados", () => {
    const result = AgentAction.safeParse({
      action: "update_lead",
      empresa: "Lomas Cafetería",
      comuna: "Ñuñoa",
      volumenSemanal: "30 bolsas",
      reply: "Listo, anotado",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.action === "update_lead") {
      expect(result.data.comuna).toBe("Ñuñoa");
      expect(result.data.empresa).toBe("Lomas Cafetería");
    }
  });

  it("combina nota y campos", () => {
    const result = AgentAction.safeParse({
      action: "update_lead",
      note: "Pidió cotización",
      rubro: "Cafetería",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.action === "update_lead") {
      expect(result.data.note).toBe("Pidió cotización");
      expect(result.data.rubro).toBe("Cafetería");
    }
  });

  it("rechaza update_lead sin nota ni campos (vacío)", () => {
    const result = AgentAction.safeParse({ action: "update_lead" });
    expect(result.success).toBe(false);
  });

  it("rechaza campos con longitud excesiva", () => {
    const result = AgentAction.safeParse({
      action: "update_lead",
      comuna: "x".repeat(200),
    });
    expect(result.success).toBe(false);
  });
});