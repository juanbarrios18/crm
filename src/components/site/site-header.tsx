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

/** Ícono del menú: tres líneas, mismo trazo que la marca. */
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="M3.5 7h17" />
      <path d="M3.5 12h17" />
      <path d="M3.5 17h17" />
    </svg>
  );
}

/** El CTA de WhatsApp: la conversión del sitio, en el header. */
function OrderCta({ className }: { className?: string }) {
  return (
    <a
      href={WHATSAPP_HREF}
      rel="noopener noreferrer"
      target="_blank"
      className={`shrink-0 rounded-full bg-site-accent px-3.5 py-2 text-sm font-medium text-site-panel transition-colors hover:bg-site-accent-hover sm:px-5 sm:py-2.5 ${className ?? ""}`}
    >
      Pedir ahora
    </a>
  );
}

/**
 * Cabecera de la web pública.
 *
 * Server component a propósito: la navegación se resuelve ENTERA con CSS, así
 * que funciona sin JavaScript y no suma hidratación al bundle del sitio.
 *
 * El menú de móvil es un `<details>`/`<summary>`, que es un disclosure nativo:
 * se abre con teclado (Enter/Espacio), lo anuncian los lectores de pantalla y
 * no necesita estado. **Limitación conocida**: `<details>` no se cierra al
 * tocar afuera ni con Escape. Se cierra al navegar (cada enlace recarga la
 * página) o tocando el botón otra vez. Cerrarlo al toque afuera exigiría JS, que
 * es justo lo que este componente evita; si algún día pesa más la UX que el
 * peso, ese es el punto a cambiar.
 */
export function SiteHeader() {
  return (
    /*
     * `sticky top-0 z-40`.
     *
     * STICKY: el header acompaña el scroll y queda pegado arriba, en desktop y
     * en móvil. Al ser el propio `<header>` el que se fija (y no un div interno),
     * su bloque contenedor es el `body`, así que se queda pegado durante TODA la
     * página; si se fijara un hijo, dejaría de pegar al salir de la caja del
     * padre.
     *
     * z-40 NO es decorativo: la barra usa `backdrop-blur`, y `backdrop-filter`
     * crea un stacking context propio. Sin elevarlo, el header pinta por debajo
     * del hero (que es `relative isolate`) y el panel del burger —que se
     * despliega hacia abajo, sobre el contenido— queda TAPADO: los clics los
     * intercepta el hero y el menú es inclickeable. Se detectó con un test de
     * Playwright que intenta clickear un enlace del panel.
     */
    <header className="sticky top-0 z-40">
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

      {/*
       * `relative` acá (y NO en el `<details>`) es lo que hace que el panel del
       * menú móvil pueda ocupar el ancho completo: el panel es `absolute
       * inset-x-0`, así que su caja de referencia tiene que ser esta barra, no
       * el botón de 40px del burger.
       */}
      <div className="relative border-b border-site-border bg-site-bg/95 backdrop-blur">
        {/*
         * `gap-x-2` en móvil: el header tiene que entrar en UNA fila (logo +
         * CTA + burger) desde 360px, que es el ancho del teléfono más chico
         * vigente. Medido con Chromium: a 360 sobra con `gap-x-6`, pero a 320 no
         * entra ni con gap cero (los tres ítems solos ya pasan el ancho
         * disponible), así que ahí el header envuelve a dos filas — sin
         * overflow. Es el mismo comportamiento que ya tenía el header viejo en
         * móvil, no una regresión.
         */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-3 px-4 py-4 sm:gap-x-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label={`${SITE_NAME} — inicio`}
          >
            <WheatMark className="h-8 w-8 text-site-accent" />
            <span className="flex flex-col leading-none">
              {/*
               * En móvil el logotipo va compacto: la bajada es lo más ancho del
               * bloque (va en mayúsculas con tracking abierto), y con ella el
               * header no entra en una fila junto al CTA y el burger. Medido:
               * sin la bajada el bloque pasa de 209px a ~150px.
               */}
              <span className="font-display text-lg font-semibold tracking-tight text-site-text sm:text-2xl">
                {SITE_NAME}
              </span>
              <span className="mt-1 hidden text-[0.6875rem] uppercase tracking-[0.18em] text-site-muted sm:block">
                {SITE_TAGLINE}
              </span>
            </span>
          </Link>

          {/* Navegación de escritorio: enlaces en línea, centrados. */}
          <nav
            aria-label="Navegación principal"
            className="hidden lg:flex lg:flex-1 lg:justify-center"
          >
            <ul className="flex items-center gap-6 text-sm font-medium">
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

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <OrderCta />

            {/*
             * Navegación de móvil. Los enlaces se declaran DOS veces (acá y en
             * la lista de escritorio) a propósito: la que no corresponde queda
             * en `display:none`, así que los lectores de pantalla leen una sola
             * y no hay enlaces duplicados anunciados. La alternativa —un solo
             * disclosure que en escritorio se vea abierto— no se puede resolver
             * con CSS, porque el estado `open` no es estilable por breakpoint.
             *
             * Comparte el `aria-label` con la de escritorio a propósito: nunca
             * están las dos visibles, así que el lector de pantalla ve un solo
             * landmark de navegación.
             */}
            <nav aria-label="Navegación principal" className="lg:hidden">
              <details>
                <summary className="inline-flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-site-border text-site-text transition-colors hover:border-site-accent hover:text-site-accent [&::-webkit-details-marker]:hidden">
                  <span className="sr-only">Abrir menú</span>
                  <MenuIcon className="h-5 w-5" />
                </summary>

                {/*
                 * Panel a ancho completo y pegado debajo de la barra: sin bordes
                 * redondeados, para que se lea como una extensión del navbar y no
                 * como una tarjeta flotante. Fondo `site-bg` (crema, el mismo del
                 * sitio) — con `site-panel` quedaba casi blanco y desentonaba.
                 *
                 * `mt-px`: `top-full` se resuelve contra la PADDING box del
                 * contenedor, así que sin ese pixel el panel arrancaba encima del
                 * `border-b` del navbar y se comía el separador entre la barra y
                 * el menú (medido: panel.top 72 vs barra.bottom 73).
                 *
                 * La transición de apertura la da `.site-menu` desde
                 * `globals.css` (ver ahí por qué es `animation` y no `transition`).
                 */}
                <ul className="site-menu absolute inset-x-0 top-full z-50 mt-px border-b border-site-border bg-site-bg/95 py-1 shadow-lg backdrop-blur">
                  {NAV.map((item) => (
                    <li key={item.href}>
                      {/*
                       * `<a>` y no `<Link>` a propósito. Con `<Link>` Next navega
                       * del lado del cliente, el layout NO se desmonta y el
                       * `<details>` queda abierto tapando la página nueva. El
                       * estado `open` no es estilable ni reseteable por CSS, así
                       * que la única forma de cerrarlo sin JS es una navegación
                       * de verdad. Cuesta el prefetch y el cambio de ruta
                       * instantáneo en móvil; a cambio el menú se cierra solo al
                       * tocar un enlace. En escritorio la nav no tiene estado que
                       * resetear, así que ahí sí va `<Link>`.
                       */}
                      <a
                        href={item.href}
                        className="block px-6 py-3.5 text-center text-lg font-semibold text-site-text/80 transition-colors hover:bg-site-topbar/70 hover:text-site-accent"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
