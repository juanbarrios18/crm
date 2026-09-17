# Auditoría de la interacción con el LLM

> **Qué es**: la auditoría del ciclo completo de interacción con el modelo
> (construcción del prompt, llamadas por turno, contratos de salida, costo,
> latencia y fidelidad con la conversación) **después** de la ejecución nocturna
> documentada en `docs/plan-ejecucion-nocturna.md` y `docs/bitacora-nocturna.md`.
>
> **Qué NO es**: no reemplaza `docs/auditoria-interaccion-agente.md` (diagnóstico
> y diseño objetivo) ni `docs/harness-agente-prod.md` (inventario de la línea
> base). Esta auditoría mide el estado **posterior** a los cambios y responde dos
> preguntas: ¿cuán eficiente es el turno hoy? y ¿cuán fiel es a la conversación?
>
> **Método**: lectura del código en la rama
> `refactor/agente-conversacion-y-anotacion` (`d861575`, con los PR #15 a #18
> mergeados), medición del prompt real con la configuración real de la base de
> desarrollo, y lectura de los `turn_metrics` persistidos por el Laboratorio.
> Solo lectura: no se escribió en la base ni se disparó ninguna corrida.
>
> **Fecha**: 2026-09-17

---

## 0. Resultado en dos tuits

Anoche el agente mejoró por dentro y sigue sonando igual por fuera, ahora con
números: los tres defectos de infraestructura quedaron cerrados (cero
contradicción de idioma, la ficha del cliente vuelve al prompt, el contrato de
conversación ya no pide campos del CRM) y el juez por fin atrapa el registro de
call center (`errores_modismos` pasó de verde a amarillo en 3 de 3). Pero la
precisión no subió: 25 de 39 casos siguen marcados por tono, y la causa se mudó
del código a los datos, porque las instrucciones y el saludo del negocio
continúan en voseo y con fórmula de call center. La eficiencia, en cambio,
empeoró sin haberse medido: el turno pasó de una llamada de 3.130 tokens a dos
de unos 4.700 (+50 %), en serie antes de entregar la respuesta, con el bloque
fijo de reglas duplicado, sin temperatura fijada y con el 64 % de las llamadas
sin caché de prefijo.

---

## 1. Qué se auditó y con qué evidencia

| Pieza | Fuente de evidencia |
|---|---|
| Composición y tamaño del prompt actual | Medición con el código real (`buildAgentSystemPrompt`, `buildAnnotationSystemPrompt`) sobre la configuración real de la organización de desarrollo |
| Costo y latencia por turno | `agent_test_case.turn_metrics` de la corrida `run_vngfka7jq6qxcy52mcw7` (128 llamadas) |
| Aciertos y fallas de precisión | `agent_test_case.hallazgos` y `veredicto` de la misma corrida (39 casos) |
| Código del ciclo | `src/server/ai/pipeline.ts`, `src/server/ai/prompts.ts`, `src/server/ai/actions.ts`, `src/lib/ai/index.ts`, `src/server/lab/judge.ts` |
| Configuración viva | `agent_profile` de la base de desarrollo (tono, instrucciones, escalado, saludo) |

**Calibración de tokens**: la corrida de referencia midió 3.130 tokens de prompt
en promedio por llamada, y el prompt de conversación medido hoy tiene 9.617
caracteres. Eso fija la ratio real de este material (español con precios,
tildes y símbolos) en **≈3,2 caracteres por token**, no en los 4 que se usan
habitualmente como regla rápida. Todas las estimaciones de este documento usan
la ratio calibrada.

---

## 2. Qué cambió anoche, y qué no

### 2.1 Cambios que sí tocaron la interacción con el modelo

| Defecto raíz | Estado hoy | Evidencia |
|---|---|---|
| **D1 · Contradicción de idioma** | **Cerrado.** El código ya no declara el idioma ni el registro: defiere a los ajustes del negocio. | `prompts.ts:329` — `Responda siempre en el idioma del negocio y con el registro que definen los ajustes` |
| **D2 · Voseo en el harness (código)** | **Cerrado en el código.** Las reglas de código pasaron a registro neutro con trato de usted, y hay guardián mecánico. | `NIVEL_2_CONDUCTA_UNIVERSAL`, `CIERRE_DE_CONVERSACION`, `FORMATO_DE_MENSAJES`; `tests/unit/voice-register.test.ts` |
| **D3 · JSON con campo de CRM en cada turno** | **Resuelto parcialmente.** El turno ahora son dos llamadas con contratos disjuntos, pero la llamada de conversación sigue siendo JSON. | `ConversationReply` (`reply`, `handoff`) vs. `LeadExtraction`; `callProvider` mantiene `response_format: json_object` |
| **D4 · La ficha nunca volvía** | **Cerrado.** La ficha del contacto se consulta y se inyecta en cada turno. | `pipeline.ts:216-241` + `renderClientFile()`; medido en +326 caracteres con ficha realista |

### 2.2 Cambios que **no** se hicieron (y por qué importan acá)

| Fase | Estado | Consecuencia para esta auditoría |
|---|---|---|
| **Fase E — datos bajo demanda y orden para caché** | No ejecutada | El catálogo y las zonas completos siguen en cada llamada, y el bloque estático de reglas sigue **después** de lo dinámico |
| **Fase G — recortar el harness** | No ejecutada (bloqueada por decisión) | El bloque fijo de reglas sigue pesando 3.786 caracteres y va en la llamada de conversación |
| **Fase A — pendientes del harness** | Bloqueada por regla cero | El cuerpo de las reglas sigue igual, salvo la reubicación que no se pudo hacer |

**El hallazgo más importante de la noche no está en esa tabla**: la Fase 8
descubrió que el defecto de registro **no estaba solo en el código**. Estaba —y
sigue estando— en la configuración del negocio, que es dato. Ver §4.6.

---

## 3. Eficiencia: cómo se gasta el turno

### 3.1 Anatomía del turno hoy

```
mensaje entrante
   │
   ├─ GUARDS DETERMINISTAS (sin LLM)          pipeline.ts:152-187
   │    handoff activo · ventana 24 h · regex de intención de escalado · coalesce
   │
   ├─ LLAMADA 1 — CONVERSACIÓN                pipeline.ts:271
   │    sistema 9.617 chars + historial (hasta 20 mensajes)
   │    salida JSON: { reply, handoff }
   │    hasta 3 intentos ante JSON inválido
   │
   ├─ (opcional) LLAMADA 1b — CORRECCIÓN      pipeline.ts:297-321
   │    solo si `reply` vino vacío: otros 3 intentos
   │
   ├─ LLAMADA 2 — ANOTACIÓN                    pipeline.ts:339
   │    sistema 4.532 chars + EL MISMO historial
   │    salida JSON: { stage, note, campos del lead }
   │    hasta 3 intentos; falla sin tumbar el turno
   │
   └─ ENTREGA                                  pipeline.ts:388-396
        recién acá se envía la respuesta al cliente
```

**Tres hechos de arquitectura que definen el costo:**

1. **La anotación está en el camino crítico de la entrega.** El `reply` se genera
   en la llamada 1, pero no se entrega hasta que termina la llamada 2
   (`pipeline.ts:339` antes de `deliverReply` en la línea 390/395). La anotación
   no influye en el texto que recibe el cliente, y sin embargo el cliente la
   espera.
2. **El historial completo se envía dos veces.** `annotationMessages` reutiliza
   `messages.slice(1)` (`pipeline.ts:337`): el mismo bloque de hasta 20 mensajes
   viaja en las dos llamadas.
3. **El peor caso sigue siendo de 9 llamadas por turno**: 3 intentos de
   conversación + 3 de corrección + 3 de anotación (`MAX_ATTEMPTS = 3` en
   `lib/ai/index.ts:45`, aplicado a los tres puntos de llamada).

### 3.2 Composición del prompt (medida hoy, configuración real)

| Bloque | Caracteres | Tokens aprox. | ¿En qué llamada? | ¿Cacheable? |
|---|---:|---:|---|---|
| Identidad | 224 | 70 | conversación | Sí |
| Tono (N3) | 128 | 40 | conversación | Sí |
| **Instrucciones del negocio (N3)** | **2.947** | **921** | **conversación + anotación** | No (depende del negocio, pero estable) |
| Reglas de escalado (N3) | 385 | 120 | conversación | Sí |
| Saludo sugerido (N3) | 97 | 30 | conversación | Sí |
| Conocimiento del negocio (KB) | 22 | 7 | conversación | Sí |
| **Catálogo (12 productos)** | **1.150** | **359** | conversación | No |
| **Zonas (11 comunas)** | **347** | **108** | conversación | No |
| Etapas + etapa actual | 158 | 49 | conversación + anotación | No |
| Ficha del cliente (realista) | 326 | 102 | conversación | No |
| **Bloque fijo de reglas de código** | **3.786** | **1.183** | **conversación** | Sí, pero mal ubicado |
| **System prompt de conversación** | **9.617** | **≈3.005** | | |
| **System prompt de anotación** | **4.532** | **≈1.416** | | |

**Dos observaciones que caen de la tabla:**

- **Las instrucciones del negocio se mandan dos veces por turno** (921 tokens
  cada vez). Es el bloque dinámico más grande de la configuración y no aporta
  nada a la extracción que el `CONTRATO_ANOTACION` no pida ya.
- **El bloque fijo de reglas (1.183 tokens) sigue ubicado al final**, después del
  catálogo, las zonas, las etapas y la ficha. Cualquier cambio en la etapa o en
  la ficha invalida el prefijo cacheable anterior.

### 3.3 Costo por turno: antes y después

| | Llamadas/turno | Tokens de prompt por turno |
|---|---:|---:|
| **Antes (medido en `main`)** | 1 | **3.130** (promedio real de 128 llamadas) |
| **Ahora (estimado con el prompt medido)** | 2 | **≈4.700** |
| Diferencia | +1 llamada | **≈+50 %** |

El número de "ahora" se estima así: la llamada de conversación mantiene su
tamaño (3.005 tokens de sistema + historial) y se le suma la de anotación (1.416
tokens de sistema + **el mismo historial**). En una conversación larga, donde el
historial llega a los 20 mensajes (≈345 tokens medidos en el caso más grande de
la base), el turno se va a ≈5.100 tokens.

**El costo subió a cambio de un beneficio que nadie midió todavía.** La bitácora
lo dice con todas las letras: "no se midió el impacto real de la separación con
una corrida completa del Laboratorio". La separación es correcta desde el
diseño; lo que falta es que alguien pague la medición.

### 3.4 Caché de prefijo: dos tercios de las llamadas no la usan

Distribución de `cachedTokens` sobre las 128 llamadas de la corrida:

| Tokens cacheados | Llamadas | Proporción |
|---|---:|---:|
| **0** | **82** | **64 %** |
| ~2.950–2.980 | 46 | 36 % |

Cuando la caché acierta, cubre **≈94 % del prompt** (2.950 de 3.130 tokens). Es
decir: el mecanismo funciona y el material es cacheable; lo que falla es la
consistencia. El orden actual (dinámico antes de estático) explica por qué el
prefijo se rompe en cuanto cambia la etapa o la ficha, y es exactamente el
defecto que la Fase E debía corregir y que quedó sin ejecutar.

> **Advertencia de interpretación**: la caché medida es implícita del proveedor
> (no hay `cache_control` explícito) y no se controla desde el código. La
> afirmación sólida es la distribución observada; la causa raíz del 64 % es
> hipótesis razonable, no hecho verificado.
>
> **Y cambia con la Fase C**: ahora hay **dos prefijos distintos** por
> conversación (conversación y anotación), lo que agrega una fuente de fallo de
> caché que la corrida de referencia no podía exhibir.

### 3.5 Latencia

| Métrica (corrida de referencia, 1 llamada/turno) | Valor |
|---|---:|
| Latencia promedio por llamada | **1.328 ms** |
| Latencia máxima observada | 3.813 ms |
| Duración de la corrida (39 casos, 11 min 19 s) | 679 s |

Con la separación, ese promedio se paga **dos veces por turno, en serie**. El
cliente percibe el turno como `conversación + anotación` (≈2,6 s de modelo en el
caso promedio) aunque solo la primera llamada influya en lo que lee. Con la
anotación en paralelo o después de la entrega, el turno volvería a ≈1,3 s sin
cambiar el resultado conversacional.

---

## 4. Precisión con la conversación

### 4.1 El historial que recibe el modelo

| Regla | Valor | Problema de precisión |
|---|---|---|
| Ventana | últimos 20 mensajes con texto | Un guion de 5 turnos cabe; una conversación real de 25 turnos pierde el inicio sin resumen |
| Mapeo de roles | `direction === "in"` → `user`; **cualquier otro** → `assistant` | **Los mensajes escritos por humanos del equipo se le presentan al modelo como si fueran suyos** (`pipeline.ts:260-265`) |
| Compresión | ninguna | — |
| Fecha y hora | no se inyectan | El agente no puede responder "¿cuándo?" ni razonar sobre plazos de 48 horas contra una fecha real |
| Estado del handoff | no se inyecta | El modelo no sabe si ya escaló antes |

El segundo punto es el de mayor impacto sobre la fidelidad: en cuanto un humano
del equipo contesta y la IA se reactiva, el modelo lee las respuestas del humano
como propias y las da por dichas. Es un defecto que ningún cambio de anoche tocó.

### 4.2 Contabilidad separada: el contrato ya es disjunto

`ConversationReply` (`reply`, `handoff`) y `LeadExtraction` (`stage`, `note`,
campos) están validados por separado con Zod (`actions.ts`). Ya no existe una
salida que obligue al modelo a conversar y clasificar en el mismo objeto.

**Lo que queda del defecto original**: `callProvider` sigue mandando
`response_format: { type: "json_object" }` (`lib/ai/index.ts:169`) en **todas**
las llamadas, incluida la de conversación. El modelo sigue redactando texto
dentro de un campo JSON. La separación de contratos bajó el costo de la
contabilidad de "campos del CRM" a "extracción", pero no eliminó el envoltorio.
El comentario en el código justifica el flag para modelos chicos
(`gemini-flash-lite`) y es correcto que así sea; lo que corresponde evaluar es si
la llamada de conversación puede usar texto plano con un parseo tolerante, dado
que `extractJson` ya tolera cerca de todo.

### 4.3 Los guards deterministas deciden antes del modelo

`matchesHandoffIntent` (`handoff.ts:7`) corre **antes** del LLM y, si matchea,
el agente ni siquiera tiene turno: responde `CLOSING_FAREWELL` fijo y escala.

```text
/(hablar|comunicar|contactar)[\s\S]{0,40}?(asesor|humano|persona|alguien)|un asesor|atenci[oó]n humana/i
```

La alternativa `un asesor` matchea **cualquier** mensaje que contenga esa frase,
en cualquier contexto, incluido un cliente que pregunta "¿cuánto cobra un asesor
de eventos?". Cuando eso pasa, el agente entrega un cierre genérico y aborta la
conversación: es una fuente directa de "suena a reglamento, no a conversación".
Es un guardrail valioso (evita falsos negativos de escalado) pero su radio de
acción no está acotado al contexto comercial.

### 4.4 La ficha del cliente: cerrado, pero con un crecimiento sin techo

La ficha vuelve al prompt (correcto). Dos detalles de precisión que la auditoría
deja anotados:

- **`notes` se inyecta completo y crece sin límite**: `appendLeadNote` acumula
  `[IA] …` en cada turno (`pipeline.ts:547-551`) y `renderClientFile` lo vuelca
  entero. Un lead de 30 turnos arrastra las 30 notas a cada llamada, en las dos
  llamadas. Es un costo que crece con la vida del lead y nadie lo acota.
- **La anotación no recibe el catálogo**, así que extrae `productoInteres` y
  `formato` sin la lista de productos a la vista. Reconocer "la de 12" contra el
  catálogo es más confiable que reconocerlo contra la prosa de las instrucciones.

### 4.5 Qué mide el instrumento hoy (y qué no)

Corrida `run_vngfka7jq6qxcy52mcw7`: 39 casos, score 54, 10 verde · 20 amarillo ·
8 rojo · 1 `judge_failed`.

| Hallazgo | Casos | Lectura |
|---|---:|---|
| `tono` | **30** | El registro de call center sigue siendo el problema dominante: aparece en 25 de los 39 casos |
| `fuera_de_kb` | 9 | — |
| `debio_escalar` | 6 | — |
| `afirmacion_sin_evidencia` | 5 | La falla grave: afirmar envíos o estados que el canal no puede verificar |
| `alucinacion` | 4 | — |

**Lo que el instrumento ya hace bien**: atrapa el caso que motivó la auditoría.
`errores_modismos` pasó de verde a amarillo en las 3 repeticiones, con hallazgos
`tono` citando textualmente `¡Hola! Le saluda el equipo comercial de Lamas
Foods.` El punto ciego está cerrado.

**Lo que el instrumento todavía no sostiene** (8 de 13 personas inestables):

| Persona | Repeticiones | Diagnóstico |
|---|---|---|
| `consumidor_final` | verde · **alucinacion** · **fuera_de_kb** | El mismo guion produce tres lecturas distintas |
| `cliente_recurrente` | **judge_failed** · rojo · rojo | Un caso sin veredicto y dos rojos por la misma causa |
| `fuera_de_kb` | **verde con hallazgo `fuera_de_kb`** · rojo · amarillo | Un veredicto `verde` que a la vez reporta el hallazgo que debería bajarlo |
| `pide_boleta_pago` | amarillo · rojo · rojo | Estable en la gravedad, inestable en el tipo |

El tercer caso es el más incómodo: **el juez reporta el hallazgo y aun así da
verde**, lo que indica que la severidad no está derivada de forma determinista
del tipo de hallazgo. Mientras eso siga así, la comparación de scores entre
corridas no es un instrumento válido para aprobar cambios del harness — que es
exactamente la conclusión a la que llegó la Fase G al no ejecutarse.

### 4.6 El registro: el defecto migró del código a los datos

Este es el hallazgo central de la auditoría, y la explicación de los 30 hallazgos
de tono.

W0/W1 limpiaron el **código**. La configuración del negocio, que es **dato**, no
se tocó. Estado actual de `agent_profile`:

| Campo | Estado | Evidencia |
|---|---|---|
| `tone` | **Corregido** | `Tratamiento: usted. Registro: cordial y profesional, español de Chile. Mensajes de 2 o 3 líneas…` (122 caracteres, sin persona verbal) |
| `greeting` | **Sin corregir** | `¡Hola! Le saluda el equipo comercial de Lamas Foods. ¿En qué podemos ayudarle con nuestros panes?` |
| `instructions` (2.947 caracteres) | **Sin corregir** | Contiene formas como `Sos`, `Atendés`, `ofrecé`, `dejá`, `explicá`, `pedí` |
| `escalationRules` | **Sin corregir** | Contiene formas como `escalá`, `ofrezcas`, `dejá` |

Dos consecuencias, y la segunda es la grave:

1. **El saludo configurado es literalmente la fórmula que el juez marca como
   call center.** "Le saluda el equipo comercial" (hablar de sí mismo en tercera
   persona) y "¿En qué podemos ayudarle?" son dos de los tres ejemplos textuales
   que el prompt del juez lista como señal de `tono`, y son los que aparecen
   citados en los hallazgos de `errores_modismos`. **El agente está siendo
   penalizado por obedecer a su propia configuración.**
2. **Las instrucciones y el escalado siguen en voseo, y ahora se envían dos
   veces por turno** (921 tokens cada vez). El modelo imita el registro de sus
   instrucciones: el vehículo que W0/W1 limpiaron en el código sigue intacto en
   la superficie que el modelo lee con más atención.

La Fase 8 detectó esto y paró correctamente: corregirlo toca **datos de
configuración del negocio** (la fila del perfil y, para instancias nuevas, el
seed), no código. Es la tarea pendiente con mejor relación valor/riesgo que
queda, y es una decisión de producto: el dueño debe aprobar el texto de su
propio negocio.

---

## 5. Parámetros del request: dos palancas sin usar

`callProvider` (`lib/ai/index.ts:153-173`) arma el cuerpo con **cuatro** claves:
`model`, `messages`, `response_format` y —solo si la variable está seteada—
`reasoning`.

| Parámetro | Estado hoy | Efecto |
|---|---|---|
| `temperature` | **No se envía** | Se hereda el default del proveedor (`gemini-2.5-flash-lite` opera en 1.0). Para un agente de ventas que debe sostener un registro y repetir precios exactos, es el valor más ruidoso posible |
| `reasoning.effort` | **Desactivado** (`OPENROUTER_REASONING_EFFORT` vacío) | Menos capacidad de sostener matices y de resistir un prompt de 3.000 tokens |
| `timeoutMs` | 60.000 ms | — |
| `model` | El mismo para conversación, anotación y corrección | La anotación es extracción: es el lugar natural para el modelo más barato |

La ausencia de `temperature` es la palanca más barata de todas: una línea, y
ataca de frente la varianza que el propio Laboratorio mide (8 de 13 personas
inestables). No reemplaza la estabilización del juez, pero reduce una de las dos
fuentes de ruido.

---

## 6. Margen de mejora, priorizado

| # | Cambio | Impacto | Esfuerzo | Riesgo |
|---|---|---|---|---|
| **P0** | **Corregir el registro de la configuración del negocio**: `greeting` sin tercera persona ni "¿en qué podemos ayudarle?", e `instructions`/`escalationRules` a español neutro sin voseo. Actualizar también el seed para instancias nuevas | **Alto**: ataca la causa directa de los 30 hallazgos de tono en 25 de 39 casos | Bajo (texto) | **Es decisión de producto**: requiere aprobación del dueño |
| **P1** | **Sacar la anotación del camino crítico**: dispararla en paralelo con la conversación (misma entrada) o después de la entrega | **Alto**: ≈−1,3 s de latencia percibida por turno | Bajo | Bajo; la anotación ya es best-effort |
| **P2** | **Achicar la llamada de anotación**: quitarle las instrucciones completas (2.947 caracteres), acotarle el historial (p. ej. últimos 6 mensajes) y apuntarla a un modelo más barato | **Alto**: −921 tokens por turno hoy duplicados, más el historial | Medio | Bajo; medir extracción de campos antes/después |
| **P3** | **Fijar `temperature`** (p. ej. 0.2–0.4) y evaluar `reasoning.effort` con la corrida 2 de 2 | **Medio-alto**: reduce varianza medible | Muy bajo | Bajo |
| **P4** | **Ejecutar la Fase E** (Fase W4): estático primero, dinámico después; catálogo y zonas solo si el turno los pide | **Medio**: el 64 % de llamadas sin caché más ~470 tokens de catálogo y zonas por turno | Medio | Medio: el recorte del catálogo puede degradar la cotización; el reordenamiento solo, no |
| **P5** | **Corregir el mapeo de roles del historial**: distinguir los mensajes de humanos del equipo de los del bot | **Alto en fidelidad**: hoy el modelo lee respuestas humanas como propias | Medio (requiere origen del mensaje en la query) | Bajo |
| **P6** | **Inyectar fecha y hora**, y acotar `contact.notes` (resumen o últimas N) | Medio: habilita plazos reales y detiene el crecimiento del prompt | Bajo | Bajo |
| **P7** | **Acotar el guard de handoff** por regex: exigir contexto comercial y no escalar por `un asesor` suelto | Medio: elimina abortos de conversación espurios | Bajo | Medio: no perder escalados reales; cubrir con personas del Laboratorio |
| **P8** | **Evaluar la salida de texto plano en la conversación**, dejando JSON solo donde el parseo es indispensable | Medio: quita el "motor de llenar campos" del texto que lee el cliente | Medio | Medio: `extractJson` es tolerante, pero hay que medir la tasa de fallo |
| **P9** | **Ejecutar la Fase G** (recorte a 4-8 principios + 4-6 límites) | Alto a largo plazo | Alto | **Bloqueado por instrumento**: primero hay que bajar la inestabilidad del juez |
| **P10** | **Estabilizar el juez**: derivar la severidad del tipo de hallazgo de forma determinista y revisar el caso `cliente_recurrente` en `judge_failed` | Alto: es el desbloqueo de P9 y de toda comparación entre corridas | Medio | Bajo |
| **P11** | **Forzar en código el formato del mensaje** (largo, una sola pregunta, listas de precio) en vez de solo pedirlo en el prompt | Medio | Medio | Bajo |

**Orden de lectura sugerida**: P0 y P1 son las de mejor relación valor/riesgo y
no dependen de nada. P2 y P3 son baratas. P10 desbloquea P4 y P9. P5 y P6 son
fidelidad pura.

---

## 7. Límites de esta auditoría

- **La mejora conversacional de la separación (Fase C) no está medida.** El
  ahorro o el empeoramiento en calidad, la tasa de repetición de datos ya
  capturados y el efecto sobre el "suena a formulario" requieren una corrida
  **posterior** a los cambios, que no se hizo. Todo lo que este documento dice
  sobre calidad conversacional es lectura de código, no medición.
- **La corrida de referencia es previa a los cambios B y C.** Mide el instrumento
  y la línea base de costo y latencia, no el harness actual. Los números de costo
  del harness actual son estimaciones sobre el prompt medido, no tokens
  facturados.
- **La causa de la inconsistencia de caché no está probada.** Se observa la
  distribución; el vínculo con el orden del prompt es hipótesis.
- **No se disparó ninguna corrida del Laboratorio.** Queda 1 de 2 autorizadas.
  Es el presupuesto natural para validar P0+P3 juntos.
- **El juez sigue siendo el techo de la medición**: mientras sea inestable en 8 de
  13 personas, ninguna mejora de score es atribuible.

---

## Anexo — Números crudos y reproducción

### Prompt medido (2026-09-17, configuración real de la organización de desarrollo)

```text
conversación sin ficha     9.617 chars
conversación con ficha     9.943 chars
anotación                  4.532 chars
bloque fijo de reglas      3.786 chars
instrucciones del negocio  2.947 chars
catálogo (12 productos)    1.150 chars
zonas (11 comunas)           347 chars
ficha (caso realista)        326 chars
KB                             22 chars (0 entradas)
```

### Costo y latencia (`run_vngfka7jq6qxcy52mcw7`, 128 llamadas)

```text
promptTokens   promedio 3.130   total 400.658
completionTok  promedio    66
cachedTokens   promedio 1.066   (82 de 128 llamadas en 0)
latencia       promedio 1.328 ms   máxima 3.813 ms
turnos/caso    máximo 5
duración       679 s para 39 casos
```

### Reproducir la medición del prompt

```bash
pnpm exec esbuild <script> --bundle --platform=node --format=esm \
  --outfile=.tmp-audit.mjs --alias:@=./src --packages=external
node --env-file=.env .tmp-audit.mjs
```

El script llama a `buildAgentSystemPrompt` y `buildAnnotationSystemPrompt` con
el perfil, las etapas, el catálogo y las zonas de la organización, y solo lee la
base. Advertencia: el `.env` local apunta al Postgres de desarrollo; verificar el
destino antes de correrlo.

### Consultar los `turn_metrics` de una corrida

```sql
SELECT count(*) AS llamadas,
       round(avg((t->>'promptTokens')::numeric)) AS avg_prompt,
       round(avg((t->>'latencyMs')::numeric)) AS avg_latencia
FROM agent_test_case c, jsonb_array_elements(c.turn_metrics) AS t
WHERE c.run_id = '<run_id>';
```
