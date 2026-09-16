"use client";

import { useEffect } from "react";
import Link from "next/link";
import { WHATSAPP_HREF } from "@/content/lamasfood";

/**
 * Error de la web pública (007).
 *
 * Sin este archivo, un 500 en el sitio cae en la página de error pelada de Next
 * —sin header, sin footer, sin marca— o en el overlay de desarrollo. Acá el
 * visitante ve una página de la marca con salidas reales, y nunca se lo manda
 * al CRM: el admin es una superficie aparte que solo conoce quien la conoce.
 *
 * El detalle técnico no se muestra al visitante; sí va a la consola para poder
 * diagnosticarlo.
 */
export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[site] error no controlado:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-4 py-28">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-site-muted">
        Algo salió mal
      </p>
      <h1 className="mt-4 font-display text-4xl font-semibold text-site-text sm:text-5xl">
        No pudimos cargar esta página
      </h1>
      <p className="mt-5 text-base leading-relaxed text-site-muted">
        Fue un problema de nuestro lado, no tuyo. Probá de nuevo en un momento
        o escribinos y lo resolvemos.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-site-accent px-6 py-2.5 text-sm font-medium text-site-panel transition-colors hover:bg-site-accent-hover"
        >
          Reintentar
        </button>
        <Link
          href="/"
          className="rounded-full border border-site-border px-6 py-2.5 text-sm font-medium text-site-text transition-colors hover:border-site-accent hover:text-site-accent"
        >
          Volver al inicio
        </Link>
        <a
          href={WHATSAPP_HREF}
          rel="noopener noreferrer"
          target="_blank"
          className="rounded-full border border-site-border px-6 py-2.5 text-sm font-medium text-site-text transition-colors hover:border-site-accent hover:text-site-accent"
        >
          Escribirnos
        </a>
      </div>
      {error.digest && (
        <p className="mt-8 text-xs text-site-muted">
          Código de referencia: <span className="font-mono">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
