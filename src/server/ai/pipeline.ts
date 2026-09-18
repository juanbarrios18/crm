import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatJsonResult, type ChatMessage, type ChatTiming } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import {
  ConversationReply,
  isPlaceholderValue,
  LeadExtraction,
  resolveStage,
  type LeadExtractionType,
} from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { isBotOutbound, toConversationHistory } from "@/server/ai/history";
import {
  ANNOTATION_HISTORY_LIMIT,
  appendTemporalNote,
  buildAgentSystemPrompt,
  buildAnnotationSystemPrompt,
  CLOSING_FAREWELL,
  renderAnnotationTurnState,
  renderTurnState,
} from "@/server/ai/prompts";
import { guardReply, resolveUncorrectedReply } from "@/server/ai/reply-guard";
import { getActiveProductsPublic, getActiveZones } from "@/server/catalog/queries";
import { notifyHandoff } from "@/server/push/notify";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/** Llamada al modelo que reportó timing (para acumular la telemetría del turno). */
type TimedCall = {
  model: string;
  latencyMs: number;
  usage: { promptTokens: number | null; completionTokens: number | null; cachedTokens: number | null } | null;
  provider: string | null;
};

/**
 * Suma la telemetría de TODAS las llamadas del turno (conversación + corrección
 * opcional + anotación) en UN `ChatTiming`.
 *
 * Tokens: se SUMAN a propósito — el turno hace más de una llamada y el
 * Laboratorio mide el costo REAL, no el de una sola. Un `null` se trata como 0
 * SOLO si otra llamada reportó valor para ese mismo token; si ninguna lo
 * reporta, queda `null` (no se inventa un 0).
 *
 * `model` y `provider` son los de la llamada de conversación, que SIEMPRE es
 * `calls[0]`.
 *
 * Latencia: NO se suma. Desde P1 la conversación y la anotación corren en
 * paralelo, así que la cifra honesta es el tiempo de pared del tramo paralelo
 * (cuánto esperó realmente el cliente), que llega explícito en `latencyMs`.
 * Sumar las dos llamadas reportaría una latencia que nadie experimentó.
 */
function accumulateTiming(calls: TimedCall[], latencyMs: number): ChatTiming {
  const sumToken = (
    pick: (u: NonNullable<TimedCall["usage"]>) => number | null
  ): number | null => {
    let total: number | null = null;
    for (const call of calls) {
      if (!call.usage) continue;
      const value = pick(call.usage);
      if (value !== null) total = (total ?? 0) + value;
    }
    return total;
  };
  const primary = calls[0]!;
  return {
    model: primary.model,
    latencyMs,
    promptTokens: sumToken((u) => u.promptTokens),
    completionTokens: sumToken((u) => u.completionTokens),
    cachedTokens: sumToken((u) => u.cachedTokens),
    provider: primary.provider,
  };
}

/**
 * Consume la promesa de anotación garantizando que quede resuelta.
 *
 * La anotación es best-effort y `chatJson` no propaga excepción de proveedor
 * (resultado `error` tipado), pero sí puede rechazar si el entorno es inválido
 * (`getEnv` lanza). Una promesa rechazada sin manejar tumba el proceso en Node,
 * así que todo camino de salida la consume a través de acá.
 */
async function settleAnnotation(
  promise: Promise<ChatJsonResult<LeadExtractionType>>
): Promise<ChatJsonResult<LeadExtractionType>> {
  try {
    return await promise;
  } catch (err) {
    return {
      ok: false,
      error: "provider_error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
export function scheduleAgentTurn(conversationId: string): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = getEnv().AGENT_COALESCE_MS;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTurn(conversationId);
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      void executeTurn(conversationId);
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(
  conversationId: string
): Promise<ChatTiming | null> {
  if (!isAiConfigured()) return null;

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return null;
  const organizationId = conversation.organizationId;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return null;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return null;
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) return null;

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return null;

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return null;
  }

  // Patrón de respaldo ANTES del LLM (FR-022). Se despide con el cierre cordial
  // ANTES de escalar: el agente debe ser siempre el último en escribir.
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await deliverReply(conversation, CLOSING_FAREWELL);
    await applyHandoff(conversationId, organizationId, "cliente");
    return null;
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({
      id: schema.pipelineStage.id,
      name: schema.pipelineStage.name,
      position: schema.pipelineStage.position,
      kind: schema.pipelineStage.kind,
      // F3: el criterio de entrada es lo que lee la anotación para mover leads.
      criteria: schema.pipelineStage.criteria,
    })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  // Etapa actual del lead: se inyecta en el prompt y evita retrocesos.
  const leadRows = await db
    .select({ stageId: schema.lead.stageId })
    .from(schema.lead)
    .where(eq(schema.lead.contactId, conversation.contactId))
    .limit(1);
  const currentStageId = leadRows[0]?.stageId ?? null;
  const currentStage = stages.find((s) => s.id === currentStageId) ?? null;

  // Ficha del cliente: datos comerciales ya capturados + nombre. Viaja en la
  // nota del turno para que el agente NO vuelva a preguntar lo conocido. Las
  // notas `[IA]` NO se leen (F2): son un registro del propio agente para el
  // equipo humano y realimentarlas al modelo lo hacía tomar notas de
  // conversaciones previas como pedidos reales.
  const contactRows = await db
    .select({
      name: schema.contact.name,
      empresa: schema.contact.empresa,
      rubro: schema.contact.rubro,
      comuna: schema.contact.comuna,
      rut: schema.contact.rut,
      razonSocial: schema.contact.razonSocial,
      giro: schema.contact.giro,
      direccionFacturacion: schema.contact.direccionFacturacion,
      email: schema.contact.email,
      frecuenciaDespacho: schema.contact.frecuenciaDespacho,
      volumenSemanal: schema.contact.volumenSemanal,
      productoInteres: schema.contact.productoInteres,
      formato: schema.contact.formato,
    })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.id, conversation.contactId),
        eq(schema.contact.organizationId, organizationId)
      )
    )
    .limit(1);
  const clientFile = contactRows[0] ?? null;

  // 005 — contexto comercial: catálogo público + zonas de envío (NUNCA el costo).
  const catalog = await getActiveProductsPublic(organizationId);
  const zones = await getActiveZones(organizationId);

  // F1 — NADA que cambie por turno viaja en el system: ni fecha/hora (P1), ni
  // etapa actual, ni ficha del cliente. El proveedor solo acredita caché si el
  // system es idéntico byte a byte entre turnos (sonda: 0 % con estado dentro
  // del system, 81-82 % con la nota adjunta al último mensaje del cliente; la
  // tabla está en el comentario de `buildAgentSystemPrompt`). Todo el estado
  // del turno se arma con `renderTurnState` y va pegado al último mensaje del
  // cliente; el caso borde está documentado en `appendTemporalNote`.
  const turnState = renderTurnState({
    stage: currentStage?.name ?? null,
    clientFile,
    now: new Date(),
    timeZone: getEnv().BUSINESS_TIMEZONE,
  });
  const messages: ChatMessage[] = appendTemporalNote(
    [
      {
        role: "system",
        content: buildAgentSystemPrompt({
          profile,
          kb,
          stages,
          catalog,
          zones,
        }),
      },
      ...toConversationHistory(history),
    ],
    turnState
  );

  // Mensajes de la anotación (llamada 2). Su ENTRADA no depende del reply de la
  // conversación: solo del system de extracción y del historial. Por eso se arma
  // ANTES y puede lanzarse en paralelo. La extracción de etapa y campos NUNCA
  // puede tumbar la conversación: si falla, se registra un aviso y el turno
  // entrega igual la respuesta.
  //
  // Historial ACOTADO (P2): la extracción no necesita el hilo completo. Se
  // conservan los últimos `ANNOTATION_HISTORY_LIMIT` mensajes, que es donde vive
  // el dato recién dicho.
  //
  // El historial va en modo `plain-assistant`: la marca de saliente humano la
  // explica N2, que vive solo en el prompt de conversación. Acá es extracción
  // pura y el marcador sería ruido sin explicación.
  //
  // F1: la etapa ACTUAL tampoco va en este system (cambia por turno); viaja en
  // la nota interna al final del último mensaje, igual que en la conversación.
  const annotationMessages: ChatMessage[] = appendTemporalNote(
    [
      {
        role: "system",
        content: buildAnnotationSystemPrompt({
          profile,
          stages,
          catalog,
        }),
      },
      ...toConversationHistory(history, { humanOutbound: "plain-assistant" }).slice(
        -ANNOTATION_HISTORY_LIMIT
      ),
    ],
    renderAnnotationTurnState(currentStage?.name ?? null)
  );

  // ── Llamadas 1 y 2 EN PARALELO (P1) ───────────────────────────────────────
  // El turno se parte en dos llamadas independientes: la conversación produce
  // SOLO el texto para el cliente; la anotación resuelve etapa y campos. Al no
  // depender una de la otra, corren juntas y el cliente deja de esperar la
  // extracción. `turnStartedAt` mide el tramo paralelo completo.
  const turnStartedAt = Date.now();
  const conversationPromise = chatJson(ConversationReply, messages);
  // La marca de tiempo se toma al RESOLVER la promesa, no al esperarla: si la
  // anotación termina antes que la entrega, esperarla más tarde no debe inflar
  // su latencia con el tiempo de esa espera.
  let annotationDoneAt = 0;
  // P2: la anotación puede usar su propio modelo (`OPENROUTER_ANNOTATION_MODEL`).
  // Sin la variable, `chatJson` cae a OPENROUTER_MODEL como antes.
  const annotationModel = getEnv().OPENROUTER_ANNOTATION_MODEL;
  // F3: la extracción es determinista por diseño → temperatura 0 salvo override.
  const annotationPromise = chatJson(LeadExtraction, annotationMessages, {
    model: annotationModel,
    temperature: getEnv().OPENROUTER_ANNOTATION_TEMPERATURE ?? 0,
  }).then((result) => {
    annotationDoneAt = Date.now();
    return result;
  });

  const conversationResult = await conversationPromise;
  let conversationDoneAt = Date.now();

  if (!conversationResult.ok) {
    // La anotación ya está en vuelo: se consume SIEMPRE para no dejar la
    // promesa sin manejo (y porque sus tokens ya se gastaron).
    await settleAnnotation(annotationPromise);
    if (conversationResult.error === "not_configured") return null;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(
      `[agente] fallo del proveedor (conversación, raw): ${conversationResult.detail}`
    );
    await applyHandoff(conversationId, organizationId, "error");
    return null;
  }

  const timedCalls: TimedCall[] = [
    {
      model: conversationResult.model,
      latencyMs: conversationResult.latencyMs,
      usage: conversationResult.usage,
      provider: conversationResult.provider,
    },
  ];

  let reply = conversationResult.data.reply.trim();
  const wantsHandoff = conversationResult.data.handoff === true;

  // El cliente espera respuesta. Si el modelo devolvió reply vacío sin escalar,
  // se pide UNA corrección para no dejar la conversación colgada. Si tampoco
  // trae texto, el turno no envía nada (equivale al `none` anterior).
  if (!reply && !wantsHandoff) {
    const corrective = await chatJson(ConversationReply, [
      ...messages,
      { role: "assistant", content: conversationResult.raw },
      {
        role: "system",
        content:
          "El cliente espera una respuesta y su último turno no incluyó texto. " +
          "Responda OTRA VEZ el JSON incluyendo SIEMPRE el mensaje cordial para el " +
          "cliente en el campo reply. Si el cliente se está despidiendo, agradeciendo " +
          "o cerrando el tema, cierre con un mensaje que diga que quedamos a la orden " +
          "para cualquier otra duda.",
      },
    ]);
    conversationDoneAt = Date.now();
    if (corrective.ok) {
      timedCalls.push({
        model: corrective.model,
        latencyMs: corrective.latencyMs,
        usage: corrective.usage,
        provider: corrective.provider,
      });
      const corrected = corrective.data.reply.trim();
      if (corrected) reply = corrected;
    }
  }

  // ── Guard determinista (F5) ────────────────────────────────────────────────
  // Antes de entregar, el reply se verifica contra las fuentes de verdad
  // (precios y formatos del catálogo, tarifas de despacho) y contra las
  // afirmaciones que el canal no puede hacer. Una violación pide UNA corrección
  // con la falla citada, como mensaje system al FINAL (el prefijo cacheable no
  // se toca). Si la corrección también falla, o la llamada falla, se entrega la
  // respuesta segura. Nunca lanza: un error del guard no puede tumbar el turno.
  let guardViolations = 0;
  if (reply) {
    try {
      const sources = { catalog, zones };
      // F5b: cuántas veces habló ya el agente en el hilo, para detectar el
      // saludo repetido. Se cuenta sobre el mismo historial de la llamada.
      const guardContext = {
        greeting: profile.greeting,
        agentTurnsBefore: history.filter((m) => isBotOutbound(m)).length,
      };
      const first = guardReply(reply, sources, guardContext);
      if (!first.ok) {
        guardViolations += first.violations.length;
        console.warn(
          `[guard] ${conversationId}: ${first.violations.map((v) => `${v.kind}=${v.detail}`).join(" | ")}`
        );
        const retry = await chatJson(ConversationReply, [
          ...messages,
          { role: "assistant", content: conversationResult.raw },
          { role: "system", content: first.correction },
        ]);
        conversationDoneAt = Date.now();
        let corrected: string | null = null;
        if (retry.ok) {
          timedCalls.push({
            model: retry.model,
            latencyMs: retry.latencyMs,
            usage: retry.usage,
            provider: retry.provider,
          });
          const candidate = retry.data.reply.trim();
          if (candidate) {
            const second = guardReply(candidate, sources, guardContext);
            if (second.ok) corrected = candidate;
            else guardViolations += second.violations.length;
          }
        }
        // Con solo violaciones de estilo se conserva la original.
        reply = corrected ?? resolveUncorrectedReply(reply, first.violations);
      }
    } catch (err) {
      console.error("[guard] error inesperado, se entrega el reply original:", err);
    }
  }

  // ── Entrega ───────────────────────────────────────────────────────────────
  // Ocurre SIN esperar la anotación (P1): el cliente recibe su respuesta con el
  // máximo de las dos llamadas, no con la suma.
  if (wantsHandoff) {
    // El agente SIEMPRE cierra cordialmente: sin texto, usa el cierre determinista.
    await deliverReply(conversation, reply || CLOSING_FAREWELL);
    await applyHandoff(conversationId, organizationId, "modelo");
  } else if (reply) {
    await deliverReply(conversation, reply);
  }

  // ── Anotación: se espera DESPUÉS de la entrega (P1) ───────────────────────
  // Etapa y nota se procesan igual que antes; el turno no retorna hasta
  // cerrarlas para que el Laboratorio mida el `finalStage` completo
  // (runner.ts:396) y la telemetría incluya las dos llamadas.
  const extraction = await settleAnnotation(annotationPromise);
  if (!extraction.ok) {
    console.warn(
      `[agente] extracción del lead falló, el turno continúa: ${extraction.detail}`
    );
  } else {
    timedCalls.push({
      model: extraction.model,
      latencyMs: extraction.latencyMs,
      usage: extraction.usage,
      provider: extraction.provider,
    });

    // Etapa objetivo: se resuelve contra las etapas reales y solo avanza (nunca
    // retrocede ni sale de ganado/perdido). Un nombre inexistente solo registra
    // el aviso y no mueve el lead.
    if (extraction.data.stage) {
      const target = resolveStage(extraction.data.stage, stages);
      if (!target) {
        console.warn(
          `[agente] etapa inexistente "${extraction.data.stage}" — ` +
            `disponibles: ${stages.map((s) => s.name).join(", ")}.`
        );
      } else {
        const targetMeta = stages.find((s) => s.id === target.id);
        const canAdvance =
          currentStage === null ||
          (currentStage.kind !== "won" &&
            currentStage.kind !== "lost" &&
            targetMeta !== undefined &&
            targetMeta.position > currentStage.position);
        if (canAdvance && target.id !== currentStageId) {
          await moveLeadToStage(organizationId, conversation.contactId, target.id);
          publish(organizationId, {
            type: "conversation.updated",
            data: { conversation: { id: conversationId } },
          });
        }
      }
    }

    // Nota y campos comerciales: si la extracción no trae nada, no se escribe.
    await appendLeadNote(organizationId, conversation.contactId, extraction.data);
  }

  // Latencia del turno: tiempo de pared del tramo paralelo (P1). Si la
  // anotación no llegó a marcar hora (caso imposible: siempre resuelve), se cae
  // al cierre de la conversación para no reportar un valor sin sentido.
  const latencyMs =
    Math.max(conversationDoneAt, annotationDoneAt || conversationDoneAt) -
    turnStartedAt;
  return { ...accumulateTiming(timedCalls, latencyMs), guardViolations };
}

type Conversation = typeof schema.conversation.$inferSelect;

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return;
    }
    throw err;
  }
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
    origin: "ai",
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana"
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId))
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });

  // 006: avisar al responsable por push — jamás en conversaciones de prueba
  // (guard de sandbox, igual que el envío real de mensajes).
  if (!updated[0].isTest) {
    void notifyHandoff(organizationId, conversationId, reason);
  }
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.lead)
    .set({ stageId, updatedAt: new Date(), lastActivityAt: new Date() })
    .where(eq(schema.lead.contactId, contactId));
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  fields: Omit<LeadExtractionType, "stage">
): Promise<void> {
  // Una extracción vacía es válida: no hay nada que anotar y no se escribe.
  const fieldKeys = [
    "empresa",
    "rubro",
    "comuna",
    "rut",
    "razonSocial",
    "giro",
    "direccionFacturacion",
    "email",
    "frecuenciaDespacho",
    "volumenSemanal",
    "productoInteres",
    "formato",
  ] as const;
  // Un marcador de posición ("...") no es un dato: se descarta en vez de
  // escribirlo en el contacto (ver `isPlaceholderValue`).
  const hasStructuredField = fieldKeys.some(
    (key) => fields[key] !== undefined && !isPlaceholderValue(fields[key])
  );
  const note = isPlaceholderValue(fields.note) ? undefined : fields.note;
  if (note === undefined && !hasStructuredField) return;

  const db = getDb();

  const rows = await db
    .select({
      id: schema.contact.id,
      notes: schema.contact.notes,
      empresa: schema.contact.empresa,
      rubro: schema.contact.rubro,
      comuna: schema.contact.comuna,
      rut: schema.contact.rut,
      razonSocial: schema.contact.razonSocial,
      giro: schema.contact.giro,
      direccionFacturacion: schema.contact.direccionFacturacion,
      email: schema.contact.email,
      frecuenciaDespacho: schema.contact.frecuenciaDespacho,
      volumenSemanal: schema.contact.volumenSemanal,
      productoInteres: schema.contact.productoInteres,
      formato: schema.contact.formato,
    })
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  const contact = rows[0];
  if (!contact) return;

  // Último valor gana: cada campo estructurado presente en la extracción
  // sobrescribe el valor previo; lo ausente se conserva. Los marcadores de
  // posición se descartan igual que lo ausente.
  const patch: Partial<typeof schema.contact.$inferInsert> = {};
  for (const key of fieldKeys) {
    const value = fields[key];
    if (value !== undefined && !isPlaceholderValue(value)) {
      patch[key] = value;
    }
  }

  const notes = note
    ? contact.notes
      ? `${contact.notes}\n[IA] ${note}`
      : `[IA] ${note}`
    : contact.notes;

  await db
    .update(schema.contact)
    .set({ ...patch, notes, updatedAt: new Date() })
    .where(eq(schema.contact.id, contact.id));
}
