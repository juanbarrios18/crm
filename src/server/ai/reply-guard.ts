import type { PublicProduct } from "@/lib/catalog";
import { checkAgentText, type FactViolation } from "@/server/lab/fact-check";
import {
  checkDeliveryEligibility,
  checkFreeDelivery,
  checkInventedCapability,
  checkInventedDeadline,
  type CommercialViolation,
} from "@/server/ai/commercial-rules";

/**
 * Guardrail determinista de la respuesta ANTES de enviarla (F5).
 *
 * Hasta acá la prevención de alucinaciones era 100 % prompt. Este módulo reusa
 * el chequeo de hechos del Laboratorio (`checkAgentText`) y lo corre en
 * producción sobre el `reply` del modelo: precios y formatos contra el
 * catálogo y las zonas, y afirmaciones de acciones que el canal no puede
 * ejecutar. Puro y sin BD; el pipeline decide qué hacer con el resultado
 * (una corrección acotada y, si persiste, `SAFE_FALLBACK_REPLY`).
 */

/**
 * Violaciones del guard: las de hechos del Laboratorio más `saludo_repetido`
 * (F5b): medido en las corridas F3 y F4, el modelo a veces responde el saludo
 * configurado literal en TODOS los turnos e ignora al cliente.
 */
export type GuardViolation =
  | FactViolation
  | CommercialViolation
  | { kind: "saludo_repetido"; detail: string }
  | { kind: "respuesta_repetida"; detail: string }
  | { kind: "nombre_repetido"; detail: string };

/** @deprecated alias histórico; use `GuardViolation`. */
export type Violation = GuardViolation;

/** Contexto conversacional opcional del guard. */
export type GuardContext = {
  greeting?: string | null;
  /** Mensajes del agente ya enviados en el hilo antes de esta respuesta. */
  agentTurnsBefore: number;
  /**
   * Hecho DECLARADO por el cliente (no inferido): el pipeline lo calcula con
   * `declaresNaturalPerson` sobre sus mensajes y descarta la condición si la
   * ficha tiene datos de empresa. El guard nunca lo adivina.
   */
  clientIsNaturalPerson?: boolean;
  /** Instrucciones del negocio; respaldo de los plazos que el agente cita. */
  businessText?: string | null;
  /**
   * 008 P2 — Textos de los salientes del BOT ya enviados en el hilo, antes de
   * esta respuesta. Se usa un arreglo (no solo la última) porque el defecto es
   * repetir una respuesta que YA se emitió, y no siempre es la inmediatamente
   * anterior. El pipeline lo deriva del historial con `isBotOutbound`.
   */
  previousAgentReplies?: readonly string[];
  /**
   * T001 — Nombre del contacto según la ficha. El agente debe nombrarlo a lo
   * sumo UNA vez en toda la conversación; el guard veta las menciones
   * posteriores. La ficha viaja pegada al último mensaje del cliente en cada
   * turno, así que el nombre tiene alta saliencia: el prompt por sí solo no
   * garantiza el "nunca". Opcional: sin ficha no hay nada que vigilar.
   */
  contactName?: string | null;
};

export type GuardSources = {
  catalog: PublicProduct[];
  zones: { comuna: string; costoDespacho: number | null }[];
};

export type GuardResult =
  | { ok: true }
  | { ok: false; violations: GuardViolation[]; correction: string };

/**
 * Respuesta segura cuando la corrección tampoco pasa el guard. Registro neutro
 * (usted), sin datos ni promesas: pasa el guard con cualquier catálogo.
 *
 * No debe afirmar una acción consumada ni prometer una futura ("le escribo"):
 * el juez del Laboratorio lo marca como `afirmacion_sin_evidencia`. Tampoco
 * debe usar fórmulas de call center ("¿en qué podemos ayudarle?"): el juez las
 * marca como `tono`. Medido en PROD (corrida run_pk41lg7gshfsjyyhyhkj): 5 casos
 * citaron el texto anterior como hallazgo grave.
 */
export const SAFE_FALLBACK_REPLY =
  "Ese dato no lo puedo confirmar desde aquí. Un asesor del equipo comercial puede ayudarle con eso.";

function describeViolation(v: GuardViolation): string {
  switch (v.kind) {
    case "precio":
      return `Su respuesta cita ${v.detail}, que no está en el catálogo ni en las tarifas de despacho.`;
    case "formato":
      return `Su respuesta ofrece ${v.detail}, un formato que ese producto no tiene en el catálogo.`;
    case "unidades":
      return `Su respuesta cotiza ${v.detail}. Corrija la cantidad de unidades por bolsa antes de responder.`;
    case "afirmacion":
      return `Su respuesta afirma "${v.detail}", y este canal no puede ejecutar ni verificar esa acción.`;
    case "saludo_repetido":
      return "Su respuesta repite el saludo inicial. El cliente ya fue saludado: responda a lo que acaba de escribir, sin volver a saludar.";
    case "respuesta_repetida":
      return "Su respuesta repite casi literalmente algo que usted ya dijo. El cliente escribió algo nuevo: avance el diálogo, responda al último mensaje o pida solo el dato que falta, sin repetir la misma pregunta.";
    case "nombre_repetido":
      return "Su respuesta vuelve a nombrar al cliente. El nombre ya se usó UNA vez en la conversación: en los mensajes siguientes se habla sin nombrarlo.";
    case "elegibilidad_despacho":
      return "Su respuesta ofrece o coordina despacho a un cliente que declaró comprar para uso personal. A una persona natural solo corresponde el retiro en planta.";
    case "despacho_gratuito":
      return `Su respuesta ofrece despacho sin costo ("${v.detail}"), y el negocio nunca despacha gratis: el despacho tiene tarifa según la comuna.`;
    case "plazo_inventado":
      return `Su respuesta cita el plazo "${v.detail}" con un calificativo que no está en las fuentes del negocio. Copie el plazo tal como aparece en las instrucciones.`;
    case "capacidad_inventada":
      return `Su respuesta promete revisar o consultar historial o pedidos ("${v.detail}"), una capacidad que este canal no tiene. Diga que no puede acceder y pida los datos al cliente.`;
  }
}

/** Minúsculas, sin tildes, puntuación colapsada a espacios simples. */
function normalizeLoose(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Ventana de comparación del saludo repetido: cuántos caracteres del inicio
 * normalizado del saludo se exigen en el arranque de la respuesta.
 *
 * Comparar la PRIMERA ORACIÓN del saludo es el error que produjo el incidente
 * de PROD (corrida run_pk41lg7gshfsjyyhyhkj): un saludo que abre con "¡Hola!"
 * degeneraba la comparación en "toda respuesta que empiece con Hola", y 7
 * respuestas correctas quedaron rechazadas como `saludo_repetido`. La ventana
 * se toma del saludo COMPLETO; si el saludo es más corto que la ventana se
 * compara entero, de modo que un saludo breve repetido con contenido detrás
 * también se detecta.
 */
const GREETING_PREFIX_CHARS = 20;

/**
 * Detecta que la respuesta ES el saludo configurado (o repite su arranque
 * distintivo) cuando el agente ya habló antes. Medido en la corrida F5+F6: con
 * una tolerancia de largo, el modelo seguía abriendo cada turno con el saludo y
 * pegaba el contenido detrás. Volver a saludar es repetir el saludo, traiga o
 * no contenido: la regla de estilo lo prohíbe y el guard lo hace cumplir.
 *
 * La comparación toma los primeros `GREETING_PREFIX_CHARS` caracteres del
 * saludo COMPLETO. Así un saludo que abre con "¡Hola!" no convierte cualquier
 * "Hola" en una repetición: el veto solo dispara cuando la respuesta reproduce
 * ese arranque o el saludo completo. Si el saludo es más corto que la ventana,
 * se compara entero y una repetición con contenido detrás también se detecta.
 */
/**
 * 008 — Fórmulas que vuelven a saludar en nombre del negocio (auditoría A7).
 *
 * La comparación por prefijo del saludo configurado no alcanza: el modelo abre
 * turnos posteriores con variantes ("Hola, le saluda Lamas Foods") que no
 * reproducen ese arranque.
 *
 * Se exige la FÓRMULA ("le saluda", "somos el equipo"), NO un "Hola" suelto.
 * Vetar cualquier "Hola" fue el incidente de PROD `run_pk41`: rechazaba
 * respuestas correctas que empezaban con "¡Hola! Su volumen semanal es alto…".
 * La fórmula sí distingue un re-saludo de una respuesta con contenido.
 */
const REGREETING_FORMULA = /(le saluda|les saluda|somos el equipo|estimado cliente)/;

export function isRepeatedGreeting(reply: string, context: GuardContext): boolean {
  const greeting = context.greeting?.trim();
  if (!greeting || context.agentTurnsBefore < 1) return false;
  const normReply = normalizeLoose(reply);
  if (!normReply) return false;
  const normGreeting = normalizeLoose(greeting);
  if (!normGreeting) return false;
  if (normReply === normGreeting) return true;
  // 008: variante con la fórmula del negocio, aunque no copie el arranque.
  if (REGREETING_FORMULA.test(normReply)) return true;
  const prefix = normGreeting.slice(0, GREETING_PREFIX_CHARS);
  return normReply.startsWith(prefix);
}

/**
 * 008 P2 — Detector de continuidad: el agente repite, casi literal, una
 * respuesta que ya emitió mientras el cliente preguntó algo nuevo. Medido en
 * `pide_boleta_pago#0`: tras "perfecto, transfiero hoy mismo" repitió palabra
 * por palabra la pregunta de comuna y productos del turno anterior.
 *
 * El detector es deliberadamente "misma respuesta otra vez": NO mira el turno
 * del cliente (el guard no lo recibe). Umbrales conservadores para no vetar
 * respuestas legítimamente parecidas:
 * - al menos 8 tokens: evita marcar cierres cortos que se repiten sin ser
 *   defecto ("Gracias, quedo atento.").
 * - Jaccard de palabras >= 0.9: exige solapamiento casi total; un saludo
 *   distinto con contenido nuevo queda fuera.
 */
const MIN_REPEAT_TOKENS = 8;
const REPEAT_JACCARD_THRESHOLD = 0.9;

function tokensOf(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}

export function isRepeatedReply(reply: string, context: GuardContext): boolean {
  const previous = context.previousAgentReplies;
  if (!previous || previous.length === 0) return false;
  const normReply = normalizeLoose(reply);
  if (!normReply) return false;
  const replyTokens = tokensOf(normReply);
  if (replyTokens.length < MIN_REPEAT_TOKENS) return false;
  const replySet = new Set(replyTokens);

  for (const prior of previous) {
    const normPrior = normalizeLoose(prior);
    if (!normPrior) continue;
    if (normPrior === normReply) return true;
    const priorTokens = tokensOf(normPrior);
    if (priorTokens.length < MIN_REPEAT_TOKENS) continue;
    const priorSet = new Set(priorTokens);
    let intersection = 0;
    for (const token of replySet) {
      if (priorSet.has(token)) intersection += 1;
    }
    const union = replySet.size + priorSet.size - intersection;
    if (union > 0 && intersection / union >= REPEAT_JACCARD_THRESHOLD) return true;
  }
  return false;
}

/**
 * T001/T005 — Largo mínimo del token de nombre que se evalúa. Nombres de una
 * sola sílaba ("Ana", "Sol", "Paz") quedan fuera a propósito: un token de 3
 * letras o menos es demasiado corto para distinguirlo de una palabra común sin
 * vetar respuestas correctas.
 */
const MIN_NAME_TOKEN_LENGTH = 4;

/** Tokens del nombre en forma normalizada (minúsculas, sin tildes). */
function nameTokens(contactName: string): string[] {
  return tokensOf(normalizeLoose(contactName));
}

/**
 * T005 — Signos que, inmediatamente antes del nombre, lo marcan como VOCATIVO:
 * una llamada directa al interlocutor. `.` y `?`/`!` quedan fuera a propósito:
 * cierran una oración y el nombre que sigue abre otra, no es un trato.
 */
const VOCATIVE_BOUNDARY = new Set([",", ";", ":", "¡", "¿", "(", "—", "–", "-"]);

/** Interjecciones de saludo que convierten el nombre siguiente en vocativo. */
const VOCATIVE_GREETINGS = new Set(["hola", "buenas", "buenos"]);

/**
 * T005 — ¿La aparición del nombre que empieza en `index` es un VOCATIVO?
 *
 * Se mira hacia atrás saltando espacios: es vocativo si está al inicio del
 * texto, si lo precede un signo de `VOCATIVE_BOUNDARY`, o si lo precede una
 * interjección de saludo. Cualquier otra cosa —un artículo o una preposición
 * ("en Santiago", "la rosa mosqueta", "a Roberto")— lo deja fuera: es una
 * comuna, un producto o una empresa, no un trato directo.
 */
function isVocativeAt(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /\s/u.test(text[i]!)) i -= 1;
  if (i < 0) return true;
  if (VOCATIVE_BOUNDARY.has(text[i]!)) return true;
  let start = i;
  while (start >= 0 && /[\p{L}\p{N}]/u.test(text[start]!)) start -= 1;
  return VOCATIVE_GREETINGS.has(normalizeLoose(text.slice(start + 1, i + 1)));
}

/**
 * ¿El texto usa el token del nombre como vocativo?
 *
 * Se recorre el texto por palabras (con `wordSpans`, que normaliza tildes) y no
 * por regex sobre el texto crudo: un nombre con tilde ("José") nunca coincidiría
 * contra su forma normalizada ("jose").
 */
function hasVocativeToken(text: string, token: string): boolean {
  for (const span of wordSpans(text)) {
    if (span.norm === token && isVocativeAt(text, span.start)) return true;
  }
  return false;
}

/**
 * T001/T005 — Detecta que la respuesta vuelve a nombrar al contacto COMO
 * VOCATIVO.
 *
 * Regla de producto: el nombre aparece COMO MÁXIMO UNA vez en los salientes del
 * agente. Medido en PROD, el modelo lo repetía en casi cada turno porque la
 * ficha con `- Nombre:` viaja pegada al último mensaje del cliente en cada
 * vuelta.
 *
 * T005: contar cualquier aparición del token corrompía mensajes correctos.
 * "Santiago" es comuna del catálogo y nombre chileno; con el saliente previo
 * "Hacemos despachos en Santiago...", la respuesta "El despacho a Santiago
 * cuesta $5.000." quedaba vetada y se entregaba sin la comuna. Por eso la
 * aparición solo cuenta si es un vocativo (ver `isVocativeAt`) y el saliente
 * previo también lo usó como vocativo.
 *
 * Conservador por diseño:
 * - Sin `contactName` (o sin tokens) → `false`.
 * - Token de detección: el PRIMER token del nombre normalizado ("Roberto", no
 *   "Roberto Gonzalez"). Exige `MIN_NAME_TOKEN_LENGTH`.
 * - Comparación por TOKEN COMPLETO, nunca por substring.
 * - SOLO dispara si el nombre ya apareció COMO VOCATIVO en algún saliente
 *   previo: la primera mención nunca se veta. Sin `previousAgentReplies` →
 *   `false`.
 */
export function isRepeatedName(reply: string, context: GuardContext): boolean {
  const contactName = context.contactName?.trim();
  if (!contactName) return false;
  const firstToken = nameTokens(contactName)[0];
  if (!firstToken || firstToken.length < MIN_NAME_TOKEN_LENGTH) return false;
  const previous = context.previousAgentReplies;
  if (!previous || previous.length === 0) return false;
  if (!hasVocativeToken(reply, firstToken)) return false;
  return previous.some((prior) => hasVocativeToken(prior, firstToken));
}

/** Primera letra alfabética a mayúscula, sin tocar el resto del texto. */
function capitalizeFirstLetter(text: string): string {
  const match = /\p{L}/u.exec(text);
  if (!match || match.index === undefined) return text;
  const index = match.index;
  return text.slice(0, index) + text[index]!.toUpperCase() + text.slice(index + 1);
}

/** Palabra (letras/números) con su rango en el texto original. */
type WordSpan = { norm: string; start: number; end: number };

/** Palabras con su posición, para operar siempre por token completo. */
function wordSpans(text: string): WordSpan[] {
  const re = /[\p{L}\p{N}]+/gu;
  const spans: WordSpan[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    spans.push({
      norm: normalizeLoose(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return spans;
}

/**
 * T005 — Limpia la puntuación que queda al quitar un vocativo. NO capitaliza:
 * eso lo decide `stripContactName`, que sabe si la remoción tocó el inicio del
 * texto. Reglas: colapsa espacios, pega el signo a la palabra, colapsa corridas
 * de separadores y quita la puntuación huérfana del inicio sin borrar `¿` ni `¡`.
 */
function collapseOrphanPunctuation(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/[,;:]{2,}/g, ",")
    .replace(/[.!]{2,}/g, ".")
    .replace(/([.!?]),/g, "$1")
    .replace(/,\./g, ".")
    .replace(/([¿¡])\s+/g, "$1")
    .replace(/^[\s.,;:!?]+/u, "")
    .trim();
}

/**
 * T005 — Tramos del texto donde el nombre aparece como VOCATIVO.
 *
 * Recorre el texto por palabras y agrupa los tokens del nombre, incluidos los
 * unidos por un conector ("Roberto y Gonzalez" es el mismo nombre). El ancla es
 * SIEMPRE el primer token del nombre (`firstToken`, el mismo de la detección):
 * así un token posterior que también sea palabra común ("El" de "Panaderia El
 * Trigo") no abre un tramo propio. El tramo cuenta solo si su ancla es vocativa
 * (ver `isVocativeAt`): "en Santiago", "la rosa mosqueta" o "a Roberto" quedan
 * fuera y no se borran.
 */
function findVocativeSpans(
  reply: string,
  name: string,
  firstToken: string
): { start: number; end: number }[] {
  const nameSet = new Set(nameTokens(name));
  const spans = wordSpans(reply);
  const out: { start: number; end: number }[] = [];
  let i = 0;
  while (i < spans.length) {
    const first = spans[i]!;
    if (first.norm !== firstToken) {
      i += 1;
      continue;
    }
    let end = first.end;
    let j = i + 1;
    while (j < spans.length) {
      const next = spans[j]!;
      if (!/^\s*$/.test(reply.slice(end, next.start))) break;
      if (nameSet.has(next.norm)) {
        end = next.end;
        j += 1;
        continue;
      }
      const after = spans[j + 1];
      if (
        /^(y|e)$/u.test(next.norm) &&
        after &&
        nameSet.has(after.norm) &&
        /^\s*$/.test(reply.slice(next.end, after.start))
      ) {
        end = after.end;
        j += 2;
        continue;
      }
      break;
    }
    if (isVocativeAt(reply, first.start)) out.push({ start: first.start, end });
    i = j;
  }
  return out;
}

/**
 * T001/T005 — Respaldo determinista del nombre repetido: entrega el contenido
 * SIN el vocativo en vez del fallback genérico.
 *
 * El nombre es una falla de estilo, no de hechos: reemplazar la respuesta por
 * `SAFE_FALLBACK_REPLY` borraría contenido válido (lección de `run_pk41`). Se
 * eliminan SOLO las apariciones vocativas (T005), no las comunas, productos o
 * empresas que comparten el token. Al quitar una, se consume el delimitador
 * interior (`;` `:` `,`): el de la izquierda si existe; si no, uno posterior.
 * Nunca se consumen `.!?`. Si tras limpiar no queda letra ni número, se
 * devuelve `SAFE_FALLBACK_REPLY`.
 */
export function stripContactName(
  reply: string,
  contactName: string | null | undefined
): string {
  const name = contactName?.trim();
  if (!name) return reply;
  const firstToken = nameTokens(name)[0];
  // Misma guarda de largo que la detección: un nombre corto no se recorta.
  if (!firstToken || firstToken.length < MIN_NAME_TOKEN_LENGTH) return reply;

  const vocatives = findVocativeSpans(reply, name, firstToken);
  if (vocatives.length === 0) return reply;

  const removals: { start: number; end: number }[] = [];
  for (const span of vocatives) {
    let start = span.start;
    let end = span.end;
    let left = start - 1;
    while (left >= 0 && /[ \t]/.test(reply[left]!)) left -= 1;
    if (left >= 0 && /[,;:]/.test(reply[left]!)) {
      start = left;
    } else {
      let right = end;
      while (right < reply.length && /[ \t]/.test(reply[right]!)) right += 1;
      if (right < reply.length && /[,;:]/.test(reply[right]!)) end = right + 1;
    }
    removals.push({ start, end });
  }

  let stripped = "";
  let cursor = 0;
  for (const r of removals) {
    if (r.start < cursor) continue;
    stripped += reply.slice(cursor, r.start);
    cursor = r.end;
  }
  stripped += reply.slice(cursor);

  const removedAtStart = removals.some((r) => r.start === 0);
  stripped = collapseOrphanPunctuation(stripped);
  // Capitaliza solo si la remoción tocó el inicio, o tras `¿`/`¡` en minúscula.
  if (removedAtStart || /^[¿¡]\s*\p{Ll}/u.test(stripped)) {
    stripped = capitalizeFirstLetter(stripped);
  }
  if (!/[\p{L}\p{N}]/u.test(stripped)) return SAFE_FALLBACK_REPLY;
  return stripped;
}

/**
 * Mensaje `system` de corrección: cita cada violación y pide responder de
 * nuevo sin ella. Va al FINAL del arreglo de mensajes para no romper el
 * prefijo cacheable.
 */
export function buildCorrection(violations: GuardViolation[]): string {
  return [
    "CORRECCIÓN OBLIGATORIA. Su último JSON no se envió al cliente:",
    ...violations.map((v) => `- ${describeViolation(v)}`),
    "Responda OTRA VEZ el JSON usando solo precios, formatos y comunas del catálogo y las zonas, y sin afirmar acciones que no puede hacer. Si no tiene el dato, diga que lo confirma con el equipo.",
  ].join("\n");
}

export function guardReply(
  reply: string,
  sources: GuardSources,
  context?: GuardContext
): GuardResult {
  const violations: GuardViolation[] = [...checkAgentText(reply, sources)];
  if (context && isRepeatedGreeting(reply, context)) {
    violations.push({ kind: "saludo_repetido", detail: reply.trim() });
  }
  if (context && isRepeatedReply(reply, context)) {
    violations.push({ kind: "respuesta_repetida", detail: reply.trim() });
  }
  if (context && isRepeatedName(reply, context)) {
    violations.push({
      kind: "nombre_repetido",
      detail: context.contactName?.trim() ?? reply.trim(),
    });
  }
  // P1: reglas comerciales. Las que no dependen de contexto corren siempre; la
  // elegibilidad exige el hecho declarado y el plazo exige la fuente del negocio.
  violations.push(...checkFreeDelivery(reply));
  violations.push(...checkInventedCapability(reply));
  if (context?.clientIsNaturalPerson === true) {
    violations.push(...checkDeliveryEligibility(reply, { clientIsNaturalPerson: true }));
  }
  if (typeof context?.businessText === "string") {
    violations.push(...checkInventedDeadline(reply, context.businessText));
  }
  if (violations.length === 0) return { ok: true };
  return { ok: false, violations, correction: buildCorrection(violations) };
}

/**
 * Qué se entrega cuando la corrección del guard tampoco pasó.
 *
 * `saludo_repetido` es una falla de estilo: la respuesta original es correcta
 * en contenido y reemplazarla por el fallback la empeora (medido en PROD: el
 * fallback genérico perdió el aviso de escalado por alto volumen y el juez lo
 * marcó grave). Si TODAS las violaciones originales son de estilo, se entrega
 * la original; si hay una violación de hechos (precio, formato o afirmación),
 * se entrega la respuesta segura.
 *
 * 008 P2: `respuesta_repetida` se trata igual que el saludo repetido. Es un
 * defecto real de continuidad, pero la original al menos responde algo; el
 * fallback genérico borraría la respuesta entera. La corrección sí se intenta
 * (el guard igual devuelve `ok: false`), solo que si no prospera se conserva.
 *
 * T001: `nombre_repetido` también es estilo. Su respaldo determinista NO es el
 * fallback genérico sino `stripContactName`: se entrega el contenido sin el
 * nombre (lección de `run_pk41`: el fallback borró contenido válido y el juez
 * lo marcó grave). Una violación de hechos sigue mandando al fallback.
 *
 * T005: `context` es REQUERIDO. Omitirlo desactivaba `stripContactName` en
 * silencio (sin `contactName` no hay nada que recortar), y el único llamador
 * —`pipeline.ts`— siempre lo tiene a mano.
 */
export function resolveUncorrectedReply(
  original: string,
  violations: GuardViolation[],
  context: GuardContext
): string {
  const styleOnly = violations.every(
    (v) =>
      v.kind === "saludo_repetido" ||
      v.kind === "respuesta_repetida" ||
      v.kind === "nombre_repetido"
  );
  if (!styleOnly) return SAFE_FALLBACK_REPLY;
  if (violations.some((v) => v.kind === "nombre_repetido")) {
    return stripContactName(original, context.contactName);
  }
  return original;
}
