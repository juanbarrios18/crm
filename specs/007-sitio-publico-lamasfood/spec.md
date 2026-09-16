# Feature Specification: Sitio público LamasFood + separación admin (007)

**Feature Branch**: `007-sitio-publico-lamasfood`

**Created**: 2026-09-16

**Status**: Draft

**Input**: Diseñar y construir la web pública de LamasFood (raíz del dominio) con
catálogo de productos, SSR estático, SEO y liviandad; el sistema de gestión (CRM)
pasa a servirse en el subdominio `admin.<dominio>`.

## Contexto

LamasFood es una panadería (catálogo real: Pan ciabatta, Pan de completo, Pan de
hamburguesa, Pan de molde; masas Blanco XL / Brioche / Papa / Sin masa; formatos
en cm y rebanadas). Vocero es la instancia de gestión. Hoy el CRM ocupa la raíz
del dominio (`src/app/page.tsx` redirige a `/inbox`) y no existe ninguna web
pública ni separación por host.

La referencia de diseño es una landing de panadería artesanal (hero fotográfico
con tarjeta superpuesta, sección "por qué elegirnos" de 3 tarjetas, bloque
"visítanos" partido con collage, galería inferior). Se RECREA con el stack del
repo (Next.js App Router + Tailwind), no se copia código de la plantilla.

### Restricciones duras verificadas en el repo

- **`pnpm build` corre sin BD y sin secretos** (`Dockerfile`: los secretos llegan
  en runtime; `src/lib/env.ts` acepta placeholders en `phase-production-build`).
  → Ninguna página que lea la BD puede pre-renderizarse en build.
- **Constitución II**: prohibido introducir servicios externos (S3/R2/CDN de
  imágenes). Todo asset se sirve self-hosted.
- **`PublicProductSchema` es `.strict()`** (`src/lib/catalog.ts:42`): un campo
  nuevo NO se expone si no se agrega explícitamente.
- **El pipeline de media actual está acoplado a conversaciones** y empuja a Graph
  API (`src/app/api/conversations/[id]/messages/media/route.ts`); el serving
  (`src/app/api/media/[assetId]/route.ts`) exige sesión. No sirve tal cual para
  imágenes públicas de producto.

## User Stories

### US1 — Web pública en la raíz del dominio (P1)

Como visitante (dueño de negocio, panadería, distribuidor), entro al dominio y veo
la web de LamasFood: quiénes son, qué producen y cómo pedir. No veo nada del CRM.

**Aceptación**:
1. `GET /` en el host público renderiza la landing (hero, propuesta de valor,
   productos destacados, bloque de visita, galería) según la referencia.
2. `GET /catalogo` lista el catálogo real desde la BD, agrupado por producto, con
   masa, formato, unidades por bolsa y precio con IVA.
3. Ninguna ruta del CRM es alcanzable desde el host público (responde 404).
4. El host `admin.*` sirve el CRM como hoy (`/` → `/inbox`, `/login`, `/inbox`…).
5. En el host `admin.*`, las rutas internas del sitio público responden 404.

### US2 — SEO y liviandad (P1)

Como negocio, quiero que la web aparezca en búsquedas y cargue rápido en móvil.

**Aceptación**:
1. `robots.txt` deja de bloquear todo: en el host público permite indexar `/` y
   `/catalogo`; en el host `admin.*` bloquea todo. (Hoy `public/robots.txt` dice
   `Disallow: /`.)
2. `sitemap.xml` en el host público con la landing y el catálogo; en `admin.*` no
   se expone.
3. Cada página define `title`, `description`, canonical y Open Graph propios de
   LamasFood — nunca el título del CRM.
4. JSON-LD `Bakery`/`LocalBusiness` en la landing y `ItemList` de `Product` con
   `Offer` en el catálogo.
5. `lang="es"`, HTML semántico (un solo `h1` por página, landmarks), imágenes con
   `alt` y `next/image`.
6. Sin JavaScript de cliente obligatorio para ver contenido (la landing y el
   catálogo se leen con JS deshabilitado).
7. La respuesta pública se sirve con caché HTTP agresiva y la consulta a BD no se
   repite en cada request.

### US3 — Imagen de producto (P2)

Como operador, quiero asignar una foto a cada producto para que el catálogo
público lo muestre.

**Aceptación**:
1. `product` gana una columna de imagen (nullable, sin romper filas existentes).
2. El formulario de Productos permite subir/reemplazar y quitar la imagen.
3. La imagen se almacena en `MEDIA_DIR` (volumen existente) — sin S3/R2.
4. Se sirve públicamente por una ruta sin sesión, solo para imágenes referenciadas
   por productos activos, con caché larga.
5. El costo sigue sin salir nunca de la proyección pública.
6. Un producto sin imagen muestra un placeholder, no un hueco roto.

## Edge cases

- Producto sin imagen → placeholder local; la tarjeta no colapsa.
- Catálogo vacío o BD caída → la página renderiza el armazón y un mensaje honesto;
  nunca un 500 ni una página en blanco.
- `MEDIA_DIR` no escribible / upload inválido (mime o tamaño) → error claro, sin
  dejar filas huérfanas.
- Host desconocido o `localhost` en desarrollo → comportamiento predecible y
  documentado (no romper el flujo de dev).
- Producto con `notas` largas → no rompe el layout de la tarjeta.
- `prefers-reduced-motion` → sin animaciones.
- Imagen de producto borrada del disco → degrada al placeholder.

## Success Criteria

- **SC-1**: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
- **SC-2**: Guion E2E nuevo en `tests/e2e/` conducido por `scripts/e2e-selftest.mjs`
  que ejerce: landing pública (200 + contenido esperado), catálogo con productos
  sembrados, CRM alcanzable en host admin, rutas cruzadas en 404, `robots.txt` y
  `sitemap.xml` correctos por host, y camino infeliz (producto sin imagen, catálogo
  vacío).
- **SC-3**: Los E2E existentes siguen verdes (sin regresión de comportamiento).
- **SC-4**: Sin dependencias de runtime nuevas; imágenes y fuentes self-hosted.

## Out of Scope

- Carrito / checkout / pasarela de pago (Constitución II prohíbe Stripe en v1).
- CMS editable para los textos de marketing (v1: contenido en código, tipado).
- Blog, multi-idioma, modo oscuro del sitio público.
- Mover el CRM a un despliegue separado (se resuelve por host en un solo app).
- Dominio propio por organización (la instancia es de un solo negocio).
