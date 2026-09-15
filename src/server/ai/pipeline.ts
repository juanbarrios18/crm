import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatMessage, type ChatTiming } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import { AgentAction, degradeAction, resolveStage, type AgentActionType } from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { buildAgentSystemPrompt, CLOSING_FAREWELL } from "@/server/ai/prompts";
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

/** true si la acción incluye un mensaje visible para el cliente. */
function actionHasReply(action: AgentActionType): boolean {
  switch (action.action) {
    case "reply":
      return true;
    case "update_lead":
    case "move_stage":
      return Boolean(action.reply);
    case "handoff":
      return Boolean(action.farewell);
    case "none":
      return false;
  }
}

/** Texto de respuesta de una acción, si lo tiene. */
function replyText(action: AgentActionType): string | undefined {
  switch (action.action) {
    case "reply":
      return action.text;
    case "update_lead":
    case "move_stage":
      return action.reply;
    case "handoff":
      return action.farewell;
    case "none":
      return undefined;
  }
}

/** Adjunta el texto de respuesta a la acción original (preserva su decisión). */
function attachReply(
  action: AgentActionType,
  text: string | undefined
): AgentActionType {
  if (!text) return action;
  switch (action.action) {
    case "none":
      return action.stage
        ? { action: "reply", text, stage: action.stage }
        : { action: "reply", text };
    case "reply":
      return action;
    case "update_lead":
    case "move_stage":
      return { ...action, reply: text };
    case "handoff":
      return { ...action, farewell: text };
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
      }),
    },
    ...history
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  const result = await chatJson(AgentAction, messages);
  if (!result.ok) {
    if (result.error === "not_configured") return null;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    await applyHandoff(conversationId, organizationId, "error");
    return null;
  }

  // Timing del turno: modelo usado + latencia + tokens/provider (Laboratorio).
  const timing: ChatTiming = {
    model: result.model,
    latencyMs: result.latencyMs,
    promptTokens: result.usage?.promptTokens ?? null,
    completionTokens: result.usage?.completionTokens ?? null,
    cachedTokens: result.usage?.cachedTokens ?? null,
    provider: result.provider,
  };

  let action: AgentActionType = result.data;

  // El cliente espera respuesta. El modelo chico suele "anotar" con update_lead
  // (o devolver none) y olvidarse de responder. Si la acción no trae texto,
  // pedimos UNA corrección para no dejar la conversación colgada.
  if (!actionHasReply(action)) {
    const corrective = await chatJson(AgentAction, [
      ...messages,
      { role: "assistant", content: result.raw },
      {
        role: "system",
        content:
          "El cliente espera una respuesta y tu última acción no incluyó texto. " +
          "Respondé OTRA VEZ el JSON incluyendo SIEMPRE un mensaje cordial para el cliente " +
          "(campo reply; si es handoff, farewell). Si el cliente se está despidiendo, " +
          "agradeciendo o cerrando el tema, cerrá con un mensaje que diga que quedamos " +
          "a la orden para cualquier otra duda. No cambies la decisión de fondo.",
      },
    ]);
    if (corrective.ok && actionHasReply(corrective.data)) {
      // Se conserva la decisión original (nota/etapa) y se le adjunta el texto.
      action = attachReply(action, replyText(corrective.data));
    }
  }

  // Etapa objetivo: el modelo la emite como campo independiente en CUALQUIER
  // acción (no compite con la elección de reply/move_stage). Se resuelve contra
  // las etapas reales y solo avanza (nunca retrocede ni sale de ganado/perdido).
  if (action.stage) {
    const target = resolveStage(action.stage, stages);
    if (!target) {
      console.warn(
        `[agente] etapa inexistente "${action.stage}" — ` +
          `disponibles: ${stages.map((s) => s.name).join(", ")}.`
      );
      if (action.action === "move_stage") action = degradeAction(action);
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

  if (action.action === "move_stage") {
    if (action.reply) {
      await deliverReply(conversation, action.reply);
    }
    return timing;
  }

  switch (action.action) {
    case "none":
      return timing;
    case "reply":
      await deliverReply(conversation, action.text);
      return timing;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action);
      if (action.reply) await deliverReply(conversation, action.reply);
      return timing;
    }
    case "handoff": {
      // El agente SIEMPRE cierra cordialmente: si el modelo no trajo farewell,
      // se usa el cierre determinista antes de pasar a atención humana.
      await deliverReply(conversation, action.farewell ?? CLOSING_FAREWELL);
      await applyHandoff(conversationId, organizationId, "modelo");
      return timing;
    }
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
  fields: {
    note?: string;
    empresa?: string;
    rubro?: string;
    comuna?: string;
    rut?: string;
    razonSocial?: string;
    giro?: string;
    direccionFacturacion?: string;
    email?: string;
    frecuenciaDespacho?: string;
    volumenSemanal?: string;
    productoInteres?: string;
    formato?: string;
  }
): Promise<void> {
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

  // Último valor gana: cada campo estructurado presente en la acción
  // sobrescribe el valor previo; lo ausente se conserva.
  const patch: Partial<typeof schema.contact.$inferInsert> = {};
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
