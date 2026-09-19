import type { PublicProduct } from "@/lib/catalog";
import { checkAgentText, type FactViolation } from "@/server/lab/fact-check";

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
  | { kind: "saludo_repetido"; detail: string };

/** @deprecated alias histórico; use `GuardViolation`. */
export type Violation = GuardViolation;

/** Contexto conversacional opcional del guard. */
export type GuardContext = {
  greeting?: string | null;
  /** Mensajes del agente ya enviados en el hilo antes de esta respuesta. */
  agentTurnsBefore: number;
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
 */
export function resolveUncorrectedReply(
  original: string,
  violations: GuardViolation[]
): string {
  const styleOnly = violations.every((v) => v.kind === "saludo_repetido");
  return styleOnly ? original : SAFE_FALLBACK_REPLY;
}
