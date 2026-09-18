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

export type Violation = FactViolation;

export type GuardSources = {
  catalog: PublicProduct[];
  zones: { comuna: string; costoDespacho: number | null }[];
};

export type GuardResult =
  | { ok: true }
  | { ok: false; violations: Violation[]; correction: string };

/**
 * Respuesta segura cuando la corrección tampoco pasa el guard. Registro neutro
 * (usted), sin datos ni promesas: pasa el guard con cualquier catálogo.
 */
export const SAFE_FALLBACK_REPLY =
  "Ese dato lo confirmo con el equipo comercial y le escribo. ¿Hay algo más en lo que pueda ayudarle?";

function describeViolation(v: Violation): string {
  switch (v.kind) {
    case "precio":
      return `Su respuesta cita ${v.detail}, que no está en el catálogo ni en las tarifas de despacho.`;
    case "formato":
      return `Su respuesta ofrece ${v.detail}, un formato que ese producto no tiene en el catálogo.`;
    case "afirmacion":
      return `Su respuesta afirma "${v.detail}", y este canal no puede ejecutar ni verificar esa acción.`;
  }
}

/**
 * Mensaje `system` de corrección: cita cada violación y pide responder de
 * nuevo sin ella. Va al FINAL del arreglo de mensajes para no romper el
 * prefijo cacheable.
 */
export function buildCorrection(violations: Violation[]): string {
  return [
    "CORRECCIÓN OBLIGATORIA. Su último JSON no se envió al cliente:",
    ...violations.map((v) => `- ${describeViolation(v)}`),
    "Responda OTRA VEZ el JSON usando solo precios, formatos y comunas del catálogo y las zonas, y sin afirmar acciones que no puede hacer. Si no tiene el dato, diga que lo confirma con el equipo.",
  ].join("\n");
}

export function guardReply(reply: string, sources: GuardSources): GuardResult {
  const violations = checkAgentText(reply, sources);
  if (violations.length === 0) return { ok: true };
  return { ok: false, violations, correction: buildCorrection(violations) };
}
