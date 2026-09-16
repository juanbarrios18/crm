import { z } from "zod";
import { revalidateTag } from "next/cache";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isSafeImageRef } from "@/lib/catalog";
import { CATALOG_TAG } from "@/lib/catalog-public";
import {
  CatalogConflictError,
  createProduct,
  listProductsAdmin,
} from "@/server/catalog/admin";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const products = await listProductsAdmin(session.organizationId);
  return Response.json({ products });
});

const createSchema = z.object({
  producto: z.string().trim().min(1).max(120),
  masa: z.string().trim().min(1).max(80),
  formato: z.string().trim().min(1).max(80),
  unidadesPorBolsa: z.number().int().positive().max(100000),
  precioBolsaNeto: z.number().finite().min(0).max(1000000000),
  // Ruta o URL de la foto. Solo rutas internas o http(s): nunca `javascript:`
  // ni `data:` (el valor termina en un `src` de la web pública).
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

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  try {
    const product = await createProduct(session.organizationId, {
      producto: body.data.producto,
      masa: body.data.masa,
      formato: body.data.formato,
      unidadesPorBolsa: body.data.unidadesPorBolsa,
      precioBolsaNeto: body.data.precioBolsaNeto,
      imagen: body.data.imagen ?? null,
      activo: body.data.activo ?? true,
      notas: body.data.notas ?? null,
    });
    // El catálogo del sitio es una vista cacheada: sin invalidar, un producto
    // nuevo tardaría hasta la ventana de revalidación en aparecer en la web.
    revalidateTag(CATALOG_TAG);
    return Response.json({ product }, { status: 201 });  } catch (err) {
    if (err instanceof CatalogConflictError) {
      return apiError(409, "conflict", err.message);
    }
    throw err;
  }
});
