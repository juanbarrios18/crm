/**
 * Fuente única de verdad del registro rioplatense (voseo).
 *
 * Este módulo define QUÉ lexemas son voseo y CÓMO detectarlos. Lo consumen dos
 * consumidores con la misma regla:
 *   - el guardián de registro (`tests/unit/voice-register.test.ts`), que vigila
 *     el código y la documentación que lee el agente;
 *   - la verificación determinista del Laboratorio
 *     (`src/server/lab/dialect-check.ts`), que evalúa las respuestas del agente
 *     contra la voz configurada del negocio.
 *
 * Mantener una sola lista evita que el guardián y el instrumento de medición se
 * desincronicen.
 */

/**
 * Lista EXPLÍCITA de lexemas voseo. NO es una regla por terminación a propósito:
 * `está`, `acá`, `más`, `además` y `jamás` también terminan en `-á` y son español
 * neutro legítimo; una regla por sufijo los marcaría en falso.
 */
export const VOSEO_LEXEMES = [
  // Imperativos
  "agregá",
  "probá",
  "guardá",
  "revisá",
  "elegí",
  "considerá",
  "ingresá",
  "poné",
  "definí",
  "creá",
  "subí",
  "cargá",
  "completá",
  "seleccioná",
  "configurá",
  "volvé",
  "andá",
  "escribí",
  "escribinos",
  "contanos",
  "consultanos",
  "apuntá",
  "verificá",
  "dejá",
  "usá",
  "hacé",
  "corré",
  "extendé",
  "mirá",
  "abrí",
  "cerrá",
  "compará",
  "invocálos",
  "tratá",
  "respondé",
  "decile",
  "decime",
  "contame",
  "apagá",
  "ofrecé",
  "pedí",
  // Más imperativos voseo del mismo defecto, descubiertos al limpiar el repo.
  "recargá",
  "avanzá",
  "detectá",
  "escalá",
  // Huecos que el prompt del agente tenía y la lista original no cazaba.
  // Si aparecen de nuevo, es una regresión del harness: el guardián debe verlos.
  "repetí",
  "despedite",
  "vení",
  "decí",
  "salí",
  "esperá",
  "avisá",
  "mandá",
  "pasá",
  "seguí",
  "fijate",
  "acordate",
  // Presente del indicativo (2ª persona voseo)
  "tenés",
  "podés",
  "querés",
  "sos",
  "sabés",
  "hacés",
  "decís",
  "venís",
  "andás",
  "preferís",
  "elegís",
  "necesitás",
  "vendés",
  "comprás",
  "fabricás",
  "producís",
  "cambiás",
  // Pronombre
  "vos",
] as const;

export type VoseoLexeme = (typeof VOSEO_LEXEMES)[number];

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ALTERNATION = VOSEO_LEXEMES.map(escapeRegExp).join("|");

/**
 * Construye el patrón de detección con límites de palabra Unicode.
 *
 * CRÍTICO: el límite usa lookarounds `(?<!\p{L})` y `(?!\p{L})` con flag `u`, NO
 * `\b`. En JS `\b` se apoya en `\w`, que es ASCII, así que `\bagregá\b` NO
 * matchea "agregá": la `á` no es carácter de palabra y no hay transición de
 * límite. Si alguien "simplifica" esto a `\b`, el detector deja de funcionar
 * para todos los lexemas terminados en vocal acentuada.
 *
 * Devuelve una instancia nueva con flag `g` para que cada escaneo arranque con
 * `lastIndex` en cero y no arrastre estado entre llamadas.
 */
export function buildVoseoPattern(): RegExp {
  return new RegExp(`(?<!\\p{L})(${ALTERNATION})(?!\\p{L})`, "giu");
}

/** Patrón listo para usar cuando no se itera (`.test`). */
export const VOSEO_PATTERN = buildVoseoPattern();

/**
 * Devuelve las ocurrencias de voseo en `text`, case-insensitive y con límites de
 * palabra Unicode. Cada ocurrencia reporta la palabra tal como aparece.
 */
export function findVoseo(text: string): { word: string }[] {
  const pattern = buildVoseoPattern();
  const out: { word: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const word = match[1];
    if (word) out.push({ word });
  }
  return out;
}
