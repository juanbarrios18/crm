# Auditoría externa del contexto del agente y plan de optimización de la interacción LLM

> **Para quién**: el dueño del producto y la sesión que ejecute las fases.
> **Insumo**: `docs/auditoria-contexto-agente.md` (evidencia cruda), `docs/harness-agente-prod.md`,
> `docs/plan-correccion-regresiones-pr22.md` y el código de `src/server/ai/`, `src/lib/ai/`, `src/server/lab/`.
> **Estado**: `main` en `c3cd873`. F0 (instrumento) implementada en esta misma entrega, sin corrida aún.
> **Fecha**: 2026-09-17.

## Contexto

El agente de WhatsApp del CRM (Vocero) consume ~4.800 tokens de prompt por turno con 5–9 % de caché, alucina productos y afirma acciones imposibles. Se hicieron ya tres planes (mejoras PR #22, corrección de regresiones, P1) y la caché no se recuperó. El pedido: auditar desde afuera y proponer cómo DEBERÍA diseñarse una interacción LLM eficiente, con una frontera clara entre lo que vive en código (comportamiento base de un chatbot comercial) y lo que vive en la configuración del CRM (tono, empresa, productos).

Insumos leídos: `docs/auditoria-contexto-agente.md` (con anexo crudo), `docs/harness-agente-prod.md`, `docs/plan-correccion-regresiones-pr22.md`, `src/server/ai/prompts.ts`, `src/lib/ai/index.ts`, mapa de `pipeline.ts`, `history.ts`, `actions.ts`, `schema.ts`, `env.ts`, `src/server/lab/*`.

---

## Parte 1 — Auditoría

### 1.1 Diagnóstico raíz (no es la fecha, no es el orden: es la arquitectura del estado)

El sistema mezcla en un solo mensaje `system` dos cosas de naturaleza distinta:

| Naturaleza | Ejemplos | Frecuencia de cambio |
|---|---|---|
| **Configuración** (quién es el agente, qué sabe, cómo habla) | identidad, tono, instrucciones, KB, catálogo, zonas, etapas, reglas fijas | por deploy o por edición del dueño |
| **Estado** (dónde está esta conversación) | etapa del lead, ficha del contacto, notas `[IA]`, fecha/hora | **cada turno** |

Toda optimización previa reordenó bloques *dentro* del system. Pero el proveedor acredita caché solo si el `system` es idéntico byte a byte (medido: sonda A/B 0 %, C/G/H 80–85 %). Mientras haya un solo byte de estado en el system, el prefijo entero se pierde. Ese es el hallazgo central de la propia auditoría interna (§6) y la razón por la que P1 no movió la aguja.

### 1.2 El bucle de retroalimentación de notas `[IA]` (el problema más grave, y no es de caché)

`pipeline.ts:641-645` hace append de una línea generada por el modelo en cada turno. `prompts.ts:192` la vuelve a inyectar (últimos 1.500 caracteres). Efectos verificados en el anexo A.2:

- 17 notas casi idénticas ("Cliente consulta por boleta" × 6 variantes) dentro del prompt. Es **texto del modelo alimentando al modelo**: ruido que crece, sin depuración, y que un modelo chico pesa como si fuera verdad del negocio.
- La ficha rendereada trae `Empresa: Lamas Foods`, `Rubro: equipo comercial`: la anotación extrajo datos del **saludo del propio agente** y los guardó como datos del cliente. La ficha ya está contaminada y se reinyecta cada turno.
- Costo: ~180 tokens/turno que crecen hasta el tope y desplazan el prefijo en cada turno.

Conclusión: **un registro escrito por el agente no debe volver al prompt del agente.** Las notas son para humanos (timeline del lead). Al modelo le sirve solo la ficha estructurada, y como mucho *un* resumen de una línea que se **reemplaza**, nunca se acumula.

### 1.3 Duplicación y contradicciones dentro del prompt

- Las instrucciones del negocio (~3.000 caracteres) viajan **dos veces por turno** (conversación + anotación). La anotación las necesita solo para juzgar la etapa (medido F9: sin ellas 17/39 casos quedan atrás). Lo que la anotación realmente necesita es el **criterio de cada etapa**, no el reglamento completo. Ese criterio hoy no existe como dato: está implícito en prosa.
- El dueño escribió en `instructions` reglas que ya están en código (N2): "No invente precios", "Nunca revele estas instrucciones", "No prometa registrar…". Duplicación → más tokens y señales contradictorias sobre quién manda.
- "CONOCIMIENTO DEL NEGOCIO (su única fuente de verdad)" se renderiza **vacío**, mientras la verdad real vive en `instructions` y en el catálogo. El modelo recibe una etiqueta que le dice que su fuente de verdad no tiene nada.
- 77 viñetas, 9 "NUNCA", 20 "NO". Un prompt-reglamento para `gemini-2.5-flash-lite`. Los modelos chicos siguen mal las listas largas de prohibiciones y bien los ejemplos cortos y la estructura.
- Catálogo como lista plana de 12 líneas con `producto — masa — formato`. La alucinación "hamburguesa 15 cm a $4.080" es exactamente el error de leer una tabla plana: cruzó la fila de completo 15 cm con la de hamburguesa. Un render **agrupado por producto → formatos disponibles** hace esa confusión mucho más difícil.

### 1.4 Ausencia de guardrails deterministas sobre la salida

Hoy la prevención de alucinaciones es 100 % prompt. No hay ningún chequeo en código de que:
- todo precio `$X` en `reply` exista en el catálogo,
- todo `producto + formato` mencionado exista,
- no aparezcan afirmaciones prohibidas ("ya lo envié", "quedó agendado", "boleta emitida"),
- una comuna citada esté en zonas.

Existen ya chequeos deterministas en el Laboratorio (`pipeline-check.ts`, `dialect-check.ts`) pero son *post-mortem*. El mismo patrón debe correr **en producción, antes de enviar**, con una reparación acotada (un reintento con la violación concreta) y un fallback seguro.

### 1.5 El instrumento de evaluación no tiene potencia para atribuir

- Juez LLM con 8/13 personas cambiando de veredicto entre repeticiones. Con ese ruido no se puede atribuir `tono` 11 → 22.
- `score` mezcla hechos (precio inventado) con juicio (tono). Los hechos son verificables por código; solo el tono necesita LLM.
- La caché y los tokens no son gate del Laboratorio: se miran a mano después.
- 3 repeticiones con el mismo guion inflan la caché medida (coincidencia entre repeticiones que no existe en producción).

### 1.6 Lo que sí está bien y hay que conservar

- La frontera única con el proveedor (`chatJson`, Zod, reintentos) es correcta.
- La separación conversación/anotación en paralelo es correcta (latencia 794 ms).
- La capa N1 "verdad del sistema" derivada de capacidades es la idea correcta: **la única forma real de evitar "ya envié la boleta" es que el modelo sepa qué puede hacer**; hay que reforzarla con guardrails, no con más reglas.
- El registro neutro del código (W1-A) y la deferencia de voz a la configuración son correctos.
- La reciente decisión de mover el temporal fuera del system (forma C) es correcta; solo era insuficiente.

### 1.7 Frontera código ↔ configuración del CRM (estado actual vs. objetivo)

| Concern | Hoy | Debería |
|---|---|---|
| Contrato de salida JSON, capacidades del canal (N1), conducta universal (N2), formato WhatsApp, cierre | código | **código** (producto) ✔ |
| Identidad, saludo, reglas de escalado | config libre | **config** ✔ |
| Tono | 1 campo de texto libre (500) | **config estructurada**: tratamiento (usted/tú), país/dialecto, largo; el código compone la frase |
| Conocimiento factual (condiciones, mínimos, dirección, pago) | dentro de `instructions` como prosa; KB vacía | **KB** (qa/block), etiquetada como verdad |
| Proceso comercial (qué averiguar, en qué orden) | prosa en `instructions` | **config**: `instructions` acotadas al proceso, sin reglas de conducta |
| Criterio de avance por etapa | implícito en prosa | **config por etapa** (`pipelineStage.criteria`, 1–2 líneas) → único insumo de la anotación |
| Catálogo, zonas, etapas | tablas | tablas ✔, render agrupado |
| Estado del turno (etapa actual, ficha, fecha) | dentro del system | **fuera del system**, al final del arreglo |
| Notas `[IA]` | prompt + BD append | **solo timeline humana**; al modelo un resumen reemplazable opcional |

---

## Parte 2 — Diseño objetivo de un turno

```
[system]  PREFIJO ESTABLE (idéntico entre turnos de la misma org)
          1. identidad + voz compuesta desde config estructurada
          2. capacidades del canal (N1, código)
          3. conducta universal compacta (N2, código, ≤10 líneas)
          4. proceso comercial del negocio (config, sin conducta)
          5. escalado (config)
          6. conocimiento (KB, config)  ← fuente de verdad declarada y no vacía
          7. catálogo agrupado por producto (tablas)
          8. zonas (tablas)
          9. contrato de salida + formato (código)
[user/assistant …]  historial (20 mensajes, marcadores humanos)
[user]    último mensaje del cliente
          + [CONTEXTO INTERNO] estado del turno:
              etapa: Interesado · ficha: {campos estructurados presentes}
              fecha/hora
```

Reglas del diseño:
- **Nada que cambie por turno entra al system.** Es un invariante con test unitario: `buildAgentSystemPrompt(orgConfig)` debe ser una función pura de la configuración de la organización, sin `currentStage`, sin `clientFile`, sin `now`.
- **El estado viaja al final**, en el mismo mecanismo ya medido (forma C: 81–82 %). Un solo bloque interno con marcador.
- **Anotación**: system estable propio (criterios de etapa + vocabulario del catálogo + contrato), sin `instructions`, sin etapa actual en el system; la etapa actual viaja en el bloque de estado. Temperatura 0. Su prefijo también cachea.
- **Post-validación determinista** de `reply` antes de enviar: precios ∈ catálogo, producto+formato ∈ catálogo, comuna ∈ zonas, sin afirmaciones prohibidas. Violación → un reintento con la violación citada; segunda violación → respuesta segura ("lo confirmo con el equipo") + marca en telemetría.
- **Ficha**: solo campos estructurados; la anotación no puede extraer datos de mensajes `assistant` (ya usa `plain-assistant`, pero el contrato debe decir "solo lo que dijo el CLIENTE"); `contact.notes` deja de recibir `[IA]` y nace `lead_activity` (o se usa el timeline existente) para humanos.

Metas medibles (heredadas del plan de corrección, ajustadas):

| Métrica | Hoy | Meta |
|---|---|---|
| % tokens cacheados (conversación) | 5–9 % | **≥60 %** desde el turno 3 (techo medido 82–85 %) |
| Tokens facturados/turno (2 llamadas) | ~4.450 | **≤2.200** |
| Tamaño system conversación | ~3.300 tok | **≤2.000 tok** |
| Precios/productos fuera de catálogo en `reply` (check determinista) | no medido | **0** |
| Afirmaciones prohibidas (check determinista) | no medido | **0** |
| Latencia | 794 ms | ≤1.000 ms |

---

## Parte 3 — Plan por fases (un cambio por corrida, protocolo de `plan-correccion-regresiones-pr22.md` §3)

### F0 — Instrumento antes que cambios (sin tocar el agente)
Archivos: `src/server/lab/runner.ts`, nuevo `src/server/lab/fact-check.ts`, `scripts/lab-run.ts`.
- Chequeos deterministas por transcript: precios y productos citados ∈ catálogo, comunas ∈ zonas, afirmaciones prohibidas (regex), handoff presente cuando la persona lo pide. Mismo patrón que `applyPipelineCheck`. Hallazgos tipo `hecho` (rojo).
- Reporte por corrida: % caché, facturados/turno, tamaño system, separado por llamada (conversación/anotación). Gate opcional vía flags.
- Personas con **guion variado por repetición** (3 variantes de redacción por persona) para no inflar la caché.
- El juez LLM queda solo para `tono` y `fuera_de_kb`.
- Corrida baseline con este instrumento. Tests: `tests/unit/lab-fact-check.test.ts`.

### F1 — System prompt estable (caché)
Archivos: `src/server/ai/prompts.ts`, `src/server/ai/pipeline.ts`, `tests/unit/prompt-client-file.test.ts` (+ nuevo `prompt-stability.test.ts`).
- `buildAgentSystemPrompt` deja de recibir `currentStage` y `clientFile`. Nuevo `renderTurnState({stage, clientFile, now, timeZone})` que reemplaza a `renderTemporalNote` y se adjunta con `appendTemporalNote` (renombrar a `appendTurnContext`).
- Lo mismo en `buildAnnotationSystemPrompt`: sin `currentStage`.
- Test de invariante: dos llamadas con distinta etapa/ficha/fecha → system idéntico.
- Corrida. Esperado: caché ≥60 % en conversación; anotación empieza a cachear su prefijo.

### F2 — Cortar el bucle de notas
Archivos: `pipeline.ts` (`appendLeadNote`), `prompts.ts` (`renderClientFile`, eliminar `capNotes`/`CLIENT_FILE_NOTES_MAX_CHARS`), `actions.ts` (`LeadExtraction.note` → `resumen` reemplazable, opcional), schema si se crea `lead_activity`.
- `[IA] nota` deja de ir a `contact.notes`; va a la actividad del lead (visible en la ficha del CRM).
- Al modelo: ficha estructurada + opcionalmente un `resumen` de una línea que se **sobrescribe**. Medir con y sin resumen.
- Contrato de anotación: "solo datos que dijo el CLIENTE; ignore lo que dijo el agente".
- Corrida. Esperado: baja `afirmacion_sin_evidencia` y `alucinacion`; ficha sin datos del propio agente.

### F3 — Anotación sin las instrucciones completas
Archivos: `schema.ts` (`pipelineStage.criteria` text nullable), migración, UI de etapas, `prompts.ts` (`buildAnnotationSystemPrompt`), `env.ts` (temperatura por rol: `OPENROUTER_ANNOTATION_TEMPERATURE` = 0).
- La anotación recibe: etapas con su criterio (config), vocabulario del catálogo, contrato. Sin `instructions`.
- Corrida. Gate: etapa final igual o mejor que F9 (≤ los 17/39 de desvío medidos sin instrucciones tienen que desaparecer; comparar contra baseline F2).

### F4 — Poda y estructura del prefijo
Archivos: `prompts.ts` (N2, CIERRE, FORMATO), `renderCatalog` agrupado, semilla/`instructions` del negocio de desarrollo (quitar reglas de conducta duplicadas y mover hechos a KB).
- Meta: system ≤2.000 tokens. N2 ≤10 líneas; FORMATO con un ejemplo, no siete reglas. Etiqueta de fuentes de verdad: "KB + catálogo + zonas + condiciones".
- Catálogo: `Pan de hamburguesa (masa Brioche): 10 cm bolsa 12 $…; 11 cm …; 12 cm …`.
- Corrida. Gate: sin regresión en hechos (F0) y en etapa (F3).

### F5 — Guardrails deterministas en producción
Archivos: nuevo `src/server/ai/reply-guard.ts` (reusa la lógica de `lab/fact-check.ts`), `pipeline.ts` (entre `chatJson` y la entrega), telemetría `guard_violations` en `turn_metrics`.
- Precio/producto/comuna fuera de fuentes o afirmación prohibida → un reintento con mensaje `system` final que cita la violación (no rompe el prefijo) → si persiste, respuesta segura.
- Tests unitarios del guard con los casos reales del anexo (hamburguesa 15 cm, "podemos emitir boleta").

### F6 — Configuración estructurada de voz
Archivos: `schema.ts` (`agentProfile.voice` jsonb: `{tratamiento, pais, largo}`), `api/agent/profile/route.ts`, `agent-client.tsx` (con contador de caracteres para `instructions`/`escalationRules`, hoy solo lo tiene la KB), `prompts.ts` (compone la línea de voz).
- `tone` libre queda como complemento opcional. Corrida: `tono` del juez; la meta original era ≤5.

### F7 — Experimentos diferidos (después de F1–F5, con el instrumento de F0)
- Un modelo un escalón arriba (`gemini-2.5-flash`) con el prompt podado: el costo puede quedar igual o menor que hoy gracias a la caché.
- `cache_control` explícito si se prueba un proveedor que lo requiera.
- Anotación condicional (solo cuando el último mensaje del cliente tiene señal), medida contra la tasa de campos perdidos.

### Orden y presupuesto
F0 → F1 → F2 → F3 → F4 → F5 → F6. Una corrida de 39 casos por fase (F0 dos: baseline + validación del instrumento). F1 y F2 son las que recuperan tokens y conducta; F5 es la que elimina la clase de error "hecho inventado" sin depender del modelo.

---

## Verificación
- Unit: `pnpm test` (nuevos: `prompt-stability`, `lab-fact-check`, `reply-guard`, `render-turn-state`).
- `pnpm lab:check` antes de cada corrida; `pnpm lab:run` una vez por fase con modelos y datos congelados.
- Después de F1: comparar hash del system por turno en el proxy de captura → debe ser **1 system distinto por organización**, no 124/128.
- E2E (Definición de Hecho): conversación mock feliz + persona que pide boleta + persona que pide humano.
- Cada fase cierra con una entrada en `docs/bitacora-*.md` con la corrida y la lectura contra la meta.

## Estado de ejecución
- F0 parcial (2026-09-17): `src/server/lab/fact-check.ts` (precio, formato y afirmación prohibida, tipo `hecho`, fuerza rojo) cableado en `runner.ts` tras el chequeo de dialecto; `src/server/lab/run-metrics.ts` agrega tokens, caché y hallazgos por tipo al informe de `pnpm lab:run`. Tests: `tests/unit/lab-fact-check.test.ts`, `tests/unit/lab-run-metrics.test.ts`.
- Pendiente de F0: guiones variados por repetición (decisión de producto: cambia las personas) y acotar el juez a `tono` y `fuera_de_kb`. Corrida baseline pendiente (gasta créditos del proveedor: la dispara el dueño).
- F1 en adelante: no iniciadas.

## Baseline F0 — corrida `run_s6pu2sp8dhjhl1p77r8r` (2026-09-18)

Instrumento nuevo (fact-check + resumen de tokens), sin cambios en el agente. Modelos y datos congelados: `google/gemini-2.5-flash-lite` (agente y anotación), `z-ai/glm-5.3-flash` (juez), temperatura 0,3, KB vacía, 12 productos, 11 zonas.

| Métrica | Baseline F0 | Meta del plan |
|---|---|---|
| Turnos | 118 | — |
| % tokens cacheados | **10,1 %** (26 turnos con caché) | ≥60 % |
| Facturados por turno | **4.078** | ≤2.200 |
| Score del arnés | 50 | (no comparable) |
| Personas inestables | 8 de 13 | — |

Hallazgos por tipo: `tono` 22 · `debio_escalar` 12 · `alucinacion` 3 · `afirmacion_sin_evidencia` 3 · `hecho` 2 · `judge_failed` 2 · `fuera_de_kb` 1.

Lecturas:

- La caché y los facturados coinciden con la auditoría (5–9 % y ~4.450). El instrumento reproduce el problema.
- `debio_escalar` 12: casi todos en `pide_credito` y `comprador_decidido` ("¿me hacen precio?"). Las reglas de escalado del negocio piden escalar cuando el cliente propone algo no contemplado; el agente lo niega en seco y sigue. Es N2 ("no lo niegue en seco… si insiste, escale") compitiendo con las instrucciones del negocio. Insumo directo para F4.
- `tono` 22: tres fuentes repetidas, todas ya conocidas: "Quedamos a su disposición" (viene de `CLOSING_FAREWELL` y del prompt de cierre), "Estimado cliente", y el nombre de la ficha completo en cada saludo ("Hola, [Prueba] Preguntón de precios."). Las tres son de código o de la ficha, no del negocio. Insumo para F4 y F6.
- Los 2 `hecho` de esta corrida fueron falsos positivos del propio instrumento y quedaron corregidos: un total de 10 bolsas (múltiplo del precio de catálogo) y un ofrecimiento en subjuntivo ("¿quiere que le envíe…?"). El fact-check acepta múltiplos enteros de precios del catálogo y conserva tildes para distinguir pretérito de subjuntivo.
- 2 `judge_failed` por timeout del juez ("This operation was aborted").
- Corrida previa `run_vsmq6s797treb87d5qin` interrumpida a los 10 min por la limpieza de arranque del servidor de desarrollo (corrida headless en otro proceso). Corregido en `src/server/lab/orphan-runs.ts`: en desarrollo solo se limpian corridas más viejas que el timeout del runner.

## F1 — system estable — corrida `run_krfubp94mdrocyfhwh39` (2026-09-18)

Cambio único: etapa, ficha y fecha salen del `system` (conversación y anotación) y viajan en un bloque interno al final del último mensaje del cliente. Mismos modelos, temperatura y datos que la baseline.

| Métrica | Baseline F0 | F1 | Meta |
|---|---|---|---|
| Turnos | 118 | 123 | — |
| % tokens cacheados | 10,1 % | **23,4 %** (54 turnos) | ≥60 % |
| Facturados por turno | 4.078 | **3.639** | ≤2.200 |
| Caché promedio en turnos 4–5 | — | ≈2.690 tokens de ≈4.950 | — |

Lectura de caché: a partir del turno 3 el `system` de conversación (~2.700 tokens) se acredita entero. Lo que queda sin caché es la anotación (system + 6 mensajes desplazados) y el historial. Para llegar a la meta hacen falta F3 (anotación chica) y F4 (poda).

Hallazgos: `alucinacion` 3 → **15**, `afirmacion_sin_evidencia` 3 → **9**, `tono` 22 → 13, `debio_escalar` 12 → 5.

**Atribución del salto de `alucinacion`: confundido, no atribuible a F1 solo.**

- El Laboratorio **reutiliza los mismos contactos de prueba entre corridas** (`[Prueba] Cliente recurrente — repetición 2`, etc.) y las notas `[IA]` se acumulan entre corridas. F1 corrió sobre fichas con las notas de las tres corridas anteriores. Ejemplo: la ficha de "Cliente recurrente" ya decía "Cliente solicita agregar 10 bolsas de pan de hamburguesa brioche" y el agente respondió "¿las 10 bolsas que solicitó anteriormente?" y calculó "20 bolsas… $4.440" (mal: 20 × 2.220 = 44.400). Es el bucle de notas de la sección 1.2, con un agravante: al final del prompt, pegado a la pregunta, el estado tiene **más saliencia** que dentro del system.
- Varios `alucinacion` del juez son falsos: "Puerto Montt no está dentro de nuestras zonas" (correcto), "viene en bolsa de 12 unidades" (está en el catálogo), "Hola, [Prueba]" (es tono, no alucinación). El juez sigue siendo inestable (7 de 13).
- El marcador interno **no se filtró** a ninguna respuesta (0 apariciones).
- Bajaron `tono` y `debio_escalar`, y `pide_credito` pasó a verde × 3.

Decisión: **se conserva F1** (la mejora de caché es la esperada y el mecanismo funciona) y se pasa a F2 con dos piezas: cortar las notas `[IA]` del prompt y del `contact.notes`, y que el Laboratorio **limpie la ficha de los contactos de prueba al inicio de cada corrida** para que las corridas sean comparables.

## F2 — notas fuera del prompt — corrida `run_0m11fjn2ug8lkc27uveh` (2026-09-18)

Cambio: la ficha ya no incluye `notes` (siguen guardándose en `contact.notes` para humanos); el contrato de anotación extrae solo lo que dijo el CLIENTE; el Laboratorio resetea ficha y notas de cada contacto de prueba al inicio de la corrida (verificado: 0 contactos con más notas que turnos de la corrida).

| Métrica | Baseline F0 | F1 | F2 | Meta |
|---|---|---|---|---|
| % tokens cacheados | 10,1 % | 23,4 % | **27,6 %** (67 turnos) | ≥60 % |
| Facturados por turno | 4.078 | 3.639 | **3.366** | ≤2.200 |
| `alucinacion` | 3 | 15 | **3** | ≤4 |
| `afirmacion_sin_evidencia` | 3 | 9 | 6 | ≤6 |
| `debio_escalar` | 12 | 5 | 4 | ≤6 |
| `tono` | 22 | 13 | 12 | ≤5 |
| Personas inestables | 8/13 | 7/13 | **5/13** | — |
| Score (no comparable) | 50 | 38 | 65 | — |

Lecturas:

- Atribución confirmada: sin notas en la ficha, `alucinacion` vuelve a 3 y `cliente_recurrente` deja de inventar pedidos previos. El salto de F1 era el registro acumulado, no el system estable.
- Lo que queda en rojo es de conducta y de código, no de contexto: `cliente_enojado` (pide datos en vez de escalar, e inventa un teléfono "+569XXXXXXX"), `comprador_decidido` ("¿me hacen precio?" → niega en seco sin escalar), `cliente_recurrente` (promete "confirmar stock" y "agregamos a su pedido" sin poder hacerlo). Insumo directo de F4 (poda y reglas de escalado) y F5 (guardrail de afirmaciones).
- Caché por turno: 4.520 tokens de prompt en el turno 1 y ≈2.600 cacheados desde el turno 4. El techo de esta arquitectura con la anotación actual ronda el 55 % en conversaciones largas; para la meta hacen falta F3 (anotación chica con criterios por etapa) y F4 (poda del system).
- 2 `judge_failed` por timeout del juez (`This operation was aborted`), igual que en la baseline: conviene subir el timeout del juez o reintentar una vez.

## F3 — anotación con criterios por etapa — corrida `run_gbaasl1cajrpetxw2bnc` (2026-09-18)

Cambio: `pipeline_stage.criteria` (config del CRM, editable en el gestor de etapas); la anotación recibe etapas con criterio en lugar de las instrucciones completas; temperatura 0 en la extracción.

| Métrica | F2 | F3 | Meta |
|---|---|---|---|
| Prompt tokens turno 1 (2 llamadas) | 4.520 | **3.804** | — |
| Facturados por turno | 3.366 | **2.918** | ≤2.200 |
| % tokens cacheados | 27,6 % | 25,9 % | ≥60 % |
| Etapa final igual o mejor que F2 | — | 13 de 13 personas | sin regresión |
| `alucinacion` / `afirmacion_sin_evidencia` | 3 / 6 | 5 / 5 | ≤4 / ≤6 |
| `debio_escalar` | 4 | 7 | ≤6 |
| `tono` | 12 | 17 | ≤5 |
| Personas inestables | 5/13 | 8/13 | — |

Lecturas:

- La anotación bajó ~700 tokens por turno sin perder etapa: `consumidor_final` ahora cierra en Perdido (antes quedaba en Nuevo), `pide_boleta_pago` y `pregunton_precios` avanzan más; `reclama_no_recibido` pasa a Cliente (cumple el criterio literal "confirmó el pago"; revisar si el negocio quiere una etapa distinta para reclamos post-venta).
- El % de caché baja levemente porque el denominador se achicó: los tokens cacheados absolutos por turno (≈2.100 en el turno 5) son los del system de conversación, que F4 reduce.
- Los hallazgos del juez suben (`tono` 17, `fuera_de_kb` 7, 8 inestables): ruido del instrumento y, en parte, **confusión introducida por mí**: el seed de F4 (instrucciones 2.947 → 2.724 chars) se aplicó en la base mientras F3 corría, y el pipeline lee el perfil por turno. Los casos posteriores a ese momento vieron un system distinto. Lección para el protocolo: ningún seed ni migración de datos con una corrida en curso.
- 2 `judge_failed` por timeout, como en todas las corridas.

## F4 — poda y estructura del system — corrida `run_m3yq5vof0xmblb0gdff2` (2026-09-18)

Cambio: N2 en 7 líneas (con escalado explícito), estilo en 6 con un ejemplo, fuentes de verdad declaradas una vez, KB omitida si vacía, catálogo agrupado, cierre determinista natural, seed sin reglas duplicadas. System del perfil sembrado: 10.159 → 8.451 caracteres.

| Métrica | F3 | F4 | Meta |
|---|---|---|---|
| Prompt tokens turno 1 (2 llamadas) | 3.804 | **3.418** | — |
| Facturados por turno | 2.918 | **2.494** | ≤2.200 |
| % tokens cacheados | 25,9 % | **29,6 %** (70 turnos) | ≥60 % |
| `alucinacion` / `afirmacion_sin_evidencia` | 5 / 5 | 4 / 5 | ≤4 / ≤6 |
| `debio_escalar` | 7 | 9 | ≤6 |
| `tono` | 17 | **12** | ≤5 |
| Personas inestables | 8/13 | 7/13 | — |

Acumulado desde la baseline: facturados por turno 4.078 → 2.494 (−39 %), caché 10,1 % → 29,6 %.

Lecturas:

- Defecto nuevo visible: en 1 de 3 repeticiones de `reclama_no_recibido` y `cliente_enojado` el agente respondió **el saludo sugerido literal en todos los turnos** (5 turnos del agente en esta corrida, 3 en F3). Es degeneración del modelo chico ante la línea "Saludo sugerido para conversaciones nuevas": la repite como plantilla. Se corrige en F5 con un chequeo determinista (saludo repetido → corrección) además de la regla de estilo.
- `debio_escalar` 9: `comprador_decidido` × 3 ("¿me hacen precio?") sigue sin escalar aunque N2 lo pide en una línea explícita. `gemini-2.5-flash-lite` no sostiene esa regla con consistencia: candidato a resolverse por código (detección de intención de descuento/crédito → handoff) o con un modelo un escalón arriba (F7).
- `alucinacion` del juez: 2 de 4 son falsas (listar las comunas con cobertura es correcto; "este canal no gestiona envíos de documentos" es N1). Las reales: "pan de completo 20 cm … bolsa de 6" (es bolsa de 10) y "así podremos emitir su boleta".
- El % de caché sube con el prompt más chico, pero el techo absoluto por turno baja a ≈1.500 tokens cacheados: lo que queda sin caché es el historial y la anotación, ambos legítimamente variables. La meta de 60 % no es alcanzable con caché de prefijo implícita sobre conversaciones de 5 turnos; el objetivo operativo real es facturados por turno, que ya bajó 39 %.
