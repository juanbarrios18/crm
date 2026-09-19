/**
 * Patrón de RESPALDO de intención de escalado (FR-022). Se evalúa sobre el
 * mensaje del cliente ANTES del LLM: si matchea, el handoff ocurre aunque el
 * modelo no lo detecte.
 *
 * Es una RED, no el mecanismo: la vía principal es el modelo, que entiende
 * variantes que ningún patrón cubre ("¿me atiende una persona?", "pásame con el
 * encargado"). Por eso el patrón se calibra para no abortar conversaciones que
 * siguen: un falso positivo corta una venta en curso.
 *
 * Criterio (P7): exige un VERBO DE CONTACTO a menos de 40 caracteres de un
 * objeto humano, o la petición explícita "atencion humana". Una mención suelta
 * del objeto —"¿cuánto cobra un asesor de eventos?", "un asesor me dijo que
 * sí"— NO alcanza.
 *
 * Sobre las tildes: el texto se NORMALIZA antes de evaluar (minúsculas y sin
 * diacríticos), así que este patrón se escribe sin tildes y una sola entrada
 * cubre "derívame" y "derivar", "pásame" y "pasas". Escribir las variantes
 * acentuadas a mano era la fuente de los huecos: "derívame" no matcheaba con
 * `derivar` y la petición real se perdía.
 *
 * Fuera del patrón a propósito: "atiendan"/"atiéndanme" es ambiguo (puede ser
 * una consulta de horarios: "¿atienden los sábados?"), así que no aborta la
 * conversación por sí solo; lo resuelve el modelo en la vía principal.
 */
export const HANDOFF_BACKUP_REGEX =
  /(hablar|comunic|contactar|deriv|pas[ae])[\s\S]{0,40}?(asesor|humano|persona|alguien)|atencion humana/;

/**
 * 008 — Disparadores deterministas que la configuración del negocio YA manda
 * escalar y que dependían solo del modelo (auditoría A3):
 *
 * - Queja o molestia: "Si la persona se muestra molesta o hay una queja, escala".
 * - Descuento, crédito o entrega especial: "Si pide algo no contemplado
 *   (crédito, descuentos, entregas especiales), no lo ofrezca, pero escale".
 *
 * En la corrida de PROD esto era no determinista: `cliente_enojado` rep0 no
 * escaló y las repeticiones 1 y 2 sí; el pedido de descuento no escaló nunca.
 * Como el modelo es el que decidía, la conducta cambiaba entre repeticiones con
 * el mismo guion.
 *
 * Se mantiene el criterio del patrón de respaldo: exigir una señal clara. "Al por
 * mayor" (el modelo de venta del negocio) NO matchea; "por volumen" o "por
 * cantidad" sí.
 */
export const HANDOFF_ESCALATION_REGEX =
  /queja|reclamo|molest|enojad|indignad|no me llego|no recibi|me cobraron|pedido incompleto|faltaron|faltan \d|descuento|rebaja|mejor precio|precio por (volumen|cantidad)|si llevo (mas|hart)/;

/** Minúsculas y sin diacríticos, para que las tildes no abran huecos. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function matchesHandoffIntent(text: string): boolean {
  const normalized = normalize(text);
  return (
    HANDOFF_BACKUP_REGEX.test(normalized) ||
    HANDOFF_ESCALATION_REGEX.test(normalized)
  );
}
