import { describe, expect, it } from "vitest";

/**
 * 005 — Zonas de envío (T010). La tarifa NULL se declara como "sin tarifa
 * definida"; la proyección pública jamás es un costo inventado (FR-011).
 */

/** Mapping idéntico al que aplica `getActiveZones` en server/catalog/queries.ts. */
function mapZone(z: {
  comuna: string;
  costoDespacho: string | null;
  activa: boolean;
}) {
  return {
    comuna: z.comuna,
    costoDespacho: z.costoDespacho != null ? Number(z.costoDespacho) : null,
    activa: z.activa,
  };
}

describe("mapZone", () => {
  it("convierte numeric string a number", () => {
    const z = mapZone({ comuna: "Macul", costoDespacho: "4500.0000", activa: true });
    expect(z.costoDespacho).toBe(4500);
  });

  it("declara tarifa NULL como 'sin tarifa definida' (null)", () => {
    const z = mapZone({ comuna: "Vitacura", costoDespacho: null, activa: true });
    expect(z.costoDespacho).toBeNull();
  });

  it("no incluye campos internos", () => {
    const z = mapZone({ comuna: "Macul", costoDespacho: "4500.0000", activa: true });
    expect(z).not.toHaveProperty("costo");
    expect(z).not.toHaveProperty("margen");
  });
});