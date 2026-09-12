import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * 006 — Persistencia de suscripciones Web Push (por usuario y dispositivo).
 *
 * `auth`/`p256dh` viajan cifrados en reposo (Principio I) como un único blob
 * JSON dentro de `keys_cipher`/`keys_iv`/`keys_tag`. El `endpoint` va en claro
 * (no es secreto: es la URL a la que se POSTea el push).
 */

export type SubscriptionKeys = { auth: string; p256dh: string };

type SubscriptionRow = typeof schema.pushSubscription.$inferSelect;

function encryptKeys(keys: SubscriptionKeys) {
  return encryptSecret(JSON.stringify(keys));
}

export function decryptKeys(row: SubscriptionRow): SubscriptionKeys {
  return JSON.parse(
    decryptSecret({
      cipher: row.keysCipher,
      iv: row.keysIv,
      tag: row.keysTag,
    })
  ) as SubscriptionKeys;
}

/** Upsert idempotente por endpoint (UNIQUE). Re-suscribir no duplica. */
export async function upsertSubscription(
  organizationId: string,
  userId: string,
  endpoint: string,
  keys: SubscriptionKeys
): Promise<void> {
  const db = getDb();
  const enc = encryptKeys(keys);
  await db
    .insert(schema.pushSubscription)
    .values({
      id: newId("pushSubscription"),
      organizationId,
      userId,
      endpoint,
      keysCipher: enc.cipher,
      keysIv: enc.iv,
      keysTag: enc.tag,
    })
    .onConflictDoUpdate({
      target: schema.pushSubscription.endpoint,
      set: {
        keysCipher: enc.cipher,
        keysIv: enc.iv,
        keysTag: enc.tag,
        updatedAt: new Date(),
      },
    });
}

export async function listByOrg(
  organizationId: string
): Promise<SubscriptionRow[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.pushSubscription)
    .where(scoped(schema.pushSubscription.organizationId, organizationId));
}

export async function listByUser(
  organizationId: string,
  userId: string
): Promise<SubscriptionRow[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.pushSubscription)
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        eq(schema.pushSubscription.userId, userId)
      )
    );
}

export async function deleteSubscription(
  organizationId: string,
  endpoint: string
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.pushSubscription)
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        eq(schema.pushSubscription.endpoint, endpoint)
      )
    );
}

/** Purga por id (suscripción expirada detectada al enviar, 404/410). */
export async function deleteSubscriptionById(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.pushSubscription).where(eq(schema.pushSubscription.id, id));
}
