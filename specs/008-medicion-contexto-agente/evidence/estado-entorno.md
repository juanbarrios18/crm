# Estado del entorno — feature 008

Nota de traspaso operativa. Lo que un agente nuevo necesita saber y **no** está
deducible de `spec.md`, `plan.md` o `tasks.md`. Estado al 2026-09-19.

## Repositorio

- Rama de trabajo: `fix/guard-respuesta-y-anotacion`, HEAD `5dc9d3a`.
- `scripts/` está **excluido** de `tsconfig.json`. Los errores del LSP sobre
  `scripts/*.ts` (`Cannot find module '@/…'`, `implicitly any`) son ruido: esos
  archivos no se typechecan. La verificación real es bundlearlos y ejecutarlos.
- `pnpm lint` falla, pero **solo** dentro de `.agents/`, el directorio de skills
  sin trackear que ya estaba antes de esta feature. Verificado:
  `npx eslint <archivos de src> ` sale limpio. No es una regresión de 008.

## Bases de datos

| Base | Rol | Estado |
|---|---|---|
| `vocero` (local, docker `vocero-dev-postgres-1`) | Desarrollo | Migrada a 0014 |
| `vocero_baseline` (local, mismo contenedor) | **Réplica de PROD para medir** | Restaurada del respaldo, migrada a 0014 |
| PROD (Hetzner, `ssh vocero`) | Producción | 14 migraciones (0000-0013), **al día**. NO aplicarle 0014 |

`vocero_baseline` es una réplica fiel de PROD: misma organización
(`org_e6fex2ojc1j7x5l6jdz2`), `run_ttbdykydfvz7sfb309tk` con score 42, sus 39
casos con transcripts, y la configuración vieja (voseo, `criteria` NULL, KB de 1
fila). El id de organización local del dev (`org_jmn79z7oz6o1waxad5qu`) es
**distinto**, por eso se eligió una base aparte en vez de remapear.

### Apuntar un comando a otra base sin tocar `.env`

`node --env-file` **no pisa** una variable ya definida en el entorno (verificado).
Eso permite:

```bash
export DATABASE_URL=$(node -e "const fs=require('fs');const m=fs.readFileSync('.env','utf8').match(/^DATABASE_URL=(.*)$/m);process.stdout.write(m[1].trim().replace(/\/vocero(\?|$)/,'/vocero_baseline\$1'))")
pnpm lab:rejudge --run run_ttbdykydfvz7sfb309tk --passes 3
```

Nunca imprimir el valor: contiene la contraseña.

## Respaldo de PROD

```
~/vocero-backups/vocero-prod-2026-09-18.dump   # local
/root/vocero-prod-2026-09-18.dump              # en PROD
sha256 bb9b539fdfe8e51d906eba5b59d5abbc582b63c47ead8b77c22c3927bb40111e
```

Dump completo (`--format=custom --compress=9`, 226 KB), verificado con
`pg_restore --list` (24 tablas con datos). Tomado **antes** de cualquier
escritura y antes del seed, así que preserva el estado pre-seed.

## Evidencia de la línea base

En `specs/008-medicion-contexto-agente/evidence/`:

| Archivo | Contenido |
|---|---|
| `prod-config-2026-09-18.sql` | 30 INSERTs: 1 perfil + 5 etapas + 1 KB + 12 productos + 11 zonas |
| `run_ttb-run.jsonl` | La corrida (score 42, modelo y juez) |
| `run_ttb-cases.jsonl` | 39 casos con transcripts (veredictos 7 verde / 16 amarillo / 12 rojo / 4 nulos) |
| `SHA256SUMS` | Hashes de los tres |
| `estado-entorno.md` | Este archivo |

## Variables de entorno agregadas

- `JUDGE_TIMEOUT_MS` (default `120000`): el default de `callProvider` era 60 s y
  abortaba a los jueces lentos (4 de 39 casos nulos).
- `OPENROUTER_JUDGE_TEMPERATURE` (default `0`): sin fijarla, dos pasadas del
  mismo material no son comparables.

Ambas son opcionales con default: `.env` no necesita cambios. Documentadas en
`.env.example`. Las herramientas de archivo tienen **denegado** el acceso a
`.env.*` por reglas del entorno; se editan por shell con autorización del dueño.

## Disciplina de entorno (footgun)

- El **Laboratorio** exige `WA_MOCK_ENABLED=false`: hace llamadas reales.
- El **self-test E2E** exige `WA_MOCK_ENABLED=true`: usa mocks.
- Alternar mal da mediciones inválidas **sin error visible**.

## Cómo medir

```bash
# 1) congelar la instantánea de una corrida (la hace reconstruible)
DATABASE_URL=<baseline> pnpm lab:rejudge --snapshot-run <runId>

# 2) re-juzgar N veces el mismo material y ver el piso de ruido
DATABASE_URL=<baseline> pnpm lab:rejudge --run <runId> --passes 3
```

El re-juez es reanudable: una corrida de re-evaluación sin terminar queda
`running` y la próxima invocación la **reusa** y salta las pasadas ya
registradas. No crear una nueva en cada intento.

## Hecho

T001, T002, T003, T004, T101, T102, T103 (\~), T107, T109, T301, T302, T303,
T304, T501.

## Próximo

T205/T307 (correr el re-juez y publicar el piso de ruido), luego la fase 5
(reglas del juez). **Antes de la fase 6** (escrituras a PROD) conviene cortar y
revisar con el dueño.
