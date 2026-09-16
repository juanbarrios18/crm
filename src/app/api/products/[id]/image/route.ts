import { eq } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { revalidateTag } from "next/cache";
import { CATALOG_PUBLIC_MEDIA_PREFIX, CATALOG_TAG } from "@/lib/catalog-public";
import {
  MEDIA_LIMITS,
  mediaFilePath,
  saveMediaFile,
} from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Foto de un producto del catálogo (007).
 *
 * Crea un asset PROPIO (`waMediaId` ausente, `fetchStatus: "available"`) en el
 * volumen `MEDIA_DIR`: no pasa por Graph ni por una conversación, que es lo que
 * hacen los adjuntos de WhatsApp. Después apunta `product.imagen` al serving
 * público y revalida la caché del catálogo para que el cambio se vea sin
 * esperar la ventana de revalidación.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.product)
    .where(
      scoped(
        schema.product.organizationId,
        session.organizationId,
        eq(schema.product.id, id)
      )
    )
    .limit(1);
  const product = rows[0];
  if (!product) return apiError(404, "not_found", "Producto no encontrado");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(422, "invalid", "Se esperaba multipart/form-data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError(422, "invalid", "Falta el archivo (campo `file`)");
  }

  const { maxBytes, mimes, label } = MEDIA_LIMITS.image;
  if (!mimes.test(file.type)) {
    return apiError(415, "unsupported_type", `Formato no soportado: ${label}`);
  }
  if (file.size > maxBytes) {
    return apiError(413, "too_large", `El archivo excede el límite: ${label}`);
  }

  const assetId = newId("mediaAsset");
  const data = Buffer.from(await file.arrayBuffer());

  try {
    const storagePath = await saveMediaFile(
      session.organizationId,
      assetId,
      data
    );

    await db.insert(schema.mediaAsset).values({
      id: assetId,
      organizationId: session.organizationId,
      kind: "image",
      // Sin `waMediaId`: el asset no viene de WhatsApp. `available` es
      // obligatorio, si no el serving lo trataría como descarga pendiente.
      fetchStatus: "available",
      mimeType: file.type,
      fileName: file.name || null,
      fileSize: data.byteLength,
      storagePath,
    });

    const publicRef = `${CATALOG_PUBLIC_MEDIA_PREFIX}/${assetId}`;
    const updated = await db
      .update(schema.product)
      .set({ imagen: publicRef, updatedAt: new Date() })
      .where(
        scoped(
          schema.product.organizationId,
          session.organizationId,
          eq(schema.product.id, id)
        )
      )
      .returning();

    // Recién con el reemplazo confirmado se borra la foto anterior.
    await dropOrphanImage(session.organizationId, product.imagen);

    revalidateTag(CATALOG_TAG);

    return Response.json({ product: updated[0], imagen: publicRef });
  } catch (err) {
    // Si algo falló después de escribir el archivo, no dejamos basura.
    await unlink(mediaFilePath(session.organizationId, assetId)).catch(() => {});
    await db
      .delete(schema.mediaAsset)
      .where(
        scoped(
          schema.mediaAsset.organizationId,
          session.organizationId,
          eq(schema.mediaAsset.id, assetId)
        )
      )
      .catch(() => {});
    throw err;
  }
});

/** Quita la foto del producto (vuelve al placeholder del catálogo). */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();

  const current = await db
    .select()
    .from(schema.product)
    .where(
      scoped(
        schema.product.organizationId,
        session.organizationId,
        eq(schema.product.id, id)
      )
    )
    .limit(1);
  if (!current[0]) return apiError(404, "not_found", "Producto no encontrado");

  const updated = await db
    .update(schema.product)
    .set({ imagen: null, updatedAt: new Date() })
    .where(
      scoped(
        schema.product.organizationId,
        session.organizationId,
        eq(schema.product.id, id)
      )
    )
    .returning();

  // El asset a borrar es el ANTERIOR: después del update `imagen` ya es null.
  await dropOrphanImage(session.organizationId, current[0].imagen);
  revalidateTag(CATALOG_TAG);

  return Response.json({ product: updated[0], imagen: null });
});

/** Extrae el assetId de una referencia pública `/api/public/media/<id>`. */
function assetIdFromPublicRef(ref: string | null): string | null {
  if (!ref) return null;
  const prefix = `${CATALOG_PUBLIC_MEDIA_PREFIX}/`;
  if (!ref.startsWith(prefix)) return null;
  const assetId = ref.slice(prefix.length);
  return /^[\w.-]{1,64}$/.test(assetId) ? assetId : null;
}

/**
 * Borra el asset y su archivo si ya no lo usa nadie.
 *
 * Nunca toca un asset referenciado por un mensaje: el mismo `mediaAsset` puede
 * ser un adjunto de conversación, y esos no se reciclan.
 */
async function dropOrphanImage(
  organizationId: string,
  ref: string | null
): Promise<void> {
  const assetId = assetIdFromPublicRef(ref);
  if (!assetId) return;

  const db = getDb();
  const referenced = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.mediaAssetId, assetId)
      )
    )
    .limit(1);
  if (referenced.length > 0) return;

  await db
    .delete(schema.mediaAsset)
    .where(
      scoped(
        schema.mediaAsset.organizationId,
        organizationId,
        eq(schema.mediaAsset.id, assetId)
      )
    )
    .catch(() => {});
  await unlink(mediaFilePath(organizationId, assetId)).catch(() => {});
}
