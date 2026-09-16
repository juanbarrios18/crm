import type { Metadata } from "next";
import { ProductCard } from "@/components/site/product-card";
import { JsonLd } from "@/components/site/json-ld";
import { CATALOG_COPY, SEO, SITE_NAME } from "@/content/lamasfood";
import { getSiteCatalog, groupCatalog } from "@/server/site/catalog";

/** Lee el catálogo de la base → no se puede prerenderizar (ver plan.md). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: CATALOG_COPY.title,
  description: SEO.catalogDescription,
  alternates: { canonical: "/catalogo" },
  openGraph: {
    title: `${CATALOG_COPY.title} · ${SITE_NAME}`,
    description: SEO.catalogDescription,
    url: "/catalogo",
  },
};

export default async function CatalogPage() {
  const products = await getSiteCatalog();
  const groups = groupCatalog(products);

  /**
   * Sin `offers`: el catálogo NO publica precios (los cotiza el agente por
   * WhatsApp). Dejar acá un `Offer` con precio sería filtrar la lista de precios
   * a Google y a cualquier scraper —más visible que en la ficha, no menos—, y
   * un `Offer` sin precio es un dato estructurado inválido para rich results.
   * Si algún día el precio vuelve a la web, este es el punto a restaurar.
   */
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: SEO.catalogTitle,
    numberOfItems: groups.length,
    itemListElement: groups.map((group, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        name: group.producto,
        category: "Panadería",
      },
    })),
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
      <header className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-site-muted">
          {CATALOG_COPY.eyebrow}
        </p>
        <h1 className="mt-4 font-display text-4xl font-semibold text-site-text sm:text-5xl">
          {CATALOG_COPY.title}
        </h1>
        <p className="mt-5 text-base leading-relaxed text-site-muted">
          {CATALOG_COPY.intro}
        </p>
      </header>

      {groups.length > 0 ? (
        <>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <ProductCard key={group.producto} group={group} headingLevel={2} />
            ))}
          </div>
          <JsonLd data={itemListJsonLd} />
        </>
      ) : (
        <div className="mt-14 max-w-xl rounded-2xl border border-site-border bg-site-panel p-8">
          <p className="text-base leading-relaxed text-site-muted">
            {CATALOG_COPY.empty}
          </p>
          <a
            href={CATALOG_COPY.emptyCta.href}
            rel="noopener noreferrer"
            target="_blank"
            className="mt-6 inline-flex rounded-full bg-site-accent px-6 py-2.5 text-sm font-medium text-site-panel transition-colors hover:bg-site-accent-hover"
          >
            {CATALOG_COPY.emptyCta.label}
          </a>
        </div>
      )}
    </div>
  );
}
