# Tasks: Sitio público LamasFood + separación admin (007)

Estado durable para reanudar. Se marca a medida que se completa.

## Fase 1 — Ruteo por host y separación de layouts

- [x] T101 `src/lib/env.ts`: agregar `ADMIN_HOST` opcional + helper `adminHost()` que
      cae a `new URL(APP_BASE_URL).host` si no está seteado.
- [x] T102 `.env.example`: documentar `ADMIN_HOST` con guía inline.
- [x] T103 Mover `src/app/layout.tsx` → `src/app/(crm)/layout.tsx` (conserva
      `force-dynamic`, branding y PWA).
- [x] T104 Mover `src/app/page.tsx` → `src/app/(crm)/page.tsx` (redirect a `/inbox`).
- [x] T105 Mover `src/app/(app)` y `src/app/(auth)` → bajo `src/app/(crm)/`.
- [x] T106 Verificar que no quede `src/app/layout.tsx` y que `pnpm build` resuelva
      los dos root layouts.
- [x] T107 `src/middleware.ts` con la tabla de ruteo del plan (rewrite público,
      redirect de `/site` canónico, 404 cruzado, dev sin romper).
- [x] T108 Matcher del middleware: excluir `_next/static`, `_next/image`,
      `favicon.ico` y extensiones de archivo.

## Fase 2 — Sitio público

- [x] T201 `src/content/lamasfood.ts`: contenido de marketing tipado (hero, value
      props, visita, galería, nav, contacto, SEO).
- [x] T202 `public/site/*.svg`: placeholders locales (hero, 3 value props, 2 visita,
      galería, logo). Sin dependencias externas.
- [x] T203 `src/app/globals.css`: tokens `.site` (crema/marrón, serif) scopeados.
- [x] T204 `src/app/(site)/site/layout.tsx`: root layout público, fuente serif,
      metadata SEO de LamasFood, header/footer.
- [x] T205 `src/components/site/header.tsx` + `footer.tsx` (nav + CTA WhatsApp).
- [x] T206 `src/app/(site)/site/page.tsx`: landing — hero con tarjeta superpuesta,
      "por qué elegirnos" (3 tarjetas), bloque visita con collage, galería.
- [x] T207 `src/server/site/catalog.ts`: consulta del catálogo envuelta en
      `unstable_cache` (tag `catalog`, revalidate 3600). La agrupación quedó en
      `src/lib/catalog-public.ts` (módulo puro) para poder testearla sin Next.
- [x] T208 `src/app/(site)/site/catalogo/page.tsx`: catálogo con tarjetas, precio
      con IVA, masa/formato/unidades, imagen o placeholder, y estado vacío honesto.
- [x] T209 `src/components/site/product-card.tsx`.
- [x] T210 `revalidateTag("catalog")` al mutar productos desde el admin.

## Fase 3 — SEO

- [x] T301 Eliminar `public/robots.txt`.
- [x] T302 `src/app/robots.ts` por host (público permite, admin bloquea).
- [x] T303 `src/app/sitemap.ts` por host.
- [x] T304 Metadata + canonical + Open Graph en el layout del sitio.
- [x] T305 JSON-LD `Bakery` (landing) e `ItemList`/`Product`/`Offer` (catálogo).
- [x] T306 Auditoría de semántica: un `h1` por página, landmarks, `alt` en imágenes.

## Fase 4 — Imagen de producto

- [x] T401 `schema.ts`: `product.imagen` nullable.
- [x] T402 `pnpm db:generate` → migración en `drizzle/`.
- [x] T403 `src/lib/catalog.ts`: `imagen` en `PublicProductSchema` +
      `serializePublicProduct`.
- [x] T404 `src/server/catalog/admin.ts`: input + set-clauses.
- [x] T405 Zod de `api/products/route.ts` y `api/products/[id]/route.ts`.
- [x] T406 `POST /api/products/[id]/image`: upload con sesión + `scoped()`,
      `saveMediaFile` + `mediaAsset` (`kind:"image"`, `fetchStatus:"available"`).
- [x] T407 `GET /api/public/media/[assetId]`: serving sin sesión, solo assets de
      productos activos, caché inmutable.
- [x] T408 `products-client.tsx`: subir/reemplazar/quitar imagen con preview.

## Fase 5 — Verificación

- [x] T501 `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- [x] T502 `tests/e2e/012-sitio-publico-lamasfood.md` con los escenarios.
- [x] T503 Checks nuevos en `scripts/e2e-selftest.mjs` (landing, catálogo, 404
      cruzado, robots/sitemap por host, camino infeliz).
- [x] T504 Correr `pnpm test:e2e` con mocks y dejarlo verde.
- [x] T505 Corregir `AGENTS.md` (tema Atlas claro, ruteo por host, mapa del sitio).

## Progreso

- 2026-09-16: spec.md + plan.md escritos. Recon completado. Decisiones del dueño:
  mismo repo con host routing · placeholders para assets · campo de imagen en el
  modelo de producto.

## Cierre

Todo el plan ejecutado y verificado. Gate técnico en verde
(`typecheck` + `lint` + `build` + 216 tests unitarios) y self-test E2E con los
28 checks de esta feature en verde sobre una base recién migrada y sembrada
(84/86 globales).

### Correcciones nacidas de la verificación

- **Bug de ruteo por host (grave)**: el host del CRM se detectaba por igualdad
  exacta, así que un host de infraestructura (`127.0.0.1`, una IP, un nombre
  interno de Docker) caía en la rama pública y **todas las `/api/*` del CRM
  respondían 404**. Se manifestó como `502` en el webhook: `deliverToWebhook`
  hace loopback a `http://127.0.0.1:<PORT>/…`. Se agregó
  `isInfrastructureHost` (`src/lib/hosts.ts`) y el middleware ahora manda a la
  rama del CRM todo host sin punto, IP literal o loopback. Verificado: el
  webhook con token real responde 200 desde `127.0.0.1`, `web` y el host admin,
  y sigue en 404 desde el host público.
- **Tokens del sitio sin opacidad**: Tailwind v3 no aplica modificadores
  (`bg-site-panel/95`) sobre un color definido como `var(--x)` plano; el fondo
  quedaba **transparente en silencio**. Los tokens ahora se declaran como
  canales RGB + `<alpha-value>`.
- **`public/robots.txt` bloqueaba todo** (`Disallow: /`): eliminado a favor de
  `src/app/robots.ts`, que decide por host.

### Hallazgos de entorno (no bloquean, quedan documentados)

- El E2E **no es idempotente sobre una base ya usada**: los mocks reusan
  `waMessageId` fijos y choca `message_wa_message_id_unique`. Documentado en
  `AGENTS.md`.
- Fallos preexistentes del arnés, ajenos a esta feature: `media sin API key →
  401` falla solo por el cold start de webpack en `next dev` (el reintento da
  401), y `el agente respondió al mensaje comercial` pasa en una base usada por
  un mensaje de IA viejo pero falla en base limpia (el ai-mock nunca se invoca:
  el setup del agente en el arnés está incompleto).
- Falta cargar los **datos reales del negocio** en `src/content/lamasfood.ts`
  (los placeholders están marcados `REEMPLAZAR`) y reemplazar los placeholders
  de imagen en `public/site/` con las fotos reales (mismo nombre de archivo).

### Segunda pasada de verificación (banner real + 404)

- **Banner real**: el dueño dejó `src/assets/banner_{mobile,desktop}.png`. Se
  integraron con art direction real (`<picture>` + `getImageProps`): móvil pide
  SOLO el vertical y desktop SOLO el horizontal. Con dos `<Image priority>` Next
  preloadea ambos y el visitante se baja dos fotos para un solo hero. El Open
  Graph se regeneró (1200×630) desde el banner desktop.
- **Bug 404 (arreglado)**: ver `tests/e2e/012-sitio-publico-lamasfood.md`. Con
  varios root layouts un `not-found.tsx` de segmento no cubre las URLs sin
  match; se resolvió con `src/app/global-not-found.tsx` +
  `experimental.globalNotFound`.
- **Bug loop 308 (arreglado)**: Next vuelve a correr el middleware sobre la
  ruta reescrita, así que la regla canónica de `/site` producía un loop que
  dejaba el sitio sin servir HTML. Guarda `x-site-rewrite`.
- **Semántica**: auditoría de encabezados; el catálogo saltaba `h1` → `h3`.
  `ProductCard` acepta `headingLevel` (2 en `/catalogo`, 3 en la landing).
- **Verificación final**: 31/31 checks de 007 verdes contra el artefacto
  `standalone` (equivalente al de Docker), más `typecheck` + `lint` + `build` +
  216 tests unitarios.

### Pendiente del dueño (contenido, no código)

- Datos reales del negocio en `src/content/lamasfood.ts` (los placeholders están
  marcados `REEMPLAZAR`): dirección, teléfono, email, horarios, redes.
- Fotos reales para value props, "Visítanos", galería y placeholder de producto
  en `public/site/` (mismo nombre de archivo → sin tocar código).
- Opcional: los PNG del banner pesan ~2 MB cada uno. Next los optimiza al
  servirlos, pero convertir el ORIGEN a WebP bajaría el repo y la imagen Docker.
