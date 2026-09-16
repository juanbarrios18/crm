import type { Metadata, Viewport } from "next";
import { Fraunces, Geist } from "next/font/google";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import {
  CONTACT,
  SEO,
  SITE_NAME,
  SITE_TAGLINE,
} from "@/content/lamasfood";
import { publicBaseUrl } from "@/lib/hosts";
import { JsonLd } from "@/components/site/json-ld";
import "../../globals.css";

/**
 * Root layout de la web pública (007).
 *
 * Este grupo NO comparte el layout del CRM: ese declara `force-dynamic`, lee el
 * branding de la base y arma metadatos de "sistema de gestión". Servir la web
 * pública desde ahí significaría pagar una consulta por request y filtrar el
 * título del CRM a los buscadores. Next.js permite varios root layouts si no
 * existe un `app/layout.tsx` único.
 *
 * `next/font` descarga las fuentes en BUILD y las sirve self-hosted: sin CDN en
 * runtime (Constitución II).
 */
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f1e8",
};

export const metadata: Metadata = {
  metadataBase: new URL(publicBaseUrl()),
  title: {
    default: SEO.defaultTitle,
    template: `%s · ${SITE_NAME}`,
  },
  description: SEO.defaultDescription,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    locale: "es_CL",
    siteName: SITE_NAME,
    title: SEO.defaultTitle,
    description: SEO.defaultDescription,
    images: [
      {
        url: SEO.ogImage,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — ${SITE_TAGLINE}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO.defaultTitle,
    description: SEO.defaultDescription,
    images: [SEO.ogImage],
  },
  /*
   * TEMPORAL: `noindex` hasta que el negocio confirme los datos de contacto.
   *
   * El sitio está publicado con `CONTACT` en placeholder (teléfono, WhatsApp,
   * dirección y correo falsos), así que indexarlo dejaría en Google un teléfono
   * que no existe. Volver a `{ index: true, follow: true }` cuando esos datos
   * estén reales y verificados.
   *
   * Se resuelve con el meta tag y NO tocando `robots.txt`, a propósito: para que
   * Google respete un `noindex` tiene que poder ENTRAR a la página. Si se bloquea
   * el crawl, el buscador nunca lee la directiva y —si la URL ya era conocida—
   * queda como "indexada aunque bloqueada por robots.txt", que es peor que no
   * hacer nada. Por eso `src/app/robots.ts` sigue con `Allow: /`.
   *
   * El `sitemap.xml` también queda como está: lista URLs que ahora responden
   * `noindex`, y Google prioriza el `noindex`. Vaciar el sitemap no agrega
   * protección y rompería el invariante que verifica el E2E.
   */
  robots: { index: false, follow: false },
};

/** La panadería como entidad: se declara una vez y aplica a todo el sitio. */
const BUSINESS_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Bakery",
  name: SITE_NAME,
  description: SEO.defaultDescription,
  url: publicBaseUrl(),
  image: `${publicBaseUrl()}${SEO.ogImage}`,
  telephone: CONTACT.phoneDisplay,
  email: CONTACT.email,
  address: {
    "@type": "PostalAddress",
    streetAddress: CONTACT.address,
    addressCountry: "CL",
  },
  openingHours: CONTACT.hoursSchema,
  priceRange: "$$",
};

export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /*
   * `scroll-pt-*`: el header es sticky, así que al saltar a un ancla
   * (`/#contacto`) el destino quedaba TAPADO por el header. `scroll-padding-top`
   * corre la posición de scroll de TODOS los saltos de ancla, y va en el
   * elemento que scrollea (`<html>`), no en cada ancla — así no hay que
   * acordarse de tocar cada `id` que se agregue.
   *
   * Los valores salen de medir el header: 73px en móvil y 112px desde `sm`
   * (barra de utilidad 32 + barra principal 80). Si el header cambia de alto,
   * estos dos números se actualizan.
   */
  return (
    <html
      lang="es"
      className={`${geist.variable} ${display.variable} scroll-pt-20 sm:scroll-pt-32`}
    >
      <body className="site font-sans antialiased">
        <JsonLd data={BUSINESS_JSON_LD} />
        <SiteHeader />
        <main id="contenido">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
