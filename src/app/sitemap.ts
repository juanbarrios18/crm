import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isAdminHost, normalizeHost, publicBaseUrl } from "@/lib/hosts";

/**
 * `sitemap.xml` por host: solo la web pública tiene contenido indexable. En el
 * subdominio de gestión devuelve una lista vacía a propósito.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const headerList = await headers();
  const host = normalizeHost(
    headerList.get("x-forwarded-host") ?? headerList.get("host")
  );

  if (isAdminHost(host)) return [];

  const base = publicBaseUrl();
  const now = new Date();

  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/catalogo`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${base}/nosotros`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
