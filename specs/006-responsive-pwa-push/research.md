# Research: Vocero móvil — responsive, PWA y push

Decisiones técnicas de la feature 006, registradas para trazabilidad (Principio VII).

## DV-001 — Web Push como estándar W3C, no servicio de terceros

**Decisión**: usar Web Push (Push API + VAPID) para notificar al responsable, NO push nativo
(FCM/APNs) ni un proveedor tipo OneSignal.

**Por qué**: la constitución (Principio II) prohíbe servicios de Google/terceros. El Web Push
es un estándar W3C: el navegador del usuario elige su servicio push (Chrome→FCM, Firefox→
autopush, Safari→Apple) y le da a Vocero un `endpoint`. Vocero no abre cuenta, no integra SDK
ni API key de terceros; firma con VAPID propia. No se pierde soberanía de datos ni de
operación.

**Riesgo/gráfico**: la entrega física transita por infra del vendor del navegador. Queda
documentado en `plan.md` Complexity Tracking y se propone aclaración del Principio II.

## DV-002 — VAPID auto-generada, privada en env, pública vía endpoint

**Decisión**: generar el par VAPID una vez (`scripts/generate-vapid.mjs`, `web-push.
generateVAPIDKeys()`). `VAPID_PRIVATE_KEY` vive en env (gitignored, como el resto de secretos).
`VAPID_PUBLIC_KEY` se sirve en runtime vía `GET /api/push/config` (no `NEXT_PUBLIC_*`).

**Por qué**: la pública no es secreto, pero servirla en runtime evita rebuild al rotar la
clave y es consistente con "config resuelta en runtime". La privada se trata como secreto
(Principio I).

**Alternativa considerada**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (más simple, pero exige rebuild
ante rotación). Descartada por el patrón de config runtime del repo.

## DV-003 — Librería `web-push` (implementación de referencia)

**Decisión**: agregar `web-push` (Node) en vez de implementar el cifrado a mano.

**Por qué**: es la implementación de referencia del RFC 8291 (Message Encryption for Web
Push); pequeña, sin dependencias de red propias, sin servicio externo. Hand-roll del cifrado
`aes128gcm` + autenticación VAPID sería más código y más superficie de error.

**Contra**: una dependencia más. Aceptado: es el camino estándar y auditable.

## DV-004 — Suscripción por usuario+dispositivo, claves cifradas

**Decisión**: tabla `push_subscription` con `organization_id` + `user_id` NOT NULL, `endpoint`
UNIQUE; `auth` y `p256dh` cifradas en reposo con `lib/crypto` (AES-256-GCM).

**Por qué**: un usuario puede tener varios dispositivos (móvil + tablet). El `endpoint` UNIQUE
da idempotencia al subscribe (upsert). Cifrar las claves alinea con Principio I aunque su
valor sea bajo (perderlas solo rompe el push, no filtra datos del negocio).

**Decisión menor**: `auth` es el componente sensible (deriva la clave de cifrado del payload);
se cifra junto con `p256dh` por simplicidad.

## DV-005 — Guard is_test en el disparo del push

**Decisión**: `applyHandoff` dispara `notifyHandoff` SOLO si la conversación no es `is_test`.
El `returning()` del UPDATE ya trae el row actualizado (incluye `isTest`), así que no hay
query extra.

**Por qué**: el Laboratorio nunca debe alcanzar la API real (Principio IX / guard de sandbox
del repo). El push real es una salida externa igual que `sendText` real.

## DV-006 — Purga de suscripciones expiradas, sin tumbar el turno

**Decisión**: en `notifyHandoff`, cada `sendNotification` se envuelve en try/catch; los
errores 404/410 (`WebPushError.statusCode`) eliminan esa suscripción; el resto se registra y
continúa. El envío es best-effort: NUNCA bloquea el turno del agente ni reintenta el handoff.

**Por qué**: un endpoint inválido (el usuario desinstaló la PWA) no puede romper la atención
de la conversación. El handoff ya está persistido; el push es un efecto colateral tolerante a
fallos.

## DV-007 — Breakpoint móvil y hook SSR-safe

**Decisión**: móvil = `< 768px` (Tailwind `md`). Introducir `useMediaQuery` (o `useIsMobile`)
que lee `window.matchMedia` dentro de `useEffect` (nunca en render) para evitar hydration
mismatch — mismo patrón que el `panelOpen`/`localStorage` actual.

**Por qué**: el repo no tiene ningún hook de breakpoint; hay que crearlo. El patrón
`useEffect` ya se usa para `localStorage` en `inbox-client.tsx`.

## DV-008 — Pipeline: TouchSensor en dnd-kit

**Decisión**: agregar `TouchSensor` (con `activationConstraint: { delay: ~200, tolerance: 8 }`)
al `DndContext` del pipeline, además del `PointerSensor` actual.

**Por qué**: con solo `PointerSensor` el arrastre táctil no funciona. El delay evita que el
scroll vertical del tablero sea secuestrado por el drag. El board ya tiene `overflow-x-auto`,
así que no se rompe en móvil; esto lo hace usable.

## DV-009 — iOS: instalación manual obligatoria para el push

**Decisión**: el botón "Instalar app" captura `beforeinstallprompt` (Chromium) y, en iOS,
muestra la guía "Compartir → Agregar a pantalla de inicio". No se puede instalar
programáticamente en Safari.

**Por qué**: iOS 16.4+ solo habilita web push en PWA instalada y `standalone`. Sin instalación,
no hay push; la UI debe comunicarlo en vez de fallar.

## DV-010 — Deep link por query param en el inbox

**Decisión**: `GET /inbox?conversation=<id>` selecciona esa conversación. El `inbox/page.tsx`
lee `searchParams.conversation` y lo pasa como `initialSelectedId` a `InboxClient` (que lo
aplica una vez en `useState` inicial). El SW en `notificationclick` abre esa URL.

**Por qué**: reutiliza la ruta existente sin estado global; el deep link es estable y
compartible.
