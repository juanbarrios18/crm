# Tasks: Vocero móvil — responsive, PWA instalable y push de handoff

**Input**: Design documents from `/specs/006-responsive-pwa-push/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md

**Tests**: Vitest (unit) + guion E2E Playwright con viewport móvil (gate del proyecto, Principios
V y IX).

**Organization**: Tasks agrupadas por historia de usuario; cada historia es implementable y
testeable de forma independiente. Fases dependency-ordered.

## Review Workload Forecast

- **Cambio estimado**: ~1.500–1.700 líneas cambiadas (responsive + PWA + push).
- **Chained PRs recomendados**: No (el trabajo no es divisible en slices de valor independientes
  sin romper el gate; ver Dependencias).
- **400-line budget risk**: Alto (supera el default de 400) — **pero dentro del presupuesto
  elegido en preflight (2000 líneas)**.
- **Decision needed before apply**: No con `single-pr` + presupuesto 2000. Si durante apply el
  diff real amenaza con pasar de 2000, se frena y se consulta.

## Phase 1: Fundación PWA (US3 — instalable)

**Purpose**: manifest + service worker (shell) + instalación. Prerrequisito del push en iOS
(instalado + standalone).

**Independent Test**: `GET /` expone manifest `standalone`; el botón "Instalar app" aparece en
Chromium y la guía iOS en Safari; recarga sin conexión sirve el shell.

- [ ] T001 Crear `src/app/manifest.ts` (`MetadataRoute.Manifest`): `display: standalone`,
      `theme_color`, `name`/`short_name`, `start_url`, `icons` (192/512/maskable), `scope`.
- [ ] T002 [P] Generar iconos en `public/icons/` (icon-192.png, icon-512.png, maskable-512.png,
      apple-touch-icon.png 180px) desde el acento/letra del branding.
- [ ] T003 Modificar `src/app/layout.tsx`: `viewport` exportado (`themeColor`, width=device-width)
      + metas `apple-mobile-web-app-capable`/`apple-mobile-web-app-title`/`apple-touch-icon`.
- [ ] T004 [P] Crear `public/sw.js`: `install` (precache del shell app), `activate` (limpiar
      caché vieja), `fetch` (network-first con fallback a caché) y registro del SW desde un
      componente client (`PwaProvider` o en `(app)/layout`).
- [ ] T005 Crear `src/components/pwa/install-prompt.tsx`: captura `beforeinstallprompt`, botón
      "Instalar app" (Chromium) y guía "Compartir → Agregar a pantalla de inicio" (iOS/Safari).
      Montar en el drawer de AppNav o en Ajustes.

**Checkpoint**: la app es instalable y arranca offline (shell).

## Phase 2: Push server-side (US4 — disparo)

**Purpose**: persistir suscripciones y enviar push al handoff.

**Independent Test**: con una suscripción sembrada, disparar `notifyHandoff` → `sendNotification`
se invoca con el payload correcto; una conversación `is_test` NO dispara.

- [ ] T006 Agregar `push_subscription` a `src/lib/db/schema.ts` (`organization_id`+`user_id`
      NOT NULL, `endpoint` UNIQUE, `p256dh`/`auth` text) y generar migración (`pnpm db:generate`).
- [ ] T007 [P] Crear `src/server/push/vapid.ts`: carga `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
      (env), valida, `setVapidDetails` (subject `mailto:`); + `scripts/generate-vapid.mjs` que
      imprime un par VAPID y guía para el `.env`.
- [ ] T008 [P] Crear `src/server/push/subscriptions.ts`: `upsertSubscription`,
      `listByOrg`, `deleteSubscription` (scoped por org+user, cifrado `auth`/`p256dh` con
      `lib/crypto`, upsert por `endpoint`).
- [ ] T009 Crear `src/server/push/notify.ts`: `notifyHandoff(orgId, { conversationId,
      contactName, reason })` — lista suscripciones activas, envía `web-push.sendNotification`
      (payload JSON con `title`/`body`/`data.url`), purga `410/404` y registra el resto; siempre
      best-effort (nunca lanza).
- [ ] T010 En `src/server/ai/pipeline.ts`, `applyHandoff` llama `notifyHandoff` SOLO si el row
      devuelto por `returning()` tiene `isTest = false`; pasa `contactName` (join contact) y
      `reason`.
- [ ] T011 [P] Crear `src/app/api/push/config/route.ts`: `GET` → `{ publicKey }` (VAPID pública,
      resuelta en runtime).

**Checkpoint**: el disparo server-side existe y respeta el guard `is_test`.

## Phase 3: Push client-side (US4 — suscripción y recepción)

**Purpose**: el usuario se suscribe/desuscribe y el SW muestra la notificación con deep link.

**Independent Test**: suscribirse en el navegador persiste la suscripción; desuscribirse la
borra; una notificación simulada en el SW abre `/inbox?conversation=ID`.

- [ ] T012 Crear `src/app/api/push/subscribe/route.ts` (POST/PUT upsert) y
      `unsubscribe/route.ts` (DELETE) — validan el body con Zod y scoped por usuario+org.
- [ ] T013 [P] Crear `src/components/pwa/push-toggle.tsx`: pide permiso
      (`Notification.requestPermission`), obtiene VAPID pública de `/api/push/config`,
      `pushManager.subscribe` → POST `/api/push/subscribe`; toggle off → DELETE; estado
      persistente (permiso + suscripción). Montar en Ajustes.
- [ ] T014 [P] Extender `public/sw.js`: handler `push` (`showNotification` con `title`/`body`/
      `data.url`) y `notificationclick` (`clients.openWindow(data.url)` o focus si ya abierta).
- [ ] T015 [P] Unit test `tests/unit/push-notify.test.ts`: `notifyHandoff` salta `is_test`,
      purga `410`, cifrado/descifrado roundtrip de `auth`/`p256dh`.

**Checkpoint**: el push llega de punta a punta (suscripción → handoff → notificación → deep link).

## Phase 4: Chat responsive (US1 — prioridad)

**Purpose**: bandeja ↔ hilo navegables en móvil, panel de contacto como sheet, deep link.

**Independent Test**: viewport móvil → bandeja y hilo de a uno, "volver" funciona, el panel de
contacto se abre como overlay, `/inbox?conversation=ID` selecciona la conversación.

- [ ] T016 Crear `src/components/hooks/use-media-query.ts` (SSR-safe: `matchMedia` en
      `useEffect`, patrón `panelOpen`).
- [ ] T017 Modificar `src/components/inbox/inbox-client.tsx`: master/detail — a `< md`, mostrar
      bandeja O hilo (no ambos), botón "volver" del hilo a la bandeja, y `ContactPanel` como
      sheet/overlay (reusa el estado `panelOpen` existente).
- [ ] T018 Modificar `src/app/(app)/inbox/page.tsx`: leer `searchParams.conversation` y pasarlo
      como `initialSelectedId` a `InboxClient` (aplicado una vez en `useState`).
- [ ] T019 [P] Unit test `tests/unit/deep-link.test.ts`: parseo de `?conversation=` (valores
      inválidos/ausentes no rompen).

**Checkpoint**: el chat es usable de punta a punta en móvil.

## Phase 5: Resto de la app responsive (US2)

**Purpose**: navegación global, settings y pipeline usables en móvil; cero scroll horizontal.

**Independent Test**: recorrer todas las pantallas de `(app)` a < 640px sin scroll horizontal;
el drawer de navegación abre/cierra; el tablero arrastra en touch.

- [ ] T020 Modificar `src/components/app-nav.tsx`: drawer móvil (< md) con hamburguesa (overlay
      `fixed inset-0 z-50`, patrón `StageManager`) + columna `w-56` en escritorio; montar el
      `install-prompt` (T005) y el `push-toggle` (T013) accesibles desde el drawer.
- [ ] T021 [P] Modificar `src/app/(app)/settings/layout.tsx` + `settings-nav.tsx`: nav responsive
      (tabs horizontales/colapsable < md en vez del sidebar `w-44`).
- [ ] T022 [P] Modificar `src/components/pipeline/pipeline-client.tsx`: agregar `TouchSensor`
      (con `activationConstraint` de delay/tolerancia) al `DndContext`.
- [ ] T023 [P] Modificar `src/components/contacts/contacts-client.tsx`: header `flex-wrap` (el
      buscador `w-72` fijo desborda en `justify-between`).
- [ ] T024 [P] Audit de cierre responsive: recorrer las 10 rutas de `(app)` a < 640px y corregir
      desbordes residuales (tablas anchas → scroll contenido o layout apilado).

**Checkpoint**: toda la app pasa el audit sin scroll horizontal.

## Phase 6: Verificación y cierre

**Purpose**: gate completo + validación en vivo (Principio IX).

- [ ] T025 Guion E2E `tests/e2e/011-responsive-pwa.md` (feliz e infeliz: master/detail en móvil,
      deep link, sin scroll horizontal, drawer) y extender `scripts/e2e-selftest.mjs`.
- [ ] T026 Verificación completa: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` +
      self-test E2E con viewport móvil. Entrega real de push por browser vendor = no-oficial →
      verificación acotada con allowlist + anti-flood (Principio IX).
- [ ] T027 Actualizar `specs/README.md` (índice) y documentar la aclaración propuesta del
      Principio II en `constitution.md` (o dejar `NEEDS CLARIFICATION` visible, Principio VII).

## Dependencies & Execution Order

- **Phase 1 (PWA)** es independiente; **Phase 2 (push server)** es independiente de Phase 1.
- **Phase 3 (push client)** depende de Phase 1 (SW) + Phase 2 (endpoints/vapid).
- **Phase 4 (chat responsive)** es independiente (crea el hook `use-media-query`).
- **Phase 5** depende de Phase 4 (el hook) para el drawer; pipeline/contacts son independientes.
- **Phase 6** al final.

## Parallel Opportunities

- T001/T002/T003 (PWA) en paralelo con T006–T011 (push server): frontes independientes.
- Dentro de Phase 2: T007/T008/T011 en paralelo tras T006 (schema).
- Phase 5: T021/T022/T023/T024 en paralelo tras el hook (T016).
- Tests unit (T015/T019) en paralelo con sus implementaciones.
- Guion E2E (T025) en paralelo con la implementación de Phase 4/5.
