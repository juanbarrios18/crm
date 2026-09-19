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
 * Petición de precio o beneficio especial: palabras de precio más los verbos
 * con los que el cliente pide el beneficio ("me deja", "me hacen").
 */
const SPECIAL_PRICE_ASK =
  "(?:precio|rebaja|descuento|me\\s+(?:deja|dejan|hace|hacen|da|dan|rebaja|rebajan|mejora|mejoran))";

/**
 * Cantidad CONDICIONAL explícita: "si llevo 20", "si compro 30", "si pido 50",
 * "si son 20", "llevando 20". Exige el verbo condicional PEGADO al número; un
 * número suelto ("y el de 20", "bolsa de 12") no alcanza.
 */
const CONDITIONAL_QUANTITY =
  "(?:(?:si\\s+)?(?:llevo|compro|pido|encargo|quiero)|llevando|comprando|pidiendo|si\\s+son)\\s+\\d+";

/** Verbo explícito de beneficio junto a "por <cantidad>". */
const BENEFIT_VERB =
  "(?:me\\s+(?:deja|dejan|hace|hacen|da|dan|rebaja|rebajan|mejora|mejoran))";

/**
 * El cliente pide ENVIAR un documento al correo (no emitirlo). "me pueden
 * emitir boleta?" NO matchea: emitir es una capacidad del negocio; solo el
 * envío por correo exige escalado.
 */
const SEND_DOCUMENT_EMAIL =
  "(?:manda|mandan|mandar|mandarme|mandarnos|envia|envian|enviar|enviarme|enviarnos|remit|envien|envie)[\\s\\S]{0,30}?(?:al|por)\\s+correo" +
  "|(?:al|por)\\s+correo[\\s\\S]{0,30}?(?:manda|mandan|mandar|envia|envian|enviar|remit)" +
  "|(?:boleta|factura|documento)s?[\\s\\S]{0,25}?(?:al|por)\\s+correo" +
  "|(?:al|por)\\s+correo[\\s\\S]{0,25}?(?:boleta|factura|documento)";

/** El cliente pide consultar su historial o pedidos pendientes. */
const HISTORY_REQUEST =
  "historial|pedidos[\\s\\S]{0,20}?pendientes|pedidos anteriores|mis pedidos|compras anteriores";

/**
 * 008 — Disparadores deterministas que la configuración del negocio YA manda
 * escalar y que dependían solo del modelo (auditoría A3):
 *
 * - Queja o molestia: "Si la persona se muestra molesta o hay una queja, escala".
 * - Descuento, crédito o entrega especial: "Si pide algo no contemplado
 *   (crédito, descuentos, entregas especiales), no lo ofrezca, pero escale".
 * - P2: enviar una boleta/factura por correo y consultar historial o pedidos
 *   pendientes, que el canal no puede gestionar, también exigen derivar.
 *
 * En la corrida de PROD esto era no determinista: `cliente_enojado` rep0 no
 * escaló y las repeticiones 1 y 2 sí; el pedido de descuento ("si llevo 20 me
 * hacen precio") no escaló nunca. Como el modelo era el que decidía, la
 * conducta cambiaba entre repeticiones con el mismo guion.
 *
 * PRECISIÓN vs COBERTURA: un falso positivo acá corta una venta viva (aborta la
 * conversación con handoff), así que las construcciones exigen señal explícita.
 * "cuanto sale la bolsa de brioche de 12?", "y el de 20?" y "cuanto sale la
 * bolsa de 20 cm?" son consultas de precio con número y NO disparan: sin el
 * verbo condicional ("si llevo...", "si compro...") el número no es una
 * intención de volumen. "al por mayor" tampoco: exige dígito tras "por".
 */
export const HANDOFF_ESCALATION_REGEX = new RegExp(
  [
    "queja",
    "reclamo",
    "molest",
    "enojad",
    "indignad",
    "no me llego",
    "no recibi",
    "me cobraron",
    "pedido incompleto",
    "faltaron",
    "faltan \\d",
    "descuento",
    "rebaja",
    "mejor precio",
    "precio por (volumen|cantidad)",
    "si llevo (mas|hart)",
    CONDITIONAL_QUANTITY + "[\\s\\S]{0,40}?" + SPECIAL_PRICE_ASK,
    SPECIAL_PRICE_ASK + "[\\s\\S]{0,40}?" + CONDITIONAL_QUANTITY,
    "por\\s+\\d+[\\s\\S]{0,40}?" + BENEFIT_VERB,
    BENEFIT_VERB + "[\\s\\S]{0,40}?por\\s+\\d+",
    SEND_DOCUMENT_EMAIL,
    HISTORY_REQUEST,
  ].join("|")
);

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
