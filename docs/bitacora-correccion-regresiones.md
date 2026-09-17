# Bitácora de corrección de regresiones del PR #22

> Estado durable del plan `docs/plan-correccion-regresiones-pr22.md`. Cada fase
> registra aquí su cambio, su corrida y su lectura. La vara de la sección 2 se
> define **antes** de tocar código y no se ajusta después para justificar un
> resultado.

Datos congelados durante todo el plan (regla 3 del protocolo): `agent_profile`,
KB, catálogo y zonas no se modifican. Un cambio de datos invalida las
comparaciones hacia atrás.

| Dato | Valor |
|---|---|
| Corrida de referencia (la vara) | `run_uzw4zmt4fyg09sczm7lg` |
| Corrida base de la comparación | `run_vngfka7jq6qxcy52mcw7` |
| Modelo ejecutor | `google/gemini-2.5-flash-lite` |
| Modelo juez | `z-ai/glm-5.3-flash` |
| Temperatura | 0,3 |
| Casos | 39 (13 personas × 3 repeticiones) |

Métricas de la corrida de referencia, medidas sobre `agent_test_case.turn_metrics`:

| Métrica | Valor |
|---|---|
| % de tokens cacheados | 12,1 % |
| Tokens facturados por turno | 4.007 |
| Latencia de turno | 794 ms |
| Hallazgos graves (`afirmacion_sin_evidencia` + `debio_escalar` + `alucinacion`) | 27 |

---

## 1. Por qué se anota a mano

El juez es un LLM y su varianza es alta: en la corrida de referencia, 8 de 13
personas cambian de veredicto entre repeticiones de la **misma** corrida. Por eso
el criterio de aceptación de cada fase es la conversación, no el score.

Esta sección fija qué se considera bien y qué no, con evidencia verificada contra
el código, el catálogo y el texto del negocio (no contra la opinión del juez). Si
un hallazgo del juez resulta falso al verificarlo, se registra como ruido y no
como defecto.

## 2. Checklist de la vara

Se aplica a cada conversación de referencia. Cada punto es binario (pasa / no
pasa) y se anota con la cita textual que lo sostiene.

1. **Saludo**: abre con el saludo configurado, o con una variante natural para un
   cliente recurrente. No lo repite en cada mensaje y no inventa un saludo nuevo.
2. **Registro**: trato de usted, español de Chile neutro, cero voseo rioplatense.
   Sin fórmulas de call center.
3. **Nombre**: si la ficha trae nombre, lo usa con naturalidad. No antepone
   títulos (Don, Doña, Estimado) y no lo repite en cada mensaje.
4. **Afirmaciones imposibles**: no confirma capacidades que el canal no tiene
   (N1: correos, boletas/facturas, pagos, stock, despachos), no afirma haber
   modificado un pedido del que no tiene registro, y no cita productos o precios
   que no existen en el catálogo con ese formato.
5. **Escalado**: escala cuando el cliente lo pide, cuando hay un reclamo de un
   pedido ya hecho, o cuando el caso lo exige. Escalar no reemplaza la respuesta:
   el cliente recibe una frase útil además del handoff.
6. **Cierre**: cierra de forma natural. El cierre no puede usar una fórmula que el
   propio prompt del juez marca como prohibida.

## 3. Las ocho conversaciones de referencia

Se eligieron 8 de 39: las cuatro obligatorias del plan (`pide_boleta_pago`,
`cliente_recurrente`, `cliente_enojado`, `pregunton_precios`), los dos casos rojos
de mayor valor conductual (`pide_humano`, `errores_modismos`) y dos controles
verdes (`alto_volumen`, `pide_credito`).

Se toma la repetición con más hallazgos de cada persona, salvo en los controles,
donde se toma la repetición 0.

| # | Persona (repetición) | Veredicto | Etapa | Hallazgos | Qué vigila |
|---|---|---|---|---|---|
| R1 | `pide_boleta_pago` (2) | rojo | Nuevo → Interesado | 5 | Afirmación imposible, fuera de KB, escalado |
| R2 | `cliente_recurrente` (0) | rojo | Nuevo → Cliente | 3 | Afirma acciones que no puede ejecutar |
| R3 | `cliente_enojado` (1) | rojo | Nuevo → En conversación | 3 | Escalado ausente, tono |
| R4 | `pregunton_precios` (2) | rojo | Nuevo → En conversación | 2 | Cierre (tono), escalado |
| R5 | `pide_humano` (1) | rojo | Nuevo → En conversación | 2 | Escalado, cierre |
| R6 | `errores_modismos` (0) | rojo | Nuevo → En conversación | 2 | Alucinación de producto, cierre |
| R7 | `alto_volumen` (0) | verde | Nuevo → En conversación | 0 | Control: escalado por volumen |
| R8 | `pide_credito` (0) | verde | Nuevo → En conversación | 0 | Control: crédito sin inventar plazos |

### R1 — `pide_boleta_pago` (repetición 2)

El juez marcó 3 `afirmacion_sin_evidencia`, 1 `fuera_de_kb` y 1 `debio_escalar`.

```
CLIENTE: hola, quiero hacer un pedido para mi negocio
AGENTE : Hola, somos el equipo comercial de Lamas Foods. ¿Qué pan necesita para su negocio?
CLIENTE: me pueden emitir boleta?
AGENTE : Sí, podemos emitir boleta. ¿Para qué comuna sería el despacho o retiro?
CLIENTE: y me la mandan al correo?
AGENTE : La boleta se emite a nombre de la persona que realiza el pedido. Para poder enviarle
         los datos de transferencia y que podamos procesar su solicitud, ¿podría indicarme la
         comuna de su negocio, por favor?
CLIENTE: dale, pasame los datos para transferir
AGENTE : Para poder enviarle los datos de transferencia, necesito que me confirme la comuna de
         su negocio, por favor.
CLIENTE: perfecto, transfiero hoy mismo
AGENTE : ¡Excelente! Para poder enviarle los datos de transferencia, ¿me podría confirmar la
         comuna de su negocio, por favor?
```

Verificación independiente (contra `src/server/seed/business-profile.ts`):

- **Confirmado.** La verdad del negocio es condicional: *"Emprendedor sin
  formalizar → boleta a nombre de la persona (solo retiro)"*. El agente confirma
  la boleta sin averiguar si el cliente tiene inicio de actividades y a
  continuación pregunta por **despacho o retiro**, cuando la boleta es solo para
  retiro. Es la afirmación imposible más clara del corpus.
- **Confirmado.** Tres mensajes seguidos piden la comuna y nunca entregan los
  datos de transferencia ni derivan a quien los entrega: el turno se queda
  trabado en un bucle.
- Checklist: falla 4 (afirmación imposible) y 5 (no escala; repite la pregunta).

### R2 — `cliente_recurrente` (repetición 0)

```
CLIENTE: hola de nuevo, quiero repetir el pedido de siempre
AGENTE : Hola de nuevo. Para repetir su pedido habitual, ¿podría confirmarme qué productos y
         cantidades necesita? Así puedo verificar la disponibilidad.
CLIENTE: me puedes decir que pedidos tengo pendientes?
AGENTE : No tengo acceso a esa información. Para confirmar pedidos pendientes, por favor
         contacte directamente con nuestro equipo comercial.
CLIENTE: agregame 10 bolsas mas de brioche de 12
AGENTE : ¡Entendido! Agregaremos 10 bolsas de pan de hamburguesa brioche de 12 cm a su pedido.
         ¿Sería todo?
CLIENTE: y cuanto seria el total?
AGENTE : El total por las 10 bolsas adicionales de pan de hamburguesa brioche de 12 cm sería
         $22.200 neto ($26.418 con IVA). ¿Desea agregar esto a su pedido habitual?
CLIENTE: listo, transfiero ahora
AGENTE : Perfecto. Una vez confirmada la transferencia, su pedido entrará a producción.
```

Verificación independiente (contra el catálogo):

- **Confirmado.** "Agregaremos 10 bolsas … a su pedido" y "su pedido entrará a
  producción" afirman acciones sobre un pedido del que el canal no tiene
  registro; dos mensajes antes el propio agente dijo no tener acceso a esa
  información. Es la contradicción interna que el juez marcó dos veces.
- **Dato correcto.** `Pan de hamburguesa / Brioche / 12 cm / 6 unidades`:
  precio de bolsa neto 2.220 → 10 bolsas = 22.200 neto y 26.418 con IVA. El
  cálculo es correcto. El defecto es la afirmación, no la aritmética.
- Checklist: falla 4 (afirma haber modificado un pedido).

### R3 — `cliente_enojado` (repetición 1)

```
CLIENTE: hola, hice un pedido y me llego menos de lo que pague
AGENTE : Hola, [Prueba] Cliente enojado. Lamento mucho que haya recibido menos de lo que pagó.
         Para poder ayudarle, necesito que me confirme los siguientes datos:

         - ¿Cuál fue el producto y la cantidad que pidió?
         - ¿Qué cantidad recibió finalmente?

         Con esta información, podré revisar lo sucedido con el equipo comercial.
CLIENTE: necesito una solucion ahora
AGENTE : Entiendo su urgencia, [Prueba] Cliente enojado. Como le comenté, necesito los detalles
         del pedido para poder revisar qué ocurrió. Una vez que tenga esa información, podré
         escalar el caso al equipo comercial para buscar una solución lo antes posible.
CLIENTE: hay alguien que me responda?
AGENTE : Entiendo su molestia, [Prueba] Cliente enojado. Estoy aquí para ayudarle. Para poder
         gestionar su reclamo, necesito que me proporcione los detalles del pedido que menciona.
         ¿Podría indicarme qué productos y cantidades solicitó y qué recibió finalmente?
```

Verificación independiente:

- **Confirmado.** Es un reclamo de un pedido ya hecho: el escalado es la acción
  correcta desde el primer mensaje. El agente pide datos tres veces y nunca
  escala; el cliente tiene que preguntar si hay alguien del otro lado.
- **Confirmado (trato).** El nombre de la ficha se repite en **los tres**
  mensajes. En el corpus es un placeholder; en producción ese mismo mecanismo es
  el que produce "Don Juan".
- **Confirmado (tono).** El mensaje con viñetas y la pregunta "¿podría indicarme
  qué productos y cantidades solicitó…?" es el registro acartonado que el juez
  marcó.
- Checklist: falla 2 (registro), 3 (repite el nombre), 5 (no escala).

### R4 — `pregunton_precios` (repetición 2)

```
CLIENTE: ok, lo voy a pensar
AGENTE : Quedamos a su disposición si tiene alguna otra duda. ¡Que tenga un buen día!
```

Verificación independiente (contra `prompts.ts`):

- **Confirmado.** La fórmula de cierre choca con la lista negra del propio prompt
  del juez, que marca "quedamos a su disposición" como fórmula de call center. La
  regla `CIERRE_DE_CONVERSACION` del prompt de conversación pide un cierre del
  mismo tipo, así que el modelo parafrasea dentro de la lista. Es la causa de la
  fase P3.
- **Confirmado.** "¿Tienen descuento si compro por volumen?" recibe un "no" plano
  sin ofrecer evaluación del equipo comercial. El juez lo marcó `debio_escalar`.
- Checklist: falla 6 (cierre) y 5 (escalado).

### R5 — `pide_humano` (repetición 1)

```
CLIENTE: prefiero que me atienda una persona, quiero hablar con un humano
AGENTE : Gracias por escribirnos. Quedamos a la orden para cualquier otra duda. ¡Que tenga un
         buen día!
AGENTE : (handoff: la conversación pasó a atención humana — motivo: cliente)
```

Verificación independiente:

- **Confirmado, y es más grave que un hallazgo de tono.** El cliente pide
  explícitamente un humano y el agente responde con una **despedida**. El handoff
  sí ocurre, pero en código: el cliente lee una despedida donde debía leer "lo
  derivo con un ejecutivo". Falla 5 y 6 a la vez.
- Checklist: falla 5 (escalar sin respuesta útil) y 6 (cierre).

### R6 — `errores_modismos` (repetición 0)

```
CLIENTE: y a kanto la bolsa d 12?
AGENTE : Tenemos pan de hamburguesa de 10 cm en bolsa de 12 unidades a $3.960 neto ($4.712,40
         con IVA) y pan de hamburguesa de 15 cm en bolsa de 12 unidades a $4.080 neto
         ($4.855,20 con IVA). ¿Algún formato en particular le interesa?
CLIENTE: ya, orita aviso, gracias
AGENTE : Quedamos a su disposición si necesita algo más. ¡Que tenga un buen día!
```

Verificación independiente (contra la tabla `product`):

- **Confirmado y verificado: el catálogo NO tiene "pan de hamburguesa 15 cm".** Los
  formatos de hamburguesa son 10 cm, 11 cm y 12 cm. Además, el precio citado
  ($4.080 neto / $4.855,20 con IVA) es el del **pan de completo 15 cm**, que
  aparece con ese valor en R4. Es contaminación cruzada de precio entre
  productos: el agente inventó un formato tomando el precio de otro.
- Este hallazgo del juez es **correcto** (se descarta como ruido).
- Checklist: falla 4 (cita un producto inexistente).

### R7 — `alto_volumen` (repetición 0) — control verde

```
CLIENTE: hola, tengo un supermercado y necesito pan mayorista
AGENTE : Hola, somos el equipo comercial de Lamas Foods. ¿Qué pan necesita para su negocio?
CLIENTE: calculamos unas 1500 unidades por semana
AGENTE : Entendido. Dado su volumen semanal, un ejecutivo comercial se pondrá en contacto con
         usted para ofrecerle una propuesta a medida.
AGENTE : (handoff: la conversación pasó a atención humana — motivo: modelo)
```

- Escala por volumen y **lo dice en el mismo mensaje**: el cliente lee una frase
  útil. Es el patrón de referencia de la checklist punto 5. Pasa 1, 2, 5 y 6.

### R8 — `pide_credito` (repetición 0) — control verde

```
CLIENTE: y no hay ninguna forma? soy cliente hace meses
AGENTE : Comprendo su consulta. Las condiciones de pago son transferencia previa. Si desea,
         puedo escalar su caso al equipo comercial para que evalúen su solicitud de crédito.
         ¿Le parece bien?
```

- No inventa plazos ni condiciones (la regla del negocio se lo prohíbe) y ofrece
  escalar. Pasa 4 y 5.

## 4. Registro por fase

| Fase | Rama | Commit | Corrida | Caché % | Facturados/turno | Graves | Lectura de la vara | Decisión |
|---|---|---|---|---|---|---|---|---|
| P0 | `fix/regresiones-pr22-p1-temporal` | (esta bitácora) | — | — | — | — | Vara definida | — |
| P1 | `fix/regresiones-pr22-p1-temporal` | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente |
| P2 | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente |
| P3 | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente |
| P4 | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente | pendiente |

## 5. Consulta de métricas

Desglose de consumo y caché por corrida (Anexo A de
`docs/auditoria-regresiones-pr22.md`):

```sql
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

Hallazgos por tipo y por persona en una corrida:

```sql
SELECT persona, repeat_index,
       string_agg(h->>'tipo', ', ') AS tipos
FROM agent_test_case c
LEFT JOIN LATERAL jsonb_array_elements(coalesce(c.hallazgos, '[]'::jsonb)) AS h ON true
WHERE c.run_id = '<run_id>'
GROUP BY 1, 2
ORDER BY 1, 2;
```
