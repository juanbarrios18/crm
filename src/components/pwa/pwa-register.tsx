"use client";

import { useEffect } from "react";

/**
 * 006 — Registra el service worker de la PWA (una vez por sesión).
 * No pinta nada; solo hace el registro en el navegador.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.error("[pwa] registro del SW falló:", err));
  }, []);
  return null;
}
