import { describe, expect, it } from "vitest";
import { IVA_RATE, computePricing } from "@/server/catalog/admin";

/**
 * 005 — Precios derivados del catálogo (cara administrativa).
 * `computePricing` es puro: unitario = bolsa / unidades (4 decimales) y
 * bolsa con IVA = bolsa * 1.19 (2 decimales).
 */

describe("computePricing", () => {
  it("calcula unitario y con IVA para el caso de referencia", () => {
    const result = computePricing(2220, 6);
    expect(result.precioUnitarioNeto).toBe(370);
    expect(result.precioBolsaConIva).toBe(2641.8);
  });

  it("redondea el unitario a 4 decimales", () => {
    const result = computePricing(1000, 3);
    expect(result.precioUnitarioNeto).toBe(333.3333);
  });

  it("redondea el precio con IVA a 2 decimales", () => {
    const result = computePricing(99.99, 6);
    expect(result.precioUnitarioNeto).toBe(16.665);
    expect(result.precioBolsaConIva).toBe(118.99);
  });

  it("siempre cumple con IVA = neto * 1.19 redondeado", () => {
    for (const neto of [0, 1, 4500, 4855.2, 12345.678]) {
      const result = computePricing(neto, 12);
      expect(result.precioBolsaConIva).toBe(
        Math.round(neto * IVA_RATE * 100) / 100
      );
    }
  });

  it("rechaza unidades no positivas o no enteras", () => {
    expect(() => computePricing(1000, 0)).toThrow();
    expect(() => computePricing(1000, -6)).toThrow();
    expect(() => computePricing(1000, 2.5)).toThrow();
  });

  it("rechaza precios inválidos", () => {
    expect(() => computePricing(Number.NaN, 6)).toThrow();
    expect(() => computePricing(Number.POSITIVE_INFINITY, 6)).toThrow();
    expect(() => computePricing(-1, 6)).toThrow();
  });
});
