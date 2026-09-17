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

/** Minúsculas y sin diacríticos, para que las tildes no abran huecos. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function matchesHandoffIntent(text: string): boolean {
  return HANDOFF_BACKUP_REGEX.test(normalize(text));
}
