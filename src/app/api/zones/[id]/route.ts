import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  CatalogConflictError,
  deleteZone,
  updateZone,
} from "@/server/catalog/admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  comuna: z.string().trim().min(1).max(120).optional(),
  costoDespacho: z.number().finite().min(0).max(1000000000).nullable().optional(),
  activa: z.boolean().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  try {
    const zone = await updateZone(session.organizationId, id, body.data);
    if (!zone) return apiError(404, "not_found", "Zona no encontrada");
    return Response.json({ zone });
  } catch (err) {
    if (err instanceof CatalogConflictError) {
      return apiError(409, "conflict", err.message);
    }
    throw err;
  }
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const deleted = await deleteZone(session.organizationId, id);
  if (!deleted) return apiError(404, "not_found", "Zona no encontrada");
  return Response.json({ deleted: true });
});
