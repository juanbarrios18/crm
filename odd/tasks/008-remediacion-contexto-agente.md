# Tarea: remediación del plan `run_ejf1ffwxlmifjeeh315f` (008)

## Objetivo

Implementar el plan de mejoras de
`specs/008-medicion-contexto-agente/plan-run-ejf1ffwxlmifjeeh315f.md`: eliminar
incumplimientos comerciales y promesas sin respaldo, distinguir defectos del
agente/flujo/juez sobre el mismo material, y dejar verificación determinista.

## Problema

La corrida terminó con score 77 y 39 casos (26 verde / 5 amarillo / 8 rojo), con
14 hallazgos: 4 `alucinacion`, 4 `debio_escalar`, 3 `tono`, 2 `pipeline`, 1
`afirmacion_sin_evidencia`. Hay incumplimientos comerciales confirmados
(despacho a persona natural, despacho "sin costo", "48 horas hábiles"), escalados
omitidos, capacidades inventadas, un error comercial que el juez omitió, y dos
amarillos de pipeline tras handoff de causa desconocida.

## Por qué

El score agregado no mide calidad real: mezcla defectos del agente con ruido del
juez y errores de flujo. Sin separarlos no se puede corregir ni volver a medir.

## Alcance autorizado

- Repositorio local, sin tocar PROD, sin SSH, sin corridas pagadas del Laboratorio.
- Archivos de agente/flujo/lab y sus tests, más fixtures versionados.
- Los JSONL de evidencia y `evidence/SHA256SUMS` son INMUTABLES (solo lectura).

Fuera de alcance: fine-tuning, servicios externos, acceso nuevo a pedidos,
esconder amarillos cambiando expectativas, corridas nuevas del Laboratorio.

## Restricciones

- Orden RED → GREEN → REFACTOR por unidad, y
  `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- Registro de artefactos: español neutro profesional; el texto de negocio
  (chileno, usted) se cita, no se reescribe en voseo.
- Regla de atribución: no cambiar a la vez config del negocio, agente, juez y
  personas del Laboratorio en la misma unidad.
- Decisión de producto pendiente (P2/P4) se consulta antes de codificar.

## Checklist

- [x] T001 P0 — Verificar SHA-256 de ambos JSONL contra `SHA256SUMS` (coinciden;
      se anota hash y tamaño en el progreso).
- [x] T002 P0 — Guard de integridad de evidencia + fixture minimizado con
      etiquetas humanas (`tests/fixtures/lab/remediacion-ejf1-cases.json`, 13
      casos; `tests/unit/lab-remediacion-fixtures.test.ts`).
- [x] T003 P1a — Elegibilidad de despacho determinista (`commercial-rules.ts`,
      con guarda de negación para que la respuesta correcta de retiro no caiga).
- [x] T004 P1b — Despacho gratuito, "48 horas hábiles" y subtotal vs total.
- [x] T005 P1c — Historial y capacidades no simuladas.
- [x] T006 P2 — Escalado por precio especial con número, envío de boleta por
      correo, consulta de historial y detección de respuesta repetida.
- [x] T007 P3 — Diagnóstico causal: H1 y H3 refutadas por código; H2 necesaria
      pero no suficiente (2 contraejemplos). Corrección: avance determinista por
      intención de compra explícita.
- [x] T008 P4 — Contradicción de rúbrica resuelta en tres categorías; controles
      de hechos (hábiles, subtotal) y tono; políticas del dueño incorporadas.
- [x] T009 Verificación — gate técnico verde y E2E de comportamiento 101/101.

## Criterios de aceptación

- Cero ofertas/encaminamientos de despacho a persona natural en fixtures y
  variaciones; cero despacho gratuito; cero «hábiles» añadido sin fuente; cero
  estados/capacidades inventados; subtotal ≠ total cuando falta composición.
- 100 % de fixtures de descuento inequívoco con handoff real; cero handoffs en
  controles de mera consulta de precio.
- Explicación causal reproducible de los dos amarillos de pipeline.
- Contradicción de rúbrica resuelta; negaciones honestas no penalizadas.
- Gate técnico verde sin regresión de casos ya verdes.

## Checks aplicables

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`; E2E con `pnpm dev` +
mocks si la base está limpia. Sin corridas del Laboratorio.

## Progreso

- 2026-09-19: T001 verificado. SHA-256 de `run_ejf1ffwxlmifjeeh315f-run.jsonl`
  = `7c3ae82f…`, 5.334 bytes; `run_ejf1ffwxlmifjeeh315f-cases.jsonl`
  = `9330f818…`, 77.049 bytes; ambos coinciden con `evidence/SHA256SUMS`.
  Reconocimiento de código hecho (pipeline, prompts, reply-guard, handoff,
  runner, judge, snapshot, personas).

### Unidades de trabajo (commits)

| Commit | Unidad | Tests |
|---|---|---|
| `cf52b1e` | P0 — evidencia congelada + fixture etiquetado | 8 |
| `32eea88` | P1 — reglas comerciales deterministas | 44 |
| `f689298` | P2 — escalado y continuidad | 60 |
| `f6957a7` | P3 — diagnóstico causal de pipeline | 9 |
| `98c032d` | P3 — avance por intención de compra | 53 |
| `5e6e837` | P4 — calibración de la rúbrica | 65 |
| `c534c7a` | E2E — self-test del handoff y la precisión | 101 checks |

### Decisiones del dueño (2026-09-19)

- Consulta de historial: negar Y escalar en el mismo turno.
- Envío de boleta/factura por correo: negar Y escalar en el mismo turno.
- Anomalías de pipeline: avance determinista por intención de compra explícita.

### Verificación

- `pnpm typecheck` + `pnpm lint` + `pnpm build` + `pnpm test` en verde.
- E2E de comportamiento: **101/101**, sobre base recién migrada y sembrada, con
  `WA_MOCK_ENABLED=true` y `AGENT_COALESCE_MS=0`. El check 005 del arnés dormía
  2,5 s contra un debounce por defecto de 6 s: era un fallo de tiempo, no de
  lógica. Ver `tests/e2e/013-remediacion-ejf1.md`.

### Límites honestos

- No se ejecutó ninguna corrida nueva del Laboratorio (no había autorización de
  coste): la medición de score por estrato queda pendiente de esa autorización.
- Los 11 fallos de `tests/unit/reply-guard.test.ts` en la suite completa son de
  otro trabajo concurrente en el mismo worktree (T001–T005, nombre/precios),
  ajenos a esta tarea: sus 137 tests propios pasan.
- P1 se validó por contrato determinista y E2E, no por el juez real.

## Próximo paso

Re-medir el Laboratorio por estrato **solo** con autorización de coste, y
actualizar `specs/008-medicion-contexto-agente/tasks.md` con los resultados
observados.
