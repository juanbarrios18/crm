# Feature Specification: Medición confiable y contexto del agente (008)

**Feature Branch**: `008-medicion-contexto-agente`

**Created**: 2026-09-18

**Status**: Draft

**Input**: Auditorías `docs/auditoria-corrida-prod-ttb.md` y
`docs/auditoria-corrida-prod-ttb-depurada.md`, y el análisis
`docs/auditoria-contexto-agente.md`.

## Contexto

La corrida de PROD `run_ttbdykydfvz7sfb309tk` dejó un diagnóstico sólido, pero
todavía no medible: 4 de 39 casos quedaron sin veredicto por agotamiento de tiempo
del juez, hay falsos positivos sistemáticos que explican 2 de los 12 rojos, y el
ruido del instrumento no está acotado. Cualquier cambio en el prompt del agente
se mide hoy contra ruido.

El análisis de contexto agregó un segundo problema, independiente del contenido:
la evaluación **no se puede re-mediar**. Cada corrección del instrumento exige
volver a ejecutar al agente, y la evaluación no registra con qué configuración
del negocio se juzgó. Después de cambiar la configuración, la corrida anterior
deja de ser reconstruible y su verificación se vuelve no falsable.

Esta feature ataca las dos cosas: primero vuelve el instrumento comparable y
repetible, después corrige lo que entra al contexto del agente (configuración,
memoria del contacto y hechos objetivos). El agente se toca último.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Re-medición offline de una corrida (Priority: P1)

Como responsable de calidad, quiero volver a juzgar conversaciones ya guardadas
sin ejecutar al agente, para medir un cambio del instrumento sin gastar una
corrida completa ni arrastrar la varianza del agente.

**Why this priority**: es el keystone. Sin esto, cada arreglo del juez cuesta una
corrida completa y confunde la varianza del agente con la del instrumento, que es
exactamente el error que la auditoría denuncia.

**Independent Test**: tomar una corrida existente, re-juzgarla y confirmar que no
se ejecutó ningún turno nuevo del agente y que el informe compara ambos
resultados sobre el mismo material.

**Acceptance Scenarios**:

1. **Given** una corrida con 39 casos guardados, **When** se dispara la
   re-evaluación, **Then** los 39 casos se vuelven a juzgar y el contador de
   turnos ejecutados del agente queda en 0.
2. **Given** una re-evaluación terminada, **When** se consulta el informe,
   **Then** muestra el resultado de la corrida origen y el de la re-evaluación
   lado a lado, con los casos sin veredicto visibles.
3. **Given** una corrida después de un cambio de configuración del negocio,
   **When** se re-juzga, **Then** usa las fuentes con las que se juzgó
   originalmente, no la configuración vigente.

---

### User Story 2 - El instrumento no descarta casos ni esconde su ruido (Priority: P1)

Como responsable de calidad, quiero que una corrida completa no pierda casos por
tiempo y que la dispersión del juez sea un número visible, para saber qué
diferencia de resultado es señal y qué diferencia es ruido.

**Why this priority**: sin piso de ruido, un score que sube de 42 a 48 no es un
resultado. La auditoría ya tiene la función de dispersión, pero no un comando que
la alimente con juicios repetidos del mismo material.

**Independent Test**: con la temperatura del juez fijada, juzgar N veces el mismo
conjunto de transcripts y publicar la dispersión; correr una corrida completa y
confirmar cero casos sin veredicto.

**Acceptance Scenarios**:

1. **Given** el mismo conjunto de transcripts, **When** se juzga N veces con la
   temperatura fijada, **Then** el informe publica la dispersión por persona y el
   piso de ruido agregado.
2. **Given** una corrida completa del Laboratorio, **When** termina, **Then** el
   número de casos sin veredicto por agotamiento de tiempo es 0 y la tasa de
   fallo del juez aparece en el informe, no solo excluida de la mediana.
3. **Given** un cambio que mejora el score por debajo del piso de ruido,
   **When** se reporta, **Then** el informe lo marca como indistinguible de ruido.

---

### User Story 3 - El juez evalúa contra la configuración real (Priority: P1)

Como dueño del negocio, quiero que el juez juzgue al agente contra la
configuración que yo definí y contra todas las fuentes de verdad, para que no
castigue mi propia voz ni invente hallazgos donde no los hay.

**Why this priority**: 20 de 25 hallazgos de tono y al menos 4 falsos positivos
sistemáticos vienen de reglas de código aplicadas a contenido configurado. Es la
mayor fuente de rojos que no son defectos del producto.

**Independent Test**: re-juzgar los transcripts de la corrida base con las reglas
corregidas y confirmar que los cuatro falsos positivos conocidos no se reproducen.

**Acceptance Scenarios**:

1. **Given** un agente que reproduce literalmente el saludo configurado por el
   dueño, **When** el juez lo evalúa, **Then** no emite hallazgo de tono.
2. **Given** una respuesta respaldada por el comportamiento configurado o el
   catálogo, **When** el juez la evalúa, **Then** no emite `fuera_de_kb`.
3. **Given** un rechazo explícito de cobertura, **When** el juez lo evalúa,
   **Then** no emite `alucinacion`.
4. **Given** un transcript con la línea de handoff, **When** el juez lo evalúa,
   **Then** no emite `debio_escalar`.
5. **Given** una afirmación de capacidad ("podemos emitir boleta"), **When** el
   juez la evalúa, **Then** no la trata como acción ya realizada.

---

### User Story 4 - La configuración del negocio deja de ser fuente de ruido (Priority: P2)

Como dueño del negocio, quiero que mi configuración sea consistente y que las
etapas tengan criterio de entrada, para que el agente no reciba contradicciones ni
la anotación reinyecte texto que no corresponde.

**Why this priority**: es la raíz común de buena parte de los hallazgos, pero
depende de que la medición esté calibrada para poder verificarse. La voz y los
criterios ya están codificados: lo que falta es aplicarlos a PROD con respaldo
previo.

**Independent Test**: confirmar que ninguna etapa queda sin criterio, que el
conocimiento no contiene mensajes internos, y que la anotación no reinyecta
instrucciones cuando hay criterios configurados.

**Acceptance Scenarios**:

1. **Given** las etapas del pipeline, **When** se inspeccionan, **Then** ninguna
   queda sin criterio de entrada.
2. **Given** el conocimiento del negocio, **When** se inspecciona, **Then** no
   contiene mensajes de asistente dirigidos al equipo interno.
3. **Given** etapas con criterio, **When** se arma la anotación, **Then** las
   instrucciones del negocio no vuelven a viajar en esa llamada.
4. **Given** la voz configurada, **When** se compara con el registro del agente,
   **Then** son consistentes (tratamiento y dialecto).

---

### User Story 5 - El contexto reinyectado solo contiene datos verificables (Priority: P2)

Como dueño del negocio, quiero que la ficha del contacto que se reinyecta al
agente en cada turno no contenga datos que el modelo dedujo sin respaldo del
cliente, para que el agente no razone sobre información falsa.

**Why this priority**: cierra el bucle de memoria contaminada que la auditoría
depurada confirmó en campos estructurados, y evita que el arnés contamine el
contexto que dice medir.

**Independent Test**: reproducir una conversación del Laboratorio y confirmar que
el fixture no aparece en el transcript ni en la ficha, y que los campos sin
respaldo no se promueven.

**Acceptance Scenarios**:

1. **Given** una conversación donde el cliente no declara su empresa, **When**
   termina el turno, **Then** el campo de empresa no se completa con texto del
   fixture ni con una inferencia sin respaldo.
2. **Given** un campo comercial promovido desde la extracción, **When** se
   inspecciona, **Then** es trazable a lo que el cliente dijo.
3. **Given** cualquier transcript del Laboratorio, **When** se busca el texto del
   fixture, **Then** no hay ocurrencias.

---

### User Story 6 - Los hechos objetivos los verifica el código (Priority: P3)

Como responsable de calidad, quiero que las afirmaciones verificables por
comparación (unidades por bolsa, verbos de acción que el canal no puede ejecutar)
las detecte código determinista, para que el juez gaste su juicio en lo subjetivo.

**Why this priority**: es la frontera correcta entre verificación determinista y
juez, y hoy está invertida. Depende de que el instrumento ya sea confiable para no
mezclar el efecto con ruido.

**Independent Test**: enviar una cotización con unidades de bolsa equivocadas y
una afirmación de acción imposible, y confirmar que las detecta la verificación
determinista.

**Acceptance Scenarios**:

1. **Given** una cotización que atribuye a un producto una cantidad de unidades
   por bolsa distinta de la del catálogo, **When** pasa el guard, **Then** se
   detecta sin intervención del juez.
2. **Given** una respuesta que afirma haber procesado, agregado, revisado o
   anotado algo, **When** pasa el guard, **Then** se detecta sin intervención del
   juez.

---

### User Story 7 - Escalada, cierre y repetición deterministas (Priority: P3)

Como cliente, quiero que cuando pido un humano o hago un reclamo la conversación
escale siempre igual y me lo comunique, y que el agente no repita la misma
respuesta a preguntas distintas.

**Why this priority**: son defectos reales de comportamiento, pero de menor
frecuencia y posteriores a la corrección del instrumento y de la configuración.

**Independent Test**: reproducir los casos de queja, descuento, pedido de humano
y respuesta repetida, y confirmar el comportamiento estable en las tres
repeticiones.

**Acceptance Scenarios**:

1. **Given** una queja o un pedido de descuento por volumen, **When** el agente
   responde, **Then** escala de forma determinista en las tres repeticiones.
2. **Given** un handoff con motivo cliente, **When** el agente cierra, **Then** el
   cierre comunica que una persona va a atender el caso.
3. **Given** una pregunta distinta sobre el mismo tema, **When** el agente
   responde, **Then** no repite el texto de un turno anterior.
4. **Given** un saludo ya emitido, **When** el agente responde un turno
   posterior, **Then** no vuelve a saludar, incluidas las variantes cortas.

---

### Edge Cases

- Corrida origen sin transcripciones guardadas o con transcripciones incompletas:
  la re-evaluación informa el faltante y no aborta el resto.
- Configuración del negocio cambiada entre la corrida y la re-evaluación: se usan
  las fuentes congeladas; si no existen, la re-evaluación falla explícitamente en
  lugar de juzgar contra la configuración vigente.
- Re-evaluación interrumpida a mitad: se puede reanudar sin duplicar juicios.
- Juez que devuelve una respuesta inválida en una pasada: esa pasada queda sin
  veredicto y no invalida las demás.
- Etapa con criterio vacío o solo espacios: se trata como sin criterio.
- Producto sin cantidad de unidades declarada: el guard no inventa una violación.
- Conversación sin etapa asignada: la anotación no avanza el lead.

## Requirements *(mandatory)*

### Functional Requirements

**Reproducibilidad y re-medición**

- **FR-001**: El sistema DEBE registrar, por cada corrida, las fuentes textuales
  con las que se juzgó (conocimiento, comportamiento, catálogo y zonas), de forma
  que una re-evaluación posterior use exactamente esas fuentes.
- **FR-002**: El sistema DEBE exponer una identidad verificable de la
  configuración de cada corrida, para poder agrupar y comparar corridas.
- **FR-003**: El sistema DEBE poder re-juzgar los casos de una corrida existente
  sin ejecutar ningún turno nuevo del agente.
- **FR-004**: El sistema DEBE permitir repetir el juicio del mismo material N
  veces y registrar cada pasada por separado.
- **FR-005**: El sistema DEBE informar la dispersión entre pasadas del mismo
  material, por persona y agregada.
- **FR-006**: El sistema DEBE comparar el resultado de una corrida con el de su
  re-evaluación sobre el mismo material.

**Confiabilidad del instrumento**

- **FR-007**: El juicio DEBE ejecutarse con una temperatura fijada, no heredada
  del entorno general.
- **FR-008**: Una corrida completa NO DEBE dejar casos sin veredicto por
  agotamiento del presupuesto de tiempo del juez.
- **FR-009**: El informe DEBE mostrar la tasa de casos sin veredicto de cada
  corrida, además de excluirlos de la mediana.
- **FR-010**: El informe DEBE marcar una diferencia de resultado como
  indistinguible de ruido cuando no supera el piso medido.

**Reglas del juez**

- **FR-011**: El juez DEBE evaluar el tono contra la voz configurada por el
  negocio, y NO DEBE marcar como hallazgo el texto que reproduce esa voz.
- **FR-012**: El juez DEBE considerar conocimiento, comportamiento configurado,
  catálogo y zonas como fuentes de verdad equivalentes para el hallazgo de tema
  fuera de conocimiento.
- **FR-013**: El juez DEBE emitir `alucinacion` solo ante contradicción con una
  fuente o invención de un dato concreto, nunca ante un rechazo de cobertura.
- **FR-014**: El juez DEBE leer la línea de handoff del transcript como escalado
  ocurrido.
- **FR-015**: El juez NO DEBE tratar una afirmación de capacidad como una acción
  ya realizada.

**Configuración del negocio**

- **FR-016**: Toda etapa del pipeline DEBE tener criterio de entrada, o quedar
  explícitamente marcada como sin criterio de forma visible para el dueño.
- **FR-017**: Cuando todas las etapas tienen criterio, la anotación NO DEBE
  incluir las instrucciones del negocio.
- **FR-018**: El conocimiento del negocio NO DEBE contener mensajes internos
  dirigidos al equipo.
- **FR-019**: La configuración del negocio DEBE ser internamente consistente: la
  voz (tratamiento y dialecto) entre sus campos, y las reglas comerciales entre
  sí (a quién se vende y por qué modalidad).

**Memoria del contacto**

- **FR-020**: Un campo comercial solo DEBE promoverse a la ficha cuando es
  trazable a lo que el cliente declaró, o a una carga humana.
- **FR-021**: El texto del fixture del Laboratorio NO DEBE aparecer ni en el
  transcript ni en la ficha del contacto.

**Verificación determinista**

- **FR-022**: La verificación determinista DEBE detectar la cantidad de unidades
  por bolsa cuando contradice el catálogo.
- **FR-023**: La verificación determinista DEBE detectar las afirmaciones de
  acciones que el canal no puede ejecutar, incluidas procesar, agregar, revisar y
  anotar.

**Comportamiento del agente**

- **FR-024**: La queja y el pedido de descuento por volumen DEBEN disparar
  escalada de forma determinista, sin depender del modelo.
- **FR-025**: El cierre de un handoff con motivo cliente DEBE comunicar que una
  persona atenderá el caso.
- **FR-026**: El agente DEBE detectar y evitar repetir una respuesta ya emitida a
  una pregunta distinta.
- **FR-027**: El agente NO DEBE volver a saludar en turnos posteriores, incluidas
  las variantes cortas del saludo.

### Key Entities

- **Corrida de evaluación**: agrupación de casos evaluados. Tiene tipo (ejecución
  del agente o re-evaluación), referencia a la corrida origen cuando es
  re-evaluación, modelo del agente, modelo del juez y estado.
- **Instantánea de configuración**: las fuentes textuales con las que se juzgó
  (conocimiento, comportamiento, catálogo, zonas) más una identidad verificable.
  Es la unidad que hace reconstruible una corrida.
- **Juicio**: observación de un par (transcript, configuración) por el juez.
  Registra pasada, veredicto, hallazgos, estado y latencia. Un caso puede tener
  varios juicios, que es lo que permite medir dispersión.
- **Piso de ruido**: dispersión agregada entre pasadas del mismo material. Es la
  referencia contra la que se decide si un cambio es señal.
- **Ficha del contacto**: campos comerciales reinyectados al agente cada turno.
  Cada campo promovido debe ser trazable a su origen.
- **Regla de verificación determinista**: comparación objetiva contra las fuentes
  (catálogo y capacidades del canal) que no depende del juez.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una corrida completa del Laboratorio termina con 0 casos sin
  veredicto por agotamiento de tiempo del juez (hoy 4 de 39).
- **SC-002**: Re-evaluar una corrida existente ejecuta 0 turnos nuevos del agente
  y consume menos del 15% de las llamadas al proveedor de una corrida completa.
- **SC-003**: Existe un piso de ruido publicado y toda mejora reportada lo supera.
- **SC-004**: Al re-evaluar la corrida base, 0 falsos positivos se reproducen en
  las cuatro clases conocidas (tema fuera de conocimiento por comportamiento,
  alucinación por rechazo de cobertura, escalado pendiente con handoff presente,
  capacidad tratada como acción).
- **SC-005**: 0 hallazgos de tono citan texto configurado por el dueño.
- **SC-006**: 0 ocurrencias del texto del fixture en transcripts y fichas del
  Laboratorio.
- **SC-007**: La etapa avanza en al menos 8 de cada 10 casos con señal de compra
  clara que hoy quedan en la etapa inicial (hoy 0 de 11).
- **SC-008**: Los defectos de hechos objetivos (unidades por bolsa y verbos de
  acción imposible) se detectan por verificación determinista, con el juez
  ausente.
- **SC-009**: El gate técnico y el self-test de comportamiento de punta a punta
  quedan verdes, sin regresión de los casos ya verdes.

## Assumptions

- La corrida base `run_ttbdykydfvz7sfb309tk` y sus transcripciones siguen
  disponibles en PROD para congelar la línea base antes de cambiar la
  configuración.
- El proveedor de LLM acepta una temperatura explícita por llamada, como ya lo
  hace la anotación.
- La configuración de PROD no cambia entre el congelamiento de la línea base y la
  primera re-evaluación.
- El juez puede juzgar el mismo material repetidamente sin caché que altere el
  resultado.
- Las decisiones de contenido del dueño quedaron resueltas el 2026-09-18: el seed
  es fuente de verdad solo al crear (no sobrescribe sin un forzado explícito), la
  persona natural puede comprar solo con retiro en planta y boleta, y el
  conocimiento del negocio se purga y se reevalúa más adelante.
- La voz y los criterios de etapa ya están codificados en el repositorio; su
  aplicación a PROD es una tarea de ejecución con respaldo previo, no una decisión
  pendiente.

## Out of Scope

- Tabla de auditoría por request (`llm_call`) con flag de entorno: es una
  migración con costo de almacenamiento. La evidencia por request se obtiene con
  la captura por proxy ya probada en el repositorio.
- Cambiar de modelo de agente o de juez.
- Rediseñar la interfaz del Laboratorio más allá de exponer las métricas nuevas.
- Cualquier cambio de comportamiento del agente no listado en FR-024 a FR-027.
- Re-entrenar o ajustar el modelo.
