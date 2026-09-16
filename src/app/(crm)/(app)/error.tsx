"use client";

import { useEffect } from "react";

/**
 * Error del CRM (007).
 *
 * Reemplaza la página de error por defecto de Next por una que respeta el
 * chrome de la app y ofrece una salida real. No enlaza a la web pública: son
 * superficies separadas y el admin solo lo conoce quien lo conoce.
 */
export default function CrmError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[crm] error no controlado:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-xs font-medium uppercase tracking-widest text-text-3">
        Algo salió mal
      </p>
      <h1 className="text-xl font-semibold text-foreground">
        No se pudo cargar esta pantalla
      </h1>
      <p className="max-w-md text-sm leading-relaxed text-text-2">
        El error quedó registrado en la consola del servidor. Pruebe de nuevo; si
        persiste, revise los logs del contenedor.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand-hover"
      >
        Reintentar
      </button>
      {error.digest && (
        <p className="mt-2 text-xs text-text-4">
          Referencia: <span className="font-mono">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
