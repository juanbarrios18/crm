import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  CatalogConflictError,
  createZone,
  listZonesAdmin,
} from "@/server/catalog/admin";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const zones = await listZonesAdmin(session.organizationId);
  return Response.json({ zones });
});

const createSchema = z.object({
  comuna: z.string().trim().min(1).max(120),
  costoDespacho: z.number().finite().min(0).max(1000000000).nullable().optional(),
  activa: z.boolean().optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  try {
    const zone = await createZone(session.organizationId, {
      comuna: body.data.comuna,
      costoDespacho: body.data.costoDespacho ?? null,
      activa: body.data.activa ?? true,
    });
    return Response.json({ zone }, { status: 201 });
  } catch (err) {
    if (err instanceof CatalogConflictError) {
      return apiError(409, "conflict", err.message);
    }
    throw err;
  }
});
