# Tasks: Asistente comercial con contexto de negocio

**Input**: Design documents from `/specs/005-asistente-comercial/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/public-catalog.md

**Tests**: Vitest unit + guion E2E (gate del proyecto, Principios V y IX).

**Organization**: Tasks grouped by user story; cada historia es implementable y testeable
de forma independiente.

## Phase 1: Foundational (bloquea todas las user stories)

**Purpose**: schema + proyecciones + queries, la base que todas las stories consumen.

- [x] T001 Crear tablas en `src/lib/db/schema.ts`: `product`, `product_cost`,
      `delivery_zone` (con `organization_id` NOT NULL, índices org-first, UNIQUE de SKU y de
      comuna) y generar migración (`pnpm db:generate`).
- [x] T002 [P] Agregar columnas comerciales a `contact` en `src/lib/db/schema.ts`:
      `empresa`, `rubro`, `comuna`, `rut`, `razon_social`, `giro`, `direccion_facturacion`,
      `email`, `frecuencia_despacho`, `volumen_semanal`, `producto_interes`, `formato`
      (text nullable) y regenerar migración.
- [x] T003 [P] Crear `src/lib/catalog.ts` con `PublicProductSchema` y
      `InternalProductSchema` (Zod) + `serializePublicProduct` / `serializeInternalProduct`
      y helper `parseLocalPrice` (normaliza `"2.641,8"` → `2641.8`).
- [x] T004 [P] Crear `src/server/catalog/queries.ts`: `getActiveProductsPublic(orgId)` y
      `getActiveZones(orgId)` (scoped, solo proyección pública; NO JOIN a `product_cost`).

**Checkpoint**: la capa de datos está lista para las stories.

## Phase 2: User Story 1 — Catálogo con costo privado (P1)

**Goal**: el catálogo se importa idempotente y la proyección pública nunca incluye el costo.

**Independent Test**: `pnpm seed:products --file=...` → 13 SKUs; re-importar no duplica;
`GET /api/public/products` no contiene costo.

- [x] T005 [US1] Crear `src/server/catalog/import.ts` con `upsertProductsFromCsv(db, orgId,
      csvText)` — parseo simple del CSV (comillas), `parseLocalPrice`, upsert por
      `(org, producto, masa, formato)`.
- [x] T006 [US1] Crear `scripts/seed/products.ts` (esbuild, patrón de `seed:demo`) que
      lea un archivo CSV (arg/env) y llame `upsertProductsFromCsv`; agregar script
      `seed:products` en `package.json`.
- [x] T007 [P] [US1] Unit test `tests/unit/catalog-import.test.ts`: normalización de
      decimales (`"2641,8"`, `4284`), upsert idempotente, SKU duplicado en el CSV.
- [x] T008 [P] [US1] Unit test `tests/unit/catalog-projection.test.ts`:
      `serializePublicProduct` NO contiene `costo`/`margen` aunque el row los tenga;
      `PublicProductSchema` rechaza payload con campo extra.

**Checkpoint**: US1 completa y testeable independientemente.

## Phase 3: User Story 2 — Zonas de envío (P1)

**Goal**: las comunas con cobertura y tarifa pública existen y el agente puede usarlas.

**Independent Test**: cargar una zona → la consulta la devuelve; comuna sin tarifa →
`null` declarado como "sin tarifa definida".

- [x] T009 [US2] CRUD mínimo de `delivery_zone` vía `src/server/catalog/queries.ts`
      (getActiveZones ya existe; agregar `upsertZone`) + seed/import simple (script o
      endpoint). La tarifa queda NULL hasta que el negocio provea la data (DV-007).
- [x] T010 [P] [US2] Unit test `tests/unit/zones.test.ts`: upsert por comuna idempotente,
      tarifa NULL manejada.

**Checkpoint**: US2 completa.

## Phase 4: User Story 3 — Lead enriquecido (P1)

**Goal**: el agente captura campos comerciales estructurados del lead durante la charla.

**Independent Test**: conversación con ai-mock donde el cliente da empresa/comuna/volumen →
la ficha del contacto se enriquece.

- [x] T011 [US3] Extender `AgentAction` en `src/server/ai/actions.ts`: `update_lead` acepta
      campos opcionales (`empresa`, `rubro`, `comuna`, `rut`, `razon_social`, `giro`,
      `direccion_facturacion`, `email`, `frecuencia_despacho`, `volumen_semanal`,
      `producto_interes`, `formato`), además de la `note` existente.
- [x] T012 [US3] En `src/server/ai/pipeline.ts`, aplicar los campos estructurados a
      `contact` (último valor gana) junto a `appendLeadNote`; validar contra los valores
      permitidos del enum.
- [x] T013 [P] [US3] Unit test `tests/unit/lead-enrich.test.ts`: campos aplicados, último
      valor gana, contacto BSUID sin teléfono funciona.

**Checkpoint**: US3 completa.

## Phase 5: User Story 4 — Agente comercial con contexto (P1)

**Goal**: el agente responde con catálogo + zonas inyectados (proyección pública), reglas
comerciales respetadas, y NUNCA ve el costo.

**Independent Test**: ai-mock → cliente pregunta precio y cobertura → el agente responde
con datos reales; producto inexistente → no inventa.

- [x] T014 [US4] En `src/server/ai/prompts.ts`, agregar `renderCatalog(products)` y
      `renderDeliveryZones(zones)` (proyección pública, texto plano legible) y extender
      `buildAgentSystemPrompt` para inyectarlas (patrón `renderKb`).
- [x] T015 [US4] En `src/server/ai/pipeline.ts`, cargar catálogo público + zonas activas
      (scoped) y pasarlas al builder del prompt.
- [x] T016 [P] [US4] Unit test `tests/unit/prompts-catalog.test.ts`: el prompt contiene el
      catálogo público; NO contiene `costo`/`margen`/claves internas.
- [x] T017 [P] [US4] Guion E2E `tests/e2e/010-asistente-comercial.md` (feliz e infeliz:
      cotiza real, no inventa, sin cobertura → retiro, crédito → política, humano → handoff)
      y extender `scripts/e2e-selftest.mjs`.

**Checkpoint**: US4 completa — el agente comercial funciona como el MVP del negocio.

## Phase 6: User Story 5 — Catálogo público para la web (P2)

**Goal**: `GET /api/public/products` alimenta la web con la proyección pública.

**Independent Test**: `curl /api/public/products` → solo activos, sin costo.

- [x] T018 [US5] Crear `src/app/api/public/products/route.ts`: `GET` sin auth, usa
      `resolveInstanceOrg()` (404 sin org), devuelve `getActiveProductsPublic` validado por
      `PublicProductSchema`.
- [x] T019 [P] [US5] Unit test `tests/unit/public-products-route.test.ts`: 404 sin org,
      solo activos, sin costo, shape válido.

## Phase 7: Verificación y cierre

**Purpose**: gate completo + validación en vivo (Principio IX).

- [x] T020 Verificación completa: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
      + validación en vivo del flujo 005 (import → agente cotiza → lead enriquece → endpoint
      público) contra la app con mocks. [Gate técnico ✅ en verde; validación en vivo ✅:
      catálogo (12 SKUs) y zonas (11 comunas) importados a la BD, `GET /api/public/products`
      sirve la proyección pública sin costo, inbound de lead se persiste, ai-mock responde.
      PENDIENTE solo la configuración del agente comercial en la instancia: activarlo +
      portar las reglas del negocio a `agent_profile.instructions`/`escalation_rules`.]
- [x] T021 Actualizar `specs/README.md` (indice) y marcar `004-integracion-n8n` como
      deprecada; actualizar `specs/005/...` con el estado final.

## Dependencies & Execution Order

- **Phase 1** bloquea todas las stories (T001–T004 primero).
- **US1 → US2 → US3 → US4 → US5** en orden de prioridad; US5 no depende de US3/US4.
- **Phase 7** al final.

## Parallel Opportunities

- T001/T002 (misma migración) → luego T003/T004 en paralelo.
- Tests (T007/T008, T010, T013, T016, T019) en paralelo con sus implementaciones.
- Guion E2E (T017) en paralelo con la implementación de US4.