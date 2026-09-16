import { NextResponse, type NextRequest } from "next/server";
import {
  isAdminHost,
  isInfrastructureHost,
  isLocalHost,
  normalizeHost,
} from "@/lib/hosts";

/**
 * Ruteo por host: una instancia, dos superficies.
 *
 *   raíz del dominio  → web pública de la marca (rutas internas bajo `/site`)
 *   `admin.<dominio>` → CRM (rutas actuales, sin cambios)
 *
 * Las rutas internas del sitio (`/site`, `/site/catalogo`) NO son URLs
 * públicas: en el host público se redirigen a su forma canónica sin prefijo,
 * para no exponer contenido duplicado a los buscadores.
 */

/** Prefijos que se sirven tal cual, en cualquier host. */
const ALWAYS_ALLOWED = [
  "/api/health", // healthcheck del contenedor: jamás debe depender del host
  "/api/public", // catálogo e imágenes públicas que consume la web
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico",
  "/manifest.webmanifest",
];

/** Prefijos de assets del build y de la carpeta pública. */
const ASSET_PREFIXES = ["/_next", "/icons"];

/** true si la ruta parece un archivo (tiene extensión en el último segmento). */
function looksLikeFile(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return last.includes(".");
}

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Ruta interna del sitio público → forma canónica sin prefijo. */
function stripSitePrefix(pathname: string): string {
  const stripped = pathname.replace(/^\/site/, "");
  return stripped.length > 0 ? stripped : "/";
}

/**
 * Marca de reescritura propia.
 *
 * Next.js vuelve a correr el middleware sobre la ruta YA reescrita. Sin esta
 * marca se produce un loop: `/` (host público) se reescribe a `/site`, el
 * middleware entra de nuevo, aplica la regla canónica (`/site` → `/`) y devuelve
 * un 308 hacia `/`, que se vuelve a reescribir… El sitio entero quedaba en un
 * redirect permanente sin servir nunca el HTML.
 */
const INTERNAL_REWRITE_HEADER = "x-site-rewrite";

export function middleware(req: NextRequest) {
  // Segunda pasada sobre una reescritura propia: la ruta ya está resuelta.
  if (req.headers.get(INTERNAL_REWRITE_HEADER) === "1") {
    return NextResponse.next();
  }

  const host = normalizeHost(
    req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  );
  const { pathname } = req.nextUrl;

  // ---- Host del CRM (o de infraestructura) --------------------------------
  // Un host de infraestructura (IP, loopback, nombre interno de Docker) NO es
  // la web pública: se sirve el CRM. Si no, el webhook de WhatsApp y el resto
  // de `/api/*` responderían 404 según con qué Host llegue el request.
  if (isAdminHost(host) || isInfrastructureHost(host)) {
    /*
     * En desarrollo `localhost` ES el host del CRM (APP_BASE_URL apunta ahí y
     * de eso dependen el webhook y los E2E), así que las rutas internas del
     * sitio se dejan pasar para poder previsualizarlo en `/site` sin montar un
     * dominio. En producción el subdominio de gestión no expone el sitio.
     */
    if (!isLocalHost(host) && (pathname === "/site" || pathname.startsWith("/site/"))) {
      return new NextResponse(null, { status: 404 });
    }
    // La raíz del CRM es la bandeja (comportamiento previo a esta feature).
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/inbox";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ---- Host público -------------------------------------------------------

  // Assets y rutas de infraestructura pasan sin tocar. Va ANTES del redirect de
  // `/site` para que `public/site/*.svg` (que se sirve en `/site/x.svg`) no
  // entre en un loop de redirección.
  if (matchesPrefix(pathname, ALWAYS_ALLOWED)) return NextResponse.next();
  if (matchesPrefix(pathname, ASSET_PREFIXES)) return NextResponse.next();
  if (looksLikeFile(pathname)) return NextResponse.next();

  // La forma canónica no lleva el prefijo interno.
  if (pathname === "/site" || pathname.startsWith("/site/")) {
    const url = req.nextUrl.clone();
    url.pathname = stripSitePrefix(pathname);
    return NextResponse.redirect(url, 308);
  }

  // Ninguna API del CRM se expone desde el dominio público.
  if (pathname.startsWith("/api/")) {
    return new NextResponse(null, { status: 404 });
  }

  const url = req.nextUrl.clone();
  url.pathname = `/site${pathname}`;
  // La marca viaja en los headers de la request reescrita para que la segunda
  // pasada del middleware no vuelva a aplicar la regla canónica.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(INTERNAL_REWRITE_HEADER, "1");
  const response = NextResponse.rewrite(url, {
    request: { headers: requestHeaders },
  });
  // Entrega tipo estática: el reverse proxy cachea el HTML y lo revalida en
  // segundo plano, así que el visitante no espera el render ni la consulta.
  // `s-maxage` aplica a cachés compartidas; el navegador revalida siempre.
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=600, stale-while-revalidate=86400"
  );
  return response;
}

export const config = {
  // `_next/static` y `_next/image` quedan fuera: son inmutables y no dependen
  // del host, así que no tiene sentido pagar el costo del middleware.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
