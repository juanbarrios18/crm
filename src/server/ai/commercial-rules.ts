/**
 * Reglas comerciales deterministas del agente (P1 del plan
 * `run_ejf1ffwxlmifjeeh315f`).
 *
 * El guard de hechos (`reply-guard.ts`) verifica precios, formatos y
 * afirmaciones contra el catálogo. Este módulo agrega lo que la instantánea del
 * negocio exige y que el modelo incumplió de forma medible: elegibilidad de
 * despacho para persona natural, prohibición de despacho gratuito, plazos
 * inventados y capacidades que el canal no tiene (historial de pedidos).
 *
 * Puro, sin BD ni I/O. No INFIERE la condición del cliente: la recibe como
 * hecho declarado. La ausencia de datos de empresa no convierte a nadie en
 * persona natural; el pipeline decide usando solo lo que el cliente declaró.
 */

export type CommercialViolation = {
  kind:
    | "elegibilidad_despacho"
    | "despacho_gratuito"
    | "plazo_inventado"
    | "capacidad_inventada";
  detail: string;
};

/** Minúsculas y sin diacríticos: una sola entrada cubre las variantes con tilde. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Negación inmediatamente anterior al índice. Se busca sobre el prefijo del
 * texto real (no sobre un recorte) para que `\b` siga significando frontera de
 * palabra: un corte a mitad de palabra inventaría una negación donde no hay.
 */
function hasNegationBefore(norm: string, index: number, window = 15): boolean {
  const re = /\b(?:no|nunca|jamas|tampoco)\b/g;
  for (const m of norm.slice(0, index).matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    if (index - end <= window) return true;
  }
  return false;
}

function hasNegation(text: string): boolean {
  return /\b(?:no|nunca|jamas|tampoco)\b/.test(text);
}

/**
 * Declaración explícita de uso personal hecha por el cliente.
 *
 * Alta precisión: "para mi" se acepta solo cuando NO abre un contexto de
 * negocio ("para mi negocio" es un comprador comercial, no una persona
 * natural). Un falso positivo acá cambia la regla comercial del turno entero.
 */
const NATURAL_PERSON_PATTERNS: readonly RegExp[] = [
  /\bpara mi casa\b/,
  /\bpara la casa\b/,
  /\bpara mi familia\b/,
  /\bpara consumo en casa\b/,
  /\bconsumo propio\b/,
  /\bsoy particular\b/,
  /\bpersona natural\b/,
  /\bno tengo empresa\b/,
  /\bno tengo negocio\b/,
  /\bpara mi hogar\b/,
  /\ben mi casa\b/,
  /\bpara mi\b(?!\s*(?:negocio|local|empresa|comercio|restaurante|panaderia|botilleria|pyme))/,
];

export function declaresNaturalPerson(text: string): boolean {
  const norm = normalize(text);
  return NATURAL_PERSON_PATTERNS.some((re) => re.test(norm));
}

/**
 * El AGENTE ofrece, cotiza o encamina despacho.
 *
 * "despach" como raíz cubre ofrecer, cotizar y coordinar. "envío" solo cuenta
 * junto a domicilio o comuna: una mención suelta del envío no es una oferta.
 * Una respuesta que solo ofrece retiro no matchea.
 */
const DELIVERY_PATTERNS: readonly RegExp[] = [
  /despach/,
  /a domicilio/,
  /envios?\b[\s\S]{0,30}(domicilio|comuna)/,
  /(domicilio|comuna)[\s\S]{0,30}envios?\b/,
  /valor del envio/,
  /costo de envio/,
  /tarifa de despacho/,
  /minimo para despacho/,
];

export function offersDelivery(reply: string): boolean {
  const norm = normalize(reply);
  return DELIVERY_PATTERNS.some((re) => re.test(norm));
}

/**
 * La respuesta NIEGA o RESTRINGE el despacho: es la respuesta CORRECTA para una
 * persona natural y no debe caer.
 *
 * Sin esta guarda, una negación que menciona la palabra "despacho" —"a persona
 * natural no ofrecemos despacho, solo retiro"— dispararía el hallazgo y forzaría
 * el fallback, que es exactamente el falso positivo que el plan prohíbe. La
 * negación se exige cerca del término de entrega para no suprimir una oferta
 * real que además contiene una negación incidental.
 */
const DELIVERY_TERM_NORM = "(?:despach\\w*|envios?\\w*|entrega\\w*|domicilio)";
const DELIVERY_REFUSAL_PATTERNS: readonly RegExp[] = [
  // "no ofrecemos despacho", "no incluye despacho", "no tenemos envío a domicilio"
  new RegExp(`\\bno\\s+(?:se\\s+)?(?:ofrecemos|hacemos|tenemos|contemplamos|incluye|incluimos|gestionamos|manejamos|realizamos|cubre|corresponde)\\b[\\s\\S]{0,20}?${DELIVERY_TERM_NORM}`),
  // "el despacho no está disponible", "el envío no aplica", "despacho no incluye"
  new RegExp(`${DELIVERY_TERM_NORM}[\\s\\S]{0,20}?\\bno\\s+(?:esta\\w*|aplica\\w*|corresponde|incluye|se puede|podemos|tenemos|hay)\\b`),
  /\bsolo (?:retiro|en planta|con retiro)\b/,
  /\bunicamente (?:retiro|en planta|con retiro)\b/,
  /\bsolamente (?:retiro|en planta|con retiro)\b/,
  /\bsin despacho\b/,
  /\bno incluye despacho\b/,
  /\bno corresponde\b/,
  /\bno aplica\b/,
  // "el despacho es solo para negocios / empresas con inicio de actividades"
  /(despach|envio|entrega|domicilio)[\s\S]{0,40}?(solo|unicamente|solamente|exclusivamente)[\s\S]{0,25}?(negocio|empresa|negocios|empresas|inicio de actividades)/,
];

export function refusesDelivery(reply: string): boolean {
  const norm = normalize(reply);
  return DELIVERY_REFUSAL_PATTERNS.some((re) => re.test(norm));
}

/**
 * Solo cuando el cliente declaró ser persona natural y la respuesta ofrece o
 * encamina despacho SIN negarlo. El llamador decide `clientIsNaturalPerson` con
 * hechos declarados: nunca se infiere por la ausencia de datos de empresa.
 */
export function checkDeliveryEligibility(
  reply: string,
  ctx: { clientIsNaturalPerson: boolean }
): CommercialViolation[] {
  if (!ctx.clientIsNaturalPerson) return [];
  if (!offersDelivery(reply)) return [];
  if (refusesDelivery(reply)) return [];
  return [
    {
      kind: "elegibilidad_despacho",
      detail: "ofrece o coordina despacho a una persona natural (solo corresponde retiro en planta)",
    },
  ];
}

const DELIVERY_TERM = "despach\\w*|envios?\\w*|entrega\\w*";
const FREE_TERM = "sin costo|sin cargo|gratis|no tiene costo|no cobramos|sin cobro";

const FREE_DELIVERY_PATTERNS: readonly RegExp[] = [
  new RegExp(`(${DELIVERY_TERM})[\\s\\S]{0,30}?(${FREE_TERM})`, "g"),
  new RegExp(`(${FREE_TERM})[\\s\\S]{0,30}?(${DELIVERY_TERM})`, "g"),
];

/**
 * Despacho gratuito SOLO si la respuesta lo ofrece de forma afirmativa.
 *
 * Guarda de negación: "no ofrecemos despacho sin costo" y "el despacho no es
 * gratis" son respuestas correctas y no deben caer. Se revisa una negación
 * dentro de los ~15 caracteres previos al primer término del match y también
 * entre ambos términos ("despacho NO ES gratis").
 */
export function checkFreeDelivery(reply: string): CommercialViolation[] {
  const norm = normalize(reply);
  for (const re of FREE_DELIVERY_PATTERNS) {
    for (const m of norm.matchAll(re)) {
      const index = m.index ?? 0;
      const first = m[1] ?? "";
      const second = m[2] ?? "";
      const firstEnd = index + first.length;
      const secondStart = index + m[0].length - second.length;
      const between = norm.slice(firstEnd, secondStart);
      if (hasNegationBefore(norm, index)) continue;
      if (hasNegation(between)) continue;
      return [{ kind: "despacho_gratuito", detail: m[0].trim() }];
    }
  }
  return [];
}

/**
 * Plazo con calificativo que la fuente no respalda: la instantánea dice
 * "48 horas" y agregar "hábiles" es un hecho inventado. Si la fuente misma dice
 * "hábiles", no hay nada que marcar.
 */
export function checkInventedDeadline(
  reply: string,
  businessText: string
): CommercialViolation[] {
  const norm = normalize(reply);
  const m = norm.match(/\d+\s*horas?\s+habiles/);
  if (!m) return [];
  if (normalize(businessText).includes("habil")) return [];
  return [{ kind: "plazo_inventado", detail: m[0].trim() }];
}

const CAPABILITY_PROMISE =
  "(?:puedo|podemos|voy a|vamos a|dejeme|dejo|reviso|revisare|consulto|consultare)";
const CAPABILITY_ACTION = "(?:revisar|consultar|verificar|buscar|\\bver\\b)";
const CAPABILITY_OBJECT = "(?:historial|pedidos pendientes|pedidos anteriores|sus pedidos|su historial)";

const CAPABILITY_PATTERN = new RegExp(
  `${CAPABILITY_PROMISE}[\\s\\S]{0,25}?${CAPABILITY_ACTION}[\\s\\S]{0,25}?${CAPABILITY_OBJECT}`,
  "g"
);

/**
 * Promesa de revisar o consultar historial o pedidos: el canal no tiene esa
 * capacidad. Solo marca la PROMESA; una negación honesta ("no tengo acceso a
 * su historial") es la respuesta correcta y no debe caer.
 */
export function checkInventedCapability(reply: string): CommercialViolation[] {
  const norm = normalize(reply);
  for (const m of norm.matchAll(CAPABILITY_PATTERN)) {
    const index = m.index ?? 0;
    if (hasNegationBefore(norm, index)) continue;
    return [{ kind: "capacidad_inventada", detail: m[0].trim() }];
  }
  return [];
}
