import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  guardReply,
  isRepeatedName,
  isRepeatedReply,
  resolveUncorrectedReply,
  stripContactName,
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

describe("guardReply — respuesta repetida (P2)", () => {
  // Texto literal del defecto de continuidad en pide_boleta_pago#0: el agente
  // repite casi palabra por palabra su pregunta anterior tras "transfiero hoy
  // mismo".
  const REPEATED =
    "Por supuesto. Para coordinar, ¿me podría indicar la comuna de su negocio y los productos que necesita? Así le puedo confirmar el detalle y los datos para la transferencia.";

  const context = (previousAgentReplies: readonly string[]): GuardContext => ({
    greeting: null,
    agentTurnsBefore: previousAgentReplies.length,
    previousAgentReplies,
  });

  it("marca la repetición literal de una respuesta previa", () => {
    expect(isRepeatedReply(REPEATED, context([REPEATED]))).toBe(true);
    const out = guardReply(REPEATED, sources, context([REPEATED]));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toContain("respuesta_repetida");
    expect(out.correction).toContain("repite");
  });

  it("marca una variante con altísimo solapamiento de palabras", () => {
    const variant =
      "Por supuesto. ¿Me podría indicar la comuna de su negocio y los productos que necesita? Así le puedo confirmar el detalle y los datos para la transferencia.";
    expect(isRepeatedReply(variant, context([REPEATED]))).toBe(true);
  });

  it("no marca una respuesta nueva y distinta", () => {
    const other =
      "Perfecto. Una vez recibido el pago, su pedido entra a producción y las 48 horas comienzan a correr desde ese momento.";
    expect(isRepeatedReply(other, context([REPEATED]))).toBe(false);
    expect(guardReply(other, sources, context([REPEATED])).ok).toBe(true);
  });

  it("no marca la primera vez, sin respuestas previas", () => {
    expect(isRepeatedReply(REPEATED, context([]))).toBe(false);
    expect(guardReply(REPEATED, sources, context([])).ok).toBe(true);
  });

  it("no marca una línea corta de cierre repetida", () => {
    // Menos de 8 tokens: puede repetirse sin ser un defecto de continuidad.
    const short = "Gracias, quedo atento.";
    expect(isRepeatedReply(short, context([short]))).toBe(false);
  });
});

describe("guardReply — nombre repetido (T001)", () => {
  const CONTACT = "Roberto Gonzalez";

  const context = (over: Partial<GuardContext> = {}): GuardContext => ({
    greeting: null,
    agentTurnsBefore: 1,
    previousAgentReplies: [],
    contactName: CONTACT,
    ...over,
  });

  it("marca la segunda mención del nombre (reproducción de PROD)", () => {
    // Caso real de PROD: el nombre ya apareció en el saludo del agente y el
    // modelo lo vuelve a usar en cada turno.
    const firstReply =
      "Hola, Roberto. Somos el equipo comercial de Lamas Foods, ¿qué necesita?";
    const reply =
      "¡Hola Roberto! Qué bueno saber de usted. En La Florida, tenemos pan de completo.";
    const ctx = context({ previousAgentReplies: [firstReply] });

    expect(isRepeatedName(reply, ctx)).toBe(true);
    const out = guardReply(reply, sources, ctx);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.violations.map((v) => v.kind)).toContain("nombre_repetido");
    expect(out.correction).toContain("nombre");
  });

  it("marca la mención posterior con el nombre al inicio y contenido detrás", () => {
    const ctx = context({ previousAgentReplies: ["Hola, Roberto."] });
    const reply = "Roberto, el pedido mínimo para despacho es de 15 bolsas";
    expect(isRepeatedName(reply, ctx)).toBe(true);
  });

  it("no veta la PRIMERA mención del nombre (sin salientes previos)", () => {
    const reply = "Hola, Roberto, ¿en qué le puedo ayudar?";
    expect(isRepeatedName(reply, context({ previousAgentReplies: [] }))).toBe(false);
    expect(guardReply(reply, sources, context({ previousAgentReplies: [] })).ok).toBe(true);
  });

  it("sin nombre en la ficha no evalúa nada", () => {
    const ctx = context({ contactName: null, previousAgentReplies: ["Hola, Roberto."] });
    expect(isRepeatedName("Hola, Roberto.", ctx)).toBe(false);
  });

  it("no evalúa nombres de un solo token de menos de 4 letras", () => {
    const ctx = context({ contactName: "Ana", previousAgentReplies: ["Hola, Ana."] });
    expect(isRepeatedName("Hola, Ana.", ctx)).toBe(false);
  });

  it("no marca cuando el token aparece como parte de otra palabra (comparación por token)", () => {
    const ctx = context({ contactName: "Rosa", previousAgentReplies: ["Gracias, Rosa."] });
    expect(isRepeatedName("El pan rosado no aplica.", ctx)).toBe(false);
  });

  it("stripContactName elimina el nombre y conserva el contenido", () => {
    expect(
      stripContactName("Roberto, el pedido mínimo para despacho es de 15 bolsas", CONTACT)
    ).toBe("El pedido mínimo para despacho es de 15 bolsas");
  });

  it("stripContactName limpia la puntuación huérfana", () => {
    expect(
      stripContactName(
        "Sí, Roberto. Hacemos despachos en La Florida con un costo de $5.000.",
        CONTACT
      )
    ).toBe("Sí. Hacemos despachos en La Florida con un costo de $5.000.");
  });

  it("stripContactName devuelve el fallback si el mensaje era solo el nombre", () => {
    expect(stripContactName("Roberto Gonzalez", CONTACT)).toBe(SAFE_FALLBACK_REPLY);
    expect(stripContactName("Roberto.", CONTACT)).toBe(SAFE_FALLBACK_REPLY);
  });

  it("sin nombre no toca la respuesta", () => {
    expect(stripContactName("El despacho cuesta $5.000.", null)).toBe(
      "El despacho cuesta $5.000."
    );
  });

  it("resolveUncorrectedReply conserva el contenido sin el nombre, no el fallback", () => {
    const original = "Roberto, el pedido mínimo para despacho es de 15 bolsas";
    expect(
      resolveUncorrectedReply(
        original,
        [{ kind: "nombre_repetido", detail: original }],
        context()
      )
    ).toBe("El pedido mínimo para despacho es de 15 bolsas");
  });
});

describe("resolveUncorrectedReply", () => {
  it("conserva la original si la única violación era el saludo repetido", () => {
    const original = "¡Hola! Su volumen semanal es alto, un ejecutivo lo contactará.";
    expect(
      resolveUncorrectedReply(original, [{ kind: "saludo_repetido", detail: original }])
    ).toBe(original);
  });

  it("conserva la original si la única violación era la respuesta repetida", () => {
    // Es una falla de estilo: la original al menos es informativa y el fallback
    // genérico perdería la respuesta. Se conserva, igual que el saludo repetido.
    const original = "Por supuesto. ¿Me indica la comuna de su negocio y los productos?";
    expect(
      resolveUncorrectedReply(original, [{ kind: "respuesta_repetida", detail: original }])
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
