import { describe, expect, it } from "vitest";
import { VOSEO_LEXEMES } from "@/lib/voice-register";
import { applyDialectCheck } from "@/server/lab/dialect-check";

/**
 * Fixtures construidos desde la lista compartida en vez de escribirlos como
 * prosa literal: el guardián de registro escanea los tests y no debe marcar este
 * archivo por citar la regla que verifica (ver `voice-register.test.ts`).
 */
const VOSEO_A = VOSEO_LEXEMES.find((w) => w.startsWith("agreg"))!;
const VOSEO_B = VOSEO_LEXEMES.find((w) => w.startsWith("ten"))!;

describe("applyDialectCheck", () => {
  it("detecta voseo en un turno del agente, agrega hallazgo y eleva a rojo", () => {
    const out = applyDialectCheck({
      transcript: [
        { role: "cliente", text: "hola, benden pan?" },
        { role: "agente", text: `¡Hola! ${VOSEO_A} el pedido en el carro.` },
      ],
      veredicto: "verde",
      hallazgos: [],
    });

    expect(out.veredicto).toBe("rojo");
    expect(out.hallazgos).toHaveLength(1);
    const hallazgo = out.hallazgos[0] as {
      tipo: string;
      evidencia: string;
    };
    expect(hallazgo.tipo).toBe("dialecto");
    expect(hallazgo.evidencia).toContain(VOSEO_A);
    expect(hallazgo.evidencia).toContain("turno 2");
    expect(hallazgo.evidencia).toContain("agente");
  });

  it("NO marca el voseo que está solo en turnos del cliente", () => {
    const input = {
      transcript: [
        { role: "cliente" as const, text: `che, ${VOSEO_B} el catalogo?` },
        { role: "agente" as const, text: "Con gusto, le comparto el catálogo." },
      ],
      veredicto: "verde" as const,
      hallazgos: [] as unknown[],
    };
    const out = applyDialectCheck(input);
    expect(out.veredicto).toBe("verde");
    expect(out.hallazgos).toEqual([]);
  });

  it("no toca un transcript limpio", () => {
    const hallazgos = [{ tipo: "tono", evidencia: "algo" }];
    const out = applyDialectCheck({
      transcript: [
        { role: "cliente", text: "hola, benden pan de hamburguesa?" },
        { role: "agente", text: "Con gusto, le comparto los formatos disponibles." },
      ],
      veredicto: "amarillo",
      hallazgos,
    });
    expect(out.veredicto).toBe("amarillo");
    expect(out.hallazgos).toBe(hallazgos);
  });

  it("no da falsos positivos con español neutro terminado en -á", () => {
    const out = applyDialectCheck({
      transcript: [
        {
          role: "agente",
          text: "El costo está acá y además es más barato; jamás sube.",
        },
      ],
      veredicto: "verde",
      hallazgos: [],
    });
    expect(out.veredicto).toBe("verde");
    expect(out.hallazgos).toEqual([]);
  });

  it("reporta una sola vez cada palabra distinta y preserva los hallazgos previos", () => {
    const out = applyDialectCheck({
      transcript: [
        { role: "agente", text: `${VOSEO_A} el pedido.` },
        { role: "agente", text: `Le repito: ${VOSEO_A} el pedido.` },
        { role: "agente", text: `${VOSEO_B} dudas?` },
      ],
      veredicto: "rojo",
      hallazgos: [{ tipo: "alucinacion" }],
    });
    expect(out.veredicto).toBe("rojo");
    expect(out.hallazgos).toHaveLength(3);
    const tipos = (out.hallazgos as { tipo: string }[]).map((h) => h.tipo);
    expect(tipos.filter((t) => t === "dialecto")).toHaveLength(2);
    expect(tipos).toContain("alucinacion");
  });
});
