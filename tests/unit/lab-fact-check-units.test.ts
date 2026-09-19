import { describe, expect, it } from "vitest";
import { checkAgentText } from "@/server/lab/fact-check";
import type { PublicProduct } from "@/lib/catalog";

/**
 * 008 — Defectos de hechos medidos en la corrida de PROD.
 *
 * A1: el agente cotizó el completo de 20 cm como "bolsa de 6 unidades" cuando el
 * catálogo dice 10 (6 es la bolsa del de 30 cm). El guard validaba precio y
 * formato, pero no la cantidad de unidades, así que escapó.
 *
 * A2: el agente afirmó haber procesado un pedido, haber agregado líneas y estar
 * revisando un caso. La lista de afirmaciones prohibidas no cubría esos verbos.
 */

const producto = (over: Partial<PublicProduct>): PublicProduct => ({
  producto: "Pan de completo",
  masa: "Blanco",
  formato: "20 cm",
  unidadesPorBolsa: 10,
  precioUnitarioNeto: 360,
  precioBolsaNeto: 3600,
  precioBolsaConIva: 4284,
  imagen: null,
  activo: true,
  notas: null,
  ...over,
});

const CATALOGO: PublicProduct[] = [
  producto({
    formato: "15 cm",
    unidadesPorBolsa: 12,
    precioBolsaNeto: 4080,
    precioBolsaConIva: 4855.2,
  }),
  producto({ formato: "20 cm", unidadesPorBolsa: 10 }),
  producto({
    formato: "30 cm",
    unidadesPorBolsa: 6,
    precioBolsaNeto: 3600,
    precioBolsaConIva: 4284,
  }),
];

const sources = {
  catalog: CATALOGO,
  zones: [{ comuna: "Macul", costoDespacho: 3000 }],
};

const kinds = (text: string) => checkAgentText(text, sources).map((v) => v.kind);

describe("checkAgentText (008) — unidades por bolsa", () => {
  it("detecta el cruce de unidades del formato (defecto A1)", () => {
    const text =
      "El pan de completo de 20 cm tiene un valor neto de $3.600 ($4.284 con IVA) por bolsa de 6 unidades.";
    expect(kinds(text)).toContain("unidades");
  });

  it("no marca la cantidad correcta del formato", () => {
    const text = "El pan de completo de 20 cm está a $3.600 neto por bolsa de 10 unidades.";
    expect(kinds(text)).not.toContain("unidades");
  });

  it("no evalúa si el turno no nombra el par producto+formato", () => {
    expect(kinds("Le ofrezco una bolsa de 6 unidades.")).not.toContain("unidades");
  });

  it("no evalúa si el turno nombra varios pares (evita falsos positivos)", () => {
    const text =
      "El de 15 cm viene en bolsa de 12 unidades y el de 20 cm en bolsa de 10 unidades.";
    expect(kinds(text)).not.toContain("unidades");
  });
});

describe("checkAgentText (008) — afirmaciones que el canal no ejecuta", () => {
  it.each([
    "Como cliente recurrente, le confirmo que ya procesamos su pedido anterior.",
    "Claro. Agregamos 10 bolsas más de pan de hamburguesa a su pedido.",
    "Estamos revisando su caso para darle una solución.",
    "Anotado: 10 bolsas de pan de hamburguesa.",
  ])("marca como afirmación: %s", (text) => {
    expect(kinds(text)).toContain("afirmacion");
  });

  it("no marca una afirmación de capacidad ni un ofrecimiento", () => {
    expect(kinds("Sí, podemos emitir boleta.")).not.toContain("afirmacion");
    expect(kinds("¿Quiere que le envíe la cotización?")).not.toContain("afirmacion");
  });
});
