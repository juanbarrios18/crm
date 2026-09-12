import { z } from "zod";
import { withAuth, parseBody } from "@/lib/api";
import { deleteSubscription } from "@/server/push/subscriptions";

export const dynamic = "force-dynamic";

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

// 006 — Elimina la suscripción push del usuario (toggle off / desinstalación).
export const DELETE = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, unsubscribeSchema);
  if (!body.ok) return body.response;
  await deleteSubscription(session.organizationId, body.data.endpoint);
  return Response.json({ ok: true });
});
