import { describe, expect, it } from "vitest";
import { applyFactCheck, extractPrices } from "@/server/lab/fact-check";
import type { PublicProduct } from "@/lib/catalog";

/**
 * Chequeo determinista de HECHOS en el Laboratorio: precios fuera del catálogo,
 * formatos que el producto no tiene y afirmaciones que el canal no puede hacer.
 * No depende del juez LLM. Los casos salen de la captura real del anexo A de
 * `docs/auditoria-contexto-agente.md`.
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

const catalog: PublicProduct[] = [
  product("Pan de completo", "Papa", "15 cm", 4080, 4855.2),
  product("Pan de hamburguesa", "Brioche", "12 cm", 2220, 2641.8),
  product("Pan de hamburguesa", "Brioche", "11 cm", 3150, 3748.5),
  product("Pan de hamburguesa", "Papa", "10 cm", 4560, 5426.4),
];
const zones = [{ comuna: "Macul", costoDespacho: 5000 }];

describe("extractPrices", () => {
  it("lee precios en formato chileno", () => {
    expect(extractPrices("cuesta $4.080 neto ($4.855,20 con IVA)")).toEqual([
      4080, 4855.2,
    ]);
  });
  it("devuelve vacío sin precios", () => {
    expect(extractPrices("hola, ¿qué pan necesita?")).toEqual([]);
  });
});

describe("applyFactCheck", () => {
  it("no toca un transcript cuyos precios y formatos están en el catálogo", () => {
    const out = applyFactCheck({
      transcript: [
        { role: "cliente", text: "precio hamburguesa 12" },
        {
          role: "agente",
          text: "Pan de hamburguesa 12 cm brioche: $2.220 neto ($2.641,80 con IVA). Despacho a Macul $5.000.",
        },
      ],
      catalog,
      zones,
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.veredicto).toBe("verde");
    expect(out.hallazgos).toHaveLength(0);
  });

  it("marca un precio que no existe en catálogo ni zonas", () => {
    const out = applyFactCheck({
      transcript: [{ role: "agente", text: "La bolsa sale $3.990 neto." }],
      catalog,
      zones,
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.veredicto).toBe("rojo");
    expect(out.hallazgos).toHaveLength(1);
    const h = out.hallazgos[0] as { tipo: string; evidencia: string };
    expect(h.tipo).toBe("hecho");
    expect(h.evidencia).toContain("3.990");
  });

  it("marca el formato inventado del anexo: hamburguesa de 15 cm con precio de otro producto", () => {
    const out = applyFactCheck({
      transcript: [
        {
          role: "agente",
          text: "Tenemos pan de hamburguesa de 15 cm en bolsa de 12 unidades a $4.080 neto ($4.855,20 con IVA).",
        },
      ],
      catalog,
      zones,
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.veredicto).toBe("rojo");
    const tipos = (out.hallazgos as { tipo: string; evidencia: string }[]).map(
      (h) => h.evidencia
    );
    expect(tipos.join(" ")).toContain("15 cm");
  });

  it("marca afirmaciones que el canal no puede hacer", () => {
    const out = applyFactCheck({
      transcript: [
        { role: "cliente", text: "me mandan la boleta al correo?" },
        { role: "agente", text: "Sí, ya se la envié al correo indicado." },
      ],
      catalog,
      zones,
      veredicto: "amarillo",
      hallazgos: [{ tipo: "tono" }],
    });
    expect(out.veredicto).toBe("rojo");
    expect(out.hallazgos).toHaveLength(2);
    expect((out.hallazgos[0] as { tipo: string }).tipo).toBe("hecho");
  });

  it("nunca escanea los turnos del cliente", () => {
    const out = applyFactCheck({
      transcript: [
        { role: "cliente", text: "me dijeron que sale $9.999 y que ya me lo enviaron" },
      ],
      catalog,
      zones,
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.hallazgos).toHaveLength(0);
  });
});

describe("applyFactCheck — ofrecimientos no son afirmaciones", () => {
  it("no marca un ofrecimiento en subjuntivo (caso real de la baseline F0)", () => {
    const out = applyFactCheck({
      transcript: [
        {
          role: "agente",
          text: "Una vez confirmado el pago, su pedido entra a producción. ¿Le gustaría que le envíe los datos para la transferencia?",
        },
        { role: "agente", text: "¿Quiere que le enviemos la cotización por acá?" },
      ],
      catalog,
      zones,
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.hallazgos).toHaveLength(0);
  });

  it("sí marca la acción consumada con tilde de pretérito", () => {
    const out = applyFactCheck({
      transcript: [{ role: "agente", text: "Ya le envié la boleta al correo." }],
      catalog,
      zones,
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.hallazgos).toHaveLength(1);
  });
});

describe("applyFactCheck — totales calculados", () => {
  it("acepta un total que es múltiplo entero de un precio del catálogo (caso real: 10 bolsas)", () => {
    const out = applyFactCheck({
      transcript: [
        {
          role: "agente",
          text: "El total por las 10 bolsas de hamburguesa brioche de 12 cm sería $22.200 neto ($26.418 con IVA).",
        },
      ],
      catalog,
      zones,
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.hallazgos).toHaveLength(0);
  });

  it("sigue marcando un monto que no es múltiplo de nada del catálogo", () => {
    const out = applyFactCheck({
      transcript: [{ role: "agente", text: "Serían $22.300 neto en total." }],
      catalog,
      zones,
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.hallazgos).toHaveLength(1);
  });
});
