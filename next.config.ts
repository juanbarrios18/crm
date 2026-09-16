import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone es para la imagen Docker (Linux). En Windows el trazado crea
  // symlinks que requieren permisos elevados, así que ahí se omite.
  output: process.platform === "win32" ? undefined : "standalone",
  // El paquete `postgres` usa APIs de Node que no deben empaquetarse en el bundle.
  serverExternalPackages: ["postgres"],
  experimental: {
    /*
     * Habilita `app/global-not-found.tsx` (007).
     *
     * Con varios root layouts (el CRM y la web pública) no existe un
     * `app/layout.tsx` único, así que un 404 de segmento NO cubre las URLs que
     * no matchean ninguna ruta: Next usaba el `_not-found` interno, que sin
     * layout sale pelado y sin marca. `global-not-found` se resuelve a nivel de
     * routing y no depende de ningún layout, que es justo lo que hace falta.
     * Sigue detrás de un flag en Next 15.
     */
    globalNotFound: true,
  },
};

export default nextConfig;
