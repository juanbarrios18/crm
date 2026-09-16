import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { CATALOG_PUBLIC_MEDIA_PREFIX } from "@/lib/catalog-public";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { resolveInstanceOrg } from "@/server/bot/auth";
import { readMediaFile } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ assetId: string }> };

/**
 * Sirve la foto de un producto del catálogo, SIN sesión.
 *
 * Dos guardas deliberadas:
 *  1. Solo se sirve un asset que esté REFERENCIADO por un producto activo. Esta
 *     ruta no es un acceso general al volumen de adjuntos: los adjuntos de
 *     conversación siguen siendo privados y con sesión (`/api/media/[assetId]`).
 *  2. `assetId` se valida contra un patrón estricto antes de tocar el disco.
 */
export async function GET(_req: Request, ctx: Params) {
  const { assetId } = await ctx.params;
  if (!/^[\w.-]{1,64}$/.test(assetId)) {
    return apiError(422, "invalid", "assetId inválido");
  }

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(404, "not_found", "Instancia sin organización");
  }

  const db = getDb();
  const ref = `${CATALOG_PUBLIC_MEDIA_PREFIX}/${assetId}`;

  const owner = await db
    .select({ id: schema.product.id })
    .from(schema.product)
    .where(
      scoped(
        schema.product.organizationId,
        organizationId,
        eq(schema.product.activo, true),
        eq(schema.product.imagen, ref)
      )
    )
    .limit(1);
  if (!owner[0]) {
    return apiError(404, "not_found", "Imagen no encontrada");
  }

  const assets = await db
    .select()
    .from(schema.mediaAsset)
    .where(
      scoped(
        schema.mediaAsset.organizationId,
        organizationId,
        eq(schema.mediaAsset.id, assetId)
      )
    )
    .limit(1);
  const asset = assets[0];
  if (!asset || asset.kind !== "image" || !asset.storagePath) {
    return apiError(404, "not_found", "Imagen no encontrada");
  }

  try {
    const data = await readMediaFile(organizationId, assetId);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": asset.mimeType ?? "image/jpeg",
        "content-length": String(data.byteLength),
        // El assetId es único por subida, así que el contenido de esta URL
        // nunca cambia: reemplazar la foto genera otra URL.
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return apiError(
      404,
      "not_found",
      "El archivo de la imagen no está en el volumen"
    );
  }
}
