# Deploy a producción — Hetzner (instancia Lamas Foods)

Runbook de la instancia productiva. **Regla de oro: la imagen se buildea
FUERA del VPS** y se transfiere con `docker save | ssh ... docker load`. El VPS
tiene 4 GB de RAM y `next build` lo tumba (pico de memoria).

## Destino

| Dato | Valor |
|---|---|
| Alias SSH | `vocero` (`~/.ssh/config`, `IdentityFile ~/.ssh/id_ed25519_oracle`) |
| Host | `91.98.92.59` (Hetzner, Falkenstein, `lamas-food-ubuntu-4gb-fsn1-2`) |
| Dominio | `https://lamasfood.duckdns.org` (DuckDNS) |
| Directorio | `/opt/vocero` (`docker-compose.yml`, `Caddyfile`, `.env`) |
| Imagen | `vocero-crm:latest` (tag local = tag en VPS) |
| Stack | `vocero-app-1` + `vocero-postgres-1` + `vocero-caddy-1` |

## Runbook de redeploy

Desde el repo local (`/home/juanbarrios18/Development/crm`), con los cambios ya
en el working tree:

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

Como el deploy es por tag mutable, el rollback es volver a cargar la imagen
anterior (si se conservó el tar) o rebuildear desde el commit bueno:

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
