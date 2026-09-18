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
 */
export const SAFE_FALLBACK_REPLY =
  "Ese dato lo confirmo con el equipo comercial y le escribo. ¿Hay algo más en lo que pueda ayudarle?";

function describeViolation(v: GuardViolation): string {
  switch (v.kind) {
    case "precio":
      return `Su respuesta cita ${v.detail}, que no está en el catálogo ni en las tarifas de despacho.`;
    case "formato":
      return `Su respuesta ofrece ${v.detail}, un formato que ese producto no tiene en el catálogo.`;
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
 * Detecta que la respuesta ES el saludo configurado (o arranca con su primera
 * oración) cuando el agente ya habló antes. Medido en la corrida F5+F6: con una
 * tolerancia de largo, el modelo seguía abriendo cada turno con el saludo y
 * pegaba el contenido detrás. Volver a saludar es repetir el saludo, traiga o
 * no contenido: la regla de estilo lo prohíbe y el guard lo hace cumplir.
 */
export function isRepeatedGreeting(reply: string, context: GuardContext): boolean {
  const greeting = context.greeting?.trim();
  if (!greeting || context.agentTurnsBefore < 1) return false;
  const normReply = normalizeLoose(reply);
  const normGreeting = normalizeLoose(greeting);
  if (!normGreeting) return false;
  if (normReply === normGreeting) return true;
  const firstSentence = normalizeLoose(greeting.split(/[.?!]/)[0] ?? "");
  return firstSentence.length > 0 && normReply.startsWith(firstSentence);
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
