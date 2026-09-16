import Link from "next/link";
import {
  CONTACT,
  NAV,
  SITE_NAME,
  SITE_TAGLINE,
  WHATSAPP_HREF,
} from "@/content/lamasfood";

/**
 * Pie de la web pública.
 *
 * No enlaza al subdominio de administración a propósito: no hay razón para
 * publicitar la superficie de gestión en el sitio indexable.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer id="contacto" className="mt-24 border-t border-site-border bg-site-topbar/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="font-display text-xl font-semibold text-site-text">
            {SITE_NAME}
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-site-muted">
            {SITE_TAGLINE}
          </p>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-site-muted">
            Pan artesanal al por mayor, horneado todos los días para negocios
            que viven de su vitrina.
          </p>
        </div>

        <nav aria-label="Navegación del pie">
          <h2 className="text-sm font-semibold text-site-text">Sitio</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-site-muted transition-colors hover:text-site-accent"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="text-sm font-semibold text-site-text">Contacto</h2>
          <address className="mt-4 space-y-2.5 text-sm not-italic text-site-muted">
            <p>{CONTACT.address}</p>
            <p>
              <a
                href={`tel:${CONTACT.phoneDisplay.replace(/\s/g, "")}`}
                className="transition-colors hover:text-site-accent"
              >
                {CONTACT.phoneDisplay}
              </a>
            </p>
            <p>
              <a
                href={`mailto:${CONTACT.email}`}
                className="transition-colors hover:text-site-accent"
              >
                {CONTACT.email}
              </a>
            </p>
          </address>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-site-text">Horario</h2>
          <p className="mt-4 text-sm text-site-muted">{CONTACT.hours}</p>
          <a
            href={WHATSAPP_HREF}
            rel="noopener noreferrer"
            target="_blank"
            className="mt-4 inline-block rounded-full bg-site-accent px-5 py-2.5 text-sm font-medium text-site-panel transition-colors hover:bg-site-accent-hover"
          >
            Pedir por WhatsApp
          </a>
        </div>
      </div>

      <div className="border-t border-site-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-site-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {SITE_NAME}. Todos los derechos reservados.
          </p>
          {/* Antes decía "Precios en pesos chilenos. IVA incluido donde se
              indica.": la web ya no publica precios, así que esa línea mentía.
              REEMPLAZAR si el negocio prefiere otro texto. */}
          <p>Precios y disponibilidad: consultar por WhatsApp.</p>
        </div>
      </div>
    </footer>
  );
}
