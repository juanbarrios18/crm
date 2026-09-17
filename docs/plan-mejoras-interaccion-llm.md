# Plan de mejoras de la interacción con el LLM — v2 (rama única, PR única)

> **Para quién**: un agente con contexto limpio que ejecutará este plan de punta a
> punta. Todo lo necesario está en este documento; no hace falta conocer la
> conversación donde se originó.
>
> **Objetivo**: que el agente responda mejor (fidelidad con la conversación y con
> el registro del negocio) y sea más eficiente (tokens y latencia por turno), con
> evidencia medible.
>
> **Diagnóstico**: `docs/auditoria-interaccion-llm.md`, verificado contra el
> código el 2026-09-17. Una auditoría crítica posterior recortó el alcance a lo
> estrictamente necesario (§2 y §5).
>
> **Versión**: v2 — 2026-09-17. Reemplaza al plan por fases M1–M12. Cambios
> principales: una sola rama y **una sola PR con excepción de tamaño aprobada**;
> se excluyen P4b, P8 y P11; P9 queda diferido; la configuración del negocio (P0)
> no se bloquea detrás del instrumento (P10).

---

## 0. Resumen ejecutivo

- **6 medidas necesarias**: P3 (temperatura), P1 (anotación fuera del camino
  crítico), P5 (roles humano/bot), P7 (regex de handoff), P6 (fecha/hora y tope
  de notas), P0 (registro de la configuración del negocio).
- **3 condicionadas**: P2 (adelgazar la anotación), P4a (reordenar
  estático→dinámico), P10 (veredicto derivado en código).
- **4 excluidas o diferidas**: P4b, P8, P11 y P9 (§5 explica por qué no deben
  re-agregarse).
- **Entrega**: rama `feat/mejoras-interaccion-llm` desde `origin/main`
  actualizado, commits por unidad de trabajo, **una PR** con excepción de tamaño
  aprobada por el dueño (2026-09-17).

---

## 1. Estado del mundo (verificado el 2026-09-17)

| Hecho | Detalle |
|---|---|
| `origin/main` | `3ea7e9a`. Contiene PR #18 (separación conversación/anotación), #19 (medición del instrumento), #20 (panel de transparencia), #21 (bitácora nocturna). Sin PRs abiertos. |
| Baseline auditada | `d861575` está contenida en main; los PR #19–#21 no tocan `pipeline.ts`, `prompts.ts`, `src/lib/ai`, `handoff.ts` ni `judge.ts`. Las referencias de línea de la auditoría siguen válidas. |
| Docs sin trackear | `docs/auditoria-interaccion-llm.md`, `docs/plan-ejecucion-nocturna.md`, `docs/enfoque-de-negocio.md` y este plan: entran en el primer commit (F0). |
| Herramienta útil | `GET /api/agent/prompt` (PR #20): prompt efectivo base por secciones. Verifica el reordenamiento de F6 sin volcar el prompt a mano. |
| Laboratorio | CLI en `scripts/lab-run.ts`; métricas en `agent_test_case.turn_metrics`; mocks (`WA_MOCK_ENABLED`) NUNCA miden nada real. |
| Seeds | `scripts/seed/` con patrón `pnpm seed:<nombre>` (demo, products, zones, catalog). |

**Cifras de partida** (auditoría, corrida `run_vngfka7jq6qxcy52mcw7`):

```text
prompt de conversación   9.617 chars ≈ 3.005 tok
prompt de anotación      4.532 chars ≈ 1.416 tok
turno actual             2 llamadas en serie ≈ 4.700 tokens (+50 % vs. 1 llamada de 3.130)
latencia por llamada     1.328 ms promedio (timeout 60 s)
caché de prefijo         64 % de las llamadas en 0
personas inestables      8 de 13 · hallazgos de tono 30, en 25 de 39 casos
```

---

## 2. Decisiones ya tomadas (no volver a preguntarlas)

| # | Decisión | Origen |
|---|---|---|
| D1 | Una sola rama y **una sola PR con excepción de tamaño** aprobada; commits por unidad de trabajo dentro de la rama | Dueño, 2026-09-17 |
| D2 | Alcance: P0, P1, P2 (solo adelgazar), P3, P4a, P5, P6, P7 y P10 | Auditoría crítica |
| D3 | Excluir P4b (catálogo bajo demanda), P8 (texto plano) y P11 (formato forzado en código) | Auditoría crítica |
| D4 | P9 (recorte del harness) queda diferido, sin corrida asignada | Auditoría crítica |
| D5 | RDD (`gentle-ai review mode`) está en `off`; no activarlo | `gentle-ai review mode status` |
| D6 | Los commits y push a ramas feature están pre-autorizados; igual se respetan las reglas de §6 | Dueño, 2026-09-17 |

---

## 3. Bloqueantes: preguntar todo al inicio, agrupado

Presentar estas preguntas juntas antes de empezar a ejecutar:

| # | Bloqueante | Detalle | Si no está resuelto |
|---|---|---|---|
| B1 | Aprobar el texto del negocio (F8) | Reescribe `greeting`, `instructions` y `escalationRules` del `agent_profile`. Es decisión de producto: el dueño aprueba el texto final. | Ejecutar F1–F7 y F9; dejar F8 propuesta (texto redactado en la PR) sin aplicar |
| B2 | Confirmar la tabla de severidades (F7) | Propuesta: `alucinacion`, `afirmacion_sin_evidencia` y `debio_escalar` → rojo; `fuera_de_kb` y `tono` → amarillo; sin hallazgos → verde | Saltear F7 y anotarlo en la bitácora |
| B3 | Corrida del Laboratorio | Queda **1 corrida autorizada**. Se usa UNA vez, al final (F10). No pedir más. | — |
| B4 | Proveedor real para medir | `OPENROUTER_BASE_URL=https://openrouter.ai/api` y mocks apagados durante la corrida | Sin esto, la corrida no mide nada |

---

## 4. Fases (todas en la misma rama y la misma PR)

Regla transversal: al cerrar cada fase, gate completo
(`pnpm typecheck && pnpm lint && pnpm build && pnpm test`) ANTES del commit, y
una entrada breve en `docs/bitacora-mejoras-llm.md`.

### F0 — Alineación inicial

- **Objetivo**: rama al día y documentos versionados.
- **Entregable**: `git fetch origin && git checkout -B feat/mejoras-interaccion-llm origin/main`;
  commit `docs(plan): ...` con los cuatro documentos sin trackear, más
  `docs/bitacora-mejoras-llm.md` creada con la entrada de F0.
- **Aceptación**: `git status` limpio; la rama nace de `origin/main`.

### F1 — P3 · Temperatura explícita

- **Entregable**: variable `OPENROUTER_TEMPERATURE` (numérica, 0–2, opcional) en
  `src/lib/env.ts`; `callProvider` (`src/lib/ai/index.ts:153-173`) envía
  `temperature` SOLO si está seteada, con el mismo patrón que
  `OPENROUTER_REASONING_EFFORT`; `.env.example` con guía inline; `.env` local con
  `0.3` y comentario (subirla aumenta variedad y baja repetibilidad de precios).
- **Cuidado**: no hardcodear el valor. `chatJson` comparte `callProvider`: la
  misma variable afecta conversación, anotación y juez (distinto por rol es otra
  decisión, fuera de alcance).
- **Aceptación**: con la variable seteada el body la incluye; sin ella, el body
  es idéntico al actual. Test unitario de las dos ramas.

### F2 — P1 · Anotación fuera del camino crítico

- **Objetivo**: que el cliente reciba su respuesta sin esperar la extracción.
- **Entregable**: la anotación se lanza EN PARALELO con la conversación (su
  entrada no depende del `reply`, solo del historial); la entrega ocurre sin
  esperarla; después de `deliverReply` se espera la promesa de anotación para
  procesar etapa/nota y cerrar la telemetría.
- **Dónde**: `src/server/ai/pipeline.ts` — hoy: anotación con `await` en l. 339,
  entrega en l. 388-396, `accumulateTiming` en l. 67-88.
- **Cuidado**:
  - `accumulateTiming` usa `calls[0]` como llamada principal para
    `model`/`provider` (l. 79-86): el orden del arreglo debe mantener la
    conversación primero.
  - El sandbox y la semántica de etapa no cambian (allowlist y solo avance donde
    están).
  - La anotación es best-effort: `chatJson` no lanza excepción, pero igual
    capturar y loguear ante fallo.
  - En el Laboratorio el turno se mide completo
    (`src/server/lab/runner.ts:396-401`): la promesa debe resolverse antes de que
    `runAgentTurn` retorne, o el `finalStage` de la corrida quedaría incompleto.
  - Si el turno sale temprano (error del proveedor en la conversación), la
    promesa de anotación no debe quedar sin manejo.
- **Aceptación**: latencia percibida del turno = máximo de las dos llamadas, no
  la suma; tests de `agent-move-stage`, `agent-extraction` y
  `agent-corrective-reply` verdes.

### F3 — P5 · Roles del historial: humanos vs. bot

- **Entregable**: el mapeo del historial usa `message.origin`
  (`ai | operator | manual | template`) y `message.aiGenerated` (ya existen:
  `src/lib/db/schema.ts:259-269`):
  - `in` → `user`.
  - `out` con `origin = "ai"` → `assistant`.
  - `out` de humano (`operator | manual | template`) → `user` con prefijo
    explícito en el contenido, por ejemplo `[ATENCIÓN HUMANA DEL NEGOCIO]: …`,
    más UNA línea en N2 de `prompts.ts` que explique la marca.
    **Decisión tomada**: marca en el texto, no rol nuevo (solo se admiten
    `system | user | assistant`).
- **Dónde**: `src/server/ai/pipeline.ts` (mapeo actual en l. 260-265),
  `src/server/ai/prompts.ts`.
- **Cuidado**: no romper `AGENT_COALESCE_MS` ni el orden cronológico del
  historial. El transcript del Laboratorio y el prompt del juez mapean por
  `direction`: revisar que la marca solo aplique al prompt del agente.
- **Aceptación**: test unitario de los cuatro orígenes; un turno de operador
  entre dos del bot queda distinguible en el prompt resultante.

### F4 — P7 · Acotar el regex de handoff

- **Objetivo**: que una mención suelta de "asesor" no aborte la conversación.
- **Entregable**: en `HANDOFF_BACKUP_REGEX` (`src/server/ai/handoff.ts:8`) sale
  la alternativa suelta `un asesor`; se exige verbo de contacto cerca del objeto
  humano (lo que ya hace) o petición explícita de atención.
- **Cuidado**: el falso negativo es peor que el falso positivo: un cliente que
  pide un humano y no recibe escalado cuesta una venta. La persona `pide_humano`
  del Laboratorio debe seguir escalando.
- **Tests nuevos**: "quiero hablar con un asesor" (escala); "¿cuánto cobra un
  asesor de eventos?" (no escala); "un asesor me dijo que sí" (no escala);
  "atiéndanme entre varios" (criterio documentado).
- **Aceptación**: casos nuevos correctos + `tests/unit/handoff.test.ts` verde.

### F5 — P6 · Fecha, hora y tope de notas

- **Entregable**:
  1. Línea de contexto temporal (fecha y hora actuales en la zona del negocio) al
     FINAL del bloque dinámico, para no romper el prefijo cacheable.
  2. `renderClientFile` recorta `notes` a un tope determinista (propuesto: 1.500
     caracteres, conservando las más recientes, con marca visible de recorte).
     NO resumir con LLM.
- **Dónde**: `src/server/ai/prompts.ts` (`renderClientFile` l. 177,
  `CLIENT_FILE_FIELDS` l. 151, `buildAgentSystemPrompt` l. 303) y la consulta
  del contacto en `pipeline.ts`.
- **Cuidado**: el tope es de LECTURA, no de escritura (`appendLeadNote` sigue
  acumulando en la base). Zona horaria configurable o `America/Santiago`,
  documentada.
- **Aceptación**: con 30 notas, la ficha no supera el tope y conserva las
  recientes; sin notas, el prompt es idéntico al actual. Tests unitarios de
  ambas ramas.

### F6 — P4a · Reordenar estático→dinámico

- **Objetivo**: recuperar la caché de prefijo. Es el 80 % del beneficio de P4,
  sin recortar contenido.
- **Entregable**: en `buildAgentSystemPrompt` (`prompts.ts:328-349`), ordenar
  así: identidad → tono → instrucciones → escalado → saludo → conocimiento →
  catálogo → zonas → etapas → reglas fijas → etapa actual → ficha → fecha/hora.
  Todo lo estable primero; lo que cambia por turno, al final. **Sin** inclusión
  condicional de catálogo ni zonas (D3).
- **Cuidado**: el orden afecta al modelo: es la fase con más superficie de
  comportamiento de la PR. Actualizar con criterio los tests que fijan posiciones
  (`tests/unit/prompts-catalog.test.ts`, `tests/unit/prompt-client-file.test.ts`),
  nunca "para que pasen".
- **Aceptación**: mismo contenido, solo orden; `cachedTokens > 0` en ≥80 % de las
  llamadas de la corrida final (hoy 36 %); volcado del prompt vía
  `GET /api/agent/prompt` revisado.

### F7 — P10 · Veredicto derivado en código (requiere B2)

- **Entregable**:
  1. El juez sigue devolviendo hallazgos y deja de devolver `veredicto`.
  2. Función pura y exportada en `src/server/lab/judge.ts` que deriva el
     veredicto con la tabla de B2.
  3. Se elimina del prompt del juez la instrucción de elegir veredicto
     (`prompts.ts:404-421`) y el esquema `Verdict` deja de pedirlo
     (`judge.ts:6-23`).
  4. Se ajustan `computeScore` (`judge.ts:172`), `computeDispersion` y el fixture
     del `ai-mock`.
- **Cuidado**: esto invalida la comparación por score contra corridas anteriores
  (decirlo en la PR); los hallazgos siguen viniendo de un LLM: la inestabilidad
  de fondo no desaparece.
- **Aceptación**: derivación pura y testeada; un hallazgo `alucinacion` nunca
  puede dar verde; sin hallazgos → verde; tests del runner y del juez verdes.

### F8 — P0 · Registro de la configuración del negocio (requiere B1)

- **Objetivo**: cerrar la causa directa de los 30 hallazgos de tono. El agente
  está penalizado por obedecer su propia configuración.
- **Entregable**:
  1. `greeting` sin tercera persona ni fórmula telefónica.
  2. `instructions` (2.947 caracteres) en español neutro profesional sin voseo,
     conservando TODO el contenido comercial (mínimos, plazos, precios,
     condiciones, crédito, facturación): cambio de registro, no de contenido.
  3. `escalationRules` en el mismo registro.
  4. Seed nuevo, idempotente y re-ejecutable en `scripts/seed/`, con su script
     `pnpm seed:<nombre>` (el seed demo existente es de otro negocio: Ferretería
     El Martillo).
- **Dónde**: fila `agent_profile` de la organización de desarrollo + seed nuevo.
  Aplicar en desarrollo; producción es otro momento y otra autorización.
- **Cuidado**: es DATO, el guardián anti-voseo no lo cubre: verificación manual
  sobre el texto. El texto no puede contradecir N1 ni N2. El dueño aprueba el
  texto (B1).
- **Aceptación**: el prompt efectivo no contiene fórmulas de call center ni
  voseo en los campos del negocio; el contenido comercial está completo
  (comparación ítem por ítem registrada en la PR).

### F9 — P2 · Adelgazar la anotación (sin corrida)

- **Objetivo**: la anotación es extracción; no necesita el prompt de un
  conversador.
- **Entregable**:
  1. `buildAnnotationSystemPrompt` (`prompts.ts:362-385`) deja de recibir las
     `instructions` completas (2.947 caracteres ≈ 921 tokens) y recibe: etapas,
     etapa actual, el `CONTRATO_ANOTACION` y una lista compacta de nombres de
     producto del catálogo (sin precios). Hoy la anotación extrae
     `productoInteres` sin ver el catálogo.
  2. Historial acotado (propuesto: últimos 6 mensajes; validar midiendo).
  3. `OPENROUTER_ANNOTATION_MODEL` opcional (si está seteada, la anotación usa
     ese modelo).
- **Cuidado**: sin instrucciones se pierde vocabulario del negocio: la fase DEBE
  demostrar que la extracción de `productoInteres` y `formato` no empeora,
  comparando sobre transcripts reales ya almacenados (no requiere corrida
  nueva). No romper el despacho por `ANNOTATION_MARKER` del `ai-mock`.
- **Aceptación**: prompt de anotación ≥40 % más chico, medido; extracción sin
  pérdida de campos contra la línea base.

### F10 — Cierre: gate, corrida y PR única

1. **Gate completo**: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
2. **App viva**: `pnpm dev` (nunca un build de producción con mocks) + self-test
   E2E según `AGENTS.md`, contra base recién migrada (los mocks reusan
   `waMessageId` fijos; un 500 aislado en la primera visita de una ruta es cold
   start de `next dev`, no un bug).
3. **Corrida del Laboratorio** (B3/B4): una sola. Comparar **hallazgos y
   métricas operativas**, NO score (F7 cambió la semántica del instrumento):
   - Hallazgos de `tono` (meta ≤5; hoy 30), persona `errores_modismos` estable,
     inestabilidad de personas como referencia.
   - Métricas:

     ```sql
     SELECT count(*) AS llamadas,
            round(avg((t->>'promptTokens')::numeric)) AS avg_prompt,
            round(avg((t->>'latencyMs')::numeric))  AS avg_latencia,
            count(*) FILTER (WHERE (t->>'cachedTokens')::numeric > 0) AS con_cache
     FROM agent_test_case c, jsonb_array_elements(c.turn_metrics) AS t
     WHERE c.run_id = '<run_id>';
     ```

4. **PR única** `type:feature`:
   - Título sugerido: `feat(agente): mejoras de interacción con el LLM (P0–P7, P10, P2a, P4a)`.
   - Cuerpo: resumen, fases con commits, evidencia (gate + E2E + corrida con
     números), excepción de tamaño declarada y justificada (una sola PR aprobada
     por el dueño), fuera de alcance (P4b/P8/P9/P11), riesgos.
   - Sin merge automático: mergea el humano.

---

## 5. Qué NO se hace y por qué (no re-agregar)

- **P4b · catálogo y zonas "bajo demanda"**: con F6, catálogo y zonas quedan
  dentro del prefijo cacheado y su costo marginal tiende a cero. Agregar
  detección de intención es complejidad nueva con riesgo de degradar la
  cotización.
- **P8 · texto plano en la conversación**: el modo JSON existe porque los modelos
  chicos devolvían texto plano y el turno fallaba
  (`src/lib/ai/index.ts:166-169`). Revertirlo cambia la disponibilidad del turno
  por un beneficio cualitativo no medido.
- **P11 · formato forzado en código**: truncar párrafos y contar preguntas puede
  empeorar la naturalidad; con F1 el modelo debería obedecer mejor el formato que
  ya está en el prompt.
- **P9 · recorte del harness**: diferido. Con F6 el bloque de reglas queda
  cacheado; el ahorro perseguido se vuelve marginal y el riesgo de perder reglas
  anti-alucinación sigue vigente.

---

## 6. Reglas de ejecución

1. Gate completo antes de cada commit, leído ANTES de mutar (nada de encadenar la
   verificación de forma que anule el fail-fast).
2. Un commit por unidad de trabajo; conventional commits
   (`feat|fix|docs|refactor|test|chore(scope): descripción`); sin atribución de
   IA ni `Co-Authored-By`.
3. Registro neutro profesional con trato de usted en código, comentarios, strings
   y docs. El guardián `tests/unit/voice-register.test.ts` lo verifica.
4. Una rama, una PR. La PR declara la excepción de tamaño aprobada.
5. Prohibido: push directo a main, `git push --force`, `git rebase`,
   `git reset --hard`, `--amend` sobre commits pusheados, editar migraciones
   existentes, tocar el `.env` de producción, activar mocks en producción,
   alterar el sandbox del Laboratorio (`is_test` JAMÁS toca la API real).
6. Detenerse y anotar ante: B1/B2 sin resolver, una decisión de producto nueva,
   producción o credenciales, dos fallos de gate seguidos en la misma fase, o un
   test rojo sin causa entendida.
7. Bitácora `docs/bitacora-mejoras-llm.md`: una entrada por fase (estado, commit,
   gate, evidencia, medición, pendientes). Es el seguro contra perder contexto.
8. Contexto adicional disponible: Engram (temas
   `arquitectura/auditoria-interaccion-llm` y
   `arquitectura/auditoria-plan-mejoras-llm`) y
   `docs/auditoria-interaccion-llm.md`.

---

## 7. Cómo saber que esto funcionó

| Métrica | Hoy | Meta |
|---|---|---|
| Tokens de prompt por turno | ≈4.700 crudos (2 llamadas) | ≤4.000 crudos (anotación adelgazada) |
| Llamadas con caché de prefijo | 36 % | ≥80 % |
| Latencia percibida del turno | suma de 2 llamadas (≈2,6 s) | máximo de 2 llamadas (≈1,3 s) |
| Hallazgos de tono | 30 en 25 de 39 casos | ≤5 |
| Veredicto `verde` con hallazgo | posible | imposible por construcción |
| Fórmulas de call center en la configuración | presentes | cero |

---

## Anexo A — Referencias de código verificadas (2026-09-17)

```text
src/server/ai/pipeline.ts          anotación await l. 339 · entrega l. 388-396 · roles l. 260-265
                                   notes sin tope l. 547-551 · accumulateTiming l. 67-88 · guards l. 152-187
src/server/ai/prompts.ts           buildAgentSystemPrompt l. 303 · reglas fijas al final l. 346
                                   anotación incluye instructions l. 376-378 · notes en ficha l. 165
                                   prompt del juez l. 388-447
src/lib/ai/index.ts                callProvider l. 153-173 (sin temperature; json_object l. 169)
                                   MAX_ATTEMPTS 3 l. 45 · extractJson l. 220
src/server/ai/handoff.ts           HANDOFF_BACKUP_REGEX l. 8 (alternativa "un asesor")
src/server/lab/judge.ts            Verdict l. 6-23 · computeScore l. 172
src/server/lab/runner.ts           consume runAgentTurn l. 396-401
src/lib/db/schema.ts               message.origin l. 265 · aiGenerated l. 259
src/app/api/agent/prompt/route.ts  prompt efectivo base (PR #20)
```
