# Research — Asistente comercial con contexto de negocio (005-asistente-comercial)

Decisiones tomadas durante el diseño (DV-n). Cada una registra el problema, la decisión y
por qué se descartaron alternativas. Donde hay supuesto pendiente, queda explícito
(Principio VII).

## DV-001 — Costo del producto en tabla separada, no columna

**Problema**: El costo (COGS) es sensible y NO debe salir por ninguna superficie pública
(agente comercial, web). Si fuera una columna de `product`, un error de proyección lo
filtraría.

**Decisión**: `product_cost` como tabla 1:1 separada de `product`. La separación es
ESTRUCTURAL, no solo por disciplina: las queries públicas y el prompt del agente consultan
`product` y no pueden JOINear `product_cost`.

**Alternativas descartadas**: (a) columna `costo` en `product` + DTO que la oculta —
depende de disciplina y un bug expone el dato; (b) dos tablas de catálogo (público e
interno) — duplica el catálogo y arriesga drift. Elegida la tabla separada por garantía
estructural (Principio I).

## DV-002 — Render-into-context, no tools

**Problema**: ¿Cómo hace el agente comercial para conocer el catálogo y las zonas?

**Decisión**: Inyectar el catálogo (proyección pública) y las zonas activas en el system
prompt (`renderCatalog` / `renderDeliveryZones`), leyéndolos de la BD. Coherente con el
patrón `renderKb` ya existente en `src/server/ai/prompts.ts`.

**Alternativas descartadas**: tools/función-calling del agente (`consultar_catalogo`) —
mayor complejidad (loop de llamadas) sin beneficio con 13 SKUs y 11 comunas. Se migra a
tools cuando el catálogo crezca o necesite búsqueda fina (documentado en el spec).

**Supuesto**: el catálogo cabe en contexto del modelo (13 filas hoy). El contador de tamaño
del KB existente documenta honestamente los límites.

## DV-003 — Reglas comerciales en `agent_profile`, no en código

**Problema**: Las reglas del negocio (mínimos, modalidades, cobertura, crédito, "a quién
vendemos") hoy viven quemadas en el prompt de n8n.

**Decisión**: Se configuran como comportamiento del agente (`agent_profile.instructions` /
`escalation_rules`) en la instancia. El producto aporta la CAPACIDAD (tablas + render), no
las reglas de Lamas Foods. No se codean reglas de un cliente en el repo (producto MIT,
multi-cliente).

## DV-004 — Endpoint público reutiliza `resolveInstanceOrg`

**Problema**: `GET /api/public/products` no tiene sesión; ¿a qué organización consulta?

**Decisión**: Reutilizar `resolveInstanceOrg()` de `src/server/bot/auth.ts` (una instancia =
un negocio). Devuelve 404 si no hay org o 500 si hubiera más de una (invariante de instancia).

## DV-005 — Monedas como `numeric(12,4)` y normalización en import

**Problema**: El CSV trae precios con coma decimal local (`"2641,8"`, `4284`) y sin separador
de miles.

**Decisión**: `numeric(12,4)` en BD; el import normaliza `"2.641,8"`/`"2641,8"` → `2641.8`
(quitar puntos de miles, coma → punto) antes del upsert.

## DV-006 — El `update_lead` gana campos estructurados, no solo nota

**Problema**: El agente hoy solo anexa una nota libre (`appendLeadNote`). El lead
enriquecido necesita campos tipados (empresa, comuna, RUT…).

**Decisión**: Extender `update_lead` del `AgentAction` (unión discriminada en
`src/server/ai/actions.ts`) con campos opcionales estructurados; el pipeline los aplica a
`contact` (último valor gana). La nota libre se conserva.

## Pendientes (supuestos explícitos, Principio VII)

- **DV-007**: La data de comunas con tarifa de despacho NO está disponible aún; `delivery_zone`
  se construye pero queda vacía hasta que el negocio la provea.
- **DV-008**: Los costos (COGS) no existen hoy; `product_cost` nace vacía.