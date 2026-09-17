import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatMessage, type ChatTiming } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import {
  ConversationReply,
  LeadExtraction,
  resolveStage,
  type LeadExtractionType,
} from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import {
  buildAgentSystemPrompt,
  buildAnnotationSystemPrompt,
  CLOSING_FAREWELL,
} from "@/server/ai/prompts";
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
 * opcional + anotación) en UN `ChatTiming`. Se suma a propósito: el turno hace
 * más de una llamada y el Laboratorio mide el costo/latencia REAL, no el de una
 * sola. `model` y `provider` son los de la llamada de conversación (la principal).
 *
 * Tokens: un `null` se trata como 0 SOLO si otra llamada reportó valor para ese
 * mismo token; si ninguna lo reporta, queda `null` (no se inventa un 0).
 */
function accumulateTiming(calls: TimedCall[]): ChatTiming {
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
    latencyMs: calls.reduce((acc, call) => acc + call.latencyMs, 0),
    promptTokens: sumToken((u) => u.promptTokens),
    completionTokens: sumToken((u) => u.completionTokens),
    cachedTokens: sumToken((u) => u.cachedTokens),
    provider: primary.provider,
  };
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

  // Ficha del cliente: datos comerciales ya capturados + nombre + notas. Se
  // inyecta en el prompt para que el agente NO vuelva a preguntar lo conocido.
  const contactRows = await db
    .select({
      name: schema.contact.name,
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

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        profile,
        kb,
        stages,
        currentStage: currentStage?.name ?? null,
        catalog,
        zones,
        clientFile,
      }),
    },
    ...history
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  // ── Llamada 1 — CONVERSACIÓN ──────────────────────────────────────────────
  // El turno se parte en dos llamadas: esta produce SOLO el texto para el
  // cliente; la anotación (más abajo) resuelve etapa y campos por separado.
  const conversationResult = await chatJson(ConversationReply, messages);
  if (!conversationResult.ok) {
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

  // ── Llamada 2 — ANOTACIÓN (best-effort) ───────────────────────────────────
  // La extracción de etapa y campos NUNCA puede tumbar la conversación: si esta
  // llamada falla, se registra un aviso y el turno sigue con la respuesta que ya
  // se iba a entregar. Consulta solo las etapas y las instrucciones del negocio:
  // es un prompt de extracción, notoriamente más chico que el de conversación.
  const annotationMessages: ChatMessage[] = [
    {
      role: "system",
      content: buildAnnotationSystemPrompt({
        profile,
        stages,
        currentStage: currentStage?.name ?? null,
      }),
    },
    ...messages.slice(1),
  ];
  const extraction = await chatJson(LeadExtraction, annotationMessages);
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

  // Timing del turno: suma REAL de todas las llamadas que ocurrieron (Laboratorio).
  const timing = accumulateTiming(timedCalls);

  // ── Entrega ───────────────────────────────────────────────────────────────
  if (wantsHandoff) {
    // El agente SIEMPRE cierra cordialmente: sin texto, usa el cierre determinista.
    await deliverReply(conversation, reply || CLOSING_FAREWELL);
    await applyHandoff(conversationId, organizationId, "modelo");
    return timing;
  }
  if (reply) {
    await deliverReply(conversation, reply);
  }
  return timing;
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
  const hasStructuredField = fieldKeys.some(
    (key) => fields[key] !== undefined
  );
  if (fields.note === undefined && !hasStructuredField) return;

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
  // sobrescribe el valor previo; lo ausente se conserva.
  const patch: Partial<typeof schema.contact.$inferInsert> = {};
  for (const key of fieldKeys) {
    if (fields[key] !== undefined) {
      patch[key] = fields[key];
    }
  }

  const notes = fields.note
    ? contact.notes
      ? `${contact.notes}\n[IA] ${fields.note}`
      : `[IA] ${fields.note}`
    : contact.notes;

  await db
    .update(schema.contact)
    .set({ ...patch, notes, updatedAt: new Date() })
    .where(eq(schema.contact.id, contact.id));
}
