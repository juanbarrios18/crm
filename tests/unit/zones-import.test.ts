import { describe, expect, it } from "vitest";
import { parseZonesCsv } from "@/server/catalog/zones-import";

/**
 * 005 — Import de zonas de envío. El CSV trae `comuna,costo_despacho_neto,
 * activo,notas`; el costo es la tarifa PÚBLICA (FR-011). Upsert idempotente
 * por comuna (Principio IV).
 */

describe("parseZonesCsv", () => {
  const CSV = [
    "comuna,costo_despacho_neto,activo,notas",
    "Vitacura,6000,SI,",
    "Macul,5000,SI,",
    "Santiago,5000,SI,",
  ].join("\n");

  it("parsea comunas con su tarifa (neto numérico)", () => {
    const rows = parseZonesCsv(CSV);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ comuna: "Vitacura", costoDespacho: 6000, activa: true });
    expect(rows[1]).toEqual({ comuna: "Macul", costoDespacho: 5000, activa: true });
  });

  it("interpreta activo SI/NO", () => {
    const csv = [
      "comuna,costo_despacho_neto,activo,notas",
      "A,1000,SI,",
      "B,2000,NO,",
      "C,3000,no,",
    ].join("\n");
    const rows = parseZonesCsv(csv);
    expect(rows[0]!.activa).toBe(true);
    expect(rows[1]!.activa).toBe(false);
    expect(rows[2]!.activa).toBe(false);
  });

  it("acepta comuna sin tarifa (costo vacío → null)", () => {
    const csv = [
      "comuna,costo_despacho_neto,activo,notas",
      "Pendiente,,SI,",
    ].join("\n");
    const rows = parseZonesCsv(csv);
    expect(rows[0]!.costoDespacho).toBeNull();
  });

  it("lanza error con fila incompleta", () => {
    const csv = [
      "comuna,costo_despacho_neto,activo,notas",
      "SoloComuna",
    ].join("\n");
    expect(() => parseZonesCsv(csv)).toThrow();
  });

  it("devuelve vacío sin filas", () => {
    expect(parseZonesCsv("comuna,costo_despacho_neto,activo,notas\n")).toEqual([]);
  });
});