# Plan técnico: Sitio público LamasFood + separación admin (007)

## Decisión de arquitectura: un app, dos root layouts, ruteo por host

Se mantiene **un solo despliegue** (un Next.js, una BD). La separación es por host,
no por servicio.

```
src/app/
  (crm)/                      ← root layout del CRM (dinámico, branding, PWA)
    layout.tsx                ← el actual src/app/layout.tsx, con force-dynamic
    page.tsx                  ← el actual / → redirect /inbox
    (app)/…                   ← sin cambios
    (auth)/…                  ← sin cambios
  (site)/                     ← root layout del sitio público (propio, liviano)
    site/
      layout.tsx              ← chrome público + metadata SEO de LamasFood
      page.tsx                ← landing (referencia de diseño)
      catalogo/page.tsx       ← catálogo real desde BD
  api/…                       ← route handlers, sin layout, sin cambios
```

**Por qué dos root layouts**: `src/app/layout.tsx` declara
`export const dynamic = "force-dynamic"` y lee branding de BD en cada request.
Mientras exista como layout único, TODO el árbol queda dinámico y contamina la web
pública con metadatos y consultas del CRM. Next.js permite múltiples root layouts
si no existe `src/app/layout.tsx` y cada route group aporta el suyo.

El grupo `(site)` no aporta segmento de URL; el segmento real es `site/`. Así el
sitio vive en las rutas internas `/site` y `/site/catalogo`, que el middleware
reescribe desde la raíz del host público.

### Ruteo por host — `src/middleware.ts`

```
host = x-forwarded-host ?? host        (sin puerto)
adminHost = host de APP_BASE_URL       (admin.<dominio>)
```

| Host | Request | Acción |
|---|---|---|
| público | `/`, `/catalogo`, … | `rewrite` a `/site…` |
| público | `/site/…` | `redirect` 308 a la ruta sin prefijo (canónica) |
| público | `/api/public/*`, `/_next/*`, assets | pasa |
| público | cualquier otra cosa (`/inbox`, `/api/auth/*`, `/api/events`) | 404 |
| admin | `/` | `redirect` a `/inbox` |
| admin | `/site/…` | 404 |
| admin | todo lo demás | pasa |
| dev (`localhost`, sin `ADMIN_HOST`) | `/site/…` | pasa (previsualización directa) |

Se agrega `ADMIN_HOST` a `src/lib/env.ts` y `.env.example` como opcional
(`z.string().optional()`), derivado de `APP_BASE_URL` si falta. Sin él en dev, el
middleware no rompe nada.

**Auth**: el sitio público es anónimo, así que NO se habilita
`crossSubDomainCookies`. `APP_BASE_URL` debe apuntar al host de admin para que
`trustedOrigins` y las cookies host-only sigan siendo válidos. Es la opción de
menor superficie.

## Estática vs dinámica: por qué no hay `export const static`

`pnpm build` corre sin BD (`Dockerfile`: los secretos llegan en runtime). Un
prerender que lea la BD falla el build, y un prerender con fallback vacío serviría
un catálogo vacío hasta la primera revalidación — inaceptable en un deploy nuevo.

Solución: **SSR dinámico + caché de datos + caché HTTP**.

- `unstable_cache` alrededor de la consulta del catálogo (`revalidate: 3600`), con
  tag `catalog` para invalidación puntual.
- `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` en la
  respuesta pública → el reverse proxy (Caddy) sirve HTML estático.
- La invalidación se dispara al mutar productos (`revalidateTag("catalog")` desde
  el admin), así que el cambio se ve sin esperar la ventana.

Resultado observable: el HTML se sirve desde caché, la BD se toca como máximo una
vez por hora y por tag, y el primer request tras un deploy ya trae datos reales.

## SEO

- **Eliminar `public/robots.txt`**: un archivo estático en `public/` gana sobre
  `src/app/robots.ts`, así que hay que borrarlo para que la ruta dinámica mande.
- `src/app/robots.ts`: por host — público permite `/`, bloquea `/api/`; admin
  bloquea todo.
- `src/app/sitemap.ts`: por host — público lista `/` y `/catalogo`; admin devuelve
  vacío.
- Metadata de LamasFood en `(site)/site/layout.tsx` (título, descripción,
  canonical, Open Graph, Twitter) con `metadataBase` desde `APP_BASE_URL`/host
  público.
- JSON-LD: `Bakery` en la landing; `ItemList` de `Product` con `Offer`
  (`priceCurrency: CLP`, `price` = precio bolsa con IVA) en el catálogo.
- HTML semántico: un `h1` por página, `header`/`main`/`footer`/`nav` con labels,
  `alt` en toda imagen.

## Identidad visual del sitio

Tokens propios scopeados bajo `.site`, para no pelear con el tema Atlas del CRM
(el acento white-label se inyecta en `:root` y queda fuera del scope).

| Token | Valor | Uso |
|---|---|---|
| `--site-bg` | `#F7F1E8` | fondo crema |
| `--site-panel` | `#FFFDF9` | tarjetas |
| `--site-text` | `#3B2A20` | texto principal (marrón) |
| `--site-muted` | `#8A7566` | texto secundario |
| `--site-accent` | `#6B3F2A` | CTA píldora |
| `--site-border` | `#E8DCCB` | bordes |
| `--site-serif` | Fraunces (next/font) | títulos display |

Fuente serif vía `next/font/google` (se descarga en BUILD y se self-hostea — igual
que Geist, cumple Constitución II). Sin CDN en runtime.

**Contenido y assets**: el dueño no tiene assets todavía, así que los textos de
marketing viven tipados en `src/content/lamasfood.ts` y las imágenes son
placeholders SVG locales en `public/site/` (mismo nombre de archivo que tendrá la
foto real → reemplazo sin tocar código).

## Imagen de producto (US3)

Cadena completa, 6 puntos de contacto:

1. `src/lib/db/schema.ts` — `product.imagen: text("imagen")` nullable (guarda la
   ruta pública, no un binario) → `pnpm db:generate` → migración nueva en
   `drizzle/`.
2. `src/lib/catalog.ts` — agregar `imagen` a `PublicProductSchema` (obligatorio:
   el schema es `.strict()`) y a `serializePublicProduct`.
3. `src/server/catalog/admin.ts` — `ProductInput`/`ProductUpdateInput` + set-clauses
   de `createProduct`/`updateProduct`.
4. Zod inline de `src/app/api/products/route.ts` y `[id]/route.ts`.
5. **Upload**: `POST /api/products/[id]/image` (con sesión + `scoped()`) →
   `saveMediaFile` en `MEDIA_DIR` + fila `mediaAsset` con `kind:"image"` y
   `fetchStatus:"available"` (obligatorio: `ensureAssetAvailable` corta si no hay
   `waMediaId`) → setea `product.imagen = /api/public/media/<assetId>`.
6. **Serving público**: `GET /api/public/media/[assetId]` sin sesión, que valida
   que el asset esté referenciado por un producto activo de la instancia y responde
   con `Cache-Control` inmutable. Nunca sirve assets de conversación.

7. UI: `src/components/products/products-client.tsx` — `AdminProduct`,
   `EMPTY_PRODUCT`, `startEdit`, payload de `submit` + control de subida con
   preview.

## Archivos

**Nuevos**
- `src/middleware.ts`
- `src/app/(site)/site/layout.tsx`, `page.tsx`, `catalogo/page.tsx`
- `src/components/site/*` (Header, Footer, Hero, ValueProps, Visit, Gallery, ProductCard)
- `src/content/lamasfood.ts`
- `src/app/robots.ts`, `src/app/sitemap.ts`
- `src/app/api/products/[id]/image/route.ts`
- `src/app/api/public/media/[assetId]/route.ts`
- `src/server/site/catalog.ts` (consulta cacheada para el sitio)
- `public/site/*.svg` (placeholders)
- `drizzle/00XX_*.sql` (migración generada)
- `tests/e2e/012-sitio-publico-lamasfood.md`

**Modificados**
- `src/app/layout.tsx` → `src/app/(crm)/layout.tsx`
- `src/app/page.tsx` → `src/app/(crm)/page.tsx`
- `src/app/(app)/…`, `src/app/(auth)/…` → bajo `(crm)/`
- `src/lib/db/schema.ts`, `src/lib/catalog.ts`, `src/server/catalog/admin.ts`
- `src/app/api/products/route.ts`, `src/app/api/products/[id]/route.ts`
- `src/components/products/products-client.tsx`
- `src/lib/env.ts`, `.env.example`
- `AGENTS.md` (corregir "tema oscuro / acento #25D366" → Atlas claro `#3f5972`;
  documentar el ruteo por host)
- `public/robots.txt` → **eliminado**

## Verificación

1. `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
2. `tests/e2e/012-sitio-publico-lamasfood.md` + checks en `scripts/e2e-selftest.mjs`
3. Prueba manual del camino infeliz: catálogo vacío, producto sin imagen, ruta
   cruzada entre hosts.
