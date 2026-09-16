import { describe, expect, it } from "vitest";
import {
  PublicProductSchema,
  serializePublicProduct,
  serializeInternalProduct,
} from "@/lib/catalog";

/**
 * 005 — Proyección público/privada del catálogo (T008).
 * La proyección pública JAMÁS contiene costo/margen (FR-004, FR-041).
 */

const PUBLIC_ROW = {
  producto: "Pan de hamburguesa",
  masa: "Brioche",
  formato: "12 cm",
  unidadesPorBolsa: 6,
  precioUnitarioNeto: "370.0000",
  precioBolsaNeto: "2220.0000",
  precioBolsaConIva: "2641.8000",
  imagen: null,
  activo: true,
  notas: null,
};

describe("serializePublicProduct", () => {
  it("no incluye costo ni margen aunque el row interno exista", () => {
    const result = serializePublicProduct({
      ...PUBLIC_ROW,
      // simula que la fila trajera datos internos por error
      costo: "1500.0000",
      margen: "720.0000",
    } as typeof PUBLIC_ROW & { costo: string; margen: string });
    const parsed = PublicProductSchema.parse(result);
    expect(parsed).not.toHaveProperty("costo");
    expect(parsed).not.toHaveProperty("margen");
  });

  it("convierte numerics string a number", () => {
    const result = serializePublicProduct(PUBLIC_ROW);
    expect(result.precioBolsaConIva).toBe(2641.8);
    expect(result.precioUnitarioNeto).toBe(370);
  });
});

describe("serializeInternalProduct", () => {
  it("incluye costo y margen solo cuando existen", () => {
    const result = serializeInternalProduct(PUBLIC_ROW, {
      costo: "1500.0000",
      margen: null,
    });
    expect(result.costo).toBe(1500);
    expect(result.margen).toBeNull();
  });
});

describe("PublicProductSchema", () => {
  it("rechaza payload con campo extra (seguro por omisión)", () => {
    const payload = {
      producto: "Pan",
      masa: "Pan",
      formato: "10 cm",
      unidadesPorBolsa: 12,
      precioUnitarioNeto: 380,
      precioBolsaNeto: 4560,
      precioBolsaConIva: 5426.4,
      imagen: null,
      activo: true,
      notas: null,
      costo: 2500, // campo interno que no debería pasar
    };
    const result = PublicProductSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});