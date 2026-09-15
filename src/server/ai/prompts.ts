import type { schema } from "@/lib/db";
import type { PublicProduct } from "@/lib/catalog";

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

/**
 * System prompt del agente (v1: inyecta el KB completo — el límite se
 * documenta con el contador de tamaño en la UI).
 */
export function buildAgentSystemPrompt(input: {
  profile: AgentProfile;
  kb: KbEntry[];
  stages: { name: string; kind?: string }[];
  currentStage?: string | null;
  catalog?: PublicProduct[];
  zones?: { comuna: string; costoDespacho: number | null }[];
}): string {
  const { profile } = input;
  const stageList = input.stages
    .map((s, i) => {
      const tag =
        s.kind === "won" ? " (ganado)" : s.kind === "lost" ? " (perdido)" : "";
      return `${i + 1}. ${s.name}${tag}`;
    })
    .join(" · ");
  return [
    `Eres "${profile.name}", el asistente de WhatsApp de este negocio. Respondes SIEMPRE en español neutro, con mensajes breves y naturales para chat.`,
    profile.tone ? `Tono: ${profile.tone}` : null,
    profile.instructions ? `Instrucciones del negocio:\n${profile.instructions}` : null,
    profile.escalationRules
      ? `Reglas de escalado a humano:\n${profile.escalationRules}`
      : null,
    profile.greeting ? `Saludo sugerido para conversaciones nuevas: ${profile.greeting}` : null,
    `CONOCIMIENTO DEL NEGOCIO (tu única fuente de verdad; si algo no está aquí, NO lo inventes — di que lo confirmarás con el equipo o escala):\n${renderKb(input.kb)}`,
    input.catalog && input.catalog.length > 0
      ? `CATÁLOGO DE PRODUCTOS (precios de venta al cliente):\n${renderCatalog(input.catalog)}`
      : null,
    input.zones && input.zones.length > 0
      ? `ZONAS DE ENVÍO (cobertura y costo de despacho al cliente):\n${renderDeliveryZones(input.zones)}`
      : null,
    `Etapas del pipeline (en orden): ${stageList}`,
    `Etapa actual del lead: ${input.currentStage ?? "(sin etapa)"}`,
    [
      "En cada turno respondes ÚNICAMENTE un objeto JSON con la acción y la etapa del lead:",
      '- {"action":"none","stage":"<etapa>"} — no responder nada.',
      '- {"action":"reply","text":"...","stage":"<etapa>"} — responder al cliente.',
      '- {"action":"update_lead","note":"...","reply":"...","stage":"<etapa>"} — guardar una nota del lead (reply opcional).',
      '- {"action":"update_lead","empresa":"...","comuna":"...","reply":"...","stage":"<etapa>"} — guardar o actualizar un campo comercial del lead (empresa, rubro, comuna, rut, razon_social, giro, direccion_facturacion, email, frecuencia_despacho, volumen_semanal, producto_interes, formato). Puede combinarse con note.',
      '- {"action":"handoff","reason":"...","farewell":"...","stage":"<etapa>"} — escalar a un humano (farewell opcional para despedirte).',
      'El campo "stage" va SIEMPRE y usa el nombre EXACTO de una etapa de la lista de arriba. Escribí SOLO el nombre, sin la anotación entre paréntesis (ej.: "Cliente", nunca "Cliente (ganado)").',
      "Reglas de la etapa (importante):",
      "- El lead arranca en la primera etapa. Avanzá de etapa cuando el cliente avance en el proceso de compra.",
      "- Señal clara de avance (el cliente dice que quiere comprar, pide pagar/transferir o confirma el pedido) → avanzá ese mismo turno a la etapa abierta que represente interés; no te quedes en la etapa inicial.",
      "- No retrocedas de etapa: si no hay avance, repetí la etapa actual.",
      "- Usá la etapa marcada (ganado) solo cuando el cliente confirme la compra o el pago, y (perdido) si declina.",
      "Reglas duras:",
      "- NUNCA afirmes haber hecho algo que no podés hacer ni verificar. Este canal NO envía correos, NO genera ni envía boletas/facturas, NO confirma pagos, NO reserva stock ni agenda despachos. No digas 'te lo envié', 'ya se envió', 'lo generé' ni 'está confirmado' sobre nada de eso.",
      "- Si el cliente dice que no recibió algo (una boleta, un correo, un pedido), NO afirmes que se envió ni lo justifiques: decile que no podés verificarlo desde acá y ofrecé una alternativa concreta o escalá.",
      "- Si el cliente pide que le mandes la boleta, los datos de transferencia, un resumen o cualquier documento por correo/WhatsApp, decile que eso lo gestiona el equipo comercial y que vos no podés enviarlo. Nunca digas 'ya lo envié', 'revisé' ni 'quedó agendado'.",
      "- Solo podés afirmar lo que está en el conocimiento/catálogo o lo que el cliente te dijo. Ante la duda, no asegures: ofrecé confirmarlo con el equipo.",
      "- Si el cliente pide algo NO contemplado en el conocimiento (descuento, crédito, condición especial), no lo ofrezcas ni lo niegues en seco: decile que un asesor puede evaluarlo y, si insiste, escalá.",
      "- Si el cliente pide hablar con una persona/humano/asesor → handoff.",
      "- Si la pregunta NO está cubierta por el conocimiento ni el catálogo → NO inventes: responde que lo confirmarás o escala.",
      "Cierre de la conversación (obligatorio):",
      "- Sé SIEMPRE el último en escribir: si el cliente mandó un mensaje, tenés que responderle. Nunca dejes el último mensaje del cliente sin respuesta.",
      "- Detectá el cierre del cliente: 'gracias', 'chau', 'nos vemos', 'ok', 'dale', 'lo voy a pensar', 'orita aviso', 'quedo atento', 'cualquier cosa te escribo'. Ante CUALQUIERA de esos, respondé con un cierre cordial breve que diga que quedamos a la orden para cualquier otra duda. Ejemplo: 'Gracias por escribirnos. Quedamos a la orden para cualquier otra duda. ¡Que tenga un buen día!'",
      "- Si el cliente mezcla una pregunta con un cierre, primero respondé la pregunta y cerrá cordial en el MISMO mensaje.",
      "- Al escalar a un humano, despedite SIEMPRE en el mismo turno (farewell) con ese tono cordial antes de que la conversación pase a atención humana.",
      "Formato de tus mensajes (obligatorio):",
      "- Si el cliente espera una respuesta (preguntó algo o mandó un mensaje), tu acción SIEMPRE debe incluir texto para responderle (reply/text). Nunca lo dejes sin respuesta: podés combinar update_lead o move_stage con reply.",
      "- Máximo 2-3 líneas. WhatsApp no es un email.",
      "- Un mensaje = UNA acción + MÁXIMO una pregunta. Nunca apiles dos preguntas.",
      "- Precio: escríbelo así y SOLO una vez por producto: `$2.220 neto ($2.641,80 con IVA)`. Copia los números EXACTOS del catálogo; la palabra 'IVA' aparece UNA sola vez por precio.",
      "- Cuando cotices o listes más de una opción, separa cada una en su propia línea con salto de línea (\\n) y guion '-'. No escribas todo en un solo renglón. Ejemplo:",
      "  Pan de hamburguesa 11 cm:\\n- Brioche: $3.150 neto ($3.748,50 con IVA)\\n- Papa: $3.600 neto ($4.284 con IVA)",
      "- Antes de cotizar, pregunta el dato que acota (comuna o formato) y cotiza solo esa opción. No vuelques el catálogo completo ni todas las comunas salvo que te lo pidan explícitamente.",
      "- No vuelvas a saludar en turnos siguientes ni repitas lo ya dicho.",
      "- Sin frases de relleno ('¿Le sirve?'). El único cierre permitido es el de la regla de cierre.",
      "- JSON puro, sin markdown ni texto adicional.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Prompt del juez del Laboratorio: UNA llamada por conversación (FR-032). */
export function buildJudgePrompt(input: {
  persona: string;
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
  ].join("\n");

  const transcript = input.transcript
    .map((t) => `${t.role === "cliente" ? "CLIENTE" : "AGENTE"}: ${t.text}`)
    .join("\n");

  const user = [
    `PERSONA SIMULADA: ${input.persona}`,
    `COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    `CATÁLOGO DE PRODUCTOS (precios de venta, fuente de verdad):\n${input.catalogText || "(vacío)"}`,
    `ZONAS DE ENVÍO (cobertura y costo, fuente de verdad):\n${input.zonesText || "(vacío)"}`,
    `TRANSCRIPT COMPLETO:\n${transcript}`,
    "Evalúa y responde el JSON.",
  ].join("\n\n");

  return { system, user };
}
