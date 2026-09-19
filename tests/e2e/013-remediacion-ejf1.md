# E2E 013 — Remediación `run_ejf1ffwxlmifjeeh315f`

Guion de comportamiento (Constitución IX). La parte automatizada vive en la
sección `013` de `scripts/e2e-selftest.mjs`. El plan que lo motiva es
`specs/008-medicion-contexto-agente/plan-run-ejf1ffwxlmifjeeh315f.md`
(sección 7: "Verificación funcional y decisión de nueva corrida"). Los casos
replicados provienen de la auditoría humana congelada en
`tests/fixtures/lab/remediacion-ejf1-cases.json`.

## Precondición

- App corriendo con `pnpm dev` (`NODE_ENV=development`: los mocks responden 404
  en producción).
- `WA_MOCK_ENABLED=true`, `OPENROUTER_BASE_URL` hacia ai-mock y
  `META_GRAPH_BASE_URL` hacia wa-mock.
- Base recién migrada y sembrada (`pnpm seed:catalog` +
  `pnpm seed:business-profile`) con el agente habilitado. No reutilizar una base
  ya usada: los `waMessageId` fijos chocan por unicidad.
- `AGENT_COALESCE_MS=0` recomendado: cada entrante dispara su turno en el acto y
  el self-test no depende del agrupamiento de mensajes.

## Idea de diseño

Las redes deterministas de 008 (`src/server/ai/handoff.ts` y
`src/server/ai/purchase-intent.ts`) corren en el pipeline ANTES del modelo. Por
eso su efecto es observable de punta a punta contra la app real sin que el
ai-mock conozca el caso: cuando el último entrante matchea el patrón de
escalado, el pipeline entrega el cierre cordial `CLOSING_FAREWELL_HUMAN` y
aplica handoff con motivo `"cliente"`. Los escenarios de intención de compra y
de consulta de precio sí llegan al modelo y se validan por su efecto
observable (respuesta saliente de IA y ausencia de handoff).

Cada escenario usa un teléfono sintético propio (canónico `52462900130x`) y
`waMessageId` únicos, para no colisionar con contactos ni conversaciones de
otras secciones.

## Escenarios (sección `013` del self-test)

| Caso | Entrante exacto | Observable esperado |
|---|---|---|
| Persona natural — historial | `me puedes decir que pedidos tengo pendientes?` | `handoffAt` presente y `handoffReason === "cliente"`; existe un saliente que contiene el cierre humano ("una persona"). |
| Descuento — `comprador_decidido#0/#2` | `y si llevo 20 me hacen precio?` | `handoffAt` presente y `handoffReason === "cliente"`. |
| Boleta por correo — `pide_boleta_pago#2` | `y me la mandan al correo?` | `handoffAt` presente y `handoffReason === "cliente"`; el saliente NO afirma haber enviado la boleta. |
| Intención de compra | `hola, quiero hacer un pedido para mi negocio` | Sin `handoffAt` (la red determinista avanza el lead, no deriva) y existe un saliente de IA. |
| Control de precisión | `cuanto sale la bolsa de brioche de 12?` | Sin `handoffAt` (una consulta de precio no corta la venta) y existe un saliente de IA. |

Checks del self-test, en orden:

1. `013: conversación de historial creada`
2. `historial → handoff con motivo cliente`
3. `el cierre de escalado llega al cliente (menciona a una persona)`
4. `descuento por volumen → handoff con motivo cliente (comprador_decidido#0/#2)`
5. `envío de boleta por correo → handoff con motivo cliente (pide_boleta_pago#2)`
6. `continuidad: el agente no afirma haber enviado la boleta`
7. `013: conversación de intención de compra creada`
8. `la intención de compra no escala por sí sola`
9. `el agente respondió el pedido sin escalar`
10. `consulta de precio simple → sin handoff (la venta sigue viva)`
11. `el agente cotizó sin escalar`

## Continuidad de boleta

El check 6 exige que ningún saliente de la conversación de boleta matchee
`/ya se la envi|se la envié|ya la enviamos/i`. El cierre determinista de
escalado no promete el envío: comunica que el caso pasa a una persona del
equipo comercial. Esta es la verificación de continuidad que el caso
`pide_boleta_pago#2` pedía (no afirmar capacidades no verificables).

## Lectura de estado

El self-test lee `GET /api/conversations` y busca por teléfono canónico
(`c.contact.phone === "52462900130x"`), igual que la sección `008`. La
conversación expone `handoffAt` y `handoffReason`. Los mensajes se leen de
`GET /api/conversations/{id}/messages` filtrando `direction === "out"`.

## Límites

- La persona natural no se prueba con un despacho falso: el guard de esa
  respuesta vive en el prompt y el ai-mock no lo produce. Lo que se comprueba es
  la conducta determinista observable (escalado por historial, descuento y
  boleta por correo).
- El camino feliz del Laboratorio (proveedor real) no forma parte de este guion:
  el self-test corre siempre contra mocks locales.
