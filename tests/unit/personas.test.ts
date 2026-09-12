import { describe, expect, it } from "vitest";
import { PERSONAS } from "@/server/lab/personas";

/**
 * Personas del Laboratorio: estructura estable y cobertura de los flujos de
 * negocio que el agente debe respetar (boleta/pago, recurrencia, alto volumen,
 * consumidor final, crédito, cobertura).
 */

describe("PERSONAS del Laboratorio", () => {
  it("keys y teléfonos únicos, todos con guion no vacío", () => {
    const keys = PERSONAS.map((p) => p.key);
    const phones = PERSONAS.map((p) => p.phone);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(phones).size).toBe(phones.length);
    for (const p of PERSONAS) {
      expect(p.script.length).toBeGreaterThan(0);
      expect(p.contactName.startsWith("[Prueba]")).toBe(true);
    }
  });

  it("expectAdvance es booleano cuando está presente", () => {
    for (const p of PERSONAS) {
      if (p.expectAdvance !== undefined) {
        expect(typeof p.expectAdvance).toBe("boolean");
      }
    }
  });

  it("cubre los flujos de negocio clave", () => {
    const keys = PERSONAS.map((p) => p.key);
    for (const key of [
      "pide_boleta_pago",
      "reclama_no_recibido",
      "cliente_recurrente",
      "alto_volumen",
      "consumidor_final",
      "pide_credito",
      "fuera_cobertura",
    ]) {
      expect(keys).toContain(key);
    }
  });
});
