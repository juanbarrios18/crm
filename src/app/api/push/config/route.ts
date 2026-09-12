import { withAuth } from "@/lib/api";
import { getVapid } from "@/server/push/vapid";

export const dynamic = "force-dynamic";

// 006 — Devuelve la VAPID pública para que el cliente se suscriba.
// Sin VAPID configurada → { publicKey: null } y la UI deshabilita el push.
export const GET = withAuth(async () => {
  const vapid = getVapid();
  return Response.json({ publicKey: vapid?.publicKey ?? null });
});
