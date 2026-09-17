import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";

/**
 * Atribución de anuncios de clic a WhatsApp.
 *
 * Meta adjunta un objeto `referral` al PRIMER mensaje de una conversación que
 * se inició desde un anuncio. Este módulo lo interpreta de forma tolerante y lo
 * persiste en columnas de `conversation`, para reconstruir después la cadena
 * mensaje(referral) → conversación → contacto → lead → venta(valor).
 *
 * La lógica de interpretación es PURA: no toca la base de datos y se prueba sin
 * infraestructura. La persistencia vive en `captureAttribution`.
 */

/** Campos de interés del referral, ya normalizados (los ausentes quedan en null). */
export type AttributionReferral = {
  /** referral.source_id: identificador del anuncio. */
  sourceId: string | null;
  /** referral.ctwa_clid: identificador del clic en el anuncio. */
  ctwaClid: string | null;
  /** referral.headline: titular del anuncio. */
  headline: string | null;
  /** referral.source_url: URL de origen del anuncio. */
  sourceUrl: string | null;
};

/**
 * Campo de texto opcional y tolerante: acepta string, null o ausente; ante
 * cualquier otro tipo degrada a null en lugar de fallar. Meta puede cambiar la
 * forma del payload sin aviso, así que la lectura nunca revienta.
 */
const optionalTextField = z.string().nullish().catch(null);

/**
 * Forma esperada del referral según Meta (snake_case). Sin `.strict()`: los
 * campos desconocidos se ignoran, que es el comportamiento por defecto de Zod.
 */
const referralSchema = z.object({
  source_id: optionalTextField,
  ctwa_clid: optionalTextField,
  headline: optionalTextField,
  source_url: optionalTextField,
});

/**
 * Interpreta el objeto `referral` de un mensaje entrante.
 *
 * Devuelve null cuando no hay nada utilizable: entrada ausente, entrada que no
 * es un objeto o resultado sin ningún campo útil. Nunca lanza.
 */
export function parseReferral(input: unknown): AttributionReferral | null {
  if (input === undefined || input === null) return null;

  const parsed = referralSchema.safeParse(input);
  if (!parsed.success) return null;

  const referral: AttributionReferral = {
    sourceId: parsed.data.source_id ?? null,
    ctwaClid: parsed.data.ctwa_clid ?? null,
    headline: parsed.data.headline ?? null,
    sourceUrl: parsed.data.source_url ?? null,
  };

  const hasAnyField =
    referral.sourceId !== null ||
    referral.ctwaClid !== null ||
    referral.headline !== null ||
    referral.sourceUrl !== null;
  return hasAnyField ? referral : null;
}

/**
 * Persiste la atribución en la conversación SOLO si todavía no tiene una.
 *
 * Primera gana: el referral llega con el primer mensaje, así que un segundo
 * mensaje con referral no debe sobrescribir el punto de entrada original. La
 * condición `attribution_captured_at IS NULL` hace la escritura atómica.
 *
 * @returns true si se escribió la atribución; false si la conversación ya tenía.
 */
export async function captureAttribution(
  organizationId: string,
  conversationId: string,
  referral: AttributionReferral
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({
      attributionSourceId: referral.sourceId,
      attributionCtwaClid: referral.ctwaClid,
      attributionHeadline: referral.headline,
      attributionSourceUrl: referral.sourceUrl,
      attributionCapturedAt: new Date(),
    })
    .where(
      and(
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.organizationId, organizationId),
        isNull(schema.conversation.attributionCapturedAt)
      )
    )
    .returning();

  return updated.length > 0;
}
