/**
 * Resolución de hosts de la instancia.
 *
 * Una instancia sirve DOS superficies en un mismo despliegue:
 *   - la web pública (raíz del dominio)  → marca y catálogo
 *   - el CRM (`admin.<dominio>`)         → gestión
 *
 * Este módulo es deliberadamente SIN dependencias (ni zod, ni Buffer, ni
 * builtins de Node) porque lo importa `src/middleware.ts`, que corre en el
 * runtime Edge. No agregar imports acá.
 *
 * `process.env.X` se lee en runtime (el middleware es server-side, no se
 * inlinea como en un bundle de cliente), así que las variables llegan desde el
 * contenedor y no desde el build.
 */

/** Quita el puerto y normaliza a minúsculas. `null` si no hay host usable. */
export function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null;
  // `x-forwarded-host` puede traer una cadena "host1, host2": gana el primero.
  const first = value.split(",")[0]?.trim();
  if (!first) return null;
  const host = first.replace(/:\d+$/, "").toLowerCase();
  return host.length > 0 ? host : null;
}

/** Host del CRM según `APP_BASE_URL` (la URL con la que se autentica la app). */
export function appHostname(): string | null {
  const raw = process.env.APP_BASE_URL;
  if (!raw) return null;
  try {
    return normalizeHost(new URL(raw).host);
  } catch {
    return normalizeHost(raw);
  }
}

/** Host del CRM: `ADMIN_HOST` explícito, o el de `APP_BASE_URL`. */
export function adminHostname(): string | null {
  return normalizeHost(process.env.ADMIN_HOST) ?? appHostname();
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** true si el host es una dirección de desarrollo local. */
export function isLocalHost(host: string | null): boolean {
  return host !== null && LOCAL_HOSTS.has(host);
}

/**
 * true si el request corresponde al CRM.
 *
 * Precedencia: `ADMIN_HOST` explícito → host de `APP_BASE_URL` → convención
 * `admin.<cualquier cosa>`. Sin ninguna de las tres, la instancia no tiene
 * subdominio y todo el dominio se trata como CRM (comportamiento previo).
 */
export function isAdminHost(host: string | null): boolean {
  if (!host) return false;
  const explicit = normalizeHost(process.env.ADMIN_HOST);
  if (explicit) return host === explicit;
  const fromBase = appHostname();
  if (fromBase && host === fromBase) return true;
  return host.startsWith("admin.");
}

/**
 * true si el host es de INFRAESTRUCTURA, no de la web pública.
 *
 * Esto es una guarda de seguridad operativa, no un detalle estético: el
 * middleware trata como pública a toda ruta que no sea del CRM, así que si una
 * IP o un nombre interno de Docker cayera en la rama pública, TODAS las
 * `/api/*` del CRM —incluido el webhook de WhatsApp— responderían 404 según con
 * qué Host llegue el request. El webhook se entrega por loopback
 * (`http://127.0.0.1:<PORT>/…`) y el healthcheck del contenedor igual, así que
 * las IPs y los nombres internos son infraestructura SIEMPRE.
 *
 * `localhost` es el único caso con matiz: es el host del CRM solo cuando el CRM
 * está configurado EN `localhost` (el setup simple, todo en un puerto). Si el
 * CRM tiene su propio host (`admin.localhost`, `admin.lamasfood.cl`),
 * `localhost` es la web pública — que es como se desarrolla con URLs reales y,
 * sobre todo, lo que hace que los enlaces internos del sitio funcionen: el
 * sitio vive en la RAÍZ, y su prefijo interno `/site` es solo un detalle de
 * implementación que no debe filtrarse a los hrefs.
 */
export function isInfrastructureHost(host: string | null): boolean {
  if (!host) return true;
  // IPv4 literal (incluye 127.0.0.1 y 0.0.0.0): siempre infraestructura.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 (incluye ::1): siempre infraestructura.
  if (host.includes(":")) return true;

  if (host === "localhost") {
    return adminHostname() === "localhost";
  }

  // Un dominio público siempre tiene un punto; un nombre suelto es un host
  // interno (`web`, `app`, el nombre del servicio en el compose).
  if (!host.includes(".")) return true;
  return false;
}

/**
 * URL absoluta de la web pública (raíz del dominio).
 *
 * Prioridad: `SITE_BASE_URL` explícito → `APP_BASE_URL` sin el prefijo `admin.`
 * → `APP_BASE_URL` tal cual. Se usa para `metadataBase`, canonical y Open Graph:
 * un canonical que apunte al subdominio de gestión sería un error de SEO.
 */
export function publicBaseUrl(): string {
  const explicit = process.env.SITE_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const base = process.env.APP_BASE_URL;
  if (!base) return "http://localhost:3000";

  try {
    const url = new URL(base);
    if (url.hostname.startsWith("admin.")) {
      url.hostname = url.hostname.slice("admin.".length);
    }
    return url.origin;
  } catch {
    return base.replace(/\/+$/, "");
  }
}

/** Host de un valor tipo URL o URL sin esquema. `null` si no se puede leer. */
function hostFromUrlLike(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeHost(new URL(value).host);
  } catch {
    return normalizeHost(value);
  }
}

/**
 * Revisa que la configuración de hosting sea coherente. Devuelve advertencias
 * legibles (vacío = todo bien). Se corre UNA vez al arrancar (ver
 * `src/instrumentation.ts`).
 *
 * Por qué existe: el reparto entre las dos superficies se declara con varias
 * variables que expresan dos hechos (cuál es el host del CRM y cuál la web
 * pública). Cuando se desincronizan, el síntoma es **silencioso**: el canonical
 * del sitio pasa a apuntar al dominio del admin y Google recibe señales
 * contradictorias (el admin además responde `Disallow: /`). Eso no rompe nada,
 * no tira error y no se ve mirando la página: se descubre tarde, en un informe
 * de posicionamiento. Mejor que grite el log al arrancar.
 */
export function hostingWarnings(): string[] {
  const warnings: string[] = [];
  const admin = adminHostname();
  /** Un host con punto y que no es de desarrollo: un dominio de verdad. */
  const isDeployed =
    admin !== null && admin.includes(".") && !isLocalHost(admin);

  const declared = process.env.SITE_BASE_URL;
  const siteHost = hostFromUrlLike(declared);

  if (declared) {
    if (siteHost && admin && siteHost === admin) {
      warnings.push(
        `SITE_BASE_URL (${siteHost}) es el MISMO host que el CRM. El canonical y el Open Graph ` +
          `de la web pública dirían que vive en el dominio del admin. Declarala con el dominio público.`
      );
    }
  } else if (isDeployed && admin && !admin.startsWith("admin.")) {
    warnings.push(
      `No se pudo derivar el dominio público: SITE_BASE_URL está vacía y el host del CRM ` +
        `(${admin}) no es un subdominio que empiece con "admin." (los dominios hermanos, como ` +
        `admin-midominio.duckdns.org vs midominio.duckdns.org, no se pueden derivar). ` +
        `Sin declararla, el canonical del sitio apuntará al admin. Ver .env.example.`
    );
  }

  return warnings;
}
