/**
 * Contrato compartido entre el catálogo público y su consumo.
 *
 * Vive en `lib` (y no en un módulo de servidor) porque lo importan tanto las
 * rutas del admin que mutan productos como el módulo de lectura del sitio: es
 * el punto único donde se define cómo se referencia una foto pública.
 */

/**
 * Tag de la caché de datos del catálogo del sitio.
 *
 * El admin lo invalida al mutar un producto (`revalidateTag`), así que un
 * cambio de precio o de foto se ve sin esperar la ventana de revalidación.
 */
export const CATALOG_TAG = "site-catalog";

/**
 * Prefijo público con el que se sirve la foto de un producto.
 * `product.imagen` guarda `<prefijo>/<assetId>`; el asset vive en `MEDIA_DIR`.
 */
export const CATALOG_PUBLIC_MEDIA_PREFIX = "/api/public/media";

/** Subconjunto de `PublicProduct` que necesita la agrupación del catálogo. */
export type GroupableProduct = {
  producto: string;
  masa: string;
  formato: string;
  imagen: string | null;
};

export type CatalogGroup<T extends GroupableProduct = GroupableProduct> = {
  /** Nombre comercial que agrupa las variantes. */
  producto: string;
  /** Foto del grupo: la primera variante que tenga una cargada. */
  imagen: string | null;
  variants: T[];
};

/**
 * Producto tal como lo consume la web pública: la proyección pública MENOS los
 * precios (y menos `notas` y `activo`, que la web no renderiza).
 *
 * Por qué existe este tipo y no alcanza con no pintar el precio: Next serializa
 * en el HTML los props de los componentes de servidor (payload RSC). Si el
 * precio llega como prop, termina en el código fuente de la página aunque la
 * ficha no lo muestre, y un `view-source` o un scraper se lo lleva. La única
 * forma de que no se filtre es que el dato NUNCA llegue: por eso el catálogo del
 * sitio se proyecta con lista blanca en vez de reusar `PublicProduct`.
 *
 * OJO: esto NO toca `GET /api/public/products`, que por contrato de la feature
 * 005 sigue devolviendo la proyección pública completa, con precios.
 */
export type SiteProduct = GroupableProduct & { unidadesPorBolsa: number };

/** Proyecta un producto público a lo que la web realmente necesita. */
export function toSiteProduct(product: {
  producto: string;
  masa: string;
  formato: string;
  unidadesPorBolsa: number;
  imagen: string | null;
}): SiteProduct {
  return {
    producto: product.producto,
    masa: product.masa,
    formato: product.formato,
    unidadesPorBolsa: product.unidadesPorBolsa,
    imagen: product.imagen,
  };
}

/**
 * Agrupa variantes (masa × formato) por producto, que es como el negocio
 * realmente vende y como conviene mostrarlo en la web.
 *
 * No re-ordena: `getActiveProductsPublic` ya entrega ordenado por producto y
 * masa, así que el orden de entrada se conserva.
 */
export function groupCatalog<T extends GroupableProduct>(
  products: readonly T[]
): CatalogGroup<T>[] {
  const groups = new Map<string, CatalogGroup<T>>();

  for (const product of products) {
    let group = groups.get(product.producto);
    if (!group) {
      group = { producto: product.producto, imagen: null, variants: [] };
      groups.set(product.producto, group);
    }
    group.variants.push(product);
    if (!group.imagen && product.imagen) group.imagen = product.imagen;
  }

  return [...groups.values()];
}

/** Las variantes de un producto, agrupadas por masa. */
export type MasaGroup<T extends { masa: string }> = {
  masa: string;
  /** Formatos de esa masa, en el orden en que llegaron. */
  variants: T[];
};

/**
 * Agrupa las variantes de un producto por masa.
 *
 * Por qué: la ficha listaba "Brioche 12 cm · Brioche 11 cm · Brioche 9 cm…" y
 * repetía la masa en cada línea. Agrupado, la masa se dice una vez y debajo van
 * sus formatos: menos ruido y la comparación entre formatos queda a la vista.
 *
 * La masa se toma tal cual viene de la base (misma decisión que `groupCatalog`
 * con el producto): normalizar acá escondería un dato sucio en vez de mostrarlo.
 * El orden de entrada se conserva, y la query ya entrega ordenado por
 * producto y masa, así que el resultado es determinista.
 */
export function groupByMasa<T extends { masa: string }>(
  variants: readonly T[]
): MasaGroup<T>[] {
  const groups = new Map<string, MasaGroup<T>>();

  for (const variant of variants) {
    let group = groups.get(variant.masa);
    if (!group) {
      group = { masa: variant.masa, variants: [] };
      groups.set(variant.masa, group);
    }
    group.variants.push(variant);
  }

  return [...groups.values()];
}
