# E2E — Vocero móvil: responsive, PWA y push de handoff (006)

Precondición: app corriendo con mocks (`WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock), organización creada, BD migrada, y VAPID
configurada en `.env` (`node scripts/generate-vapid.mjs`).

## Automático (en `scripts/e2e-selftest.mjs`)

1. `GET /api/push/config` → **200** `{publicKey}` (VAPID pública).
2. `POST /api/push/subscribe` con `{endpoint, keys}` → **ok**; re-suscribir el
   mismo endpoint no duplica (upsert).
3. `POST /api/push/subscribe` con body inválido → **422**.
4. `DELETE /api/push/unsubscribe` → **ok**.

## Manual / navegador (juicio visual + push real)

### US1 — Chat responsive (viewport < 768px)

5. Abrir `/inbox` en viewport móvil (DevTools o teléfono real) → la bandeja y el
   hilo NO se muestran a la vez; se navega bandeja → hilo con botón "volver".
6. Seleccionar una conversación → el hilo ocupa el ancho completo, sin scroll
   horizontal; el panel de contacto se abre como sheet (no empuja el hilo).
7. Escribir con el teclado abierto → el botón de enviar queda visible.

### US3 — PWA instalable

8. Android/Chrome: aparece el botón "Instalar app" (drawer o Ajustes →
   Notificaciones) y dispara el prompt nativo; la app abre en `standalone`.
9. iOS/Safari: el botón muestra la guía "Compartir → Agregar a pantalla de
   inicio".
10. `GET /manifest.webmanifest` → `display: standalone` + iconos 192/512/maskable.

### US4 — Push de handoff (guardarraíles: allowlist + anti-flood)

11. Ajustes → Notificaciones → activar. Un handoff (motivo `cliente`/`modelo`/
    `error`/`ventana`) produce una notificación con el contacto + motivo en <5s.
12. Tocar la notificación → abre `/inbox?conversation=<id>` directo al hilo.
13. Una conversación `is_test` (Laboratorio) NUNCA dispara push real.

## Camino infeliz

14. Navegador sin soporte push o permiso denegado → sin push y sin error
    (degradación silenciosa, la app funciona normal).
15. VAPID ausente → el toggle queda deshabilitado y la app funciona normal.
