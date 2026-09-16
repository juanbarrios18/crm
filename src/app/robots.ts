import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isAdminHost, normalizeHost, publicBaseUrl } from "@/lib/hosts";

/**
 * `robots.txt` por host.
 *
 * El sitio público se indexa; el subdominio de gestión NO debe aparecer en
 * buscadores (bandeja, contactos y pipeline no son contenido público). Es la
 * ruta dinámica que reemplaza al `public/robots.txt` estático que bloqueaba
 * todo el dominio.
 */
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headerList = await headers();
  const host = normalizeHost(
    headerList.get("x-forwarded-host") ?? headerList.get("host")
  );

  if (isAdminHost(host)) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  const base = publicBaseUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
