import Image from "next/image";
import {
  PRODUCT_PLACEHOLDER,
  productDescription,
  whatsappHref,
} from "@/content/lamasfood";
import {
  groupByMasa,
  type CatalogGroup,
  type SiteProduct,
} from "@/lib/catalog-public";

/**
 * Tarjeta de un producto del catálogo público.
 *
 * Un "producto" agrupa sus variantes (masa × formato), que es como el negocio
 * realmente lo vende. Las variantes se muestran agrupadas POR MASA: la masa se
 * nombra una vez y debajo van sus formatos, en vez de repetirla en cada línea.
 * Sin foto cargada se usa el placeholder local: la tarjeta nunca queda con un
 * hueco roto.
 *
 * NO muestra precios, a propósito. El catálogo público presenta el producto y
 * deriva la cotización al agente por WhatsApp: el precio se negocia en la
 * conversación, no se publica. Por eso la tarjeta muestra una descripción y las
 * variantes, y el único camino al precio es el CTA.
 */
export function ProductCard({
  group,
  headingLevel = 3,
}: {
  group: CatalogGroup<SiteProduct>;
  /**
   * Nivel del encabezado. En la landing la tarjeta cuelga de un `h2` (sección
   * "Lo que horneamos"), así que va `h3`. En `/catalogo` el único encabezado
   * superior es el `h1` de la página, así que va `h2`: si no, la jerarquía
   * salta un nivel (h1 → h3), que es un problema de accesibilidad y de SEO.
   */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const { producto, imagen, variants } = group;
  const hasImage = Boolean(imagen);
  const masas = groupByMasa(variants);

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-site-border bg-site-panel">
      <div className="relative aspect-[4/3] overflow-hidden bg-site-topbar">
        <Image
          src={imagen ?? PRODUCT_PLACEHOLDER}
          alt={hasImage ? `${producto}, pan artesanal` : ""}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      </div>

      <div className="flex flex-1 flex-col p-5">
        <Heading className="font-display text-xl font-semibold text-site-text">
          {producto}
        </Heading>

        <p className="mt-3 text-sm leading-relaxed text-site-muted">
          {productDescription(producto)}
        </p>

        <ul className="mt-5 flex-1 divide-y divide-site-border border-y border-site-border">
          {masas.map(({ masa, variants: formatos }) => (
            <li key={masa} className="py-3">
              <p className="text-sm font-medium text-site-text">{masa}</p>
              <ul className="mt-1.5 space-y-1">
                {formatos.map((variant) => (
                  <li
                    key={variant.formato}
                    className="text-xs leading-relaxed text-site-muted"
                  >
                    {variant.formato} · {variant.unidadesPorBolsa} un. por bolsa
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        <a
          href={whatsappHref(`Hola LamasFoods, quiero consultar por ${producto}.`)}
          rel="noopener noreferrer"
          target="_blank"
          className="mt-5 inline-flex items-center justify-center rounded-full border border-site-accent px-5 py-2.5 text-sm font-medium text-site-accent transition-colors hover:bg-site-accent hover:text-site-panel"
        >
          Consultar por {producto}
        </a>
      </div>
    </article>
  );
}
