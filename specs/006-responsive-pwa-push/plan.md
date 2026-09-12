# Implementation Plan: Vocero móvil — responsive, PWA instalable y push de handoff

**Branch**: `006-responsive-pwa-push` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-responsive-pwa-push/spec.md`

## Summary

Vocero deja de ser una app solo de escritorio. Tres frentes: (1) **responsive** — el shell
fijo de 3 paneles (`h-screen` + `w-56` + inbox 360/320px) se adapta a móvil con un drawer
de navegación, master/detail en el inbox y panel de contacto como sheet; (2) **PWA
instalable** — manifest `standalone` + service worker + botón "Instalar app" con guía iOS;
(3) **push de handoff** — cuando la IA escala (`applyHandoff`), se notifica a las
suscripciones activas de los usuarios de la organización, con deep link a la conversación.

El código es ~99% desktop-first (audit: 7 clases de breakpoint en todo `src/`, 0 `hidden`
de layout, 0 `useMediaQuery`). Los primitivos UI (`button`, `input`, `card`…) ya son
fluidos; el problema está en los **shells de layout** (AppNav, inbox, settings-nav) y en
algunos anchos fijos de página. El push se resuelve con la librería `web-push` (estándar
W3C, VAPID propia, sin servicio externo), documentando la zona gris del Principio II.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22

**Primary Dependencies**: Next.js 15 (App Router) · React 19 · Tailwind · Drizzle ORM · Zod ·
nanoid · **+ `web-push`** (nueva, envío server-side de notificaciones, VAPID)

**Storage**: PostgreSQL 16 — tabla nueva `push_subscription` (`organization_id` + `user_id`
NOT NULL, endpoint UNIQUE). Claves de suscripción (`auth`, `p256dh`) cifradas con `lib/crypto`.

**Testing**: Vitest (unit) + Playwright E2E vía `scripts/e2e-selftest.mjs`; viewport móvil en
Playwright para la regresión responsive.

**Target Platform**: VPS Linux self-hosted (Coolify o compose + Caddy). Superficie nueva:
manifest + service worker (PWA) + endpoint `/api/push/*`.

**Performance Goals**: handoff → push en < 5s (in-process, sin colas); el envío de push es
best-effort y NUNCA bloquea el turno del agente. SW cachea el shell (arranque offline).

**Constraints**: Principio I (VAPID privada + claves de suscripción cifradas en reposo) ·
Principio II (web push como estándar W3C, justificado) · guard `is_test` (jamás push real
en el Laboratorio) · sin colas externas · sin servicio de terceros (ni FCM/APNs/OneSignal).

**Scale/Scope**: una instancia = un negocio; suscripciones por usuario (pocas). 1 tabla +
1 endpoint + SW + manifest + refactor de 3 shells de layout.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación | Estado |
|---|---|---|
| I. Seguridad de Datos | La clave privada VAPID vive en env (patrón del repo, gitignored) y las claves de suscripción (`auth`, `p256dh`) se cifran con `lib/crypto`. Nada sensible va al cliente: solo la VAPID **pública** (no es secreto). | ✅ |
| II. Soberanía (endurecida) | Web Push usa el estándar W3C; la entrega física pasa por el servicio push del vendor del navegador (Mozilla/Google/Apple), pero Vocero NO integra cuenta, SDK ni clave de terceros (VAPID propia, sin Firebase/OneSignal). Se justifica en Complexity Tracking y se propone aclaración del principio. | ⚠️ justificado |
| III. Multi-Tenancy Real | `push_subscription` lleva `organization_id` + `user_id` NOT NULL e índice org-first; toda query pasa por `scoped()`. El envío solo alcanza suscripciones de la org de la conversación. | ✅ |
| IV. Idempotencia | Subscribe/unsubscribe = upsert por `endpoint` (UNIQUE), re-ejecutable sin duplicar. El handoff ya es idempotente; el push es un efecto best-effort posterior que no reintenta efectos del handoff. | ✅ |
| V. Calidad Verificable | Gate typecheck+lint+build+Vitest; unit tests de notify (salta is_test, purga 410, cifrado roundtrip) y del deep-link del SW. | ✅ |
| VI. Specs Antes de Código | Este flujo (spec → plan → tasks → implement). | ✅ |
| VII. Trazabilidad | Decisiones DV-n en `research.md`; la zona gris del Principio II y el supuesto de iOS quedan explícitos. | ✅ |
| VIII. Foco Vertical | Sirve a "atender" conversaciones de WhatsApp de UN negocio (el responsable no está conectado y se entera del handoff). | ✅ |
| IX. Verificación en Vivo | E2E responsive con viewport móvil (master/detail, sin scroll horizontal, deep link). La entrega real de push por un browser vendor es no-oficial → guardarraíles: allowlist + anti-flood + volumen mínimo (Principio IX). | ✅ |

**Post-diseño (Fase 1)**: re-evaluado tras `research.md` y `data-model.md` — sin violaciones;
la única entrada de Complexity Tracking es el Principio II (web push), justificada abajo.

## Project Structure

### Documentation (this feature)

```text
specs/006-responsive-pwa-push/
├── plan.md              # Este archivo
├── research.md          # Decisiones DV-n
├── spec.md              # QUÉ y POR QUÉ
├── data-model.md        # Entidad push_subscription
└── tasks.md             # Tareas dependency-ordered
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── manifest.ts                    # NUEVO — MetadataRoute.Manifest (standalone, theme, icons)
│   ├── layout.tsx                     # MODIFICADO — viewport + meta apple-mobile-web-app
│   ├── (app)/
│   │   ├── layout.tsx                 # MODIFICADO — shell móvil (AppNav drawer)
│   │   ├── inbox/page.tsx             # MODIFICADO — lee ?conversation= para deep link
│   │   └── settings/layout.tsx        # MODIFICADO — nav responsive (tabs/colapsable)
│   └── api/push/
│       ├── config/route.ts            # NUEVO — GET { publicKey } (runtime, sin rebuild)
│       ├── subscribe/route.ts         # NUEVO — POST/PUT suscripción (scoped user+org)
│       └── unsubscribe/route.ts       # NUEVO — DELETE suscripción
├── components/
│   ├── app-nav.tsx                    # MODIFICADO — drawer móvil + hamburguesa (< md)
│   ├── hooks/use-media-query.ts       # NUEVO — hook SSR-safe (window en useEffect)
│   ├── pwa/install-prompt.tsx         # NUEVO — botón "Instalar app" + guía iOS
│   ├── pwa/push-toggle.tsx            # NUEVO — suscribir/desuscribir + estado
│   └── inbox/inbox-client.tsx         # MODIFICADO — master/detail móvil + panel sheet
├── server/
│   ├── push/
│   │   ├── vapid.ts                   # NUEVO — carga VAPID (env) + setVapidDetails
│   │   ├── subscriptions.ts           # NUEVO — upsert/list/delete (scoped)
│   │   └── notify.ts                  # NUEVO — notifyHandoff(orgId, payload)
│   └── ai/pipeline.ts                 # MODIFICADO — applyHandoff dispara notify (salvo is_test)
└── lib/db/schema.ts                   # MODIFICADO — tabla push_subscription

public/
├── sw.js                              # NUEVO — push + notificationclick + cache shell
└── icons/                             # NUEVO — 192/512/maskable/apple-touch-icon

tests/
├── unit/
│   ├── push-notify.test.ts            # NUEVO — salta is_test, purga 410, cifrado roundtrip
│   └── deep-link.test.ts              # NUEVO — parseo de ?conversation=
└── e2e/011-responsive-pwa.md          # guion self-test (viewport móvil)
```

**Structure Decision**: se sigue el patrón del repo — dominio en `src/server/<dominio>/`,
transporte delgado en `src/app/api/`, schema en `src/lib/db/schema.ts`. El service worker y
el manifest viven en `public/` y `src/app/manifest.ts` (superficie estándar de Next.js 15).
El hook `use-media-query` es el primitivo responsive nuevo (SSR-safe, consistente con el
patrón `panelOpen`/`useEffect` ya existente). El push server-side usa `web-push`
(`setVapidDetails` + `sendNotification`), que NO es un servicio externo: es la implementación
de referencia del estándar, con entrega por el endpoint del navegador.

## Complexity Tracking

1. **Principio II — Web Push (zona gris, justificada).** El web push entrega por la
   infraestructura push del vendor del navegador (Mozilla/Google/Apple). No es un "servicio
   de Google" integrado (sin cuenta, SDK, API key de Firebase/OneSignal ni contrato): Vocero
   genera VAPID propia, firma el payload y lo POSTea al endpoint que el *navegador del
   usuario* eligió. Es la misma categoría que "el navegador del usuario usa Google para
   resolver HTTPS". Se mantiene la soberanía: el operador no se ata a un proveedor de push;
   si el usuario cambia de navegador, cambia el endpoint, no Vocero. **Propuesta**: aclarar
   el Principio II para excluir explícitamente el transporte estándar del navegador (Web
   Push) de la lista de "servicios externos prohibidos", sin abrir la puerta a FCM/APNs/oneSDK
   nativos (que SÍ integran cuentas de terceros). Sin esa aclaración, esta feature queda
   marcada como excepción justificada (Principio VII), no como violación silenciosa.
