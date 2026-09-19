/**
 * Red determinista de INTENCIÓN DE COMPRA (P3, 008). Se evalúa sobre el último
 * mensaje entrante del cliente, independiente del modelo: si declara explícita y
 * directamente que quiere comprar, el lead avanza desde la etapa inicial aunque
 * la anotación no lo detecte.
 *
 * Causa medida (`specs/008-medicion-contexto-agente/plan-run-ejf1ffwxlmifjeeh315f.md`,
 * sección 5): en `pide_boleta_pago#1` y `reclama_no_recibido#2` el cliente abrió
 * con "quiero hacer un pedido para mi negocio" — señal que el criterio de la
 * etapa "Interesado" debería reconocer — y el lead seguía en "Nuevo" cuando el
 * handoff cortó el guion. No fue una carrera (el turno espera la anotación) ni
 * una lectura obsoleta (el runner relee la etapa): fue varianza del modelo en la
 * anotación, amplificada por el corte temprano.
 *
 * PRECISIÓN vs COBERTURA: un falso positivo acá MUEVE un lead sin señal real, así
 * que el patrón exige declaración en PRIMERA PERSONA y verbo explícito de compra
 * o pago. No dispara con consultas de precio ("cuanto sale..."), preguntas de
 * capacidad ("me pueden emitir boleta?"), ni cantidades sueltas ("y el de 20?").
 * "quiero pedir" y "quiero comprar" se aceptan aunque puedan preceder a una
 * pregunta: son declaraciones explícitas en primera persona, y el costo de un
 * falso negativo (lead estancado con intención clara) es el defecto que esta red
 * corrige. El modelo sigue siendo la vía principal para las variantes que ningún
 * patrón cubre.
 *
 * Sobre las tildes: el texto se NORMALIZA antes de evaluar (minúsculas y sin
 * diacríticos), así que el patrón se escribe sin tildes y una sola entrada cubre
 * "queria"/"quería", "pasame"/"pásame", "como"/"cómo".
 */

/** Verbo de compra en primera persona con su objeto explícito. */
const FIRST_PERSON_PURCHASE = [
  "quiero hacer un pedido",
  "quiero pedir\\b",
  "quiero comprar(?:les)?\\b",
  "quiero encargar\\b",
  "quiero repetir el pedido",
  "quiero empezar a comprarles",
  "quiero dejar encargado",
  "quiero cerrar el pedido",
  "quiero confirmar el pedido",
  "queria hacer un pedido",
  "me gustaria hacer un pedido",
  "vengo a (?:pedir|comprar(?:les)?|encargar)\\b",
  "necesito (?:hacer un pedido|pedir|comprar(?:les)?)\\b",
];

/** Intención explícita de pago o transferencia, también en primera persona. */
const PAYMENT_INTENT = [
  "voy a transferir",
  "quiero transferir",
  "transfiero\\b",
  "pasame los datos para transferir",
  "quiero pagar\\b",
  "como pago\\b",
];

export const PURCHASE_INTENT_REGEX = new RegExp(
  [...FIRST_PERSON_PURCHASE, ...PAYMENT_INTENT].join("|")
);

/** Minúsculas y sin diacríticos, para que las tildes no abran huecos. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** ¿El cliente declara explícitamente que quiere comprar o pagar? */
export function declaresPurchaseIntent(text: string): boolean {
  return PURCHASE_INTENT_REGEX.test(normalize(text));
}

export type StageRef = { id: string; position: number; kind?: string | null };
export type OpenStageRef = { id: string; position: number };

/**
 * Decide el avance por la red determinista, sin base de datos.
 *
 * Devuelve la etapa destino SOLO cuando:
 * - el cliente declara intención de compra,
 * - la etapa actual es la inicial entre las abiertas (menor posición),
 * - existe una etapa abierta siguiente.
 *
 * En cualquier otro caso devuelve `null`: sin intención, lead sin etapa, lead ya
 * avanzado, ganado/perdido (no se reviven ni se sobreescriben) o pipeline sin
 * etapa siguiente. La red es específicamente para leads estancados en la etapa
 * inicial; no salta etapas intermedias ni compite con el avance del modelo.
 */
export function resolvePurchaseIntentTarget(input: {
  declaresIntent: boolean;
  currentStage: StageRef | null;
  openStages: OpenStageRef[];
}): { id: string } | null {
  if (!input.declaresIntent) return null;

  const current = input.currentStage;
  if (!current) return null;
  if (current.kind === "won" || current.kind === "lost") return null;

  const ordered = [...input.openStages].sort(
    (a, b) => a.position - b.position
  );
  const initial = ordered[0];
  if (!initial) return null;
  if (current.id !== initial.id) return null;

  const next = ordered.find((stage) => stage.position > initial.position);
  return next ? { id: next.id } : null;
}
