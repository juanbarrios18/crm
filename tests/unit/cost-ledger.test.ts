import { describe, expect, it } from "vitest";
import {
  computeMargin,
  selectCostAt,
  selectCurrentCost,
  type CostMovement,
} from "@/server/catalog/costs";

/**
 * 008 — Ledger de costos: lógica de selección PURA (sin BD).
 *
 * El costo es una serie histórica, no un valor: `selectCurrentCost` /
 * `selectCostAt` eligen el movimiento vigente por `vigenteDesde` DESC y
 * desempatan por `createdAt` DESC. `computeMargin` es derivado y no se
 * persiste.
 */

function movement(
  costoUnitario: number,
  vigenteDesde: string,
  createdAt: string
): CostMovement {
  return {
    costoUnitario,
    vigenteDesde: new Date(vigenteDesde),
    createdAt: new Date(createdAt),
  };
}

describe("selectCurrentCost / selectCostAt", () => {
  it("devuelve null con un ledger vacío", () => {
    expect(selectCurrentCost([])).toBeNull();
    expect(selectCostAt([], new Date("2026-01-01"))).toBeNull();
  });

  it("toma el movimiento más reciente por vigenteDesde", () => {
    const movements = [
      movement(100, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
      movement(150, "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z"),
      movement(120, "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z"),
    ];
    expect(selectCurrentCost(movements, new Date("2026-04-01"))?.costoUnitario).toBe(150);
  });

  it("ignora un movimiento con vigenteDesde futuro para 'current'", () => {
    const movements = [
      movement(100, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
      movement(150, "2027-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
    ];
    const now = new Date("2026-06-01T00:00:00Z");
    expect(selectCurrentCost(movements, now)?.costoUnitario).toBe(100);
    // Pero una consulta con fecha futura sí lo ve.
    expect(selectCostAt(movements, new Date("2027-06-01T00:00:00Z"))?.costoUnitario).toBe(150);
  });

  it("desempata por createdAt cuando vigenteDesde es igual", () => {
    const movements = [
      movement(100, "2026-01-01T00:00:00Z", "2026-01-01T10:00:00Z"),
      movement(140, "2026-01-01T00:00:00Z", "2026-01-02T10:00:00Z"),
      movement(120, "2026-01-01T00:00:00Z", "2026-01-01T20:00:00Z"),
    ];
    expect(selectCurrentCost(movements, new Date("2026-06-01"))?.costoUnitario).toBe(140);
  });

  it("selectCostAt histórico devuelve el costo que regía en esa fecha, no el actual", () => {
    const movements = [
      movement(100, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
      movement(150, "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z"),
      movement(200, "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"),
    ];
    expect(selectCostAt(movements, new Date("2026-02-15"))?.costoUnitario).toBe(100);
    expect(selectCostAt(movements, new Date("2026-04-15"))?.costoUnitario).toBe(150);
    expect(selectCostAt(movements, new Date("2026-07-01"))?.costoUnitario).toBe(200);
  });

  it("devuelve null si la fecha consultada es anterior a todo movimiento", () => {
    const movements = [movement(100, "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z")];
    expect(selectCostAt(movements, new Date("2026-01-01"))).toBeNull();
  });

  it("no muta el array de entrada", () => {
    const movements = [
      movement(100, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
      movement(150, "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z"),
    ];
    const snapshot = movements.map((m) => ({ ...m }));
    selectCurrentCost(movements, new Date("2026-06-01"));
    selectCostAt(movements, new Date("2026-02-01"));
    expect(movements).toEqual(snapshot);
  });
});

describe("computeMargin", () => {
  it("calcula el margen bruto sobre precio neto unitario", () => {
    expect(computeMargin(1000, 250)).toBe(0.75);
    expect(computeMargin(370, 250)).toBe(0.3243);
  });

  it("devuelve 1 cuando el costo es 0", () => {
    expect(computeMargin(500, 0)).toBe(1);
  });

  it("devuelve null si el precio es 0, negativo o no finito", () => {
    expect(computeMargin(0, 100)).toBeNull();
    expect(computeMargin(-1, 100)).toBeNull();
    expect(computeMargin(Number.NaN, 100)).toBeNull();
    expect(computeMargin(Number.POSITIVE_INFINITY, 100)).toBeNull();
  });

  it("devuelve margen negativo si el costo supera al precio", () => {
    expect(computeMargin(100, 150)).toBe(-0.5);
  });
});
