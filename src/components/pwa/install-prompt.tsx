"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * 006 — Botón "Instalar app".
 * Chromium: captura `beforeinstallprompt` y dispara el prompt nativo. iOS/Safari:
 * no permite instalar por botón, así que muestra la guía "Compartir → Agregar a
 * pantalla de inicio" (requisito para habilitar el push en iPhone).
 */
export function InstallPrompt() {
  const [mounted, setMounted] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    setMounted(true);
    const ua = window.navigator.userAgent;
    setIsIos(
      /iphone|ipad|ipod/i.test(ua) ||
        (ua.includes("Mac") && "ontouchend" in document)
    );
    setInstalled(
      window.matchMedia("(display-mode: standalone)").matches
    );

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setDeferred(null);
    }
  }, [deferred]);

  // Sin render hasta el mount (evita hydration mismatch) y nada si ya instalada
  // o si no hay prompt disponible ni es iOS.
  if (!mounted || installed) return null;
  if (!deferred && !isIos) return null;

  return (
    <div className="space-y-2">
      {deferred ? (
        <button
          onClick={() => void install()}
          className="flex w-full items-center gap-2 rounded-sm border px-3 py-2 text-sm font-medium text-text-2 hover:bg-accent"
        >
          <Download className="h-4 w-4" strokeWidth={1.7} />
          Instalar app
        </button>
      ) : (
        <div className="flex items-start gap-2 rounded-sm border bg-secondary p-3 text-xs text-text-2">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <span>
            En iPhone/iPad: toca <strong>Compartir</strong> (cuadrado con flecha
            hacia arriba) y luego{" "}
            <strong>Agregar a pantalla de inicio</strong>. Instalarla habilita las
            notificaciones.
          </span>
        </div>
      )}
    </div>
  );
}
