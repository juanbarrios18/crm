# E2E 011 — Gate de adjuntos entrantes

Guion de comportamiento (Constitución IX). La parte automatizada vive en la
sección "008: gate de adjuntos entrantes" de `scripts/e2e-selftest.mjs`.

## Contexto

Mientras `WA_INBOUND_MEDIA_ENABLED` no esté en `true`, los archivos adjuntos
que el cliente manda por WhatsApp (imagen/audio/video/documento/sticker) **se
ignoran**: no se descargan ni se almacenan, el mensaje queda en el hilo sin
asset (la UI muestra el tipo con clip) y el bot responde un aviso. Ubicaciones
y contactos (payload estructurado, sin archivo) NO pasan por el gate.

Con `WA_INBOUND_MEDIA_ENABLED=true` el comportamiento vuelve al camino completo
de 008 (descarga + preview) sin tocar código.

## Escenarios (automatizados)

| Escenario | Check del selftest |
|---|---|
| Gate activo: imagen entrante | "conversación del lead de adjuntos creada" + "imagen entrante queda en el hilo SIN asset" |
| Gate activo: aviso al cliente | "se respondió el aviso de adjuntos no soportados" (mensaje saliente origin=operator) |
| Gate activo: el resto del flujo sigue normal | ubicación entrante con payload directo (no gateada), textos y agente intactos |
| Media habilitado (`WA_INBOUND_MEDIA_ENABLED=true`) | se ejercita US3 de 008 completo (preview de binarios entrantes) |

## Unitary

- `tests/unit/inbound-media-gate.test.ts` → `isInboundMediaBlocked` para cada
  tipo binario, con y sin la flag, y la exclusión de texto/ubicación/contactos.

## Pasos visuales (Playwright, al cerrar la feature)

1. Login → Inbox → conversación de un lead que mandó una foto: el hilo muestra
   la burbuja entrante con clip 📎 "Imagen" y el aviso del bot debajo.
2. El aviso se ve como mensaje saliente normal (sin badge IA).

## En vivo (producción)

1. Desde la línea de pruebas enviar una foto y un documento → en el CRM quedan
   como "Imagen/Documento" sin preview y el número recibe el aviso de adjuntos
   no soportados.
2. Cuando se habilite el procesamiento, repetir la prueba con
   `WA_INBOUND_MEDIA_ENABLED=true` → previews normales.