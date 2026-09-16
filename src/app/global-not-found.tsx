import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { Fraunces, Geist } from "next/font/google";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { SITE_NAME, SITE_TAGLINE, WHATSAPP_HREF } from "@/content/lamasfood";
import { isAdminHost, isInfrastructureHost, normalizeHost } from "@/lib/hosts";
import "./globals.css";

/**
 * 404 global de la instancia (007).
 *
 * Existe porque la app tiene DOS root layouts (el CRM y la web pública) y por lo
 * tanto ningún `app/layout.tsx` único: un `not-found.tsx` de segmento solo cubre
 * los `notFound()` que dispara ese segmento, no las URLs que no matchean ninguna
 * ruta. Para esas, Next usaba su 404 interno, que sin layout salía sin marca.
 *
 * `global-not-found` se resuelve a nivel de ROUTING y no depende de layouts, así
 * que se renderiza entero desde acá — incluidos `<html>` y `<body>`. Es la razón
 * por la que este archivo declara el documento completo en vez de reusar un
 * layout.
 *
 * El host decide qué 404 mostrar: en el dominio público sale la web de la marca
 * (con su header y footer); en el subdominio de gestión, una página sobria con
 * salida al CRM. Nunca se cruzan.
 */
export const metadata: Metadata = {
  title: "Página no encontrada",
  robots: { index: false, follow: false },
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export default async function GlobalNotFound() {
  const headerList = await headers();
  const host = normalizeHost(
    headerList.get("x-forwarded-host") ?? headerList.get("host")
  );
  const isCrm = isAdminHost(host) || isInfrastructureHost(host);

  return (
    <html lang="es" className={`${geist.variable} ${display.variable}`}>
      <body className="site font-sans antialiased">
        {isCrm ? <CrmNotFound /> : <PublicNotFound />}
      </body>
    </html>
  );
}

/** 404 de la web pública: misma marca, mismos caminos de salida. */
function PublicNotFound() {
  return (
    <>
      <SiteHeader />
      <main
        id="contenido"
        className="mx-auto flex max-w-2xl flex-col items-start px-4 py-28"
      >
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
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * 404 del CRM: sobrio y sin la marca de la web pública. Enlaza a la bandeja,
 * que es la raíz del subdominio de gestión.
 */
function CrmNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center px-6">
      <p className="text-xs font-medium uppercase tracking-widest text-text-3">
        Error 404
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-foreground">
        Esta página no existe
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-text-2">
        Revise la dirección o vuelva a la bandeja para seguir trabajando.
      </p>
      <Link
        href="/inbox"
        className="mt-7 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand-hover"
      >
        Ir a la bandeja
      </Link>
      <p className="mt-10 text-xs text-text-4">
        {SITE_NAME} · {SITE_TAGLINE}
        {" · "}
        <a
          href={WHATSAPP_HREF}
          rel="noopener noreferrer"
          target="_blank"
          className="underline underline-offset-4"
        >
          Pedidos por WhatsApp
        </a>
      </p>
    </main>
  );
}
