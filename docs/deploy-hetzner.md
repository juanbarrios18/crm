# Deploy a producción — Hetzner (instancia Lamas Foods)

Runbook de la instancia productiva. **Regla de oro: la imagen se buildea
FUERA del VPS** y se transfiere con `docker save | ssh ... docker load`. El VPS
tiene 4 GB de RAM y `next build` lo tumba (pico de memoria).

## Deploy automático (CI)

Al **mergear a `main`**, GitHub Actions (`.github/workflows/deploy.yml`) corre
el gate (`typecheck` + `lint` + `test`), buildea la imagen en el runner y la
despliega por SSH al VPS (mismo mecanismo `docker save | docker load` del
runbook manual). El deploy solo se ejecuta si el gate pasa.

Secrets requeridos en GitHub (Settings → Secrets and variables → Actions):

| Secret | Valor |
|---|---|
| `VPS_HOST` | `91.98.92.59` |
| `VPS_USER` | `root` |
| `VPS_PATH` | `/opt/vocero` |
| `VPS_SSH_KEY` | contenido de `~/.ssh/id_ed25519_oracle` |
| `VPS_PORT` | `22` (opcional) |
| `VPS_KNOWN_HOSTS` | host key del VPS (opcional; sin él se usa `ssh-keyscan`) |

La imagen se carga con doble tag: `vocero-crm:latest` y
`vocero-crm:sha-<commit>`. Los tags `sha-*` quedan en el VPS y habilitan el
rollback sin rebuild (ver abajo).

## Destino

| Dato | Valor |
|---|---|
| Alias SSH | `vocero` (`~/.ssh/config`, `IdentityFile ~/.ssh/id_ed25519_oracle`) |
| Host | `91.98.92.59` (Hetzner, Falkenstein, `lamas-food-ubuntu-4gb-fsn1-2`) |
| Dominio | `https://lamasfood.duckdns.org` (DuckDNS) |
| Directorio | `/opt/vocero` (`docker-compose.yml`, `Caddyfile`, `.env`) |
| Imagen | `vocero-crm:latest` (tag local = tag en VPS) |
| Stack | `vocero-app-1` + `vocero-postgres-1` + `vocero-caddy-1` |

## Runbook de redeploy manual (fallback)

El flujo normal es el CI automático. Este runbook solo aplica si el CI no está
disponible o querés desplegar sin pushear a `main`. Desde el repo local
(`/home/juanbarrios18/Development/crm`), con los cambios ya en el working tree:

```bash
# 1. Build local (multi-stage; los secretos NO van en build)
docker build -t vocero-crm:latest .

# 2. Transferir la imagen al VPS (318 MB aprox.)
docker save vocero-crm:latest | ssh vocero docker load

# 3. Recrear el stack (las migraciones corren al boot del contenedor)
ssh vocero 'cd /opt/vocero && docker compose up -d'
```

`docker compose up -d` recrea `app` solo si cambió el id de imagen (compose
compara el digest). Postgres y Caddy quedan intactos.

## Verificación post-deploy

```bash
# contenedores sanos + health local y por dominio
ssh vocero 'docker ps --format "{{.Names}}\t{{.Status}}\t{{.Image}}"'
ssh vocero 'docker exec vocero-app-1 wget -q -O - http://127.0.0.1:3000/api/health'
curl -s -o /dev/null -w "%{http_code}\n" https://lamasfood.duckdns.org/api/health   # → 200

# logs del arranque (debe decir "migraciones aplicadas" + "Ready")
ssh vocero 'docker logs --tail 30 vocero-app-1'

# confirmar que la imagen del VPS es la recién buildeada
docker inspect --format '{{.Id}}' vocero-crm:latest | cut -c1-19        # local
ssh vocero 'docker inspect --format "{{.Id}}" vocero-crm:latest | cut -c1-19'
```

Criterio de verde: `{"ok":true}` local, `200` por dominio, `app` en `(healthy)`,
y el id de imagen local == VPS.

## Rollback

El CI deja en el VPS los tags `vocero-crm:sha-<commit>` de cada deploy. Para
volver a un commit bueno sin rebuild:

```bash
ssh vocero 'docker images vocero-crm --format "{{.Tag}}\t{{.ID}}\t{{.Size}}"'

# volver al commit bueno (tag sha-... que quedó en el VPS)
ssh vocero 'cd /opt/vocero && docker tag vocero-crm:sha-<commit-bueno> vocero-crm:latest && docker compose up -d'
```

Como el deploy es por tag mutable, el rollback manual (sin CI) es rebuildear
desde el commit bueno:

```bash
git checkout <commit-bueno>
docker build -t vocero-crm:latest .
docker save vocero-crm:latest | ssh vocero docker load
ssh vocero 'cd /opt/vocero && docker compose up -d'
```

> Las migraciones de Drizzle son versionadas y aplicadas al arrancar. Un
> rollback de imagen **no** revierte migraciones ya aplicadas: revisar
> `drizzle/` antes de retroceder.

## Notas

- **Nunca** correr `docker compose up -d --build` en el VPS (OOM).
- `.env` productivo vive solo en `/opt/vocero/.env` (nunca en git).
- `MEDIA_DIR=/data/media` montado en el volumen nombrado `vocero_media`.
- Caddy emite/renueva el certificado Let's Encrypt automáticamente vía DuckDNS.
- `AGENT_COALESCE_MS=2000` en producción (debounce del agente).
- **Web Push (006)**: las claves VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`) van en `/opt/vocero/.env` **y** deben estar expuestas en el
  servicio `app` de `/opt/vocero/docker-compose.yml`. Sin ellas el push degrada
  en silencio (el toggle pide permiso pero nunca suscribe). El CI no sincroniza
  el compose: si cambiás `docker-compose.yml` en el repo, copialo al VPS
  (`scp docker-compose.yml vocero:/opt/vocero/`) y corré `docker compose up -d`.
