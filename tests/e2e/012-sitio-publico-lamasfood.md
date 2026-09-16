# Guion E2E — 012: Sitio público LamasFood y ruteo por host

> Conducido por `scripts/e2e-selftest.mjs` (sección "007") contra la app real con
> los mocks encendidos. No se le pasa el guion al humano: el arnés lo ejecuta y
> sale distinto de cero si algo falla.

## Contexto

Una instancia sirve dos superficies con el mismo despliegue:

| Superficie | Host | Rutas |
|---|---|---|
| Web pública | raíz del dominio (`lamasfood.cl`) | `/`, `/catalogo` |
| CRM | `admin.lamasfood.cl` | `/inbox`, `/login`, `/products`… |

El sitio se sirve internamente bajo `/site`, y el middleware reescribe la raíz
del host público hacia ahí. El host se fuerza con `x-forwarded-host` (que es lo
que setea el proxy en producción), así se prueban las dos superficies sin tocar
DNS ni `/etc/hosts`.

## Escenarios cubiertos

### US1 — Web pública en la raíz del dominio

1. `GET /` en el host público → **200**. ✅
2. El HTML es de **LamasFood**, no del CRM (`Sistema de gestión` no aparece). ✅
3. Un solo `<h1>` (HTML semántico), sin overflow horizontal en móvil ni desktop. ✅
4. La respuesta trae `s-maxage` → el proxy la sirve como estática. ✅
5. `GET /catalogo` → **200** y expone los **productos reales** del catálogo. ✅
6. `GET /site` → **308** a la forma canónica (sin contenido duplicado para SEO). ✅

### US1 — Aislamiento entre superficies

7. Desde el host público, `/inbox`, `/login`, `/api/products` y `/api/events`
   → **404**. El dominio de marca no expone el CRM. ✅
8. `/api/public/products` sigue disponible sin sesión. ✅
9. `/api/health` responde **200 en ambos hosts** (el healthcheck del contenedor no
   depende del ruteo). ✅
10. En el host admin, `/site` → **404**. ✅

### Aislamiento público/admin (invariante)

35. Nada en el host público redirige a `/inbox` ni a `/login`: se verifican las
    cabeceras `location` de `/`, `/catalogo`, `/no-existe`, `/inbox` y `/login`. ✅
36. `/inbox` y `/login` en el host público → **404 con la marca del sitio**, no
    una redirección al CRM. ✅
37. Un 500 en el sitio renderiza `error.tsx` con header, footer y botón
    "Reintentar" — nunca la página de error pelada de Next ni el admin. ✅
    (verificado con navegador: es un boundary client-rendered)

### US2 — SEO y liviandad

11. `robots.txt` público: `Allow: /` + `Disallow: /api/`. ✅
12. `robots.txt` admin: `Disallow: /` (el CRM no se indexa). ✅
13. `sitemap.xml` público: lista la landing y `/catalogo`. ✅
14. `sitemap.xml` admin: vacío. ✅
15. JSON-LD `ItemList` + `Product` en el catálogo; `Bakery` en el layout. ✅
16. JS propio del sitio: **178 B** (landing) y **491 B** (catálogo) — todo el
    resto son server components. ✅

### US3 — Foto de producto

17. `POST /api/products/:id/image` con un PNG → **200** y `imagen` queda en
    `/api/public/media/<assetId>`. ✅
18. La foto se sirve **sin sesión** por `/api/public/media/<assetId>`, con
    `Content-Type` correcto y `Cache-Control: immutable`. ✅
19. El catálogo público refleja la foto **sin esperar la revalidación**
    (`revalidateTag` al mutar el producto). ✅
20. `DELETE /api/products/:id/image` → **200** y la URL deja de servirse (**404**). ✅

## Camino infeliz

21. `GET /catalogo/no-existe` → **404** (404 propio del sitio, no del CRM). ✅
22. Subir un `text/plain` como foto → **415**. ✅
23. Borrar la foto **sin sesión** → **401**. ✅
24. **Catálogo vacío / BD caída**: `getSiteCatalog` no lanza, devuelve `[]` y la
    página muestra el mensaje + CTA en vez de un 500. ✅ (cubierto por el estado
    vacío y por el `catch` del módulo)
25. **Producto sin foto**: la tarjeta usa el placeholder local, nunca un hueco
    roto ni un `alt` vacío en la foto real. ✅
26. **La ficha NO publica precios**: la tarjeta muestra nombre, descripción y
    variantes (masa · formato · unidades por bolsa), y el único camino al precio
    es el CTA a WhatsApp. La cotización la maneja el agente. ✅
27. **El precio no está en el HTML**: se busca en TODO el HTML servido de
    `/catalogo` (nombres de campo y valores con decimales). No alcanza con no
    pintarlo: Next serializa los props de los componentes de servidor en el
    payload RSC, así que un precio que llegue como prop queda en el código
    fuente aunque la ficha no lo muestre. ✅
28. **Los datos estructurados no llevan precio**: el `ItemList` de `/catalogo`
    NO emite `Offer`/`price`. Si lo emitiera, Google mostraría el precio en los
    resultados de búsqueda —más visible que en la ficha, no menos— y un `Offer`
    sin precio es dato estructurado inválido. ✅
29. `GET /api/public/products` **sigue devolviendo la proyección pública con
    precios**, por contrato de la feature 005. El ocultamiento es de la WEB
    (proyección `SiteProduct`, sin precios), no de la API. ✅

## Dos bugs que encontró esta verificación

1. **404 sin marca y sin SSR.** Con varios root layouts no hay un
   `app/layout.tsx` único, así que un `not-found.tsx` de segmento solo cubre los
   `notFound()` de ese segmento — NO las URLs que no matchean ninguna ruta. Para
   esas, Next servía su 404 interno: sin header, sin footer, sin marca (y con un
   `[...slug]` intermedio, además un shell vacío que solo se veía con JS). Se
   resolvió con `src/app/global-not-found.tsx` + `experimental.globalNotFound`:
   se resuelve a nivel de ROUTING y no depende de layouts. Ahora el 404 sale
   SSR (con `h1`, `header` y `footer` en el HTML) y elige su cara según el host.

2. **Loop de 308 en el host público.** Next.js vuelve a correr el middleware
   sobre la ruta YA reescrita. `/` se reescribía a `/site`, el middleware entraba
   de nuevo, aplicaba la regla canónica (`/site` → `/`) y devolvía un 308 hacia
   `/`, que se volvía a reescribir: **el sitio entero quedaba en un redirect
   permanente sin servir nunca el HTML**. Se arregló con una marca
   (`x-site-rewrite`) que corta la segunda pasada. Ojo: el loop solo apareció al
   activar `globalNotFound`, pero la fragilidad era estructural — una
   reescritura y una regla de redirección sobre la misma ruta es un loop clásico
   y la guarda lo cierra para siempre.

## Cómo correrlo

```bash
# 1. app viva con `pnpm dev` y los mocks (ver el encabezado del selftest).
#    OJO: contra un build de producción los mocks dan 404 por el dev-guard, así
#    que solo la sección 007 va a pasar (se verificó así: 31/31).
# 2. desde la raíz del repo, con BASE apuntando al puerto donde corre la app:
APP_BASE_URL=http://localhost:3000 pnpm test:e2e
```

## Nota de entorno

**El sitio vive en la RAÍZ del dominio.** El prefijo interno `/site` es cómo se
monta el árbol de rutas para no chocar con el CRM, y el middleware lo reescribe.
Por eso **los `href` del sitio son absolutos a la raíz** (`/catalogo`): si el
sitio se previsualiza en una ruta con prefijo, esos enlaces se van al CRM.

En desarrollo se sirve en la raíz, igual que en producción:

```bash
# .env (desarrollo)
APP_BASE_URL=http://admin.localhost:3000
```

→ web pública en `http://localhost:3000`, CRM en
`http://admin.localhost:3000`. `localhost` solo se trata como CRM cuando
`APP_BASE_URL` apunta a `localhost` (setup de un solo puerto), y en ese caso el
sitio se puede mirar en `/site` **pero los enlaces no navegan**.

Para verificar el ruteo sin tocar `.env`:

```bash
curl -H "Host: lamasfood.cl" http://localhost:3000/
curl -H "Host: admin.lamasfood.cl" http://localhost:3000/
```
