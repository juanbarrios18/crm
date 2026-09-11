# Implementation Plan: Asistente comercial con contexto de negocio

**Branch**: `005-asistente-comercial` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-asistente-comercial/spec.md`

## Summary

Vocero pasa a ser el centro de la conversación comercial (se descarta el camino n8n de la
004). Se agrega el contexto de negocio al agente nativo: catálogo de productos con costo
privado, zonas de envío con tarifa pública y leads enriquecidos. El agente comercial lee
catálogo (proyección pública) y zonas desde la BD y los inyecta en el prompt
(render-into-context), replicando el comportamiento del asistente de n8n sin Google Sheets.
Los costos internos viven en una tabla separada y quedan fuera de toda salida pública.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22

**Primary Dependencies**: Next.js 15 (App Router) · Drizzle ORM · Zod · nanoid (IDs con prefijo)

**Storage**: PostgreSQL 16 — tablas nuevas `product`, `product_cost`, `delivery_zone`;
`contact` se extiende con campos comerciales. Todo `organization_id` NOT NULL + `scoped()`.

**Testing**: Vitest (unit) + guion E2E en `tests/e2e/` conducido por `scripts/e2e-selftest.mjs`

**Target Platform**: VPS Linux self-hosted (Coolify o compose + Caddy); superficie server-side

**Project Type**: Aplicación web monolítica (un solo paquete)

**Performance Goals**: agente con catálogo inyectado responde con la misma latencia que hoy
(catálogo = 13 filas, trivial); `GET /api/public/products` <200ms

**Constraints**: proyección pública/privada definida UNA vez en Zod · el costo NUNCA llega al
agente comercial ni al endpoint público · sin colas externas · import idempotente por SKU ·
la reglas comerciales se configuran en `agent_profile` (no se codean)

**Scale/Scope**: una instancia = un negocio; 3 tablas nuevas + extensión de `contact` + 1
endpoint público + cambios en prompt/acción del agente

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación | Estado |
|---|---|---|
| I. Seguridad de Datos | El costo (dato sensible) vive en tabla separada `product_cost`; ninguna salida pública lo expone (contrato Zod + separación estructural). No hay secretos nuevos. | ✅ |
| II. Soberanía (endurecida) | Se RETIRA la dependencia de n8n (el agente nativo toma el control): MENOS dependencias externas, no más. Sin enmienda: la lista cerrada queda intacta. | ✅ |
| III. Multi-Tenancy Real | Toda tabla nueva lleva `organization_id` NOT NULL + índice org-first; toda query pasa por `scoped()`. El endpoint público resuelve la org única de la instancia. | ✅ |
| IV. Idempotencia | Import de catálogo = upsert por clave `(org, producto, masa, formato)`; re-ejecutar no duplica. | ✅ |
| V. Calidad Verificable | Gate typecheck+lint+build+Vitest; unit tests de proyección (público sin costo), normalización CSV, render del prompt, enriquecimiento de lead. | ✅ |
| VI. Specs Antes de Código | Este flujo (spec → plan → tasks → implement). | ✅ |
| VII. Trazabilidad | Decisiones DV-n en `research.md`; la data de despachos y los costos quedan como supuestos pendientes explícitos (Principio VII). | ✅ |
| VIII. Foco Vertical | Sirve a atender/organizar/convertir conversaciones de WhatsApp de UN negocio (panificadora B2B). | ✅ |
| IX. Verificación en Vivo | Self-test E2E con wa-mock + ai-mock: conversación donde el agente cotiza desde la BD y un lead se enriquece; camino infeliz (producto no encontrado → no inventa). | ✅ |

**Post-diseño (Fase 1)**: re-evaluado tras el contrato `contracts/public-catalog.md` y el
data-model — sin violaciones; sin entradas en Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/005-asistente-comercial/
├── plan.md              # Este archivo
├── research.md          # Decisiones DV-n
├── spec.md              # QUÉ y POR QUÉ
├── data-model.md        # Entidades nuevas
├── contracts/public-catalog.md  # Contrato del endpoint público
├── quickstart.md        # Cómo probar con mocks
└── tasks.md             # Tareas dependency-ordered
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── db/
│   │   └── schema.ts                # MODIFICADO — product, product_cost, delivery_zone + campos en contact
│   └── catalog.ts                   # NUEVO — PublicProductSchema / InternalProductSchema + serializers
├── server/
│   ├── catalog/
│   │   ├── queries.ts               # NUEVO — getActiveProductsPublic, getActiveZones (scoped)
│   │   └── import.ts                # NUEVO — upsertFromCsv (normaliza decimales, idempotente por SKU)
│   └── ai/
│       ├── actions.ts               # MODIFICADO — update_lead con campos estructurados
│       ├── prompts.ts               # MODIFICADO — renderCatalog + renderDeliveryZones (proyección pública)
│       └── pipeline.ts              # MODIFICADO — carga catálogo/zona y aplica campos del lead
├── app/api/
│   └── public/products/route.ts     # NUEVO — GET sin auth, proyección pública
scripts/
├── seed/
│   └── products.ts                  # NUEVO — import CSV del catálogo (esbuild, como seed:demo)
└── package.json                     # MODIFICADO — script "seed:products"

tests/
├── unit/
│   ├── catalog-projection.test.ts   # NUEVO — público excluye costo
│   ├── catalog-import.test.ts       # NUEVO — normalización + idempotencia
│   ├── prompts-catalog.test.ts      # NUEVO — render inyecta público, sin costo
│   └── lead-enrich.test.ts          # NUEVO — update_lead estructurado
└── e2e/010-asistente-comercial.md   # guion del self-test
```

**Structure Decision**: Se sigue el patrón del repo: schema en `src/lib/db/schema.ts`,
lógica de dominio en `src/server/<dominio>/`, transporte delgado en `src/app/api/`. La
proyección vive en `src/lib/catalog.ts` (cercana al schema, sin acoplar al HTTP). El
endpoint público reutiliza `resolveInstanceOrg` (ya existe en `src/server/bot/auth.ts`).

## Complexity Tracking

Sin violaciones constitucionales que justificar.