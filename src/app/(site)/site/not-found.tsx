import Link from "next/link";

/**
 * 404 de la web pública.
 *
 * Con varios root layouts cada grupo declara el suyo: si no, un 404 en el
 * dominio público podría caer en el layout del CRM.
 */
export default function SiteNotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-4 py-28">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-site-muted">
        Error 404
      </p>
      <h1 className="mt-4 font-display text-4xl font-semibold text-site-text sm:text-5xl">
        No encontramos esta página
      </h1>
      <p className="mt-5 text-base leading-relaxed text-site-muted">
        Puede que el enlace esté viejo o que la página se haya movido. Pruebe
        desde el catálogo.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/catalogo"
          className="rounded-full bg-site-accent px-6 py-2.5 text-sm font-medium text-site-panel transition-colors hover:bg-site-accent-hover"
        >
          Ver catálogo
        </Link>
        <Link
          href="/"
          className="rounded-full border border-site-border px-6 py-2.5 text-sm font-medium text-site-text transition-colors hover:border-site-accent hover:text-site-accent"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
