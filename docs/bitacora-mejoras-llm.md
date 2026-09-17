# Bitácora — mejoras de la interacción con el LLM

> Documento de evidencia de la ejecución del plan
> `docs/plan-mejoras-interaccion-llm.md` (v2, 2026-09-17). Se actualiza al cerrar
> cada fase. Registro neutro impersonal.

## Precondiciones y bloqueantes resueltos al arrancar

| # | Punto | Resolución | Estado |
|---|---|---|---|
| B1 | Texto del negocio (F8) | Se aplica en desarrollo. **Corrección del dueño sobre el registro**: la configuración específica de un negocio (`agent_profile`) es DATO del negocio y va en **español chileno con trato de usted**, para que el agente capture el tono. El español neutro profesional aplica a la configuración general del CRM (código, UI, comentarios, docs). Consistente con la tabla de superficies de `AGENTS.md`. El voseo rioplatense sigue prohibido en todas las superficies. | Resuelto |
| B2 | Tabla de severidades (F7) | Aprobada la propuesta: `alucinacion`, `afirmacion_sin_evidencia` y `debio_escalar` → rojo; `fuera_de_kb` y `tono` → amarillo; sin hallazgos → verde. | Resuelto |
| B3 | Corrida del Laboratorio | Confirmado: **1 corrida**, usada una sola vez en F10. | Resuelto |
| B4 | Proveedor real | Confirmado: `OPENROUTER_BASE_URL=https://openrouter.ai/api`, `WA_MOCK_ENABLED=false`. Verificado antes de arrancar: token válido (`sk-or-v1…`, 73 chars, sin placeholder), `GET /v1/models` → HTTP 200 y un completion real con `google/gemini-2.5-flash-lite` respondido por el proveedor `Google`. | Resuelto |

**D5 — RDD**: no se activa `gentle-ai review mode` en ningún momento.

**Base de datos**: `vocero-dev-postgres-1` (postgres:16-alpine) healthy en `localhost:5432/vocero`.
196 casos de prueba en `agent_test_case`. Corrida de referencia
`run_vngfka7jq6qxcy52mcw7` (score 54, 39 casos, `google/gemini-2.5-flash-lite` +
juez `z-ai/glm-5.3-flash`).

**Discrepancia detectada en el plan (§1, línea 43)**: enumera
`docs/plan-ejecucion-nocturna.md` entre los documentos sin trackear que debían
entrar en F0. Ese archivo no existe: el contrato de la ejecución nocturna se
fusionó como `docs/bitacora-nocturna.md` en el PR #21, y ese contrato no está en
el repositorio (el propio documento lo declara "no versionado" en su encabezado).
F0 versiona los tres documentos que sí existen y son aporte de esta PR.

---

## F0 — Alineación inicial

- **Estado**: hecha
- **Rama**: `feat/mejoras-interaccion-llm`, creada con
  `git checkout -B feat/mejoras-interaccion-llm origin/main` sobre `3ea7e9a`.
- **Cambios**: alta de `docs/auditoria-interaccion-llm.md`,
  `docs/enfoque-de-negocio.md` y `docs/plan-mejoras-interaccion-llm.md`, más esta
  bitácora.
- **Evidencia**:
  - `origin/main` = `3ea7e9a` (merge del PR #21), coincide con lo declarado en el
    plan §1.
  - El guardián de registro (`tests/unit/voice-register.test.ts`, 3 tests) pasa
    con los tres documentos incorporados al árbol de trabajo.
  - `agent_profile` de desarrollo: `greeting` 97 chars, `instructions` 2.947
    chars, `escalation_rules` 385 chars — coincide con lo declarado en el plan.
- **Pendientes**: ninguno.

---

## F1 — P3 · Temperatura explícita

- **Estado**: hecha
- **Rama**: `feat/mejoras-interaccion-llm`
- **Cambios**:
  - `src/lib/env.ts`: nueva variable `OPENROUTER_TEMPERATURE`, numérica, rango
    `0–2`, opcional. Al pasar por `stripEmpty`, una variable vacía equivale a
    ausente.
  - `src/lib/ai/index.ts` (`callProvider`): envía `temperature` en el body
    **solo** si está definida, con el mismo patrón que
    `OPENROUTER_REASONING_EFFORT`.
  - `.env.example`: guía inline de la variable.
  - `.env` local: `OPENROUTER_TEMPERATURE=0.3` con comentario que explica el
    trade-off (repetibilidad de precios frente a variedad).
  - `tests/unit/ai-adapter.test.ts`: 4 tests nuevos.
- **Evidencia**:
  - Las dos ramas quedan fijadas por test: con la variable seteada el body
    incluye `temperature` (0.3); sin ella la clave no viaja al proveedor.
  - Extremos del rango aceptados (`0` y `2`); `3` rechazado por el esquema de
    entorno con `Variables de entorno inválidas o faltantes`.
  - Gate: typecheck OK · lint OK · build OK · test OK (297 tests, +4 sobre la
    línea base de 293).
- **Cuidado registrado**: `chatJson` comparte `callProvider`, así que la misma
  variable afecta conversación, anotación y juez. Distinguirla por rol es otra
  decisión y queda fuera de alcance.
- **Pendientes**: ninguno.
