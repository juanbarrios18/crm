import { z } from "zod";
import { revalidateTag } from "next/cache";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isSafeImageRef } from "@/lib/catalog";
import { CATALOG_TAG } from "@/lib/catalog-public";
import {
  CatalogConflictError,
  deleteProduct,
  updateProduct,
} from "@/server/catalog/admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  producto: z.string().trim().min(1).max(120).optional(),
  masa: z.string().trim().min(1).max(80).optional(),
  formato: z.string().trim().min(1).max(80).optional(),
  unidadesPorBolsa: z.number().int().positive().max(100000).optional(),
  precioBolsaNeto: z.number().finite().min(0).max(1000000000).optional(),
  // `null` limpia la imagen; ausente la deja como está.
  imagen: z
    .string()
    .trim()
    .max(2048)
    .refine(isSafeImageRef, { message: "referencia de imagen no permitida" })
    .nullable()
    .optional(),
  activo: z.boolean().optional(),
  notas: z.string().trim().max(2000).nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  try {
    const product = await updateProduct(session.organizationId, id, body.data);
    if (!product) return apiError(404, "not_found", "Producto no encontrado");
    revalidateTag(CATALOG_TAG);
    return Response.json({ product });
  } catch (err) {
    if (err instanceof CatalogConflictError) {
      return apiError(409, "conflict", err.message);
    }
    throw err;
  }
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const deleted = await deleteProduct(session.organizationId, id);
  if (!deleted) return apiError(404, "not_found", "Producto no encontrado");
  revalidateTag(CATALOG_TAG);
  return Response.json({ deleted: true });
});
