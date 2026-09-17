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

---

## F2 — P1 · Anotación fuera del camino crítico

- **Estado**: hecha
- **Rama**: `feat/mejoras-interaccion-llm`
- **Cambios** (`src/server/ai/pipeline.ts`):
  - `annotationMessages` se arma ANTES de llamar al proveedor: su entrada solo
    depende del historial y del system de extracción, nunca del `reply`.
  - La conversación y la anotación se lanzan **en paralelo** y la entrega ocurre
    sin esperar la extracción.
  - La anotación se espera DESPUÉS de la entrega, para procesar etapa/nota y
    cerrar la telemetría antes de retornar.
  - Nuevo `settleAnnotation`: todo camino de salida consume la promesa de
    anotación. `chatJson` no propaga error de proveedor, pero sí puede rechazar
    si el entorno es inválido (`getEnv` lanza), y una promesa rechazada sin
    manejo tumba el proceso. Cubre los dos caminos de salida temprana (proveedor
    no configurado y fallo persistente → handoff `error`).
  - `accumulateTiming(calls, latencyMs)` recibe la latencia explícita.
- **Semántica de la latencia (decisión)**: `latencyMs` deja de ser la suma y pasa
  a ser el tiempo de pared del tramo paralelo, medido con
  `max(finConversación, finAnotación) − inicioParalelo`. La marca de fin de la
  anotación se toma al RESOLVER su promesa, no al esperarla, para que la espera
  posterior a la entrega no infle la cifra. Los TOKENS siguen sumándose: el
  costo real del turno sí es la suma de las dos llamadas. `calls[0]` sigue siendo
  la conversación, así que `model` y `provider` no cambian.
- **Evidencia**:
  - Test nuevo en `tests/unit/lab-sandbox.test.ts`: con la conversación en 20 ms
    y la anotación en 250 ms, el mensaje saliente se persiste ANTES de que la
    anotación resuelva, y el turno igual espera la anotación antes de retornar
    (el Laboratorio mide el turno completo y el `finalStage` no queda a medias).
  - **Prueba de mutación**: reintroduciendo temporalmente `await annotationPromise`
    antes de la entrega (orden secuencial previo), el test FALLA con
    `expected … to be less than …`. Vuelto a paralelo, pasa. El test no es una
    tautología.
  - El test de telemetría ahora distingue máximo de suma con retardos reales:
    dos llamadas de 180 ms dan una latencia ≥180 ms y <340 ms (la suma sería
    ~360 ms).
  - `tests/unit/agent-corrective-reply.test.ts`: se reordenó el fixture del mock,
    que despacha por orden de invocación. El orden de llamadas pasó de
    conversación→corrección→anotación a conversación→anotación→corrección.
  - Gate: typecheck OK · lint OK · build OK · test OK (298 tests, +1).
- **Sin cambios**: el sandbox del Laboratorio, la semántica de etapa (allowlist y
  solo avance) y el orden cronológico del historial.
- **Pendientes**: ninguno.

---

## F3 — P5 · Roles del historial: humanos vs. bot

- **Estado**: hecha
- **Rama**: `feat/mejoras-interaccion-llm`
- **Cambios**:
  - Módulo nuevo `src/server/ai/history.ts` (puro, sin base de datos):
    `HUMAN_ORIGIN_MARK = "[ATENCIÓN HUMANA DEL NEGOCIO]"`, `isBotOutbound` y
    `toConversationHistory`. Se eligió un módulo puro —como `handoff.ts`— para
    poder probar el mapeo sin levantar la base.
  - `pipeline.ts`: el historial se arma con `toConversationHistory(history)`.
  - `prompts.ts`: UNA línea nueva en N2 que explica la marca al modelo,
    interpolando la constante (no puede desincronizarse del render).
- **Decisiones**:
  - **Marca en el texto, no rol nuevo**: el proveedor admite solo
    `system | user | assistant`, así que la persona del negocio no tiene rol
    propio. El humano viaja como `user` con la marca delante.
  - **`aiGenerated` además de `origin`**: la columna `origin` nació en 008 con
    default `"operator"`, así que todo el historial de IA anterior a esa columna
    quedó con `aiGenerated = true` y `origin = "operator"`. Sin el segundo
    criterio, ese historial se leería como escrito por una persona. Es BOT todo
    saliente con `origin === "ai"` **o** `aiGenerated === true`.
  - **La marca aplica SOLO al prompt de conversación**. La llamada de anotación
    recibe el historial en modo `plain-assistant` (el humano como `assistant`,
    sin marca), que es exactamente como viajaba antes de P5: es extracción pura,
    su prompt no trae N2, y un marcador sin explicación sería ruido. El
    transcript del Laboratorio y el prompt del juez mapean por `direction` y
    tampoco la ven.
- **Hallazgo durante el gate**: la regla nueva de N2 menciona "una persona del
  equipo" y el clasificador del panel de transparencia
  (`src/server/ai/rule-summary.ts`) la mandaba al grupo "Escalamiento a una
  persona", que no es de lo que habla. El test
  `agent-rules-panel > el resumen se deriva del texto de las reglas` lo detectó
  al romperse. **Se corrigió el clasificador** (tema nuevo "Mensajes de personas
  del equipo", antes de escalado) y NO el test: con el arreglo, el invariante del
  test —que el grupo de escalado tenga una sola regla— se restaura solo.
  Se agregó un test que fija la clasificación nueva.
- **Evidencia**:
  - `tests/unit/agent-history-roles.test.ts` (12 tests): los cuatro orígenes,
    la distinción bot/humano, el fallback de `aiGenerated` para historial legacy,
    los dos modos de representación y el orden cronológico.
  - `tests/unit/prompts-catalog.test.ts`: el prompt de conversación explica la
    marca; el de anotación no la contiene.
  - `tests/unit/agent-rules-panel.test.ts`: la regla de la marca no cae en el
    grupo de escalado.
  - Gate: typecheck OK · lint OK · build OK · test OK (313 tests, +15).
- **Pendientes**: ninguno.

---

## F4 — P7 · Acotar el patrón de respaldo del handoff

- **Estado**: hecha
- **Rama**: `feat/mejoras-interaccion-llm`
- **Cambio** (`src/server/ai/handoff.ts`): sale la alternativa suelta `un asesor`.
  El patrón ahora exige un verbo de contacto a menos de 40 caracteres de un
  objeto humano, o la petición explícita `atención humana`.
- **Hallazgo corregido de paso**: el patrón tenía un hueco por TILDES. El verbo
  `comunicar` no matcheaba "comunícame" y `derivar` no matcheaba "derívame": una
  petición real de humano se perdía. En vez de enumerar las variantes
  acentuadas, el texto se normaliza antes de evaluar (minúsculas y sin
  diacríticos) y el patrón se escribe sin tildes. Una sola entrada por verbo.
- **Verbos**: se agregó la familia `pas[ae]` —sin la cual "me pasas a un asesor",
  que hoy es un caso verdadero del test, dejaba de disparar— y `deriv`. Se
  eligió `pas[ae]` y no `pasa` para no atrapar "pasó" ni "pasado". **No** se
  agregó `transferir`: en este negocio la transferencia bancaria es vocabulario
  central y un falso positivo aborta una venta en curso.
- **Fuera del patrón a propósito**: "atiendan"/"atiéndanme" es ambiguo (puede ser
  una consulta de horarios, "¿atienden los sábados?"), así que no aborta por sí
  solo; lo resuelve el modelo en la vía principal.
- **Evidencia**:
  - `tests/unit/handoff.test.ts` (27 tests, +13): los cuatro casos nuevos del
    plan, tres casos de `pasa` sin objeto humano, el criterio documentado de
    "atiéndanme" y el caso verdadero "derívame con un humano".
  - El test de `pide_humano` referencia `PERSONAS` del producto en vez de copiar
    el guion, así que falla si el guion deja de escalar.
  - **Barrido sobre las personas del Laboratorio** (esbuild + node): de las 39
    líneas de guion, dispara **exactamente 1**, y es la línea correcta de
    `pide_humano` ("…quiero hablar con un humano"). Comparado con el patrón
    previo, sobre el mismo corpus el resultado es idéntico (previo=1, nuevo=1).
  - Gate: typecheck OK · lint OK · build OK · test OK (326 tests, +13).
- **Límite honesto**: el caso que motiva P7 ("¿cuánto cobra un asesor de
  eventos?") es un hallazgo de LECTURA DE CÓDIGO de la auditoría, no una línea que
  exista en el corpus de personas. Ninguna persona lo ejercita, así que la corrida
  de F10 tampoco lo va a mostrar. No se agregó una persona nueva a propósito:
  cambiaría el tamaño del corpus y confundiría la comparación de F10. La evidencia
  de P7 son los tests unitarios y el barrido de arriba, no una métrica del
  Laboratorio.
- **Pendientes**: ninguno.

---

## F5 — P6 · Fecha, hora y tope de notas

- **Estado**: hecha
- **Rama**: `feat/mejoras-interaccion-llm`
- **Cambios**:
  - `prompts.ts`: `renderTemporalContext(now, timeZone)` con la fecha y hora
    actuales, y `capNotes(notes, max)` con el tope de lectura de notas
    (`CLIENT_FILE_NOTES_MAX_CHARS = 1500`) más la marca visible
    `NOTES_TRUNCATED_MARK`. `renderClientFile` aplica el tope SOLO a `notes`.
  - `buildAgentSystemPrompt` recibe `now` y `timeZone` como parámetros
    explícitos: sigue siendo una función pura y por eso es probable con un
    momento fijo (sin eso, dos builds del mismo caso podían diferir si el reloj
    cruzaba el minuto).
  - La línea temporal va **al final** del prompt: es lo único que cambia por
    turno, así que todo lo anterior queda como prefijo cacheable.
  - `env.ts`: `BUSINESS_TIMEZONE`, opcional, con default `America/Santiago` y
    validación contra `Intl`. Un typo falla al arrancar y no en cada turno.
  - `pipeline.ts` y `GET /api/agent/prompt` pasan la zona configurada (el panel
    muestra el prompt EFECTIVO, así que debe usar la misma).
  - `.env.example`: guía inline de la variable.
- **Decisiones**:
  - **Zona configurable, no hardcodeada**: la zona horaria es un dato del
    negocio. El default es `America/Santiago`.
  - **El tope es de LECTURA**: `appendLeadNote` sigue acumulando todo en la base.
  - **Recorte determinista, sin LLM**: se conservan las notas MÁS RECIENTES (se
    guarda la cola, que es donde `appendLeadNote` agrega) y el corte busca un
    salto de línea para no partir una nota por la mitad. Resumir con el modelo
    costaría una llamada por turno y no sería reproducible.
  - **Sin notas la salida es idéntica** a la anterior: `capNotes` no agrega marca
    cuando el texto cabe.
- **Evidencia**:
  - **Medición sobre datos reales de la base de desarrollo**: el contacto con
    más notas ya tiene **2.226 caracteres en 22 líneas** — o sea, el tope no es
    teórico, ya hay un contacto que lo supera. Recortado da **1.452 caracteres en
    16 líneas**: **774 caracteres (~242 tokens) menos en cada turno** de ese
    contacto, con la nota más reciente conservada textualmente y la marca de
    recorte presente.
  - `tests/unit/prompt-client-file.test.ts`: las dos ramas del plan (con 30 notas
    la ficha no supera el tope y conserva las recientes; sin notas es idéntica a
    la anterior), más el corte en salto de línea y el determinismo.
  - `tests/unit/prompts-catalog.test.ts`: la línea temporal es la última sección
    del prompt, y el mismo instante cae en días distintos según la zona
    (`2026-09-17T02:00Z` → 16 en Santiago, 17 en Auckland), lo que prueba que la
    zona configurada se aplica de verdad.
  - `tests/unit/env-business-timezone.test.ts` (5 tests): default, cadena vacía
    como ausente, zona válida y dos valores inválidos rechazados al arrancar.
  - `tests/unit/support/agent-turn-env.ts`: helper con el entorno mínimo del
    turno. Al pasar el turno a leer `getEnv()`, cuatro tests del pipeline
    necesitaban la configuración completa; se centralizó para que agregar una
    variable no obligue a tocar cada test.
  - Gate: typecheck OK · lint OK · build OK · test OK (342 tests, +16).
- **Desvío del plan, declarado**: el plan mencionaba también "la consulta del
  contacto en `pipeline.ts`". El tope se aplicó en `renderClientFile` y no en
  SQL: es una función pura, testeable, y la lógica de la marca de recorte no
  tiene que vivir en una consulta. La consulta sigue leyendo la columna completa.
- **Pendientes**: ninguno.

---

## F6 — P4a · Reordenar estático → dinámico

- **Estado**: hecha
- **Rama**: `feat/mejoras-interaccion-llm`
- **Cambio** (`prompts.ts`): el bloque fijo de reglas sube y pasa a integrar el
  tramo estable. Orden nuevo:
  1. **Prefijo estable (cacheable)**: identidad → tono → instrucciones →
     escalado → saludo → conocimiento → catálogo → zonas → etapas → reglas
     fijas (contrato → N1 → N2 → cierre → formato).
  2. **Cola dinámica**: etapa actual → ficha del cliente → fecha y hora.

  La sección que se movió es una sola: las reglas fijas pasan de la posición 11
  a la 9. Nada más cambió de lugar.
- **Evidencia — "mismo contenido, solo orden" (verificado, no argumentado)**:
  se bundleó la versión de `prompts.ts` de `HEAD` y la del árbol de trabajo, se
  generó el prompt con el MISMO caso (perfil, KB, catálogo, zonas, etapa, ficha y
  momento fijos) y se compararon las secciones:
  - `mismo multiset de secciones: True` — el contenido es idéntico.
  - `mismo orden: False` — y el único movimiento es el índice `11 → 9` (las
    reglas fijas), con la línea temporal sostenida en el índice 12.
  - Ambas versiones rinden **13 secciones y 5.258 caracteres**.
- **Tests actualizados con criterio** (no "para que pasen"): el test que fijaba
  posiciones afirmaba `ficha → reglas fijas`, que era exactamente el orden que
  P4a corrige. Se reemplazó por el invariante que de verdad importa —el tramo
  estable queda antes y de forma contigua, la cola dinámica al final y en
  orden—, que es la propiedad de la que depende la caché. Se agregó además una
  aserción equivalente sobre el prompt EFECTIVO que sirve
  `GET /api/agent/prompt`, que es el volcado que pide el plan.
- **Pendiente de medición**: `cachedTokens > 0` en ≥80 % de las llamadas se mide
  en la corrida de F10. Acá queda establecido el orden; el efecto se mide.
- Gate: typecheck OK · lint OK · build OK · test OK (344 tests, +1).
- **Pendientes**: ninguno.

---

## F7 — P10 · Veredicto derivado en código (B2 aprobada)

- **Estado**: hecha
- **Rama**: `feat/mejoras-interaccion-llm`
- **Cambios**:
  - `judge.ts`: el esquema del juez pasa a `JudgeResponse = { hallazgos }` y se
    elimina el campo `veredicto`. Nuevo `deriveVerdict(hallazgos)` puro y
    exportado, con la tabla de B2 en un `Record` **total** sobre el enum de tipos
    de hallazgo: agregar un tipo nuevo sin clasificarlo no compila.
  - `JudgeOutcome` ahora expone `veredicto` (derivado) y `hallazgos` (del LLM).
  - `prompts.ts`: del prompt del juez sale el esquema con `veredicto` y la
    explicación verde/amarillo/rojo; entra la instrucción de no elegir veredicto.
  - `runner.ts`: consume `outcome.veredicto` / `outcome.hallazgos`.
  - `dev/ai-mock.ts`: el fixture del juez deja de devolver `veredicto`.
  - `computeScore` y `computeDispersion`: se documenta la nueva semántica. Su
    aritmética no cambia (siguen operando sobre el string del veredicto).
- **Decisiones**:
  - **La tabla es un `Record` total**: un tipo de hallazgo sin severidad asignada
    rompe la compilación. Es la garantía de que la tabla no se desactualiza en
    silencio, que es exactamente lo que pasó con el veredicto elegido por el
    modelo.
  - **Un tipo desconocido degrada hacia arriba, nunca a verde**: el verde exige
    lista vacía, así que un hallazgo no clasificado no puede producir verde.
  - **Los chequeos deterministas siguen endureciendo**: `applyPipelineCheck` y
    `applyDialectCheck` parten del veredicto derivado y solo pueden subirlo,
    nunca bajarlo. La composición queda: derivar → endurecer.
- **Evidencia**:
  - `tests/unit/judge.test.ts` (36 tests, +10): la tabla completa, que
    `alucinacion` nunca da verde ni sola ni acompañada, que el rojo gana sobre el
    amarillo sin importar el orden, el determinismo, el tipo desconocido, que
    `judgeCase` deriva lo que devuelve el juez, y que el prompt ya no pide
    veredicto.
  - Gate: typecheck OK · lint OK · build OK · test OK (357 tests, +13).
- **Aviso obligatorio (va también en la PR)**: **el score deja de ser comparable
  contra corridas anteriores a esta fase.** La aritmética de `computeScore` no
  cambió, pero el valor de un mismo caso sí puede cambiar: un caso con hallazgo
  `fuera_de_kb` que antes el juez podía declarar rojo ahora deriva amarillo. La
  comparación de F10 es por HALLAZGOS y métricas operativas, no por score.
- **Límite honesto**: los hallazgos siguen viniendo de un LLM. P10 elimina UNA
  fuente de inestabilidad (la elección libre del veredicto) pero no la de fondo:
  una misma conversación puede producir hallazgos distintos entre corridas, y
  `computeDispersion` sigue siendo la señal de cuánto.
- **Hallazgo de documentación (pre-existente, no introducido acá)**:
  `tests/e2e/us4-lab.md` afirmaba "progreso (n/6)" y "5 verdes + 1 rojo ≈ 83" con
  un corpus que hoy es de **13 personas × 3 repeticiones = 39 casos**, y esperaba
  score 100 tras cerrar el loop del KB. Con el fixture del ai-mock, además, las
  personas con `expectAdvance` cuyo guion no dispara la señal de compra del mock
  reciben un hallazgo `pipeline`. Se reescribió el guion para verificar
  COMPORTAMIENTO y no cifras: un número escrito en una guía envejece en silencio,
  que es justo lo que había pasado.
- **Pendientes**: ninguno.
