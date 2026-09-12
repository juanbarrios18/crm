import webPush from "web-push";
import { getEnv } from "@/lib/env";

/**
 * 006 — Configuración VAPID del Web Push (estándar W3C, RFC 8291).
 *
 * Sin claves en el entorno, el push queda deshabilitado (`getVapid()` → null) y
 * la app funciona normal (degradación silenciosa). `setVapidDetails` es estado
 * global del módulo: se aplica una sola vez.
 */
let configured = false;

export function getVapid(): { publicKey: string } | null {
  const env = getEnv();
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  if (!configured) {
    webPush.setVapidDetails(env.VAPID_SUBJECT, publicKey, privateKey);
    configured = true;
  }
  return { publicKey };
}
