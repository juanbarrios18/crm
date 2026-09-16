import { unstable_cache } from "next/cache";
import {
  CATALOG_TAG,
  toSiteProduct,
  type SiteProduct,
} from "@/lib/catalog-public";
import { getActiveProductsPublic } from "@/server/catalog/queries";
import { resolveInstanceOrg } from "@/server/bot/auth";

/**
 * Lectura del catálogo para la web pública.
 *
 * Por qué caché de datos y no `export const revalidate` (página estática):
 * `pnpm build` corre SIN base de datos (los secretos llegan en runtime, ver
 * Dockerfile y src/lib/env.ts). Un prerender que consulte la BD rompería el
 * build, y un prerender con fallback vacío serviría el catálogo vacío hasta la
 * primera revalidación — inaceptable en un deploy nuevo.
 *
 * Entonces: la página se renderiza en el servidor y la CONSULTA se cachea. La
 * BD se toca como máximo una vez por ventana, el HTML sale con `Cache-Control`
 * agresivo (lo sirve el reverse proxy) y el primer request tras un deploy ya
 * trae datos reales.
 */

/** Tag de la caché del catálogo. El admin lo invalida al mutar productos. */
export { CATALOG_TAG };

const REVALIDATE_SECONDS = 3600;

/**
 * La caché guarda la proyección DEL SITIO (sin precios), no la pública: así el
 * precio no entra nunca al árbol de la web y no puede terminar serializado en
 * el HTML. La clave va versionada porque cambió la forma de lo cacheado.
 */
const cachedCatalog = unstable_cache(
  async (organizationId: string) =>
    (await getActiveProductsPublic(organizationId)).map(toSiteProduct),
  ["site-catalog-v2"],
  { revalidate: REVALIDATE_SECONDS, tags: [CATALOG_TAG] }
);

/**
 * Productos activos de la instancia, para la web pública.
 *
 * Devuelve la proyección del sitio, SIN precios: la web no los publica y el
 * dato no debe llegar al navegador ni siquiera como prop.
 *
 * Nunca lanza: si la BD no responde, la web degrada al estado vacío (con su
 * mensaje y su CTA) en vez de devolverle un 500 al visitante.
 */
export async function getSiteCatalog(): Promise<SiteProduct[]> {
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return [];

  try {
    return await cachedCatalog(organizationId);
  } catch (err) {
    console.error("[site] no se pudo leer el catálogo público:", err);
    return [];
  }
}

/**
 * La agrupación vive en `@/lib/catalog-public`: es lógica pura y ahí se puede
 * testear sin levantar Next (este módulo importa `unstable_cache` y la base).
 * Se re-exporta para que las páginas del sitio tengan un solo punto de import.
 */
export { groupByMasa, groupCatalog } from "@/lib/catalog-public";
export type {
  CatalogGroup,
  MasaGroup,
  SiteProduct,
} from "@/lib/catalog-public";
