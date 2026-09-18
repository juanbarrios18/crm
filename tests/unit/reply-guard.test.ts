import { describe, expect, it } from "vitest";
import { guardReply, SAFE_FALLBACK_REPLY } from "@/server/ai/reply-guard";
import type { PublicProduct } from "@/lib/catalog";

/**
 * Guardrail determinista de la respuesta ANTES de enviarla (F5). Reusa el
 * chequeo de hechos del Laboratorio: precios y formatos contra el catálogo y
 * afirmaciones que el canal no puede hacer.
 */

function product(
  producto: string,
  masa: string,
  formato: string,
  neto: number,
  conIva: number
): PublicProduct {
  return {
    producto,
    masa,
    formato,
    unidadesPorBolsa: 12,
    precioUnitarioNeto: neto / 12,
    precioBolsaNeto: neto,
    precioBolsaConIva: conIva,
    imagen: null,
    activo: true,
    notas: null,
  };
}

const sources = {
  catalog: [
    product("Pan de completo", "Papa", "15 cm", 4080, 4855.2),
    product("Pan de hamburguesa", "Brioche", "12 cm", 2220, 2641.8),
  ],
  zones: [{ comuna: "Macul", costoDespacho: 5000 }],
};

describe("guardReply", () => {
  it("acepta una respuesta con precios y formatos del catálogo", () => {
    const out = guardReply(
      "Pan de hamburguesa 12 cm: $2.220 neto ($2.641,80 con IVA). Despacho a Macul $5.000.",
      sources
    );
    expect(out.ok).toBe(true);
  });

  it("rechaza un precio fuera del catálogo y lo cita en la corrección", () => {
    const out = guardReply("La bolsa sale $3.990 neto.", sources);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toEqual(["precio"]);
    expect(out.correction).toContain("3.990");
    expect(out.correction).toContain("catálogo");
  });

  it("rechaza un formato que el producto no tiene", () => {
    const out = guardReply(
      "Tenemos pan de hamburguesa de 15 cm a $4.080 neto ($4.855,20 con IVA).",
      sources
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toEqual(["formato"]);
    expect(out.correction).toContain("15 cm");
  });

  it("rechaza una acción consumada que el canal no puede hacer", () => {
    const out = guardReply("Sí, ya se la envié al correo.", sources);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toEqual(["afirmacion"]);
    expect(out.correction).toContain("envié");
  });

  it("acepta un ofrecimiento en subjuntivo", () => {
    expect(
      guardReply("¿Le gustaría que le envíe los datos para la transferencia?", sources).ok
    ).toBe(true);
  });

  it("acepta un total múltiplo del catálogo", () => {
    expect(
      guardReply("Las 10 bolsas serían $22.200 neto ($26.418 con IVA).", sources).ok
    ).toBe(true);
  });

  it("la respuesta segura pasa el guard", () => {
    expect(guardReply(SAFE_FALLBACK_REPLY, sources).ok).toBe(true);
    expect(guardReply(SAFE_FALLBACK_REPLY, { catalog: [], zones: [] }).ok).toBe(true);
  });
});
