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
- [ ] T002 P0 — Guard de integridad de evidencia + fixture minimizado con
      etiquetas humanas (`tests/fixtures/lab/`).
- [ ] T003 P1a — Elegibilidad de despacho determinista: persona natural no
      recibe oferta/encaminamiento de despacho; identidad desconocida pregunta.
- [ ] T004 P1b — Despacho gratuito, "48 horas hábiles" y subtotal vs total.
- [ ] T005 P1c — Historial y capacidades no simuladas.
- [ ] T006 P2 — Escalado por precio especial con número y continuidad de boleta.
- [ ] T007 P3 — Diagnóstico de avance de etapa tras handoff (instrumentación +
      tests que distingan H1/H2/H3).
- [ ] T008 P4 — Contradicción de rúbrica del juez + controles negativos.
- [ ] T009 Verificación — gate técnico completo y E2E si el entorno lo permite.

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
  fact-check, runner, judge, snapshot, personas).

## Próximo paso

T002: fixture etiquetado e integridad de evidencia.
