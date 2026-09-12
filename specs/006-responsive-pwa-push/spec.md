# Feature Specification: Vocero móvil — responsive, PWA instalable y notificaciones push de handoff

**Feature Branch**: `006-responsive-pwa-push`

**Created**: 2026-09-12

**Status**: Draft

**Input**: El responsable de un negocio no siempre está conectado a Vocero atendiendo
handoffs. Para que pueda enterarse y atender desde el móvil: (1) adaptar la app a
responsive (hoy el layout fijo de 3 paneles revienta en pantalla chica), (2) hacerla PWA
instalable (standalone + botón de instalación con guía iOS), y (3) enviar una notificación
push cuando la IA escala una conversación a humano, con deep link directo a esa
conversación.

## Contexto de producto

- **Usuario primario**: el responsable/operador del negocio que atiende handoffs. No está
  sentado frente a un escritorio; recibe la señal en el móvil y atiende desde ahí.
- **Problema central**: el handoff hoy es un estado silencioso (`handoffAt` + badge en la
  bandeja). Si nadie está mirando la web, la conversación queda sin atender.
- **Disparo de notificación**: SOLO el handoff (cuando la IA escala). No se notifica cada
  mensaje entrante — eso es ruido, la IA está al mando en esos casos.
- **Toque en la notificación**: deep link directo a la conversación
  (`/inbox?conversation=ID`), no a la bandeja.
- **Alcance responsive**: toda la app (`(app)`), con prioridad de valor en el chat/inbox.
- **Plataforma**: Android (Chrome) e iOS (Safari 16.4+). En iOS el web push exige PWA
  instalada y en standalone.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chat usable en móvil (Priority: P1)

Como responsable, abro Vocero desde el móvil y atiendo una conversación completa: veo la
bandeja, abro un hilo, leo mensajes, escribo una respuesta y consulto la ficha del
contacto — sin paneles amontonados ni desbordes horizontales.

**Why this priority**: Es la prioridad explícita del dueño: hoy el móvil es "un desastre"
porque el layout de 3 paneles está pensado para escritorio de una pieza.

**Independent Test**: En viewport < 640px, navegar bandeja → hilo → responder → abrir
panel de contacto, sin scroll horizontal y con objetivos táctiles cómodos.

**Acceptance Scenarios**:

1. **Given** un viewport móvil (< 640px), **When** se abre la bandeja, **Then** la lista y
   el hilo NO se muestran a la vez: se navega bandeja → hilo con un botón "volver".
2. **Given** una conversación seleccionada en móvil, **When** se abre el hilo, **Then**
   ocupa el ancho completo, con scroll al último mensaje y el compositor accesible
   (objetivos táctiles ≥ 44px, sin desborde horizontal).
3. **Given** un hilo abierto en móvil, **When** se abre el panel de contacto, **Then** se
   muestra como overlay/drawer y NO empuja ni oculta el hilo.
4. **Given** el teclado abierto sobre el compositor en móvil, **When** se escribe, **Then**
   el hilo se reacomoda y el botón de enviar queda visible y tocable.

---

### User Story 2 - Toda la app responsive (Priority: P2)

Como operador, configuro Vocero (ajustes, Laboratorio, leads/pipeline, catálogo) desde el
móvil sin tablas rotas ni desplazamiento horizontal.

**Why this priority**: El dueño pidió "toda la app", no solo el chat; pero el chat es el
valor inmediato, por eso el resto es P2 dentro del mismo alcance.

**Independent Test**: Recorrer cada pantalla de `(app)` a < 640px y verificar que ninguna
genera scroll horizontal y que la navegación principal es alcanzable.

**Acceptance Scenarios**:

1. **Given** un viewport móvil, **When** se navega por la app, **Then** la navegación
   principal (AppNav) se adapta: menú colapsable o bottom-nav, sin ocupar el contenido.
2. **Given** una tabla ancha (leads, catálogo), **When** se ve en móvil, **Then** usa
   layout apilado o scroll contenido, sin romper el ancho de la página.
3. **Given** cualquier pantalla de `(app)`, **When** se mide a < 640px, **Then** no existe
   scroll horizontal (regresión automatizable).

---

### User Story 3 - PWA instalable (Priority: P1)

Como responsable, instalo Vocero en el móvil (Android e iOS) como una app con pantalla
completa e icono propio, y tengo un camino claro para instalarla.

**Why this priority**: Es prerrequisito del push en iOS (solo funciona instalado y en
standalone) y mejora el acceso diario en Android.

**Independent Test**: En Android, el botón "Instalar app" dispara el install prompt y la
app abre en standalone; en iOS, el botón muestra la guía "Compartir → Agregar a pantalla
de inicio".

**Acceptance Scenarios**:

1. **Given** la app servida, **When** el navegador la consulta, **Then** existe un manifest
   con `display: standalone`, `theme_color`, nombre y iconos (192/512 + maskable).
2. **Given** un dispositivo Android/Chrome, **When** el evento `beforeinstallprompt` está
   disponible, **Then** se muestra un botón "Instalar app" que dispara el prompt nativo.
3. **Given** un dispositivo iOS/Safari, **When** se toca "Instalar app", **Then** se muestra
   la guía "Compartir → Agregar a pantalla de inicio" (Safari no permite instalar por botón).
4. **Given** la app instalada, **When** se abre, **Then** arranca en standalone (sin barra
   del navegador) con icono y nombre propios.
5. **Given** un service worker registrado, **When** se recarga sin conexión, **Then** el
   shell de la app se sirve desde caché (no pantalla en blanco).

---

### User Story 4 - Notificación push en handoff (Priority: P1)

Como responsable, cuando la IA escala una conversación a humano (handoff), recibo una
notificación push en el móvil con el contacto y el motivo; al tocarla, abro directo esa
conversación.

**Why this priority**: Es el objetivo central de la feature: cerrar la brecha "el
responsable no está conectado y no se entera".

**Independent Test**: Con la app viva y un responsable suscrito, forzar un handoff y
verificar que llega el push; tocar la notificación y verificar que abre la conversación.
Camino infeliz: conversación `is_test` → NO hay push real.

**Acceptance Scenarios**:

1. **Given** un responsable con suscripción push activa, **When** ocurre un handoff
   (motivo `cliente`/`modelo`/`error`/`ventana`), **Then** se envía una notificación en
   pocos segundos con el nombre del contacto y el motivo.
2. **Given** una notificación recibida, **When** se toca, **Then** abre
   `/inbox?conversation=<id>` directo al hilo correspondiente.
3. **Given** un responsable sin permiso de notificaciones (o navegador sin soporte), **When**
   ocurre un handoff, **Then** no se envía nada y nada se rompe (degradación silenciosa).
4. **Given** una conversación `is_test` del Laboratorio, **When** ocurre un handoff, **Then**
   JAMÁS se envía un push real (guard de sandbox, como el envío de mensajes).
5. **Given** un responsable que desactivó las notificaciones en Vocero, **When** ocurre un
   handoff, **Then** no recibe push (toggle por usuario persistido).

---

### Edge Cases

- Permiso denegado o navegador sin soporte → sin push, sin error, la app sigue funcionando.
- Un usuario con varias suscripciones (varios dispositivos) → se notifica a todas las
  válidas.
- Suscripción con endpoint inválido/expirado (el usuario desinstaló la PWA) → se elimina
  esa suscripción sin tumbar el turno del agente ni la conversación.
- Handoff en conversación `is_test` → nunca toca la API real de push.
- iOS sin instalación → no hay push; la UI lo comunica (guía de instalación).
- VAPID privada ausente/no configurada → push deshabilitado, app funciona normal.
- Múltiples handoffs simultáneos → cada uno produce su notificación, sin colas externas
  (in-process, coherente con el resto de Vocero).

## Requirements *(mandatory)*

### Functional Requirements

**PWA instalable (US3)**

- **FR-001**: El sistema MUST exponer un manifest instalable con `display: standalone`,
  `theme_color`, nombre/`short_name`, `start_url` y una cadena de iconos (192/512 +
  maskable + `apple-touch-icon`), todo servido self-hosted (sin CDN).
- **FR-002**: El sistema MUST registrar un service worker que (a) cachee el shell para el
  arranque offline y (b) maneje los eventos `push` y `notificationclick` (deep link a la
  conversación).
- **FR-003**: El sistema MUST ofrecer un botón "Instalar app" que capture
  `beforeinstallprompt` (Android/Chromium) y, en iOS/Safari, muestre la guía
  "Compartir → Agregar a pantalla de inicio".

**Notificaciones push (US4)**

- **FR-004**: El sistema MUST registrar y persistir suscripciones push por usuario y
  dispositivo (multi-dispositivo), aisladas por organización (`organization_id` NOT NULL).
- **FR-005**: Al producirse un handoff (`applyHandoff`), el sistema MUST notificar a las
  suscripciones activas de los usuarios de la organización, EXCEPTO conversaciones
  `is_test` (guard de sandbox).
- **FR-006**: La notificación MUST incluir el nombre del contacto y el motivo del handoff,
  y deep-linkear a `/inbox?conversation=<id>`.
- **FR-007**: El usuario MUST poder activar/desactivar las notificaciones en la UI; el
  estado persiste y se respeta al enviar.
- **FR-008**: El envío de push usa VAPID autogenerada (self-hosted); la clave privada se
  almacena cifrada (reutiliza `lib/crypto`). Un fallo de entrega MUST degradar sin afectar
  el turno del agente ni el estado de la conversación.

**Responsive (US1, US2)**

- **FR-009**: El layout del inbox MUST ser responsive: en móvil, bandeja y hilo se navegan
  de a una (bandeja → hilo con "volver"), y el panel de contacto se abre como overlay.
- **FR-010**: La navegación principal (AppNav) MUST adaptarse a móvil (menú colapsable o
  bottom-nav) sin ocultar el contenido.
- **FR-011**: Ninguna pantalla de `(app)` MUST generar scroll horizontal a viewport < 640px.
- **FR-012**: Los objetivos táctiles principales (seleccionar conversación, enviar, volver)
  MUST ser cómodos en móvil (≥ 44px de zona táctil).

### Key Entities

- **push_subscription**: suscripción push por usuario y dispositivo (endpoint, `p256dh`,
  `auth`), con `organization_id` + `user_id` NOT NULL; se purga ante endpoints inválidos.
  (El resto — conversaciones, contactos, mensajes, handoff — se reutiliza sin cambios.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A < 640px, un handoff se atiende completo (leer + responder + ver contacto)
  sin desbordes horizontales.
- **SC-002**: La PWA instala en Android (botón) e iOS (guía) y arranca en standalone.
- **SC-003**: Con un responsable suscrito y la app viva, un handoff produce una
  notificación en < 5s; tocarla abre la conversación correcta.
- **SC-004**: El 100% de las pantallas de `(app)` pasa un audit sin scroll horizontal a
  < 640px.
- **SC-005**: Un handoff en conversación `is_test` NO genera push real (verificado por
  guard de sandbox).

## Assumptions

- Web Push es el estándar W3C: la entrega física pasa por el servicio push del vendor del
  navegador (Mozilla/Google/Apple). Vocero NO integra cuenta, SDK ni clave de un tercero:
  usa VAPID propia y envía payload cifrado al endpoint que el navegador provee. Se
  documenta como decisión (Principio VII) y se propone aclaración del Principio II (ver
  `plan.md` Constitution Check).
- iOS habilita web push solo en PWA instalada en standalone (16.4+); sin instalación, la UI
  lo comunica en vez de fallar.
- La suscripción es por usuario de la organización; un mismo usuario puede tener varias
  (un dispositivo cada una).
- Se reutiliza `lib/crypto` para cifrar la clave privada VAPID y las claves de suscripción.
- El envío de push es in-process (sin colas externas), coherente con el resto de Vocero.

## Out of Scope (v1)

- Push nativo (FCM/APNs) — prohibido por la constitución (Principio II).
- Relay por WhatsApp al número personal del responsable — alternativa evaluada y diferida.
- Email / SMS / otros canales de notificación.
- Notificaciones por "cada mensaje entrante" (solo handoff en esta feature).
- Escritura/operación offline completa (solo shell cacheada; no edición sin conexión).
- Push a múltiples organizaciones en una sola instancia (fuera del modelo "una instancia =
  un negocio"; el scoping multi-tenant se mantiene igual).
