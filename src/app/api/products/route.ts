import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
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
      activo: body.data.activo ?? true,
      notas: body.data.notas ?? null,
    });
    return Response.json({ product }, { status: 201 });
  } catch (err) {
    if (err instanceof CatalogConflictError) {
      return apiError(409, "conflict", err.message);
    }
    throw err;
  }
});
