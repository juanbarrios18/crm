"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";

/**
 * 006 — Toggle de notificaciones push del handoff.
 * Suscribe/desuscribe al usuario en el PushManager y persiste en el backend.
 */

type PushStatus =
  | "loading"
  | "unsupported"
  | "denied"
  | "off"
  | "on";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushToggle() {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<PushStatus>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supported = useCallback(
    () =>
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    []
  );

  const refresh = useCallback(async () => {
    if (!supported()) {
      setStatus("unsupported");
      return;
    }
    try {
      const res = await fetch("/api/push/config");
      const data = (await res.json()) as { publicKey: string | null };
      setPublicKey(data.publicKey);
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const perm = Notification.permission;
      if (perm === "denied") setStatus("denied");
      else if (existing) setStatus("on");
      else setStatus("off");
    } catch {
      setStatus("off");
    }
  }, [supported]);

  useEffect(() => {
    setMounted(true);
    void refresh();
  }, [refresh]);

  async function subscribe() {
    if (!supported()) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "off");
        return;
      }
      const key = publicKey;
      if (!key) {
        setStatus("off"); // VAPID no configurada: push deshabilitado
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const raw = sub.toJSON() as { endpoint: string; keys: { auth: string; p256dh: string } };
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: raw.endpoint, keys: raw.keys }),
      });
      setStatus("on");
    } catch {
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    if (!supported()) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const raw = sub.toJSON() as { endpoint: string };
        await sub.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: raw.endpoint }),
        });
      }
      setStatus("off");
    } catch {
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  if (status === "loading") {
    return <p className="text-sm text-text-3">Cargando…</p>;
  }
  if (status === "unsupported") {
    return (
      <p className="text-sm text-text-3">
        Tu navegador no soporta notificaciones push. Usá Chrome/Edge (Android) o
        Safari en una PWA instalada (iOS 16.4+).
      </p>
    );
  }
  if (status === "denied") {
    return (
      <p className="text-sm text-text-3">
        Notificaciones bloqueadas. Habilitalas en la configuración del navegador y
        recargá.
      </p>
    );
  }

  return (
    <button
      onClick={() => void (status === "on" ? unsubscribe() : subscribe())}
      disabled={busy}
      className="flex w-full items-center gap-2 rounded-sm border px-3 py-2 text-sm font-medium text-text-2 hover:bg-accent disabled:opacity-50"
    >
      {status === "on" ? (
        <Bell className="h-4 w-4 text-brand" strokeWidth={1.7} />
      ) : (
        <BellOff className="h-4 w-4" strokeWidth={1.7} />
      )}
      {status === "on"
        ? "Notificaciones de handoff activadas"
        : "Activar notificaciones de handoff"}
    </button>
  );
}
