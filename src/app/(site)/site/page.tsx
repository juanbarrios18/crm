import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ProductCard } from "@/components/site/product-card";
import { SiteHero } from "@/components/site/site-hero";
import { JsonLd } from "@/components/site/json-ld";
import {
  CATALOG_COPY,
  GALLERY,
  GALLERY_NOTES,
  SEO,
  VALUE_PROPS,
  VALUE_PROPS_INTRO,
  VALUE_PROPS_TITLE,
  VISIT,
} from "@/content/lamasfood";
import { groupCatalog, getSiteCatalog } from "@/server/site/catalog";

/**
 * La landing lee el catálogo para mostrar productos destacados, y `pnpm build`
 * corre sin base de datos → no se puede prerenderizar. La consulta está cacheada
 * (`getSiteCatalog`) y el HTML se sirve con `Cache-Control` desde el proxy.
 */
export const dynamic = "force-dynamic";

const FEATURED_COUNT = 3;

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function SiteHomePage() {
  const products = await getSiteCatalog();
  const featured = groupCatalog(products).slice(0, FEATURED_COUNT);

  return (
    <>
      <SiteHero />

      {/* ---- Propuesta de valor ---- */}
      {/* Primera sección después del hero: va con menos aire arriba que el
          resto (pt-12 en vez del ritmo pt-20/sm:pt-28 que usan las demás), si
          no la separación con el hero se sumaba y dejaba un hueco muerto. */}
      <section className="mx-auto max-w-6xl px-4 pt-12">
        <div className="mx-auto max-w-2xl text-center">
          <span
            aria-hidden="true"
            className="mx-auto block h-px w-16 bg-site-border"
          />
          <h2 className="mt-8 font-display text-3xl font-semibold text-site-text sm:text-4xl">
            {VALUE_PROPS_TITLE}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-site-muted">
            {VALUE_PROPS_INTRO}
          </p>
        </div>

        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {VALUE_PROPS.map((prop) => (
            <article
              key={prop.title}
              className="flex flex-col overflow-hidden rounded-2xl border border-site-border bg-site-panel"
            >
              <div className="relative aspect-[4/3]">
                <Image
                  src={prop.image}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h3 className="font-display text-xl font-semibold text-site-text">
                  {prop.title}
                </h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-site-muted">
                  {prop.description}
                </p>
                <Link
                  href={prop.cta.href}
                  className="mt-6 inline-flex w-fit rounded-full border border-site-accent px-5 py-2 text-sm font-medium text-site-accent transition-colors hover:bg-site-accent hover:text-site-panel"
                >
                  {prop.cta.label}
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ---- Productos destacados (catálogo real) ---- */}
      <section className="mx-auto max-w-6xl px-4 pt-20 sm:pt-28">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-site-muted">
              {CATALOG_COPY.eyebrow}
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-site-text sm:text-4xl">
              Lo que horneamos
            </h2>
          </div>
          <Link
            href="/catalogo"
            className="rounded-full border border-site-border px-5 py-2.5 text-sm font-medium text-site-text transition-colors hover:border-site-accent hover:text-site-accent"
          >
            Ver catálogo completo
          </Link>
        </div>

        {featured.length > 0 ? (
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((group) => (
              <ProductCard key={group.producto} group={group} />
            ))}
          </div>
        ) : (
          <p className="mt-10 max-w-xl text-base leading-relaxed text-site-muted">
            {CATALOG_COPY.empty}{" "}
            <a
              href={CATALOG_COPY.emptyCta.href}
              rel="noopener noreferrer"
              target="_blank"
              className="font-medium text-site-accent underline underline-offset-4"
            >
              {CATALOG_COPY.emptyCta.label}
            </a>
          </p>
        )}
      </section>

      {/* ---- Visítanos ---- */}
      <section className="mx-auto max-w-6xl px-4 pt-20 sm:pt-28">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-semibold text-site-text sm:text-4xl">
              {VISIT.title}
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-site-muted">
              {VISIT.body}
            </p>
            <a
              href={VISIT.cta.href}
              rel="noopener noreferrer"
              target="_blank"
              className="mt-8 inline-flex rounded-full bg-site-accent px-7 py-3 text-sm font-medium text-site-panel transition-colors hover:bg-site-accent-hover"
            >
              {VISIT.cta.label}
            </a>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {VISIT.images.map((image, index) => (
              <div
                key={image.src}
                className={`relative overflow-hidden rounded-2xl ${
                  index === 0 ? "aspect-[4/5]" : "aspect-[4/5] self-end"
                }`}
              >
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  sizes="(min-width: 1024px) 25vw, 50vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Galería + notas ---- */}
      <section className="mx-auto max-w-6xl px-4 pt-20 sm:pt-28">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {GALLERY.map((image) => (
            <div
              key={image.src}
              className="relative aspect-square overflow-hidden rounded-2xl"
            >
              <Image
                src={image.src}
                alt={image.alt}
                fill
                sizes="(min-width: 1024px) 25vw, 50vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>

        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {GALLERY_NOTES.map((note) => (
            <div key={note.title} className="border-t border-site-border pt-6">
              <h3 className="font-display text-xl font-semibold text-site-text">
                {note.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-site-muted">
                {note.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SEO.defaultTitle,
          url: "/",
        }}
      />
    </>
  );
}
