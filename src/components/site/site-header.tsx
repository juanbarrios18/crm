import Link from "next/link";
import {
  CONTACT,
  NAV,
  SITE_NAME,
  SITE_TAGLINE,
  WHATSAPP_HREF,
} from "@/content/lamasfood";

/** Espiga de trigo: marca gráfica del sitio, sin depender de una imagen. */
function WheatMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21V8" />
      <path d="M12 8c0-2 1.4-3.6 3.2-4-.2 2-1.4 3.5-3.2 4Z" />
      <path d="M12 8c0-2-1.4-3.6-3.2-4 .2 2 1.4 3.5 3.2 4Z" />
      <path d="M12 12.5c0-2 1.4-3.6 3.2-4-.2 2-1.4 3.5-3.2 4Z" />
      <path d="M12 12.5c0-2-1.4-3.6-3.2-4 .2 2 1.4 3.5 3.2 4Z" />
      <path d="M12 17c0-2 1.4-3.6 3.2-4-.2 2-1.4 3.5-3.2 4Z" />
      <path d="M12 17c0-2-1.4-3.6-3.2-4 .2 2 1.4 3.5 3.2 4Z" />
    </svg>
  );
}

/**
 * Cabecera de la web pública.
 *
 * Server component a propósito: el menú se resuelve con CSS (flex + scroll
 * horizontal en móvil), así que la navegación funciona sin JavaScript.
 */
export function SiteHeader() {
  return (
    <header>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-site-accent focus:px-4 focus:py-2 focus:text-sm focus:text-site-panel"
      >
        Saltar al contenido
      </a>

      {/* Barra de utilidad: solo en pantallas con espacio. */}
      <div className="hidden bg-site-topbar sm:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 text-xs text-site-muted">
          <p>Pan artesanal al por mayor para negocios de comida y cadenas.</p>
          <div className="flex items-center gap-4">
            <a
              href={`tel:${CONTACT.phoneDisplay.replace(/\s/g, "")}`}
              className="transition-colors hover:text-site-text"
            >
              {CONTACT.phoneDisplay}
            </a>
            <a
              href={CONTACT.instagram}
              rel="noopener noreferrer"
              target="_blank"
              className="transition-colors hover:text-site-text"
            >
              Instagram
            </a>
            <a
              href={CONTACT.facebook}
              rel="noopener noreferrer"
              target="_blank"
              className="transition-colors hover:text-site-text"
            >
              Facebook
            </a>
          </div>
        </div>
      </div>

      <div className="border-b border-site-border bg-site-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label={`${SITE_NAME} — inicio`}
          >
            <WheatMark className="h-8 w-8 text-site-accent" />
            <span className="flex flex-col leading-none">
              <span className="font-display text-2xl font-semibold tracking-tight text-site-text">
                {SITE_NAME}
              </span>
              <span className="mt-1 text-[0.6875rem] uppercase tracking-[0.18em] text-site-muted">
                {SITE_TAGLINE}
              </span>
            </span>
          </Link>

          <nav
            aria-label="Navegación principal"
            className="order-3 -mx-4 w-full overflow-x-auto px-4 lg:order-none lg:mx-0 lg:w-auto lg:flex-1 lg:overflow-visible lg:px-0"
          >
            <ul className="flex items-center gap-6 text-sm font-medium lg:justify-center">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="whitespace-nowrap text-site-text/80 transition-colors hover:text-site-accent"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <a
            href={WHATSAPP_HREF}
            rel="noopener noreferrer"
            target="_blank"
            className="ml-auto shrink-0 rounded-full bg-site-accent px-5 py-2.5 text-sm font-medium text-site-panel transition-colors hover:bg-site-accent-hover"
          >
            Pedir ahora
          </a>
        </div>
      </div>
    </header>
  );
}
