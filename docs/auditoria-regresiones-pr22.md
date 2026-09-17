# Auditoría de regresiones del agente tras el PR #22 — insumo para decidir revertir o arreglar

> **Para quién**: una sesión con contexto limpio (humano o agente) que debe decidir
> si revertir el merge o arreglar. Todo lo necesario está en este documento; no
> hace falta conocer la conversación donde se originó.
>
> **Estado**: el PR #22 está **mergeado en `main`** (`81c0569`, 2026-09-17 12:54Z).
> El dueño reporta regresiones en el chat. **No hay producción afectada**: se está
> en desarrollo, así que la decisión es de calidad de desarrollo y admite
> verificación con calma. No hay presión de rollback.
>
> **Qué se decide**: revertir el merge completo, revertir solo las fases que
> tocan la voz, o arreglar. La sección 7 lista las opciones con sus comandos y
> consecuencias; la 8, cómo verificar cada una.

---

## 1. Qué se mergeó

23 archivos de producto y 24 de tests/documentación. 11 commits, uno por fase.

| Fase | Commit | Medida | ¿Toca el chat? |
|---|---|---|---|
| F0 | `3dd7238` | Versionar los documentos del plan | No |
| F1 | `037bdb0` | `OPENROUTER_TEMPERATURE=0.3` | **Sí, fuerte** |
| F2 | `6acc3cd` | Anotación en paralelo con la conversación | No (solo tiempos) |
| F3 | `d2846eb` | Marcar los salientes humanos con `[ATENCIÓN HUMANA DEL NEGOCIO]` | Sí, media |
| F4 | `447b591` | Acotar el patrón de respaldo del handoff | Sí |
| F5 | `e42369d` | Línea de fecha/hora + tope de 1500 caracteres a las notas | Sí, media |
| F6 | `dd7497d` | Reordenar el prompt: las reglas fijas dejan de ir al final | **Sí, fuerte** |
| F7 | `95f4035` | El veredicto del juez se deriva en código | No al chat, sí al juez |
| F8 | `38b5794` | Reescribir la configuración del negocio (saludo, instrucciones, escalado) | **Sí, fuerte** |
| F9 | `7971c2d` | Vocabulario de productos en la anotación + historial acotado + guard de marcadores | Sí, indirecta |
| F10 | `cfa0168` | Cierre: bitácora, gate, E2E y corrida | No |

**Archivos de producto tocados** (para acotar cualquier revert quirúrgico):

| Fase | Archivos |
|---|---|
| F1 | `src/lib/env.ts`, `src/lib/ai/index.ts` |
| F2 | `src/server/ai/pipeline.ts` |
| F3 | `src/server/ai/history.ts` (nuevo), `src/server/ai/pipeline.ts`, `src/server/ai/prompts.ts`, `src/server/ai/rule-summary.ts` |
| F4 | `src/server/ai/handoff.ts` |
| F5 | `src/server/ai/prompts.ts`, `src/server/ai/pipeline.ts`, `src/lib/env.ts`, `src/app/api/agent/prompt/route.ts` |
| F6 | `src/server/ai/prompts.ts` |
| F7 | `src/server/lab/judge.ts`, `src/server/lab/runner.ts`, `src/server/ai/prompts.ts`, `src/server/dev/ai-mock.ts` |
| F8 | `src/server/seed/business-profile.ts` (nuevo), `scripts/seed/business-profile.ts` (nuevo), `package.json` |
| F9 | `src/server/ai/prompts.ts`, `src/server/ai/pipeline.ts`, `src/server/ai/actions.ts`, `src/lib/env.ts` |

**Datos del negocio cambiados en la base de desarrollo** (no son código; un revert
del código **no** los revierte):

- `agent_profile.greeting` → `"Hola, somos el equipo comercial de Lamas Foods. ¿Qué pan necesita para su negocio?"` (82 caracteres)
- `agent_profile.instructions` → reescrito en usted chileno, 2.981 caracteres (antes 2.947, en voseo rioplatense)
- `agent_profile.escalation_rules` → reescrito, 384 caracteres
- Aplicados con `pnpm seed:business-profile`. El texto vive en `src/server/seed/business-profile.ts`.

---

## 2. Lo que se midió (evidencia existente)

Método completo en `docs/bitacora-mejoras-llm.md`. Resumen:

| Verificación | Resultado |
|---|---|
| `pnpm typecheck && pnpm lint && pnpm build && pnpm test` | Verde — 400 tests (línea base: 293) |
| Self-test E2E de comportamiento (`pnpm test:e2e`) | **90/90**, exit 0 |
| Corrida del Laboratorio | `run_uzw4zmt4fyg09sczm7lg`, 39 casos, 8m46s (baseline: 11m19s) |
| Modelo y juez de la corrida | `google/gemini-2.5-flash-lite` + `z-ai/glm-5.3-flash` (iguales a la baseline) |

**Hallazgos comparados** (baseline `run_vngfka7jq6qxcy52mcw7` → nueva):

| tipo | antes | después |
|---|---|---|
| `tono` | 30 | 11 |
| `fuera_de_kb` | 9 | 4 |
| `debio_escalar` | 6 | **10** |
| `afirmacion_sin_evidencia` | 5 | **12** |
| `alucinacion` | 4 | 5 |
| `judge_failed` | 1 | 0 |

**Distribución de veredictos**: verdes 10 → 18 · amarillos 20 → 5 · rojos 8 → 16.
El corrimiento hacia rojo es **esperado** por F7 (antes el juez podía declarar
amarillo teniendo un hallazgo grave; ahora un hallazgo grave fuerza rojo). Por eso
**el score no es comparable** (54 → 58) y la comparación se hizo por hallazgos.

**Métricas operativas:**

| métrica | baseline | nueva |
|---|---|---|
| latencia del turno | 1.328 ms | 794 ms |
| tokens de prompt por turno | 3.130 ¹ | 4.559 |
| % de tokens con caché | 33,8 % | 12,2 % |
| % de turnos con algo de caché | 35,9 % | 26,0 % |

¹ **Esta comparación de tokens no es válida como regresión.** Esa corrida
registró **una llamada por turno**; el propio plan lo dice: *"1 llamada de
3.130"*. El código en `origin/main` ya hacía dos llamadas (la separación
conversación/anotación entró en el PR #18). La referencia correcta de dos
llamadas es el ≈4.700 que el plan calculó a mano. Medido con el proveedor real,
la configuración final manda ≈4.300 tokens de system por turno (conversación
2.934 + anotación 1.366).

---

## 3. Síntomas reportados por el dueño y su causa probable

Separado en **confirmado** (hay medición o lectura de código que lo sostiene) e
**hipótesis** (mecanismo plausible, sin medición todavía).

| Síntoma reportado | Causa más probable | Estado |
|---|---|---|
| "Afirma cosas que no son reales" | F6: las reglas anti-alucinación (N2) dejaron de ir al final del prompt. Lo último que lee el modelo ahora es la ficha del cliente y la fecha | **Síntoma medido; atribución pendiente** (7 cambios juntos, juez ruidoso, contrato del juez cambiado — ver Anexo A): `afirmacion_sin_evidencia` 5 → 12 |
| "Me trata de Don Juan" | F6 (la ficha, que trae el `Nombre`, quedó como lo ÚLTIMO que lee) + F1 (temperatura 0,3 hace que el modelo se pegue a la formulación más estereotipada) + F8 (registro nuevo: usted chileno) | **Hipótesis, mecanismo reforzado** — la ficha sí es nueva respecto de la baseline (entró en `ae953a0`, PR #17) y el agente ya la usa para saludar. Ver Anexo A |
| "A veces utiliza otro saludo" | F8 reescribió `greeting`; el prompt lo presenta como "saludo sugerido", así que el modelo lo parafrasea | **Confirmado** (cambio de dato) |
| "Consumo de la API de OpenRouter" | Ver 3.1 | **Confirmado y medido** |
| "El juez falla" | F7 cambió el contrato del juez: ya no devuelve `veredicto` y el esquema exige `hallazgos`. Si el modelo devuelve otra forma, `chatJson` agota reintentos y el caso queda `judge_failed` | **Hipótesis** — la corrida propia dio 0 fallos, pero con otro juez o más actividad puede fallar |
| "Todo ha ido a peor" | Ver el conjunto: 7 cambios que tocan la voz entraron juntos | — |

### 3.1 Por qué subió el consumo (confirmado)

Tres causas acumuladas, todas del PR:

1. **No se hizo el ahorro principal.** El plan contaba con adelgazar el prompt de
   anotación para bajar ≈840 tokens por turno. Se midió y **no se hizo** (ver 4.2),
   así que ese ahorro nunca llegó.
2. **Los dos system prompts crecieron ≈921 caracteres por turno** (≈270 tokens),
   por el vocabulario de productos, la línea de fecha/hora y los marcadores de
   saliente humano.
3. **La caché de prefijo cayó**: 33,8 % → 12,2 % de los tokens. Menos caché
   significa más tokens a precio lleno. La **línea de fecha/hora cambia cada
   minuto dentro del system prompt** y es la sospechosa directa de romper el
   emparejamiento de prefijo del proveedor.

---

## 4. Lo que la propia medición ya mostraba en rojo

Esto **no es nuevo**: estaba en la evidencia de la corrida y se mergeó igual.

### 4.1 Dos indicadores empeoraron

`afirmacion_sin_evidencia` 5 → 12 y `debio_escalar` 6 → 10. En la bitácora
quedaron anotados como **"sin atribuir"**. Ese es exactamente el síntoma que el
dueño reporta ahora ("afirma cosas que no son reales"). **Fue un error de proceso
mergear sin investigarlos.**

### 4.2 El plan pedía un recorte que la medición refutó

F9 debía sacar las instrucciones del negocio del prompt de anotación. Se midió
sobre 129 turnos de cliente de los 39 casos reales, 3 repeticiones por punto,
contra el proveedor real:

| configuración | `productoInteres` | `formato` | `stage` |
|---|---|---|---|
| base | 25,6 % | 19,6 % | 96,4 % |
| sin instrucciones (lo que pedía el plan) | 37,7 % | 32,6 % | **80,9 %** |
| entregado | 29,2 % | 23,5 % | 94,1 % |

Sacar las instrucciones movía la **etapa final del lead en 17 de 39
conversaciones**, con un piso de ruido medido de 10–12 de 39. Por eso no se
entregó. **Consecuencia**: la meta de tokens del plan no se cumplió.

### 4.3 La voz del cierre se contradice a sí misma

`CIERRE_DE_CONVERSACION` (código) pide un cierre que diga *"que quedamos a la
orden"*, y el `CLOSING_FAREWELL` determinista dice literalmente *"Quedamos a la
orden para cualquier otra duda"*. El prompt del juez marca esa misma fórmula como
**de call center**. Es la causa #1 de los 11 hallazgos de `tono` que quedaron
(la meta era ≤5). Quedó fuera del alcance de F8 a propósito, porque es voz de
**producto**, no dato del negocio.

---

## 5. Mecanismos, con el detalle que hace falta para decidir

**F6 — el orden del prompt (el cambio de mayor superficie conductual).**
Antes, el prompt terminaba así: `… → etapa actual → ficha del cliente → reglas
fijas`. Ahora termina: `… → reglas fijas → etapa actual → ficha del cliente →
fecha y hora`. Verificado en `src/server/ai/prompts.ts:440-444`.

Los modelos pesan más el principio y el final del contexto. Consecuencias:
- Las **reglas duras** (contrato de salida, N1 de capacidades, N2 anti-alucinación,
  cierre, formato) perdieron el lugar final que tenían.
- La **ficha del cliente** (con el `Nombre`) pasó a ser lo último que el modelo
  lee antes de responder.
- Efecto amplificado: F9 cambia **qué** se escribe en la ficha (valores alineados
  al catálogo) y F6 hizo que la ficha **pese más**. Los dos cambios se potencian.

El objetivo de F6 era recuperar la caché de prefijo del proveedor. **No se logró**
(33,8 % → 12,2 %), así que el cambio se pagó sin cobrar el beneficio.

**F1 — la temperatura.** `OPENROUTER_TEMPERATURE=0.3` en `.env`, contra el default
del modelo (≈1.0). Afecta a las **tres** llamadas: conversación, anotación y juez,
porque `chatJson` comparte `callProvider`. El plan lo dejó anotado como decisión
fuera de alcance ("distinguirla por rol es otra decisión"). Una temperatura baja
reduce la variedad y empuja al modelo hacia la formulación más probable — que con
"trato de usted, español de Chile" es justamente el registro acartonado.

**F8 — el registro del negocio.** La configuración anterior se contradecía:
`tone` declaraba *"Tratamiento: usted. Registro: cordial y profesional, español de
Chile"* mientras `instructions` y `escalation_rules` estaban en **voseo
rioplatense** (16 ocurrencias: `Sos`, `Atendés`, `ofrecé`, `decí`, `pedile`,
`escalá`). El modelo imita el registro de sus instrucciones, así que el agente
escribía en voseo y el juez le marcaba `tono` por contradecir su propia voz
configurada. Ese arreglo es real (16 → 0) y es el grueso de la mejora de `tono`
(30 → 11). **Pero** el texto nuevo se escribió entero, y el saludo cambió.

**F5 — la línea de fecha/hora.** Va al final del prompt, con la zona del negocio
(`America/Santiago`). Es lo único que cambia minuto a minuto y está **dentro** del
system prompt: candidata principal a romper la caché de prefijo.

**F7 — el contrato del juez.** El esquema pasó de `{veredicto, hallazgos}` a
`{hallazgos}` y `deriveVerdict` calcula el veredicto con la tabla aprobada
(`alucinacion`/`afirmacion_sin_evidencia`/`debio_escalar` → rojo;
`fuera_de_kb`/`tono` → amarillo; sin hallazgos → verde). No toca el chat, pero
**sí** al instrumento: si el juez devuelve una forma que el esquema nuevo no
acepta, el caso queda `judge_failed`.

---

## 6. La causa raíz del problema de proceso

No es un bug puntual, es cómo se verificó:

1. **Se midió contra el juez del Laboratorio, no contra la conversación.** El juez
   es un LLM con ruido; la propia corrida mostró un piso de ruido de 10–12 de 39
   casos en `stage`. Optimizar contra ese instrumento no es optimizar la voz.
2. **Entraron 7 cambios que tocan la voz de una sola vez** (F1, F3, F4, F5, F6, F8,
   F9). Ninguno es atribuible por separado: hay que revertir o aislar para saber
   cuál causa qué.
3. **Se mergeó con dos indicadores en rojo sin investigarlos** (4.1).

---

## 7. Opciones

### Opción A — Revertir el merge completo

```bash
git checkout main && git pull
git revert -m 1 81c0569
```

- **Devuelve** `main` al estado de `3ea7e9a` (que es el que funcionaba).
- **No revierte los datos**: `agent_profile` en la base de desarrollo sigue con el
  texto nuevo. Hay que volver a aplicar el texto anterior si se quiere el estado
  completo (el texto viejo está en el historial: `git show 3ea7e9a` no lo tiene,
  porque vivía en la base; los valores previos están transcritos en
  `docs/bitacora-mejoras-llm.md`, fase F8).
- **Costo**: se pierden también las fases que no tocan la voz y que están bien
  (F2 tiempos, F7 juez, y los tests nuevos).
- **Ventaja**: estado conocido, sin ambigüedad, en un comando.

### Opción B — Revertir solo las fases que tocan la voz

```bash
git checkout main && git pull
git revert --no-commit dd7497d 037bdb0 38b5794   # F6 (orden), F1 (temperatura), F8 (registro)
git commit -m "revert(agente): volver el orden del prompt, la temperatura y el registro del negocio"
```

Más F5 (fecha/hora) y F3 (marcadores) si se decide que también molestan.

- **Conserva** F2, F4, F7 y los tests.
- **Riesgo**: los reverts no son independientes entre sí (F9 depende del prompt de
  F6/F9 y F8 cambió datos, no solo código). Hay que resolver conflictos a mano y
  verificar el gate.

### Opción C — Arreglar sobre `main`

Los arreglos candidatos, en orden de relación valor/riesgo:

| Arreglo | Qué se hace | Qué ataca |
|---|---|---|
| 1 | Subir o quitar `OPENROUTER_TEMPERATURE` (volver al default del modelo) | El registro acartonado, "Don Juan" |
| 2 | Devolver las reglas fijas al final del prompt, dejando la fecha última | "Afirma cosas que no son reales" |
| 3 | Sacar la línea de fecha/hora del system prompt (o moverla fuera del prefijo) | La caída de caché y el consumo |
| 4 | Revisar la voz del cierre (`CIERRE_DE_CONVERSACION` / `CLOSING_FAREWELL`) | Los 4 hallazgos de `tono` por "quedamos a su disposición" |
| 5 | Revisar el saludo nuevo del negocio | "A veces utiliza otro saludo" |
| 6 | Revisar el esquema del juez contra el modelo real | "El juez falla" |

- **Ventaja**: no se pierde nada de lo que sí sirve.
- **Riesgo**: se sigue sin poder atribuir, porque los cambios entran sobre el
  mismo estado que ya está degradado.

### Recomendación

**Opción A o B primero, y después reintroducir de a un cambio por vez.** El motivo
no es que el PR sea malo en bloque, es que **nadie puede atribuir el síntoma a un
cambio concreto en el estado actual**. Volver a un estado conocido y reingresar de
a uno es más barato que diagnosticar sobre un estado con 7 variables movidas.

Si se elige la C, conviene hacerlo **solo después de tener el protocolo de la
sección 8 andando**, porque si no se vuelve a optimizar a ciegas.

---

## 8. Cómo verificar (lo que faltó)

La medición que faltó es la de la **conversación**, no la del juez.

1. **Definir la vara antes de tocar nada.** Elegir 5–10 conversaciones reales de
   referencia (guardadas como texto) y anotar a mano qué está bien y qué no:
   saludo, registro, si afirma acciones imposibles, si usa el nombre del cliente.
   Eso es el criterio, no el score del juez.
2. **Un cambio por vez.** Cada cambio, su propia medición. Nunca dos cambios que
   tocan la voz en el mismo paso.
3. **Repetir cada caso N veces.** A temperatura 0,3 el modelo produce respuestas
   distintas con la **misma** entrada; con una sola muestra las conclusiones son
   falsas. En la fase F9 se comprobó: la variante que solo agregaba vocabulario y
   usaba la misma entrada que la base difería en 12 de 39 casos por puro ruido.
4. **Medir el consumo con la caché desglosada**, no solo el total de tokens:
   `promptTokens`, `cachedTokens` y su relación. Están en
   `agent_test_case.turn_metrics`.
5. **Verificar el juez por separado** y con el modelo real del negocio, contando
   `judge_failed` (está en `agent_test_case.status`).

Consulta lista para el desglose de consumo por corrida:

```sql
SELECT count(*) AS llamadas,
       round(avg((t->>'promptTokens')::numeric)) AS avg_prompt,
       round(avg((t->>'cachedTokens')::numeric)) AS avg_cache,
       round(100.0 * count(*) FILTER (WHERE (t->>'cachedTokens')::numeric > 0) / count(*), 1) AS pct_turnos_con_cache
FROM agent_test_case c, jsonb_array_elements(c.turn_metrics) AS t
WHERE c.run_id = '<run_id>';
```

---

## 9. Preguntas abiertas para la decisión

1. ¿El "Don Juan" aparece en conversaciones **con** nombre de contacto cargado, o
   también sin él? Si aparece sin nombre, la causa no es la ficha y hay que buscar
   en otro lado.
2. ¿El cambio de saludo es solo el texto nuevo (F8) o el agente además **no**
   respeta el saludo configurado? Son dos problemas distintos.
3. ¿Los fallos del juez son con `z-ai/glm-5.3-flash` o con otro modelo? F7 cambió
   el contrato y el impacto depende del modelo que lo obedezca.
4. ¿El consumo que se ve es **total** o por conversación? La caída de caché afecta
   el precio unitario, no necesariamente el volumen.
5. ¿Alguien está usando el CRM en un entorno compartido, o el desarrollo es de una
   sola persona? Cambia cuánto importa la ventana de inestabilidad.

---

## 10. Referencias

| Qué | Dónde |
|---|---|
| Evidencia por fase, con números y decisiones | `docs/bitacora-mejoras-llm.md` |
| El plan que se ejecutó | `docs/plan-mejoras-interaccion-llm.md` |
| La auditoría que originó el plan | `docs/auditoria-interaccion-llm.md` |
| El PR mergeado | https://github.com/juanbarrios18/crm/pull/22 |
| Configuración del negocio (texto y seed) | `src/server/seed/business-profile.ts` |
| Prompt del agente (orden actual) | `src/server/ai/prompts.ts:440-444` |
| Prompt del juez (contrato nuevo) | `src/server/lab/judge.ts` |

**Estado del árbol**: rama `feat/mejoras-interaccion-llm` viva y pusheada;
`main` en `81c0569` con el merge. Los datos del negocio en la base de desarrollo
están modificados por el seed, independientemente del código.

---

## Anexo A — Medición independiente y correcciones (2026-09-17)

> Lo produjo una sesión con contexto limpio que verificó este documento contra
> `agent_test_case` / `agent_test_run` (Postgres de desarrollo), el código en
> HEAD y los commits. Corrige y amplía la Sección 3. El plan de corrección que
> ejecuta estas conclusiones es `docs/plan-correccion-regresiones-pr22.md`.

### A.1 Números verificados

| Métrica | Baseline `run_vngfka7jq6qxcy52mcw7` | Final `run_uzw4zmt4fyg09sczm7lg` |
|---|---|---|
| Turnos | 128 | 127 |
| Llamadas por turno | **1** | **2** |
| Tokens de prompt por turno | 3.130 | 4.559 |
| Tokens cacheados | 34,0 % | 12,1 % |
| **Tokens facturados por turno** (prompt − caché) | **2.065** | **4.007 (+94 %)** |
| Latencia de turno | 1.328 ms | 794 ms |
| `afirmacion_sin_evidencia` / `debio_escalar` / `alucinacion` | 5 / 6 / 4 | 12 / 10 / 5 |
| `tono` / `fuera_de_kb` | 30 / 9 | 11 / 4 |
| `judge_failed` | 1 | 0 |

- La baseline corrió en la madrugada del 17 sobre un `main` que **aún no incluía
  los PRs #15–#21**: la comparación baseline→final abarca 8 PRs, no solo el #22.
- El salto nominal de tokens (3.130 → 4.559, +46 %) **no es atribuible al PR
  #22**: la baseline tenía una llamada; el estado de partida real (dos llamadas)
  medía ≈3.998 tokens de system en el commit del split (`cda5ae5`) y el #22 lo
  dejó en ≈4.300, por debajo de la referencia de 4.700 que el plan calculó. En
  esa ventana también entró la ficha del cliente (PR #17).
- **La fuga real está en la caché**: de los 4.007 tokens facturados por turno,
  ≈1.000 se explican por la caída de caché (con la tasa de la baseline sobre los
  prompts actuales se facturarían ≈3.009/turno).

### A.2 Huella de la caché (evidencia nueva)

| | Baseline | Final |
|---|---|---|
| Tamaño de los aciertos (cuando hay) | ~2.960 tokens (94 % del prompt) | ~1.970 (mayoría) y ~2.960 (5 turnos) |
| Aciertos por profundidad de turno | 18 % → 53 % → 71 % (crecen) | 28 % → 39 % → 12 % → 30 % (planos) |
| Turnos con algo de caché | 35,9 % | 26,0 % |

Lectura: en la baseline el acierto crecía con el hilo — el historial reusaba el
prefijo anterior. En la final eso desapareció. El candidato estructural es la
línea de fecha/hora (F5): única pieza que cambia cada minuto y vive **dentro**
del system prompt; al divergir cada turno, corta el prefijo antes del historial.
Es inferencia con evidencia consistente, no hecho probado (la bitácora ya lo
decía: "la causa no está establecida").

### A.3 Correcciones puntuales

1. **La ficha del cliente no vino del PR #18**: entró en `ae953a0` (PR #17) y es
   **nueva respecto de la baseline**. El síntoma "Don Juan" encaja mejor de lo
   que decía la Sección 3: el agente **sí** usa el `Nombre` de la ficha para
   saludar (evidencia real de la corrida final: `"Hola, [Prueba] Preguntón de
   precios."`). El Laboratorio no puede reproducir "Don" porque los nombres del
   corpus son placeholders (`[Prueba] …`).
2. **La atribución a F6 no está confirmada**: lo medido es el síntoma (5 → 12 y
   6 → 10), no la causa. Entraron 7 cambios juntos, el juez es inestable (8 de
   13 personas varían entre repeticiones de la misma corrida) y F7 cambió el
   contrato del juez. La atribución requiere el protocolo de la Sección 8.
3. **`judge_failed` en la corrida final: 0** (baseline: 1). El síntoma "el juez
   falla" no se reprodujo con `z-ai/glm-5.3-flash`.

### A.4 Consulta de verificación

```sql
-- Tokens facturados y caché por corrida
SELECT c.run_id,
       count(*) AS turnos,
       round(100.0 * sum((t->>'cachedTokens')::numeric)
                   / sum((t->>'promptTokens')::numeric), 1) AS pct_cache,
       round(sum(((t->>'promptTokens')::numeric - (t->>'cachedTokens')::numeric))
             / count(*)) AS facturados_por_turno
FROM agent_test_case c, jsonb_array_elements(c.turn_metrics) AS t
WHERE c.run_id IN ('run_vngfka7jq6qxcy52mcw7', 'run_uzw4zmt4fyg09sczm7lg')
GROUP BY 1;
```
