# Data Model: push_subscription

Entidad nueva de la feature 006 (responsive + PWA + push). El resto del modelo
(conversaciones, contactos, mensajes, handoff) se reutiliza sin cambios.

## push_subscription

Una suscripción Web Push por usuario y dispositivo. Un usuario puede tener varias (móvil +
tablet + escritorio).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | nanoid con prefijo `ps_` |
| `organization_id` | text NOT NULL | scoping multi-tenant (Principio III), índice org-first |
| `user_id` | text NOT NULL | el usuario logueado dueño de la suscripción |
| `endpoint` | text NOT NULL UNIQUE | URL del servicio push (provee el navegador); clave natural |
| `p256dh` | text NOT NULL | clave pública del cliente (URL-safe base64); **cifrada** con `lib/crypto` |
| `auth` | text NOT NULL | secreto de autenticación del cliente; **cifrada** con `lib/crypto` |
| `created_at` | timestamptz NOT NULL | default now |
| `updated_at` | timestamptz NOT NULL | default now |

**Índices**: UNIQUE `(endpoint)` · `(organization_id)` · `(organization_id, user_id)`.

**Idempotencia**: subscribe = upsert por `endpoint` (`onConflictDoUpdate`). Un mismo
dispositivo re-suscribiendo actualiza `p256dh`/`auth` sin duplicar.

**Cifrado (Principio I)**: `auth` y `p256dh` se cifran al escribir y se descifran al enviar,
reutilizando `lib/crypto` (AES-256-GCM). El `endpoint` va en claro (no es secreto; es la URL a
la que se POSTea). La VAPID privada NO vive en la tabla: va en env (`VAPID_PRIVATE_KEY`).

**Ciclo de vida**: al enviar, un `404/410` del endpoint (suscripción expirada / usuario
desinstaló la PWA) elimina la fila. Un usuario que desactiva las notificaciones en la UI
llama `DELETE /api/push/unsubscribe` y se borran sus filas.

**Relaciones**: pertenece a una organización (y a un usuario de Better Auth). No tiene FK al
dominio de conversaciones: el disparo es por organización, no por conversación (el payload de
la notificación lleva `conversationId` para el deep link, sin FK).
