import { and, eq } from "drizzle-orm";
import webPush from "web-push";
import { getDb, schema } from "@/lib/db";
import {
  decryptKeys,
  deleteSubscriptionById,
  listByOrg,
} from "./subscriptions";
import { getVapid } from "./vapid";

/**
 * 006 — Notificación de handoff al responsable.
 *
 * Best-effort: NUNCA lanza hacia arriba ni bloquea el turno del agente. Un
 * fallo de entrega degrada en silencio; las suscripciones expiradas (404/410)
 * se purgan sin tocar el estado de la conversación.
 */

const REASON_LABEL: Record<string, string> = {
  cliente: "el cliente pidió hablar con una persona",
  modelo: "la IA decidió escalar",
  error: "la IA no pudo responder",
  ventana: "la ventana de 24h está cerrada",
  manual_reply: "el dueño respondió manualmente",
};

export async function notifyHandoff(
  organizationId: string,
  conversationId: string,
  reason: string
): Promise<void> {
  try {
    if (!getVapid()) return; // push deshabilitado (sin VAPID en el entorno)

    const db = getDb();
    const convRows = await db
      .select({ name: schema.contact.name })
      .from(schema.conversation)
      .innerJoin(
        schema.contact,
        eq(schema.conversation.contactId, schema.contact.id)
      )
      .where(
        and(
          eq(schema.conversation.id, conversationId),
          eq(schema.conversation.organizationId, organizationId)
        )
      )
      .limit(1);
    const contactName = convRows[0]?.name ?? "Contacto";

    const subs = await listByOrg(organizationId);
    if (subs.length === 0) return;

    const body = `Nuevo handoff — ${contactName}: ${
      REASON_LABEL[reason] ?? reason
    }`;
    const payload = JSON.stringify({
      title: "Handoff en Vocero",
      body,
      data: { url: `/inbox?conversation=${conversationId}` },
    });

    for (const sub of subs) {
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: decryptKeys(sub) },
          payload,
          { TTL: 60 * 60 }
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deleteSubscriptionById(sub.id);
        } else {
          console.error("[push] envío falló:", err);
        }
      }
    }
  } catch (err) {
    console.error("[push] notifyHandoff falló:", err);
  }
}
