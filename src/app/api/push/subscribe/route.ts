import { z } from "zod";
import { withAuth, parseBody } from "@/lib/api";
import { upsertSubscription } from "@/server/push/subscriptions";

export const dynamic = "force-dynamic";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    auth: z.string().min(1),
    p256dh: z.string().min(1),
  }),
});

// 006 — Registra/actualiza la suscripción push del usuario (upsert por endpoint).
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, subscribeSchema);
  if (!body.ok) return body.response;
  await upsertSubscription(
    session.organizationId,
    session.userId,
    body.data.endpoint,
    body.data.keys
  );
  return Response.json({ ok: true });
});
