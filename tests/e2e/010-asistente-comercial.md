# E2E — Asistente comercial con contexto de negocio (005)

Precondición: app corriendo con mocks (`WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `OPENROUTER_BASE_URL` → ai-mock),
organización creada, conexión WhatsApp guardada (`PN-E2E-1`), BD migrada y
agente activo con instrucciones comerciales.

El catálogo y las zonas se siembran en la BD (proyección pública). El agente
comercial cotiza desde la BD y enriquece el lead; el costo interno NUNCA sale.

## US1 — Catálogo y proyección pública

1. Seed del catálogo (CSV de ejemplo) → `pnpm seed:products --file=...`.
2. `GET /api/public/products` → **200** `{products:[...]}` solo activos, y
   NINGÚN elemento contiene `costo`/`margen`.
3. Re-ejecutar el seed → la misma cantidad de productos (idempotente, sin duplicar).

## US4 — El agente comercial cotiza desde la BD

4. Enviar inbound de un lead nuevo (wa-mock): *"¿Cuánto cuesta el pan de
   hamburguesa brioche 12 cm?"* → el agente responde con el precio real del
   catálogo (no lo inventa).
5. El mismo lead pregunta: *"¿hacen despacho a Macul?"* → el agente responde
   con la tarifa de la zona (o retiro si sin cobertura).
6. El lead aporta: *"somos Lomas Cafetería, en Ñuñoa, unas 30 bolsas semanales"*
   → `GET /api/contacts/{id}` muestra `empresa`, `comuna`, `volumenSemanal`
   enriquecidos (FR-021).

## Camino infeliz

7. El lead pregunta por un producto que NO está en el catálogo → el agente NO
   inventa un precio (responde que confirmará o escala).
8. El lead pide crédito → el agente responde la política (transferencia previa).
9. El lead pide un humano → **handoff** (badge + IA silenciada).
10. Comuna sin cobertura → el agente ofrece retiro y registra la comuna.