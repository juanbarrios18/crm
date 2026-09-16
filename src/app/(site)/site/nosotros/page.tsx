import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/site/json-ld";
import { NOSOTROS, SEO, SITE_NAME, WHATSAPP_HREF } from "@/content/lamasfood";

/**
 * Página "Nosotros".
 *
 * Vive aparte de la landing a propósito: la portada existe para poner en valor
 * el producto, y contar quién está detrás distrae de eso. La portada vende lo
 * que horneamos; acá se cuenta quién lo hornea.
 *
 * Server component puro: sin estado ni cliente. La URL pública es
 * `/nosotros` — el middleware del host público reescribe internamente
 * `/nosotros` → `/site/nosotros`, igual que el resto del sitio.
 */

export const metadata: Metadata = {
  title: SEO.nosotrosTitle,
  description: SEO.nosotrosDescription,
  alternates: { canonical: "/nosotros" },
  openGraph: {
    title: `${SEO.nosotrosTitle} · ${SITE_NAME}`,
    description: SEO.nosotrosDescription,
    url: "/nosotros",
  },
};

/** La empresa como página, más específico que el `Bakery` del layout. */
const ABOUT_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: SEO.nosotrosTitle,
  description: SEO.nosotrosDescription,
};

export default function NosotrosPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
      <header className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-site-muted">
          {NOSOTROS.eyebrow}
        </p>
        <h1 className="mt-4 font-display text-4xl font-semibold text-site-text sm:text-5xl">
          {NOSOTROS.title}
        </h1>
      </header>

      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-16">
        <div className="space-y-6">
          {NOSOTROS.body.map((paragraph) => (
            <p
              key={paragraph}
              className="text-base leading-relaxed text-site-muted sm:text-lg"
            >
              {paragraph}
            </p>
          ))}
        </div>

        <aside className="h-fit rounded-2xl border border-site-border bg-site-panel p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold text-site-text">
            ¿Armamos su pedido?
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-site-muted">
            Cuéntenos qué necesita y le cotizamos por WhatsApp, según el volumen y
            la frecuencia de entrega.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <a
              href={WHATSAPP_HREF}
              rel="noopener noreferrer"
              target="_blank"
              className="inline-flex items-center justify-center rounded-full bg-site-accent px-6 py-3 text-sm font-medium text-site-panel transition-colors hover:bg-site-accent-hover"
            >
              Pedir por WhatsApp
            </a>
            <Link
              href="/catalogo"
              className="inline-flex items-center justify-center rounded-full border border-site-border px-6 py-3 text-sm font-medium text-site-text transition-colors hover:border-site-accent hover:text-site-accent"
            >
              Ver catálogo
            </Link>
          </div>
        </aside>
      </div>

      <JsonLd data={ABOUT_JSON_LD} />
    </div>
  );
}
