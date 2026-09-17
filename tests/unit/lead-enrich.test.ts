import { describe, expect, it } from "vitest";
import { LeadExtraction } from "@/server/ai/actions";

/**
 * 005 — Enriquecimiento del lead (T013). `LeadExtraction` acepta los campos
 * comerciales estructurados (FR-021). A diferencia del contrato anterior, una
 * extracción vacía SÍ es válida: no hay nada que anotar y el pipeline no escribe.
 */

describe("LeadExtraction", () => {
  it("acepta nota libre (comportamiento previo intacto)", () => {
    const result = LeadExtraction.safeParse({
      note: "Interesado en brioche 12 cm",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe("Interesado en brioche 12 cm");
    }
  });

  it("acepta campos comerciales estructurados", () => {
    const result = LeadExtraction.safeParse({
      empresa: "Lomas Cafetería",
      comuna: "Ñuñoa",
      volumenSemanal: "30 bolsas",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comuna).toBe("Ñuñoa");
      expect(result.data.empresa).toBe("Lomas Cafetería");
    }
  });

  it("combina nota y campos", () => {
    const result = LeadExtraction.safeParse({
      note: "Pidió cotización",
      rubro: "Cafetería",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe("Pidió cotización");
      expect(result.data.rubro).toBe("Cafetería");
    }
  });

  it("acepta una extracción vacía (no es un error)", () => {
    expect(LeadExtraction.safeParse({}).success).toBe(true);
  });

  it("rechaza campos con longitud excesiva", () => {
    const result = LeadExtraction.safeParse({
      comuna: "x".repeat(200),
    });
    expect(result.success).toBe(false);
  });
});
