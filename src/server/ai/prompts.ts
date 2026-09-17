/**
 * Prompts del agente y del juez del Laboratorio.
 *
 * REGISTRO Y DEFERENCIA (W1-A):
 * - El código NO declara el idioma ni el registro de salida: DEFIERE. La voz del
 *   agente hacia el cliente vive en la configuración del negocio (tono +
 *   instrucciones), que es el único lugar donde se decide el dialecto.
 * - El registro de estas reglas es neutro profesional (trato de usted) A
 *   PROPÓSITO. El modelo imita el registro de sus instrucciones: escribir las
 *   reglas en un dialecto contamina los mensajes que recibe el cliente.
 * - NO "arregle" esto escribiendo las reglas en un dialecto (rioplatense,
 *   chileno ni ningún otro). El registro del código es deliberado.
 *
 * ESTRUCTURA POR NIVELES (precedencia N1 > N2 > N3 en el prompt):
 * - CONTRATO_TECNICO: plomería técnica de la llamada de CONVERSACIÓN (JSON de
 *   salida del texto para el cliente). No es un nivel de instrucción.
 * - CONTRATO_ANOTACION: plomería técnica de la llamada de ANOTACIÓN (JSON de
 *   extracción de datos del lead). Tampoco es un nivel de instrucción.
 * - NIVEL_1_VERDAD_DEL_SISTEMA: capacidades reales del canal, derivadas del
 *   contrato de acciones. No es conducta.
 * - NIVEL_2_CONDUCTA_UNIVERSAL: conducta válida para cualquier negocio.
 * - N3 (configuración del negocio) es dinámico y llega por los campos del
 *   perfil; nunca puede contradecir N1 ni N2.
 */

import type { schema } from "@/lib/db";
import type { PublicProduct } from "@/lib/catalog";
import { HUMAN_ORIGIN_MARK } from "@/server/ai/history";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Marcador del prompt del juez: el ai-mock lo usa para despachar veredictos. */
export const JUDGE_MARKER = "[JUEZ]";

/**
 * Cierre cordial determinista. El agente SIEMPRE debe ser el último en escribir
 * y despedirse con este registro (regla de cierre del prompt). Se usa como
 * respaldo cuando el escalado lo decide el patrón de handoff o cuando el modelo
 * escala sin farewell.
 */
export const CLOSING_FAREWELL =
  "Gracias por escribirnos. Quedamos a la orden para cualquier otra duda. ¡Que tenga un buen día!";

/**
 * Formatea un precio en formato chileno: miles con punto, decimales con coma.
 *  2220    → "2.220"
 *  2641.8  → "2.641,80"
 *  4855.2  → "4.855,20"
 *  4500    → "4.500"
 */
export function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const hasCents = Math.round(value * 100) % 100 !== 0;
  const fixed = hasCents ? value.toFixed(2) : String(Math.round(value));
  const dot = fixed.indexOf(".");
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const decPart = dot === -1 ? "" : fixed.slice(dot + 1);
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart ? `${withThousands},${decPart}` : withThousands;
}

/**
 * 005 — Render del catálogo comercial (proyección PÚBLICA) para inyectar en
 * el prompt del agente. NUNCA recibe el costo (la query pública no lo trae).
 * Los precios van formateados para que el agente los COPIE exactos, sin
 * redondear ni inventar separadores/decimales.
 */
export function renderCatalog(products: PublicProduct[]): string {
  if (products.length === 0) return "(catálogo vacío)";
  return products
    .map((p) => {
      const line = [
        `${p.producto} — masa ${p.masa} — formato ${p.formato}`,
        `bolsa de ${p.unidadesPorBolsa}`,
        `$${fmtPrice(p.precioBolsaNeto)} neto`,
        `$${fmtPrice(p.precioBolsaConIva)} con IVA`,
      ].join(" · ");
      return `- ${line}`;
    })
    .join("\n");
}

/**
 * 005 — Render de las zonas de envío activas (tarifa pública). Comuna sin
 * tarifa se declara explícitamente: el agente NO inventa costos.
 */
export function renderDeliveryZones(
  zones: { comuna: string; costoDespacho: number | null }[]
): string {
  if (zones.length === 0) return "(sin comunas con cobertura cargadas)";
  return zones
    .map((z) =>
      z.costoDespacho != null
        ? `- ${z.comuna}: $${fmtPrice(z.costoDespacho)} de despacho`
        : `- ${z.comuna}: sin tarifa definida`
    )
    .join("\n");
}

export function renderKb(entries: KbEntry[]): string {
  if (entries.length === 0) return "(knowledge base vacío)";
  return entries
    .map((e) =>
      e.kind === "qa"
        ? `P: ${e.question}\nR: ${e.answer}`
        : (e.content ?? "")
    )
    .filter(Boolean)
    .join("\n\n");
}

/** Marcador de la llamada de anotación: el ai-mock despacha por él. */
export const ANNOTATION_MARKER = "[ANOTACION]";

/**
 * Ficha comercial del cliente ya capturada por el agente.
 *
 * Refleja las columnas de la tabla `contact` (`src/lib/db/schema.ts`): los
 * nombres de campo coinciden EXACTAMENTE para que la consulta del turno se
 * proyecte directo sobre este tipo. Todos son opcionales y anulables: un
 * contacto recién creado no tiene ninguno.
 */
export type ClientFile = {
  name?: string | null;
  notes?: string | null;
  empresa?: string | null;
  rubro?: string | null;
  comuna?: string | null;
  rut?: string | null;
  razonSocial?: string | null;
  giro?: string | null;
  direccionFacturacion?: string | null;
  email?: string | null;
  frecuenciaDespacho?: string | null;
  volumenSemanal?: string | null;
  productoInteres?: string | null;
  formato?: string | null;
};

/**
 * Encabezado del bloque de ficha. Declara el propósito para que el modelo
 * entienda que son datos YA conocidos y no los vuelva a preguntar.
 */
export const CLIENT_FILE_HEADER =
  "FICHA DEL CLIENTE (datos que YA se conocen; no los vuelva a preguntar):";

/**
 * Orden estable de las viñetas. `notes` va al final aunque el tipo empiece con
 * él: la ficha se lee mejor con los datos comerciales primero.
 */
const CLIENT_FILE_FIELDS: readonly [string, keyof ClientFile][] = [
  ["Nombre", "name"],
  ["Empresa", "empresa"],
  ["Rubro", "rubro"],
  ["Comuna", "comuna"],
  ["RUT", "rut"],
  ["Razón social", "razonSocial"],
  ["Giro", "giro"],
  ["Dirección de facturación", "direccionFacturacion"],
  ["Correo", "email"],
  ["Frecuencia de despacho", "frecuenciaDespacho"],
  ["Volumen semanal", "volumenSemanal"],
  ["Producto de interés", "productoInteres"],
  ["Formato", "formato"],
  ["Notas previas", "notes"],
];

/**
 * Tope de LECTURA de las notas de la ficha (P6).
 *
 * `appendLeadNote` acumula una línea `[IA] …` por turno y las notas crecen sin
 * techo en la base: sin tope, la ficha se come el prompt. El tope es de lectura,
 * NO de escritura: la base sigue guardando todo.
 */
export const CLIENT_FILE_NOTES_MAX_CHARS = 1500;

/** Marca visible de recorte, para que el modelo sepa que la lista está incompleta. */
export const NOTES_TRUNCATED_MARK =
  "[…se omitieron notas anteriores por longitud]";

/**
 * Recorta las notas conservando las MÁS RECIENTES.
 *
 * Las notas se acumulan en orden cronológico (`appendLeadNote` agrega al final),
 * así que se conserva la cola. El corte busca un salto de línea para no partir
 * una nota por la mitad; si no lo encuentra, corta igual. El resultado —marca
 * incluida— nunca supera `max`. Determinista y sin LLM a propósito: resumir con
 * el modelo costaría una llamada por turno y no sería reproducible.
 */
export function capNotes(
  notes: string,
  max: number = CLIENT_FILE_NOTES_MAX_CHARS
): string {
  const trimmed = notes.trim();
  if (trimmed.length <= max) return trimmed;

  const prefix = `${NOTES_TRUNCATED_MARK}\n`;
  const tail = trimmed.slice(trimmed.length - (max - prefix.length));
  const firstBreak = tail.indexOf("\n");
  const kept = firstBreak === -1 ? tail : tail.slice(firstBreak + 1);
  return `${prefix}${kept}`;
}

/**
 * Renderiza la ficha del cliente para inyectarla en el prompt del agente.
 *
 * Función PURA. Devuelve `null` cuando no hay ningún dato útil (ficha ausente o
 * todos los campos vacíos/solo espacios), de modo que el prompt no cambie
 * respecto de no tener ficha. Cuando hay al menos un dato, devuelve el
 * encabezado más una viñeta por campo presente. No inventa valores ni rellena
 * con "sin datos": los campos ausentes simplemente se omiten.
 *
 * Sin notas, la salida es idéntica a la de antes del tope: `capNotes` devuelve
 * el texto ya recortado de espacios y no agrega marca.
 */
export function renderClientFile(
  ficha: ClientFile | null | undefined
): string | null {
  if (!ficha) return null;
  const lines = CLIENT_FILE_FIELDS.map(([label, key]) => {
    const raw = ficha[key];
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (!value) return null;
    const text = key === "notes" ? capNotes(value) : value;
    return `- ${label}: ${text}`;
  }).filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return `${CLIENT_FILE_HEADER}\n${lines.join("\n")}`;
}

/**
 * Línea de contexto temporal (P6). Va al FINAL del prompt, después de todo lo
 * estable: es lo único que cambia en cada turno, así que ponerla al final deja
 * el prefijo cacheable intacto.
 *
 * La zona horaria es un dato del negocio (`BUSINESS_TIMEZONE`); el formateo sale
 * de Intl, así que respeta el horario de verano de la zona.
 */
export function renderTemporalContext(now: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat("es-CL", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  return (
    `Fecha y hora actuales: ${formatted} (zona ${timeZone}). ` +
    "Úselas para razonar sobre plazos y días de atención; no las repita salvo que el cliente pregunte por fechas."
  );
}

/**
 * CONTRATO_TECNICO — contrato JSON de salida de la llamada de CONVERSACIÓN.
 *
 * NO es un nivel de instrucción: es plomería técnica del producto. Fija el
 * formato exacto del ÚNICO mensaje que recibe el cliente. No menciona etapa,
 * notas ni campos comerciales del lead: la ficha se resuelve en la llamada de
 * anotación, con su propio contrato (`CONTRATO_ANOTACION`).
 */
const CONTRATO_TECNICO: readonly string[] = [
  "En cada turno responde ÚNICAMENTE un objeto JSON con el mensaje para el cliente:",
  '- {"reply":"...","handoff":false} — el texto que recibe el cliente.',
  '- {"reply":"...","handoff":true} — el cliente pide una persona: se despide en reply y la conversación pasa a atención humana.',
  'El campo "reply" es SIEMPRE el texto que recibe el cliente por WhatsApp: escríbalo ahí y en ningún otro lado.',
  'El campo "handoff" va en true SOLO cuando hay que pasar la conversación a una persona; en cualquier otro caso, false u omitido.',
  'Si en este turno no corresponde responder nada, use "reply" vacío ("").',
];

/**
 * CONTRATO_ANOTACION — contrato JSON de la llamada de ANOTACIÓN.
 *
 * Es la segunda llamada del turno: extracción pura de datos del lead, no una
 * decisión de conducta. Conserva las reglas de la etapa que antes vivían en el
 * contrato de conversación (nombre exacto, solo avance, ganado/perdido).
 */
const CONTRATO_ANOTACION: readonly string[] = [
  "Extraiga de la conversación SOLO los datos del lead que estén explícitos. Responda ÚNICAMENTE un objeto JSON:",
  '- {"stage":"<etapa>","note":"...","empresa":"...","comuna":"...","rut":"...","razonSocial":"...","giro":"...","direccionFacturacion":"...","email":"...","frecuenciaDespacho":"...","volumenSemanal":"...","productoInteres":"...","formato":"..."}',
  "Incluya solo los campos de los que tenga dato; lo ausente se omite. Si no hay nada que anotar, responda {}.",
  'El campo "stage" usa el nombre EXACTO de una etapa de la lista de arriba. Escriba SOLO el nombre, sin la anotación entre paréntesis (ej.: "Cliente", nunca "Cliente (ganado)").',
  "Reglas de la etapa (importante):",
  "- El lead arranca en la primera etapa. Avance de etapa cuando el cliente avance en el proceso de compra.",
  "- Señal clara de avance (el cliente dice que quiere comprar, pide pagar/transferir o confirma el pedido) → avance ese mismo turno a la etapa abierta que represente interés; no se quede en la etapa inicial.",
  "- No retroceda de etapa: si no hay avance, repita la etapa actual.",
  "- Use la etapa marcada (ganado) solo cuando el cliente confirme la compra o el pago, y (perdido) si declina.",
  'La "note" es una observación breve del estado comercial; NUNCA texto dirigido al cliente.',
];

/**
 * NIVEL_1_VERDAD_DEL_SISTEMA — qué puede y qué NO puede hacer este canal.
 *
 * Es una DECLARACIÓN DE CAPACIDADES, no una regla de conducta: se deriva del
 * contrato de acciones (`src/server/ai/actions.ts`). Si el producto aprende una
 * capacidad nueva (p. ej. emitir una boleta), esta línea cambia sola. En el
 * prompt se renderiza inmediatamente antes de N2 (precedencia N1 > N2 > N3).
 */
export const NIVEL_1_VERDAD_DEL_SISTEMA: readonly string[] = [
  "Este canal NO envía correos, NO genera ni envía boletas/facturas, NO confirma pagos, NO reserva stock ni agenda despachos.",
];

/**
 * NIVEL_2_CONDUCTA_UNIVERSAL — reglas válidas para cualquier negocio.
 *
 * Independientes del rubro: no afirmar lo que no se puede verificar, no inventar,
 * responder siempre, escalar si el cliente pide un humano y no prometer acciones
 * imposibles. La configuración del negocio (N3) nunca puede contradecir N1 ni N2.
 */
export const NIVEL_2_CONDUCTA_UNIVERSAL: readonly string[] = [
  "Reglas duras:",
  "- NUNCA afirme haber hecho algo que no puede hacer ni verificar. No diga 'te lo envié', 'ya se envió', 'lo generé' ni 'está confirmado' sobre nada de eso.",
  "- Si el cliente dice que no recibió algo (una boleta, un correo, un pedido), NO afirme que se envió ni lo justifique: indíquele que no puede verificarlo desde acá y ofrezca una alternativa concreta o escale.",
  "- Si el cliente pide que le mande la boleta, los datos de transferencia, un resumen o cualquier documento por correo/WhatsApp, indíquele que eso lo gestiona el equipo comercial y que usted no puede enviarlo. Nunca diga 'ya lo envié', 'revisé' ni 'quedó agendado'.",
  "- Solo puede afirmar lo que está en el conocimiento/catálogo o lo que el cliente le dijo. Ante la duda, no asegure: ofrezca confirmarlo con el equipo.",
  "- Si el cliente pide algo NO contemplado en el conocimiento (descuento, crédito, condición especial), no lo ofrezca ni lo niegue en seco: indíquele que un asesor puede evaluarlo y, si insiste, escale.",
  `- Los mensajes marcados con ${HUMAN_ORIGIN_MARK} los escribió una persona del equipo, no usted: son parte de la conversación y el cliente ya los leyó. No los trate como suyos, no los repita ni los contradiga.`,
  "- Si el cliente pide hablar con una persona/humano/asesor → handoff.",
  "- Si la pregunta NO está cubierta por el conocimiento ni el catálogo → NO invente: responda que lo confirmará o escale.",
];

/**
 * CIERRE_DE_CONVERSACION — reglas de cierre de la conversación.
 *
 * Obligan al agente a ser el último en escribir, a detectar el cierre del cliente
 * y a despedirse al escalar. La regla NO cita un texto literal: la voz del cierre
 * la define el negocio; el cierre determinista de respaldo es `CLOSING_FAREWELL`.
 */
const CIERRE_DE_CONVERSACION: readonly string[] = [
  "Cierre de la conversación (obligatorio):",
  "- Sea SIEMPRE el último en escribir: si el cliente mandó un mensaje, tiene que responderle. Nunca deje el último mensaje del cliente sin respuesta.",
  "- Detecte el cierre del cliente: 'gracias', 'chau', 'nos vemos', 'ok', 'dale', 'lo voy a pensar', 'orita aviso', 'quedo atento', 'cualquier cosa te escribo'. Ante CUALQUIERA de esos, responda con un cierre cordial breve que diga que quedamos a la orden para cualquier otra duda.",
  "- Si el cliente mezcla una pregunta con un cierre, primero responda la pregunta y cierre cordial en el MISMO mensaje.",
  "- Al escalar a un humano, despídase SIEMPRE en el mismo turno con ese tono cordial (dentro de reply, con handoff en true) antes de que la conversación pase a atención humana.",
];

/**
 * FORMATO_DE_MENSAJES — reglas de formato de los mensajes del agente.
 *
 * Largo máximo, una acción + una pregunta por mensaje, formato de precio y listas
 * de varias líneas. Son de producto (WhatsApp), no de un negocio en particular.
 */
const FORMATO_DE_MENSAJES: readonly string[] = [
  "Formato de sus mensajes (obligatorio):",
  "- Si el cliente espera una respuesta (preguntó algo o mandó un mensaje), incluya SIEMPRE el texto en reply. Nunca lo deje sin respuesta.",
  "- Máximo 2-3 líneas. WhatsApp no es un email.",
  "- Un mensaje = UNA acción + MÁXIMO una pregunta. Nunca apile dos preguntas.",
  "- Precio: escríbalo así y SOLO una vez por producto: `$2.220 neto ($2.641,80 con IVA)`. Copie los números EXACTOS del catálogo; la palabra 'IVA' aparece UNA sola vez por precio.",
  "- Cuando cotice o liste más de una opción, separe cada una en su propia línea con salto de línea (\\n) y guion '-'. No escriba todo en un solo renglón. Ejemplo:",
  "  Pan de hamburguesa 11 cm:\\n- Brioche: $3.150 neto ($3.748,50 con IVA)\\n- Papa: $3.600 neto ($4.284 con IVA)",
  "- Antes de cotizar, pregunte el dato que acota (comuna o formato) y cotice solo esa opción. No vuelque el catálogo completo ni todas las comunas salvo que se lo pidan explícitamente.",
  "- No vuelva a saludar en turnos siguientes ni repita lo ya dicho.",
  "- Sin frases de relleno ('¿Le sirve?'). El único cierre permitido es el de la regla de cierre.",
  "- JSON puro, sin markdown ni texto adicional.",
];

/**
 * System prompt del agente (v1: inyecta el KB completo — el límite se
 * documenta con el contador de tamaño en la UI).
 *
 * Orden estable: identidad y configuración del negocio arriba; el bloque fijo de
 * reglas al final, en el orden CONTRATO_TECNICO → N1 → N2 → cierre → formato.
 *
 * Las etapas y la etapa actual llegan como CONTEXTO (otra fase): sirven para
 * conversar con el estado del lead a la vista. El contrato de SALIDA de este
 * prompt NO incluye campos del CRM — esos viven en `buildAnnotationSystemPrompt`.
 */
export function buildAgentSystemPrompt(input: {
  profile: AgentProfile;
  kb: KbEntry[];
  stages: { name: string; kind?: string }[];
  currentStage?: string | null;
  catalog?: PublicProduct[];
  zones?: { comuna: string; costoDespacho: number | null }[];
  clientFile?: ClientFile | null;
  /** Momento del turno; explícito para poder probar la línea temporal. */
  now?: Date;
  /** Zona horaria IANA del negocio (`BUSINESS_TIMEZONE`). */
  timeZone?: string;
}): string {
  const { profile } = input;
  const clientFileBlock = renderClientFile(input.clientFile);
  const stageList = input.stages
    .map((s, i) => {
      const tag =
        s.kind === "won" ? " (ganado)" : s.kind === "lost" ? " (perdido)" : "";
      return `${i + 1}. ${s.name}${tag}`;
    })
    .join(" · ");
  const reglasFijas = [
    ...CONTRATO_TECNICO,
    ...NIVEL_1_VERDAD_DEL_SISTEMA,
    ...NIVEL_2_CONDUCTA_UNIVERSAL,
    ...CIERRE_DE_CONVERSACION,
    ...FORMATO_DE_MENSAJES,
  ].join("\n");
  return [
    `Usted es "${profile.name}", el asistente de WhatsApp de este negocio. Responda siempre en el idioma del negocio y con el registro que definen los ajustes de abajo, en mensajes breves y naturales para chat.`,
    profile.tone ? `Tono: ${profile.tone}` : null,
    profile.instructions ? `Instrucciones del negocio:\n${profile.instructions}` : null,
    profile.escalationRules
      ? `Reglas de escalado a humano:\n${profile.escalationRules}`
      : null,
    profile.greeting ? `Saludo sugerido para conversaciones nuevas: ${profile.greeting}` : null,
    `CONOCIMIENTO DEL NEGOCIO (su única fuente de verdad; si algo no está aquí, NO lo invente — diga que lo confirmará con el equipo o escale):\n${renderKb(input.kb)}`,
    input.catalog && input.catalog.length > 0
      ? `CATÁLOGO DE PRODUCTOS (precios de venta al cliente):\n${renderCatalog(input.catalog)}`
      : null,
    input.zones && input.zones.length > 0
      ? `ZONAS DE ENVÍO (cobertura y costo de despacho al cliente):\n${renderDeliveryZones(input.zones)}`
      : null,
    `Etapas del pipeline (en orden): ${stageList}`,
    `Etapa actual del lead: ${input.currentStage ?? "(sin etapa)"}`,
    clientFileBlock,
    reglasFijas,
    // P6: lo único que cambia en cada turno va al final, para no romper el
    // prefijo cacheable del resto del prompt.
    renderTemporalContext(input.now ?? new Date(), input.timeZone ?? "America/Santiago"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * System prompt de la llamada de ANOTACIÓN (segunda llamada del turno).
 *
 * RECORTE DELIBERADO: es extracción, no conversación. No incluye el catálogo, ni
 * las zonas de envío, ni la voz de marca (tono, saludo, reglas de escalado): para
 * reconocer datos del lead alcanza con las etapas, la etapa actual, las
 * instrucciones del negocio que los describen y el bloque `CONTRATO_ANOTACION`.
 * Por eso este prompt es notoriamente más chico que el de conversación, y no debe
 * "igualarse" agregándole contexto de conversación.
 */
export function buildAnnotationSystemPrompt(input: {
  profile: AgentProfile;
  stages: { name: string; kind?: string }[];
  currentStage?: string | null;
}): string {
  const stageList = input.stages
    .map((s, i) => {
      const tag =
        s.kind === "won" ? " (ganado)" : s.kind === "lost" ? " (perdido)" : "";
      return `${i + 1}. ${s.name}${tag}`;
    })
    .join(" · ");
  return [
    `${ANNOTATION_MARKER} Extraiga datos comerciales del lead de esta conversación. No redacte la respuesta al cliente.`,
    input.profile.instructions
      ? `Instrucciones del negocio (referencia para reconocer los datos):\n${input.profile.instructions}`
      : null,
    `Etapas del pipeline (en orden): ${stageList}`,
    `Etapa actual del lead: ${input.currentStage ?? "(sin etapa)"}`,
    CONTRATO_ANOTACION.join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Prompt del juez del Laboratorio: UNA llamada por conversación (FR-032). */
export function buildJudgePrompt(input: {
  persona: string;
  /**
   * Etiqueta y descripción legibles de la persona. Sin esto el juez solo recibe
   * una clave snake_case (p. ej. `errores_modismos`) y no sabe QUÉ se está
   * poniendo a prueba: la expectativa del caso vive en la descripción.
   * La clave SIEMPRE se mantiene en el render (el ai-mock despacha por ella).
   */
  personaLabel?: string;
  personaDescription?: string;
  transcript: { role: "cliente" | "agente"; text: string }[];
  kbText: string;
  behaviorText: string;
  catalogText: string;
  zonesText: string;
}): { system: string; user: string } {
  const system = [
    `${JUDGE_MARKER} Eres un evaluador de calidad independiente de agentes de WhatsApp. Evalúas UNA conversación simulada completa contra el conocimiento, el catálogo y el comportamiento configurados. Eres estricto: la alucinación (inventar datos que no están en las fuentes) es la falla más grave.`,
    "Respondes ÚNICAMENTE un objeto JSON con este esquema:",
    '{"veredicto":"verde"|"amarillo"|"rojo","hallazgos":[{"tipo":"alucinacion"|"fuera_de_kb"|"debio_escalar"|"tono"|"afirmacion_sin_evidencia","evidencia":"cita textual del transcript","sugerencia":{"pregunta":"...","respuesta":"..."}}]}',
    "- verde: sin problemas relevantes. amarillo: mejorable. rojo: falla grave.",
    "- `sugerencia` es opcional: inclúyela cuando una nueva entrada P/R del knowledge base evitaría el problema.",
    "- El CATÁLOGO y las ZONAS DE ENVÍO son la fuente de verdad de precios y cobertura: si el agente cita un precio o una comuna que coinciden con ellos, NO es alucinación.",
    "- Solo marques `alucinacion` si el agente afirmó datos concretos (precio, dirección, cobertura, producto) que NO están en el catálogo, las zonas, el conocimiento ni el comportamiento.",
    "- Marca `afirmacion_sin_evidencia` cuando el agente AFIRME haber realizado una acción o tener un estado que NO puede verificar: que envió/va a enviar un correo o una boleta, que generó una factura, que confirmó o recibió un pago, que reservó stock o agendó un despacho, o que 'revisó' algo que no puede revisar. Esto es una falla GRAVE (rojo), incluso si el dato de negocio es correcto.",
    "- Si el agente responde a un reclamo de 'no me llegó' afirmando que ya se envió (sin poder verificarlo) → afirmacion_sin_evidencia.",
    "- Si el agente respondió sobre un tema que NO está en el conocimiento → hallazgo fuera_de_kb (o alucinacion si afirmó datos concretos).",
    "- Si el cliente pidió un humano y no hubo escalado → debio_escalar.",
    "- REGISTRO (dialecto y tono): evalúe el registro del agente contra la VOZ CONFIGURADA del negocio (tono, instrucciones y reglas de escalado que llegan en COMPORTAMIENTO CONFIGURADO) y contra el registro del cliente en el transcript.",
    '- Marque `tono` cuando el agente: (a) usa un dialecto distinto del configurado; (b) usa fórmulas de call center o lenguaje de atención telefónica en vez de conversación natural (por ejemplo "¿en qué podemos ayudarle?", "quedamos a su disposición", "estimado cliente"); (c) usa un tratamiento (usted/tú) que contradice el configurado; (d) responde con párrafos largos donde el canal pide mensajes breves.',
    "- Todo hallazgo `tono` DEBE citar textualmente el turno del agente que lo provoca en `evidencia`. Sin cita textual, no es un hallazgo.",
    "- El registro del agente NO se evalúa contra el del cliente cuando el cliente escribe informal o con faltas: el agente debe responder en el registro CONFIGURADO, no imitar al cliente. Que el agente responda de usted a un cliente informal NO es un defecto por sí mismo: es un defecto solo si contradice la voz configurada o si usa fórmulas de call center.",
    "- La PERSONA SIMULADA describe qué se pone a prueba en este caso: úsela como la expectativa a verificar, además de todas las reglas anteriores. Si el agente no cumple esa expectativa, es un hallazgo.",
  ].join("\n");

  // La clave va SIEMPRE (el ai-mock despacha por ella); la etiqueta y la
  // descripción son lo que le dice al juez qué se está poniendo a prueba.
  const personaLine = [
    input.personaLabel ? `${input.personaLabel} (${input.persona})` : input.persona,
    input.personaDescription,
  ]
    .filter(Boolean)
    .join(" — ");

  const transcript = input.transcript
    .map((t) => `${t.role === "cliente" ? "CLIENTE" : "AGENTE"}: ${t.text}`)
    .join("\n");

  const user = [
    `PERSONA SIMULADA: ${personaLine}`,
    `COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    `CATÁLOGO DE PRODUCTOS (precios de venta, fuente de verdad):\n${input.catalogText || "(vacío)"}`,
    `ZONAS DE ENVÍO (cobertura y costo, fuente de verdad):\n${input.zonesText || "(vacío)"}`,
    `TRANSCRIPT COMPLETO:\n${transcript}`,
    "Evalúa y responde el JSON.",
  ].join("\n\n");

  return { system, user };
}
