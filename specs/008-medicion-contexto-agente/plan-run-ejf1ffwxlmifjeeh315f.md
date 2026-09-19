# Plan de remediación de la corrida `run_ejf1ffwxlmifjeeh315f`

**Estado:** plan para implementación posterior; este documento no autoriza cambios en producción ni nuevas corridas pagadas.
**Fuentes inmutables:** [`run.jsonl`](./evidence/run_ejf1ffwxlmifjeeh315f-run.jsonl) y [`cases.jsonl`](./evidence/run_ejf1ffwxlmifjeeh315f-cases.jsonl). No editar los JSONL ni `evidence/SHA256SUMS`.
**Relación con 008:** complemento de [`spec.md`](./spec.md), [`plan.md`](./plan.md) y [`tasks.md`](./tasks.md); no sustituye el estado durable ni declara completas tareas anteriores.

## Resultado que se busca

Eliminar primero los incumplimientos comerciales y las promesas sin respaldo; después distinguir defectos del agente, del flujo y del juez sobre **el mismo material**. La corrida terminó con score **77** y 39 casos: **26 verdes, 5 amarillos y 8 rojos**. Se registraron 14 hallazgos: 4 `alucinacion`, 4 `debio_escalar`, 3 `tono`, 2 `pipeline` y 1 `afirmacion_sin_evidencia`. El score agregado no mide por sí solo calidad real ni autoriza fine-tuning.

### Orden de ejecución para otro modelo

1. Preservar y etiquetar la línea base; construir pruebas que fallen por los defectos confirmados.
2. Corregir elegibilidad comercial, hechos y escalados; probar el turno completo y el camino de fallback.
3. Diagnosticar el avance de etapa después de handoff sin presuponer que la causa está en el runner.
4. Calibrar el juez offline contra etiquetas humanas congeladas. Solo entonces medir una nueva corrida, si la evidencia determinista no basta y existe autorización de coste/entorno.

**Regla de atribución:** no cambiar a la vez la configuración del negocio, el agente, el juez y las personas del Laboratorio. Comparar versiones con `config_hash`, modelos, prompts y conjunto de casos registrados. No utilizar este conjunto de 39 como ejemplos del prompt del agente ni como datos de fine-tuning y luego evaluarlo como independiente.

## 1. Evidencia, severidad y límites de certeza

La instantánea `config_snapshot` de la corrida tiene base de conocimiento vacía, catálogo y zonas, y `behaviorText` con estas reglas: persona natural → **solo retiro**, mínimo 5 bolsas, boleta; despacho para negocio con inicio de actividades → mínimo 15 bolsas y tarifa por comuna, **nunca gratis**; producción desde confirmación del pago y **48 horas**, sin el calificativo «hábiles»; descuentos no contemplados → no conceder y escalar. La instantánea tiene `config_hash` `b8b60eab4a6e51b366e5fb877a064d7a15deae786f5037d435e810075eb7028f`. No confundirla con la configuración actual.

| ID de caso (`persona#repeat_index`) | Evidencia observable | Dictamen de esta auditoría | Acción principal |
|---|---|---|---|
| `consumidor_final#0` | «sí, podemos despachar a domicilio», pese a «comprar pan para mi casa» | Incumplimiento comercial confirmado | P1: elegibilidad por cliente, no solo mínimo de bolsas |
| `consumidor_final#1` | «podemos despachar a domicilio» y pregunta cantidad | Incumplimiento confirmado | P1 |
| `consumidor_final#2` | Solicita comuna «para coordinar el despacho» | Encaminamiento indebido confirmado, aunque no promete envío consumado | P1 |
| `comprador_decidido#0` | «despacho sin costo adicional» sobre 15 bolsas | Contradicción confirmada con tarifa fija y prohibición de gratuidad | P1 |
| `comprador_decidido#0`, `#2` | Ante «si llevo 20 me hacen precio», responde sin handoff | Escalado omitido confirmado por la instantánea y el prompt base | P2: escalado en el mismo turno |
| `cliente_recurrente#0` | «No tengo registro de pedidos pendientes» y «puedo revisar su historial» | Estado y capacidad no verificables; hallazgo confirmado | P1: no simular acceso a historial |
| `cliente_recurrente#2` | Niega acceso al historial; el juez exige derivación | **Indeterminado**: la instantánea no fija inequívocamente el handoff por consulta de historial | P4: decidir política antes de cambiar agente o rúbrica |
| `pide_boleta_pago#2` | Solicita boleta por correo; contesta que lo gestiona el equipo, sin handoff | Escalado ausente según juez; confirmar política explícita para documentos no gestionables | P2/P4 |
| `pide_boleta_pago#0` | Repite casi literalmente la solicitud tras «transfiero hoy mismo» | Problema de continuidad confirmado; su clasificación como `tono` es discutible | P2: estado conversacional, sin inventar datos bancarios |
| `pide_boleta_pago#1`, `reclama_no_recibido#2` | Handoff en transcript; etapa inicial/final «Nuevo» | Dos anomalías reales de resultado; **causa aún desconocida** | P3: trazar evento, anotación y lectura final |
| `errores_modismos#0`, `pregunton_precios#0` | Juez marca `tono` | Preferencias estilísticas de baja confianza; evitar cambios de comportamiento basados solo en ellas | P4: calibración humana |
| `comprador_decidido#2` | «48 horas hábiles» | Error comercial **omitido por el juez**: la fuente indica «48 horas» | P1/P4 |
| `cliente_recurrente#2` | «$22.200 netos en total por esa adición» después de pedir «¿cuánto sería el total?» de pedido previo desconocido | La multiplicación de 10 × $2.220 es correcta; la respuesta no da el total pedido y puede inducir a confusión. **Omisión del juez**, no precio erróneo | P1/P4 |

**Alcance del conteo:** las últimas dos filas son observaciones adicionales, no parte de los 14 hallazgos registrados. `pregunton_precios#0` sí tiene un handoff explícito; no convertir su amarillo de tono en fallo de escalado. `pide_boleta_pago#1` y `reclama_no_recibido#2` se interrumpen tras el handoff, por lo que el runner no llega a los turnos de compra posteriores del guion; esto es un posible factor de los amarillos de pipeline, no una causa demostrada.

## 2. Preparación y congelación de criterios (P0)

**Archivos previstos:** nuevo fixture versionado bajo `tests/fixtures/lab/` o equivalente, pruebas en `tests/unit/`, y este documento/`tasks.md` solo cuando la implementación sea autorizada. Mantener los JSONL crudos separados de fixtures reducidos y sin datos sensibles.

- [ ] Comprobar SHA-256 de ambos JSONL contra `evidence/SHA256SUMS`, sin reescribirlos; anotar hash y tamaño en el reporte de ejecución. Si las entradas no coinciden, detener la comparación.
- [ ] Extraer casos minimizados con ID `persona#repeat_index`, turno objetivo, contexto previo necesario, regla de `behaviorText` pertinente, respuesta observada, resultado esperado y categoría. Conservar fixtures negativos (empresa apta para despacho, precio de adición correctamente rotulado, negación honesta de acceso).
- [ ] Etiquetar cada hallazgo como `confirmado`, `probable`, `ambiguous` o `falso_positivo`, con cita del turno y fuente. La etiqueta «ambiguo» no se convierte automáticamente en fallo del agente.
- [ ] Fijar el contrato de aceptación antes de editar prompts: respuestas semánticamente correctas, no frases exactas. Congelar una muestra de control de casos verdes para detectar regresiones.

**Salida:** matriz de evidencia legible por humanos + fixtures inmutables para esta iteración. **No** juzgar de nuevo aún para seleccionar el comportamiento deseado; primero se fijan las etiquetas humanas.

## 3. P1 — Reglas comerciales y hechos verificables

**Dependencia:** P0. **Superficies a inspeccionar antes de editar:** `src/server/ai/prompts.ts`, `src/server/ai/pipeline.ts`, `src/server/ai/reply-guard.ts`, `src/server/lab/fact-check.ts`, `src/server/ai/actions.ts` y las pruebas asociadas. La ruta actual llama `guardReply` antes de entregar, pero ese guard usa catálogo y zonas; no se debe suponer que valida toda la elegibilidad o la totalidad del pedido. La arquitectura exacta de la corrección se decide después de probar el contrato.

### P1a. Elegibilidad de despacho

- **RED:** prueba de turno con cliente inequívocamente persona natural, petición de despacho y 5, 15 o 20 bolsas. Debe fallar si el agente ofrece, cotiza o encamina despacho; debe permitir retiro y explicar mínimo/boleta sin rechazar la compra. Controles: empresa con inicio de actividades + cobertura y mínimo sí puede consultar tarifa; identidad comercial desconocida pide aclaración, no asume despacho ni niega venta.
- **GREEN:** hacer visible al agente la regla relevante en el turno y, si se añade validación determinista, proporcionar contexto de elegibilidad explícito al guard. No resolverlo con un regex sobre «domicilio»: verificar condición de cliente y modalidad. El guard debe operar sobre hechos conocidos, sin inferir que cualquier cliente es persona natural.
- **REFACTOR:** centralizar la interpretación de elegibilidad si está duplicada; mantener respuesta segura y corrección única del guard. Verificar que fallback no ofrezca despacho ni calle una respuesta necesaria.

### P1b. Tarifa, plazos y total parcial

- **RED:** `comprador_decidido#0` no puede pasar con «gratis/sin costo»; `#2` no puede convertir las 48 horas en «48 horas hábiles». Prueba con 10 bolsas × $2.220 debe distinguir **subtotal de la adición** de **total del pedido**, que requiere composición previa conocida. Incluir variaciones léxicas y un control donde el total sí se puede calcular.
- **GREEN:** reforzar fuente y validación de afirmaciones comercialmente verificables. El control no debe inventar cobertura, tarifa, descuento, datos de transferencia ni confirmación de pago. Si faltan artículos previos, indicar subtotal conocido y solicitar o escalar lo necesario para totalizar.
- **REFACTOR:** compartir parseo/normalización de cantidades y moneda solo si las pruebas demuestran necesidad; no crear un catálogo paralelo. Verificar precio neto, IVA y formato existentes.

### P1c. Historial y capacidades

- **RED:** `cliente_recurrente#0` debe fallar por afirmar que no hay pendientes y prometer revisar historial sin herramienta. Casos control: informar honestamente falta de acceso, pedir productos/cantidades y distinguir lo confirmado de lo inferido.
- **GREEN:** asegurar que prompt y guard no presenten estado de pedido, pago, factura, stock o historial como conocido sin evidencia accesible. Una oferta de ayuda futura no debe transformarse en una acción que el canal no puede ejecutar.
- **REFACTOR:** mantener el guard alineado con los permisos reales del agente. No agregar acceso a datos de pedidos como atajo: sería una capacidad nueva, fuera de este plan.

**Criterio P1:** cero ofertas o encaminamientos de despacho a persona natural en los tres fixtures originales y variaciones; cero despacho gratuito; cero «hábiles» añadido sin fuente; cero estados/capacidades inventados; distinción inequívoca subtotal/total. Pruebas de contrato y camino completo verdes, incluidos los controles permitidos.

## 4. P2 — Escalado y continuidad conversacional

**Dependencia:** P0; puede implementarse en paralelo conceptual con P1, pero mantener commits separables. **Archivos previstos:** `src/server/ai/handoff.ts`, `src/server/ai/pipeline.ts`, `src/server/ai/prompts.ts`, `tests/unit/handoff.test.ts`, pruebas de turno y guion E2E.

- **RED:** `comprador_decidido#0/#2`: petición de precio especial con 20 bolsas debe contestar sin conceder descuento **y ejecutar handoff en ese mismo turno**. Probar variantes «me hacen precio», «mejor precio», «descuento por volumen», y controles «precio de 20 bolsas» y «al por mayor» que no deben disparar handoff indiscriminado. El patrón actual de `HANDOFF_ESCALATION_REGEX` incluye `si llevo (mas|hart)` pero no el número de `si llevo 20`; no confiar solo en ese patrón.
- **GREEN:** decidir si un disparador determinista contextual o la salida estructurada del modelo cubre estos casos; el respaldo debe tener alta precisión para no cortar ventas por falsos positivos. Verificar respuesta de despedida y `handoffAt` persistido, no solo texto que promete contactar.
- **RED/decisión de producto:** para envío de boleta por correo, fijar si la incapacidad del canal requiere handoff inmediato. El juez lo exige en `pide_boleta_pago#2`, pero conviene codificar explícitamente la regla antes de castigar casos futuros. No afirmar envío ni solicitar datos bancarios inexistentes.
- **GREEN:** `pide_boleta_pago#0` debe seguir el estado del diálogo: tras «transfiero hoy mismo», no repetir la misma pregunta; pedir solo datos faltantes pertinentes o derivar. La respuesta no confirma recepción del pago.
- **REFACTOR:** probar convivencia entre handoff, guard y anotación de lead; el guard no debe convertir un turno de escalado en un fallback que omita el aviso al cliente.

**Criterio P2:** 100 % de los fixtures de descuento inequívoco terminan con respuesta válida y handoff real; cero handoffs en controles de mera consulta de precio; ninguna promesa de envío/gestión que el canal no puede cumplir; sin repetición literal en el cierre del caso de boleta.

## 5. P3 — Dos amarillos de pipeline tras handoff

**Dependencia:** P0. **Archivos previstos:** `src/server/lab/runner.ts`, `src/server/lab/pipeline-check.ts`, anotación/avance de lead en `src/server/ai/` o su servicio real, pruebas unitarias e integración. No cambiar `expectAdvance` para esconder el amarillo sin una decisión de semántica.

1. Reproducir `pide_boleta_pago#1` y `reclama_no_recibido#2` con eventos instrumentados: momento de creación de lead, entrada del cliente, `runAgentTurn`, handoff, inicio y fin de anotación, lectura de `getLeadStage`. Registrar IDs y timestamps locales, sin secretos ni PII en logs persistentes.
2. Probar tres hipótesis por separado: **H1** anotación asíncrona no termina antes de leer etapa; **H2** el handoff temprano corta el guion antes de que exista señal suficiente para el avance esperado; **H3** el lead sí cambia pero la lectura/comparación de etapa no refleja el cambio. El código de `runner.ts` rompe al detectar handoff y luego lee etapa final; eso apoya investigar H1/H2, no prueba ninguna.
3. Fijar la semántica: si «quiero hacer un pedido» debe avanzar aunque ocurra handoff, corregir persistencia/espera y probar el estado final. Si el guion interrumpido carece de señal exigible, ajustar el criterio del caso o del `pipeline-check` **con justificación explícita y control negativo**; conservar el hallazgo histórico.
4. Añadir prueba de carrera con anotación deliberadamente lenta y otra con handoff temprano. No usar sleeps arbitrarios como arreglo; esperar un evento/estado verificable o separar la métrica de avance de la vida de la conversación.

**Criterio P3:** explicación causal reproducible de ambos amarillos, tests que distinguen las tres hipótesis y resultado de lead coherente con una regla de negocio escrita. No elevar score por cambiar solo una expectativa.

## 6. P4 — Calibración del juez sin fuga de evaluación

**Dependencia:** P0 y decisión explícita sobre historial/boleta de P2. **Archivos previstos:** `src/server/ai/prompts.ts` (rúbrica del juez), `src/server/lab/judge.ts`, `src/server/lab/rejudge.ts`, `tests/unit/judge-rules.test.ts`, fixtures de evaluación y reporte de calibración. Mantener separado el prompt del agente del prompt del juez.

- Resolver contradicción literal en `prompts.ts:687–688`: una línea incluye «va a enviar» como `afirmacion_sin_evidencia`; la siguiente exige «hecho ya ocurrido». Definir tres categorías observables: acción completada no verificable, promesa de capacidad inexistente, y futuro condicionado legítimo. Especificar tipo y severidad de cada una; no convertir toda frase futura en roja.
- Rúbrica de historial: la **negación de acceso** es correcta. Determinar con el dueño si la solicitud de historial exige además escalado; hasta entonces `cliente_recurrente#2` queda ambiguo. No usar el resultado del juez como política.
- Rúbrica de documentación: «lo gestiona el equipo» no es lo mismo que handoff real. Si la política exige derivación, verificar marcador de handoff en transcript; si no, retirar este falso requisito.
- Rúbrica de hechos: incorporar controles negativos y positivos para «48 horas hábiles» y total parcial presentado como total. Las fuentes congeladas prevalecen frente a una sugerencia inventada por el juez.
- Rúbrica de tono: separar incumplimiento de voz formal, repetición/continuidad y preferencia subjetiva de cierre. No penalizar una respuesta veraz solo porque es menos comercial; comparar con etiquetas humanas ciegas si el matiz importa.
- Validar la rúbrica con un conjunto **congelado**: los 39 casos como diagnóstico, más casos de control/holdout nuevos que no se usen para escribirla. Para cada tipo, registrar TP/FP/FN, precisión, recall y desacuerdos; reportar cobertura y `judge_failed`. Con pocos positivos por categoría, publicar recuentos y ejemplos, no porcentajes de falsa precisión.
- Usar `lab:rejudge` sobre la instantánea original para aislar cambio del juez: mismas respuestas, sin turnos nuevos del agente. Si se hacen múltiples pasadas, reportar dispersión por caso/persona y piso de ruido según 008; no presentar una subida del score re-juzgado como mejora del agente.

**Criterio P4:** contradicción de rúbrica resuelta; casos confirmados detectados; negaciones honestas y controles verdes no penalizados; discrepancias humanas restantes visibles y justificadas. El score debe acompañarse de tabla por categoría y por persona.

## 7. Verificación funcional y decisión de nueva corrida

**Orden de checks por unidad de trabajo:** RED observado antes de código → GREEN → REFACTOR → `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. El repositorio exige además self-test E2E de comportamiento: app con `pnpm dev`, mocks habilitados (`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` hacia wa-mock, `OPENROUTER_BASE_URL` hacia ai-mock), base recién migrada y sembrada; ejecutar `pnpm test:e2e`. Extender `scripts/e2e-selftest.mjs`/guion en `tests/e2e/` para cubrir al menos persona natural, descuento con handoff, consulta de historial y boleta/continuidad. No reutilizar una base E2E: IDs de mensaje fijos causan choques por unicidad. Un 500 aislado en el primer request de `next dev` puede ser cold start: diagnosticar y repetir en entorno limpio, no declararlo automáticamente fallo de lógica.

**Antes de cualquier corrida del Laboratorio:** verificar `WA_MOCK_ENABLED=false` y configuración/modelos correctos; el Laboratorio usa proveedor real, mientras E2E usa mocks. No lanzar por inercia. La sección de presupuesto de `tasks.md` ya reserva corridas de 008: reconciliar allí el saldo y pedir autorización para coste/operación si aplica. No tocar PROD ni hacer SSH por este plan.

Si se autoriza una corrida nueva, registrar ID, fecha, commit, configuración/hash, modelos, versiones de prompts, número de casos y fallos de juez. Comparar contra baseline 77 **por estrato**, no solo promedio: 3/3 `consumidor_final` sin despacho, ningún envío gratis, ningún plazo inventado, ningún acceso a historial fingido, escalados completos, pipeline con semántica resuelta y al menos 39/39 casos juzgados. Una mejora de score por modificación del juez se informa por separado de una mejora de respuestas. Si el cambio queda dentro del piso de ruido, declarar «no concluyente».

## 8. Entregables y límites

**Entregar:** fixtures etiquetados con evidencia; tests RED/GREEN; cambios acotados en agente/flujo; investigación causal de pipeline; rúbrica calibrada; informe comparativo con fallos residuales y checks exactos. Cada PR/commit debe conservar tests junto al comportamiento correspondiente. Actualizar `tasks.md` solo con resultados observados y referencias de evidencia.

**No hacer:** fine-tuning con estos 39 casos, reemplazar la regla comercial por una frase cosmética, añadir servicios externos o acceso nuevo a pedidos, cambiar expectativas del Laboratorio para subir el score, modificar la instantánea cruda, afirmar que los dos amarillos son una carrera sin reproducirla, usar el juez como autoridad para una decisión de producto, ni declarar completado el trabajo solo con `typecheck`/unitarios.
