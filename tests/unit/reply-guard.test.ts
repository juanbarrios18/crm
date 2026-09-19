import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  guardReply,
  resolveUncorrectedReply,
  SAFE_FALLBACK_REPLY,
  type GuardContext,
} from "@/server/ai/reply-guard";
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

describe("guardReply — saludo repetido (F5b)", () => {
  const GREETING =
    "Hola, somos el equipo comercial de Lamas Foods. ¿Qué pan necesita para su negocio?";

  it("rechaza el saludo literal cuando el agente ya habló antes", () => {
    const out = guardReply(GREETING, sources, { greeting: GREETING, agentTurnsBefore: 1 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toEqual(["saludo_repetido"]);
    expect(out.correction).toContain("repite el saludo inicial");
  });

  it("acepta el saludo en el primer turno del agente", () => {
    expect(
      guardReply(GREETING, sources, { greeting: GREETING, agentTurnsBefore: 0 }).ok
    ).toBe(true);
  });

  it("rechaza volver a saludar aunque traiga contenido detrás (medido en F5+F6)", () => {
    const reply =
      "Hola, somos el equipo comercial de Lamas Foods. El pan de hamburguesa 12 cm sale $2.220 neto ($2.641,80 con IVA), bolsa de 12. ¿Para qué comuna sería el despacho?";
    const out = guardReply(reply, sources, { greeting: GREETING, agentTurnsBefore: 2 });
    expect(out.ok).toBe(false);
  });

  it("acepta un saludo con contenido en el PRIMER turno del agente", () => {
    const reply =
      "Hola, somos el equipo comercial de Lamas Foods. El pan de hamburguesa 12 cm sale $2.220 neto ($2.641,80 con IVA), bolsa de 12.";
    expect(guardReply(reply, sources, { greeting: GREETING, agentTurnsBefore: 0 }).ok).toBe(true);
  });

  it("sin saludo configurado no hay nada que comparar", () => {
    expect(guardReply(GREETING, sources, { greeting: null, agentTurnsBefore: 3 }).ok).toBe(true);
  });
});

describe("guardReply — no veta cualquier 'Hola' (PROD run_pk41)", () => {
  const GREETING =
    "¡Hola! Le saluda el equipo comercial de Lamas Foods. ¿En qué podemos ayudarle con nuestros panes?";

  it("acepta una respuesta que arranca con Hola sin repetir el saludo", () => {
    const reply =
      "¡Hola! Su volumen semanal es alto, así que un ejecutivo comercial lo contactará a la brevedad para ofrecerle una propuesta a medida.";
    expect(guardReply(reply, sources, { greeting: GREETING, agentTurnsBefore: 1 }).ok).toBe(true);
  });

  it("rechaza el saludo configurado repetido con contenido detrás", () => {
    const reply =
      "¡Hola! Le saluda el equipo comercial de Lamas Foods. El despacho a Macul cuesta $5.000.";
    const out = guardReply(reply, sources, { greeting: GREETING, agentTurnsBefore: 1 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toContain("saludo_repetido");
  });

  it("un saludo corto repetido con contenido detrás también se rechaza", () => {
    const greeting = "Hola, ¿qué necesitas?";
    expect(guardReply(greeting, sources, { greeting, agentTurnsBefore: 2 }).ok).toBe(false);
    expect(
      guardReply(`${greeting} El pan de hamburguesa 12 cm sale $2.220 neto.`, sources, {
        greeting,
        agentTurnsBefore: 2,
      }).ok
    ).toBe(false);
    expect(
      guardReply("Hola, te paso el precio del pan.", sources, { greeting, agentTurnsBefore: 2 }).ok
    ).toBe(true);
  });
});

describe("resolveUncorrectedReply", () => {
  it("conserva la original si la única violación era el saludo repetido", () => {
    const original = "¡Hola! Su volumen semanal es alto, un ejecutivo lo contactará.";
    expect(
      resolveUncorrectedReply(original, [{ kind: "saludo_repetido", detail: original }])
    ).toBe(original);
  });

  it("entrega la respuesta segura si había una violación de hechos", () => {
    expect(
      resolveUncorrectedReply("Sale $9.999 neto.", [{ kind: "precio", detail: "$9.999" }])
    ).toBe(SAFE_FALLBACK_REPLY);
  });

  it("entrega la respuesta segura si conviven saludo repetido y violación de hechos", () => {
    expect(
      resolveUncorrectedReply("¡Hola! Sale $9.999 neto.", [
        { kind: "saludo_repetido", detail: "¡Hola!" },
        { kind: "precio", detail: "$9.999" },
      ])
    ).toBe(SAFE_FALLBACK_REPLY);
  });

  it("el fallback seguro no afirma acciones ni usa fórmulas de call center", () => {
    const lower = SAFE_FALLBACK_REPLY.toLowerCase();
    expect(lower).not.toContain("le escribo");
    expect(lower).not.toContain("podemos ayudarle");
    expect(guardReply(SAFE_FALLBACK_REPLY, sources).ok).toBe(true);
  });

  it("entrega la respuesta segura si la violación es comercial", () => {
    const original = "El despacho es sin costo.";
    expect(
      resolveUncorrectedReply(original, [
        { kind: "despacho_gratuito", detail: "despacho sin costo" },
      ])
    ).toBe(SAFE_FALLBACK_REPLY);
  });
});

describe("guardReply — reglas comerciales (P1)", () => {
  const FIXTURE = path.join(process.cwd(), "tests/fixtures/lab/remediacion-ejf1-cases.json");
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    cases: { key: string; transcript: { role: "cliente" | "agente"; text: string }[] }[];
  };
  const turnText = (key: string, needle: string): string => {
    const c = fixture.cases.find((x) => x.key === key);
    const turn = c?.transcript.find((t) => t.text.includes(needle));
    if (!turn) throw new Error(`turn not found: ${key} / ${needle}`);
    return turn.text;
  };
  const context = (extra: Partial<GuardContext> = {}): GuardContext => ({
    greeting: null,
    agentTurnsBefore: 1,
    ...extra,
  });

  it("rechaza despacho ofrecido a una persona natural declarada", () => {
    const reply = turnText("consumidor_final#0", "podemos despachar a domicilio");
    const out = guardReply(reply, sources, context({ clientIsNaturalPerson: true }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toContain("elegibilidad_despacho");
  });

  it("rechaza el despacho sin costo", () => {
    const reply = turnText("comprador_decidido#0", "despacho sin costo adicional");
    const out = guardReply(reply, sources, context());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toContain("despacho_gratuito");
  });

  it("rechaza un plazo inventado cuando la fuente no lo respalda", () => {
    const reply = turnText("comprador_decidido#2", "48 horas hábiles");
    const out = guardReply(reply, sources, context({ businessText: "producción y 48 horas" }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toContain("plazo_inventado");
  });

  it("rechaza prometer una revisión de historial", () => {
    const reply = turnText("cliente_recurrente#0", "puedo revisar su historial");
    const out = guardReply(reply, sources, context());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toContain("capacidad_inventada");
  });
});
