# Deploy producción Hetzner (Lamas Foods)

- **Destino**: `ssh vocero` → `91.98.92.59` (Hetzner FSN1, 4 GB RAM), dominio
  `https://lamasfood.duckdns.org`, directorio `/opt/vocero`, imagen
  `vocero-crm:latest`.
- **Regla**: buildear FUERA del VPS (4 GB → `next build` hace OOM). Nunca
  `docker compose up -d --build` en el VPS.
- **Redeploy**: `docker build -t vocero-crm:latest .` → `docker save vocero-crm:latest | ssh vocero docker load` → `ssh vocero 'cd /opt/vocero && docker compose up -d'`.
- **Verde**: `{"ok":true}` en `/api/health` local, `200` por dominio, `app`
  `(healthy)`, id de imagen local == VPS.
- **Migraciones**: Drizzle corre al boot del contenedor (`node migrate.mjs &&
  node server.js`). Rollback de imagen NO revierte migraciones.
- **Runbook completo**: `docs/deploy-hetzner.md` del repo.
