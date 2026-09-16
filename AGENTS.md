# Vocero CRM — Guía del agente

Vocero es un CRM de WhatsApp open source (MIT), self-hosted, con agente de IA y
Laboratorio de auto-evaluación. Una instancia = un negocio. Esta guía gobierna al
agente de opencode para operar y **modificar** este repositorio (caso típico: una
agencia adaptando Vocero para un cliente).

## Registro e idioma de los artefactos (no negociable)

Esta sección **corrige** el escape hatch del persona global (*"unless the existing
project clearly uses another language and you are extending it"*). Ese permiso
significa el **locale** del proyecto (español vs inglés), NUNCA su registro
regional.

- Un repo escrito en español rioplatense se extiende en **español neutro o
  profesional**, no en más voseo.
- **Voseo rioplatense prohibido en cualquier artefacto**: `Agregá`, `Probá`,
  `Guardá`, `Revisá`, `Tenés`, `Podés`, `Sos`. Vale para código, UI, comentarios,
  strings, documentación, mensajes de error y commits.
- Un repo que ya tiene voseo **no autoriza** voseo: es deuda a limpiar, no un
  estilo a seguir.

Por superficie:

| Superficie | Registro |
|---|---|
| CRM admin (`src/components/`, `src/app/(crm)/`) | Español neutro profesional |
| Web pública (`src/app/(site)/`, `src/components/site/`, `src/content/`) | Español chileno, **trato de usted** |
| Documentación (`AGENTS.md`, `docs/`) | Neutro / impersonal |
| Agente de IA (prompt y tono) | Lo que defina la configuración del negocio |

Citar el dialecto en documentación de evidencia está permitido; escribirlo como
prosa propia no. Lo verifica `tests/unit/voice-register.test.ts` en `pnpm test`.

## Stack

**Next.js 15 (App Router) + React 19** en monolito · TypeScript estricto
(`strict` + `noUncheckedIndexedAccess`) · Tailwind CSS (**tema claro "Atlas"**,
acento acero `#3f5972` por defecto y configurable por organización; la web
pública usa su propia paleta cálida scopeada bajo `.site`) · **PostgreSQL +
Drizzle ORM** (migraciones versionadas en
`drizzle/`, aplicadas al ARRANCAR el contenedor) · **Better Auth** + plugin
organization · **Zod** en todo input externo · nanoid con prefijos (`ct_`,
`cv_`, `msg_`…) · pnpm · Vitest (unit) + guiones E2E en `tests/e2e/` conducidos
con Playwright · Docker multi-stage (standalone, healthcheck `/api/health`) ·
deploy en Coolify (Ruta A) o docker compose + Caddy (Ruta B).

## Dos superficies, un despliegue (ruteo por host)

Una instancia sirve **la web pública de la marca** en la raíz del dominio y **el
CRM** en `admin.<dominio>`, con el mismo Next.js. Lo resuelve
`src/middleware.ts`:

- Host del CRM (`ADMIN_HOST`, o el de `APP_BASE_URL`, o `admin.*`) → rutas del
  CRM tal cual; `/` redirige a `/inbox`.
- Host de infraestructura (IP literal, nombre interno de Docker, o `localhost`
  cuando el CRM está configurado en otro host) → también CRM. Sin esta guarda,
  el webhook de WhatsApp y el resto de `/api/*` responderían 404 según con qué
  Host llegue el request.
- Cualquier otro host → web pública: reescribe a las rutas internas `/site…` y
  agrega `Cache-Control` para que el proxy sirva el HTML.

`/site` es una ruta INTERNA, no una URL pública: en el host público se redirige
a su forma canónica.

**Invariante: un visitante de la web pública nunca llega al admin.** Ni por un
enlace, ni por un 404, ni por un 500, ni por una redirección. En el host público
`/inbox`, `/login` y el resto del CRM responden 404 con la página de error de la
marca; el admin solo existe en su propio host. `error.tsx` (sitio y CRM),
`(site)/site/not-found.tsx` y `global-not-found.tsx` son las piezas que lo
sostienen, y el self-test lo verifica explícitamente.

Ojo: las páginas de `error.tsx` son *client components* por contrato de Next, así
que su HTML inicial va vacío y se pintan al hidratar. Un visitante con navegador
las ve completas; sin JS vería el 500 pelado. Es una limitación del framework,
no una decisión nuestra.

**El sitio vive en la RAÍZ del dominio**; su prefijo interno `/site` es solo
cómo se monta el árbol de rutas para no chocar con el CRM, y el middleware lo
reescribe. Consecuencia importante: **los `href` del sitio son absolutos a la
raíz** (`/catalogo`). Si se previsualiza el sitio en una ruta con prefijo, esos
enlaces se van al CRM. Por eso en desarrollo el sitio se sirve en la raíz, igual
que en producción:

```bash
# .env (desarrollo) — el CRM en su propio host, el sitio en localhost
APP_BASE_URL=http://admin.localhost:3000
```

Con eso: web pública en `http://localhost:3000` y CRM en
`http://admin.localhost:3000` (los `*.localhost` resuelven a loopback por RFC
6761). Los enlaces internos funcionan porque el sitio está en la raíz.

`localhost` se trata como CRM **solo** cuando `APP_BASE_URL` apunta a
`localhost` (el setup simple de un solo puerto); ahí el sitio se previsualiza en
`/site`, pero **navegando con sus enlaces no funciona** (es la limitación
descrita arriba). Las IPs (`127.0.0.1`) y los nombres internos de Docker son
infraestructura SIEMPRE: el webhook se entrega por loopback y no puede depender
del host.

Para verificar el ruteo sin tocar `.env` se fuerza el host con el header, que es
lo que setea el proxy en producción:

```bash
curl -H "Host: lamasfood.cl" http://localhost:3000/          # web pública
curl -H "Host: admin.lamasfood.cl" http://localhost:3000/    # CRM
```

`ADMIN_HOST` y `SITE_BASE_URL` son opcionales y se documentan en `.env.example`.
Sin proxy, `x-forwarded-host` es falsificable: el CRM siempre exige sesión, la
protección de rutas es de SEO/UX, no un límite de seguridad.

Tiempo real por **SSE** (`/api/events`): heartbeat `: ping` ~25s, headers
anti-buffering, catch-up por refetch con `since=`. Sin WebSockets, sin colas
externas: el trabajo en segundo plano (agente, Laboratorio) es in-process.

## Mapa del código (fronteras de modificación)

| Quieres cambiar… | Toca… |
|---|---|
| El cerebro/proveedor LLM | `src/lib/ai/` (adaptador OpenRouter-compatible, `chatJson<T>`) |
| El comportamiento/prompt del agente | `src/server/ai/prompts.ts` |
| Las acciones que puede tomar el agente | `src/server/ai/actions.ts` + ejecución en `src/server/ai/pipeline.ts` |
| Las personas o el juez del Laboratorio | `src/server/lab/personas.ts` · `src/server/lab/judge.ts` |
| El canal WhatsApp (Graph API) | `src/lib/meta/` (cliente único) + `src/server/whatsapp/` |
| Campos/tablas | `src/lib/db/schema.ts` → `pnpm db:generate` → migración nueva en `drizzle/` |
| La ingesta/envío de mensajes | `src/server/inbox/` (ingest idempotente, send con guard de sandbox, ventana 24h) |
| Cómo se identifica a un contacto | `src/server/inbox/identity.ts` (teléfono normalizado o `bsuid:<id>`) |
| Conectar TU propio bot en vez del agente | `src/app/api/bot/*` + `src/server/bot/auth.ts` (X-API-Key) |
| La web pública (landing, catálogo, SEO) | `src/app/(site)/` + `src/components/site/` + `src/content/lamasfood.ts` |
| Qué host sirve qué superficie | `src/middleware.ts` + `src/lib/hosts.ts` |
| Textos/marca de la web pública | `src/content/lamasfood.ts` (placeholders marcados `REEMPLAZAR`) |
| La foto de un producto | `src/app/api/products/[id]/image/` (subida) + `src/app/api/public/media/` (serving) |
| UI del CRM | `src/components/` + `src/app/(crm)/(app)/` |

Los dos root layouts (`(crm)` y `(site)`) existen a propósito: el del CRM declara
`force-dynamic` y lee branding de la base, así que compartirlo haría dinámica a
la web pública y filtraría el título del CRM a los buscadores. Next.js permite
varios root layouts justamente cuando no hay un `app/layout.tsx` único.

Los mocks del entorno de pruebas viven en `src/app/api/dev/` (wa-mock +
ai-mock) tras un gate único (`src/lib/dev-guard.ts`): 404 incondicional en
producción. Por eso **el self-test E2E corre contra `pnpm dev`, nunca contra un
build de producción**.

**Identidad de contacto**: Meta está migrando de teléfono a Business-Scoped
User IDs, así que `from` puede no venir. La llave estable es
`contact.wa_identity` (teléfono normalizado 521→52, o `bsuid:<id>`); `phone` es
un atributo OPCIONAL. Nunca asumas que un contacto tiene teléfono.

**Cerebro externo**: `/api/bot/*` (autenticada por `BOT_API_KEY`) deja que un
microservicio propio conduzca la conversación sin que el token de WhatsApp
salga del CRM. Respeta `conversation.ai_enabled`/`handoff_at` igual que el
agente in-process. Sin la key, responde 401 y el CRM funciona igual.

## Reglas de la constitución (no negociables)

Autoridad máxima: [`.specify/memory/constitution.md`](.specify/memory/constitution.md).
Resumen operativo:

- **Soberanía (II, endurecida)**: dependencias de runtime SOLO WhatsApp Cloud
  API + proveedor LLM OpenRouter-compatible opcional. PROHIBIDO en v1
  introducir S3/R2, email, Stripe, Google u otros servicios externos. Auth y
  BD self-hosted.
- **Seguridad (I)**: secretos cifrados en reposo (AES-256-GCM, `lib/crypto`);
  jamás al cliente ni a logs. El token de WhatsApp solo muestra sus últimos 4.
- **Multi-tenancy (III)**: `organization_id` NOT NULL en toda tabla de dominio;
  toda query pasa por `scoped()` de `src/lib/db/tenant.ts`.
- **Idempotencia (IV)**: webhooks dedup por `wa_message_id` UNIQUE; estados
  monotónicos; seeds y migraciones re-ejecutables.
- **Sandbox del Laboratorio**: las conversaciones `is_test` JAMÁS tocan la API
  real — el sender lanza excepción (no lo "arregles": es un guardrail).

## Definición de Hecho (obligatoria)

"Typecheck + lint + build (+ tests)" es el piso, NO el techo. Una feature no
está "Hecha" hasta correr el **self-test de COMPORTAMIENTO de punta a punta**
(Playwright + mocks: `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`OPENROUTER_BASE_URL` → ai-mock) y dejarlo verde: flujo real como usuario,
resultado observable, y el camino infeliz degradando sin colgarse. Prohibido
delegar la prueba al usuario. Si algo depende de un LLM/proveedor externo,
todo turno tolera formato inesperado con extracción robusta + reintentos. Al
detectar un fallo: diagnostica, corrige y re-verifica tú mismo hasta verde.

Gate técnico:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Guiones E2E por historia en `tests/e2e/*.md`. Con la app viva con **`pnpm dev`**
(no un build de producción: los mocks dan 404 en `NODE_ENV=production`) y los
mocks encendidos, `pnpm test:e2e` (`scripts/e2e-selftest.mjs`) los conduce contra
la app real y sale distinto de cero si algo falla.

**El E2E no es idempotente sobre una base ya usada**: los mocks reusan
`waMessageId` fijos, así que re-correrlo contra la misma base choca con
`message_wa_message_id_unique` y produce fallos fantasma. Para una corrida
limpia, apuntar el self-test a una base recién migrada y sembrada. Además, los
primeros requests de cada ruta en `next dev` compilan on-demand: un 500 aislado
en la PRIMERA ejecución de una ruta suele ser ese cold start, no un bug.

Al agregar una historia,
extiende el arnés en vez de dejar solo el `.md`.

## Modo Objetivo — Loop SDD

Cuando el dueño da una META (no prompts paso a paso): Discover → Plan →
Execute → Verify → Iterate, de forma autónoma, volviendo solo con el objetivo
verificado en vivo o con un bloqueo real (decisión de producto, credenciales,
acción irreversible/costosa). Agrupa TODAS las preguntas bloqueantes al inicio.
El estado durable son los artefactos SDD en `specs/` (spec/plan/tasks) —
manténlos al día. Punto de entrada: skill `loop-sdd` o el comando `/loop-sdd
<objetivo>`.

Flujo Spec Kit: `specify → clarify → plan → tasks → analyze → implement`
(skills `speckit-*`). Cada feature vive en `specs/NNN-nombre/`; `tasks.md` es
el estado durable para reanudar si se corta el contexto.

## Subagentes

- **`deploy-ops`** (`.opencode/agent/deploy-ops.md`) — operaciones e infra:
  deploy, logs, healthchecks, diagnóstico de fallos. NUNCA escribe código de app.
- **`public-site-builder`** (`.opencode/agent/public-site-builder.md`) — páginas
  públicas/legales + doc de configuración de paneles externos. No toca auth/BD.

Invocar con la herramienta `task` (`subagent_type`). Cada uno mantiene
memoria de proyecto en `.opencode/agent-memory/<agente>/`.

## Variables de entorno

Ver `.env.example` (cada una con guía inline). Las claves: `APP_BASE_URL`,
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (32 bytes base64),
`META_WEBHOOK_VERIFY_TOKEN` (segmento secreto del webhook), `META_APP_SECRET`
(opcional, firma), y para IA:

```bash
OPENROUTER_API_TOKEN=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_JUDGE_MODEL=anthropic/claude-haiku-4.5   # opcional: juez más barato
```

Para el self-test local existe el modo de pruebas interno (mocks) — ver
`specs/001-vocero-core/quickstart.md`. Nunca actives mocks en producción.

Manejo de credenciales: cuando una feature necesite una variable/credencial
nueva, (1) agrégala a `.env` como placeholder `REEMPLAZA_...` (append), (2)
deja guía inline `#` de cómo obtenerla, (3) resume en el chat y sigue. `.env`
está gitignored; para deploy, las vars van en la plataforma de hosting
(runtime, no build).

## Memoria persistente

Memoria de archivos en `memory/` (índice `memory/MEMORY.md`, cargado por
sesión). Persiste decisiones, gotchas y correcciones; no dupliques lo que el
repo ya registra. Los subagentes con `memory: project` usan
`.opencode/agent-memory/`.
