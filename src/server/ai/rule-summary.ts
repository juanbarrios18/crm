/**
 * Resumen humano de las reglas del agente (N1 + N2) para el panel de
 * configuración.
 *
 * El dueño de la instancia no debe leer las reglas crudas: un reglamento de
 * decenas de líneas recrea el problema que el panel busca resolver (invita a
 * razonar sobre el texto en vez de configurar la voz del negocio). Este módulo
 * las agrupa por tema para que la interfaz muestre viñetas cortas.
 *
 * El agrupamiento es por CÓDIGO a partir del texto de la regla: una tabla de
 * temas con palabras clave. No hay contenido de reglas hardcodeado acá.
 *
 * Garantía crítica: una regla que no coincide con ningún tema NO se pierde,
 * cae en el grupo de respaldo ("Otros"). Así, cuando el producto agrega una
 * regla nueva a N2, el panel la muestra sin tocar la interfaz.
 *
 * Función pura: sin base de datos, sin React, sin efectos.
 */

export type RuleGroup = { topic: string; rules: string[] };

type Theme = { topic: string; keywords: string[] };

/**
 * Temas en orden de precedencia: la primera coincidencia gana. Las palabras
 * clave se comparan contra el texto normalizado (minúsculas, sin tildes), así
 * que "envía", "envia" y "ENVÍA" coinciden con la misma entrada.
 */
const THEMES: readonly Theme[] = [
  {
    topic: "No prometer lo que el canal no puede hacer",
    keywords: [
      "no envia",
      "no genera",
      "no confirma",
      "no reserva",
      "no agenda",
      "afirme haber",
      "esta confirmado",
      "lo genere",
      "ya se envio",
    ],
  },
  {
    topic: "Verificación de documentos y pagos",
    keywords: [
      "no recibio",
      "verificar",
      "envi",
      "boleta",
      "factura",
      "documento",
      "transferencia",
      "resumen",
      "agendado",
      "pago",
    ],
  },
  {
    topic: "Solicitudes fuera de alcance",
    keywords: [
      "contemplado",
      "descuento",
      "credito",
      "condicion especial",
      "no lo ofrezca",
      "no lo niegue",
      "evaluarlo",
    ],
  },
  {
    topic: "No inventar información",
    keywords: [
      "invent",
      "solo puede afirmar",
      "no asegure",
      "la duda",
      "cubierta",
      "conocimiento",
      "catalogo",
      "confirmarlo con el equipo",
    ],
  },
  {
    topic: "Escalamiento a una persona",
    keywords: ["persona", "humano", "asesor", "handoff"],
  },
  {
    topic: "Respuesta y cierre",
    keywords: [
      "responda",
      "respuesta",
      "cierre",
      "despid",
      "ultimo",
      "sin respuesta",
    ],
  },
];

/** Grupo de respaldo: nada se descarta. */
const FALLBACK_TOPIC = "Otros";

/**
 * Las constantes N1/N2 intercalan títulos de sección (por ejemplo
 * "Reglas duras:") con las reglas propiamente dichas, que son viñetas. Un
 * título no es una regla: no debe aparecer como viñeta en el panel. El criterio
 * es conservador a propósito: solo se descarta lo que no es una viñeta Y
 * termina en dos puntos, de modo que una regla nueva con otro formato se siga
 * mostrando. Esta convención se exporta para que los tests la compartan.
 */
export function isRuleEntry(entry: string): boolean {
  const trimmed = entry.trim();
  return trimmed.startsWith("-") || !trimmed.endsWith(":");
}

/** Normaliza para comparar: minúsculas y sin diacríticos. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Primer tema cuyo texto de regla contiene alguna palabra clave. */
function topicFor(rule: string): string {
  const text = normalize(rule);
  for (const theme of THEMES) {
    if (theme.keywords.some((keyword) => text.includes(keyword))) {
      return theme.topic;
    }
  }
  return FALLBACK_TOPIC;
}

/**
 * Agrupa N1 y N2 en grupos temáticos, descartando los grupos vacíos y los
 * títulos de sección. La cantidad total de reglas de salida es siempre la
 * cantidad de viñetas de `nivel1` más la de `nivel2`: ninguna regla se pierde.
 */
export function summarizeRules(
  nivel1: readonly string[],
  nivel2: readonly string[]
): RuleGroup[] {
  const buckets = new Map<string, string[]>();
  for (const theme of THEMES) buckets.set(theme.topic, []);
  buckets.set(FALLBACK_TOPIC, []);

  for (const rule of [...nivel1, ...nivel2]) {
    if (!isRuleEntry(rule)) continue; // título de sección, no una regla
    const topic = topicFor(rule);
    buckets.get(topic)!.push(rule);
  }

  return [...buckets.entries()]
    .filter(([, rules]) => rules.length > 0)
    .map(([topic, rules]) => ({ topic, rules }));
}
