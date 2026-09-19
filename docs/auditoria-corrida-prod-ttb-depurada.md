# Auditoría de `run_ttbdykydfvz7sfb309tk` — versión depurada

Revisión de la versión 1 (`docs/auditoria-corrida-prod-ttb.md`) contra el código
en HEAD y la base de PROD. Este documento conserva **únicamente los enunciados
reproducidos**; lo refutado o corregido se aísla en §6 y lo no verificado en §7.

| | |
|---|---|
| Corrida | `run_ttbdykydfvz7sfb309tk` (PROD, 2026-09-18 11:03:08Z → 11:21:57Z) |
| Código | rama `fix/guard-respuesta-y-anotacion`, HEAD `5dc9d3a` (PR #24 sin mergear, desplegado en PROD) |
| Base | PROD (Hetzner), acceso de solo lectura autorizado (`SELECT` + `docker logs`) |
| Captura | `/tmp/opencode/capture-full.jsonl` (proxy local, 319 llamadas, todas `status: 200`) |
| Fecha | 2026-09-18 |
| Relación con v1 | Reemplaza los enunciados de v1. **No** reemplaza el plan de corrección |

## Criterio de depuración

Un enunciado entra en §2–§5 solo si se reprodujo contra alguna de estas fuentes:

- **(C)** el código en HEAD, citado como `archivo:línea`;
- **(D)** la base de PROD, con la consulta del Anexo;
- **(X)** el artefacto de captura citado, con el conteo.

Todo lo demás se lista en §6 (refutado/corregido) o §7 (no verificado).

---

## 1. Contexto verificado

- El contenedor de PROD (`vocero-app-1`) se inició a las **11:00:22Z**, posterior
  al deploy del fix de PR #24. **(D)** `docker inspect`.
- La corrida es la primera posterior a ese deploy y el build incluye el fix:
  las violaciones del guard caen de 14 (`run_pk41`) a 1 (`run_ttb`). **(D)**
- HEAD local contiene los dos commits de PR #24 (`6ae4fb5`, `5dc9d3a`) sobre el
  merge de PR #23 (`072868e`), es decir, el código verificado coincide con el
  desplegado. **(C)**

---

## 2. Medición de la corrida (verificado)

La tabla §1.1 de v1 se reproduce **exacta** contra PROD:

| Métrica | `run_2k047` (09-17) | `run_pk41` (09-18 07:09Z) | `run_ttb` (09-18 11:03Z) | Fuente |
|---|---|---|---|---|
| score | 40 | 35 | **42** | D |
| verde / amarillo / rojo | 4 / 22 / 8 | 4 / 18 / 16 | **7 / 16 / 12** | D |
| sin veredicto (`judge_failed`) | 5 | 1 | **4** | D |
| turnos del agente | 128 | 125 | **121** | D |
| prompt tokens (total) | 592.338 | 471.689 | **538.775** | D |
| prompt tokens / turno | 4.628 | 3.774 | **4.453** | D (derivado) |
| caché | 9,0 % | 15,9 % | **12,1 %** | D (derivado) |
| violaciones del guard | 0 | 14 | **1** | D |

Distribución de hallazgos por tipo, **exacta**:

| tipo | n | en casos rojos |
|---|---|---|
| `tono` | 25 | 9 |
| `pipeline` | 10 | 3 |
| `alucinacion` | 7 | 7 |
| `fuera_de_kb` | 6 | 1 |
| `afirmacion_sin_evidencia` | 5 | 5 |
| `debio_escalar` | 5 | 5 |
| `judge_failed` | 4 | 0 |

Cálculo del score, verificado en código y reproducido en datos **(C, D)**:

- `computeScore` (`src/server/lab/judge.ts:237-254`) toma la **mediana por
  persona** (verde = 1, amarillo = 0,5, rojo = 0), promedia y redondea; los casos
  con veredicto `null` (`status = judge_failed`) se **excluyen** de la mediana de
  su persona.
- Con 13 personas: `5,5 / 13 = 42,3` → **42**. Reproducido con los veredictos por
  caso.

---

## 3. Configuración de PROD (verificado, literal)

| Elemento | Valor en PROD | Estado |
|---|---|---|
| `agent_profile.greeting` | «¡Hola! Le saluda el equipo comercial de Lamas Foods. ¿En qué podemos ayudarle con nuestros panes?» | Confirmado |
| `agent_profile.tone` | `«Cordial y profesional, con español de Chile. Tratá de "usted". Mensajes cortos…»` | Confirmado (voseo) |
| `agent_profile.instructions` | 2.947 caracteres, con voseo (`Sos`, `Atendés`, `ofrecé`, `dejá`, `decí`, `Averiguá`, `Preguntá`, `pedí`) | Confirmado |
| `agent_profile.voice` | `{"pais":"chile","largo":"medio","tratamiento":"usted"}` | Confirmado |
| `pipeline_stage.criteria` | `NULL` en **5/5** etapas (Nuevo, En conversación, Interesado, Cliente, Perdido) | Confirmado |
| `kb_entry` | **1 fila**, `kind = block`, 365 caracteres, con un mensaje de asistente dirigido al dueño | Confirmado |
| `delivery_zone` | **11** comunas, todas activas | Confirmado |
| `product` | **12** SKUs activos | Confirmado |

El catálogo sostiene el hallazgo A1: la bolsa del **pan de completo de 20 cm es
de 10 unidades** y la de **6 unidades es la de 30 cm** (ambas con el mismo
precio, $3.600 neto). **(D)**

---

## 4. Fallos reales del agente (verificados)

| # | Enunciado | Estado | Evidencia |
|---|---|---|---|
| A1 | El agente cotiza el completo de 20 cm como «bolsa de 6 unidades»; el catálogo dice 10 | **Confirmado** | D (catálogo) + C: `checkAgentText` (`src/server/lab/fact-check.ts:181-209`) valida precio y formato `N cm`, no `bolsa de N unidades` |
| A2 | Afirma acciones que el canal no puede ejecutar («ya procesamos», «agregamos», «estamos revisando») | **Confirmado** | D (3 hallazgos `afirmacion_sin_evidencia`) + C: `FORBIDDEN_CLAIMS` (`fact-check.ts:66-75`) no cubre esos verbos |
| A3 | Escalada no determinista: queja y descuento dependen del modelo | **Confirmado** | D (handoffs: `cliente_enojado` rep0 sin handoff; `pregunton_precios` reps 1-2 sin handoff) + C: `matchesHandoffIntent` (`src/server/ai/handoff.ts:26-38`) solo detecta pedido explícito de humano |
| A4 | El cierre determinista del handoff es una despedida genérica | **Confirmado** | D (transcripts `pide_humano` rep1 y rep2 con `handoff_reason = cliente` y cierre `CLOSING_FAREWELL`) + C: `prompts.ts:44-45`, `pipeline.ts:220-223` |
| A5 | Bucle: el mismo texto responde tres preguntas distintas | **Confirmado** | D (transcript `fuera_de_kb` rep1: 3 respuestas idénticas sobre gluten) |
| A6 | El lead no avanza de etapa | **Confirmado con corrección** | D: 11 casos `expect_advance = true` y `advanced = false` |
| A7 | Saludo re-pegado en turnos posteriores | **Confirmado** | D (1 violación de guard: `cv_9svk…`, caso `alto_volumen` rep2) + los 17 hallazgos `tono` que citan el saludo configurado |

**Corrección de A6.** La v1 lista «`alto_volumen` (3), `fuera_cobertura` (3),
`pide_boleta_pago` (2), `reclama_no_recibido` (2)» = 10 casos. En la base:

- `alto_volumen` 3 (reps 0, 1, 2), `fuera_cobertura` 3 (reps 0, 1, 2),
  `pide_boleta_pago` 2 (reps 1, 2), `reclama_no_recibido` **3** (reps 0, 1, 2).
- Total **11** casos. La cifra 10 de v1 solo cierra si se excluye
  `reclama_no_recibido` rep0, que quedó `judge_failed` pero igual no avanzó
  (`advanced = false`, `final_stage = Nuevo`). Se contaron 10 casos **con
  veredicto**, no 10 casos reales.
- Contraste confirmado: `cliente_recurrente` y `comprador_decidido` avanzaron en
  las 3 repeticiones.

---

## 5. Fallos del instrumento (verificados)

| # | Enunciado | Estado | Evidencia |
|---|---|---|---|
| B1 | El KB tiene una sola fila `block` con un mensaje de asistente, y la regla `fuera_de_kb` dispara sobre cualquier tema no presente | **Confirmado en lo esencial, corregido en el alcance** | D (1 fila, 365 caracteres) + C (`prompts.ts:676`) |
| B2 | `alucinacion` mal aplicada en `fuera_cobertura` rep1 y rep2 | **Confirmado para los 2 citados** | D (los dos hallazgos existen; el KB manda decir la falta de cobertura con claridad) |
| B3 | `afirmacion_sin_evidencia` sobre capacidad, no sobre acción, en `pide_boleta_pago` rep2 | **Confirmado** | D (hallazgo «Sí, podemos emitir boleta») |
| B4 | `debio_escalar` cuando el handoff sí ocurrió | **Confirmado** | D (transcript `pide_humano` rep1 con línea de handoff y hallazgo `debio_escalar`) |
| B5 | 20 de 25 hallazgos `tono` castigan la voz configurada por el dueño | **Confirmado exacto** | D (desglose 17 citan el saludo + 3 «Estimado» + 2 cierre + 1 fórmula + 1 tuteo + 1 otro = 25) |
| B6 | 4 casos `judge_failed` (10 %) por timeout del juez a 60 s | **Confirmado** | D (4 logs + 4 casos `null`; 4/39 = 10,3 %) + C (`lib/ai/index.ts:165-170`: `timeoutMs = 60_000` con `AbortController`) |
| B7 | Inestabilidad entre repeticiones | **Confirmado exacto** | D (la tabla completa de v1 se reproduce) |
| B8 | Fuga del fixture al transcript | **Confirmado** | D (`contact.name = "[Prueba] …"`; el agente cita «Prueba» en `cliente_recurrente` y `fuera_cobertura`) |
| B9 | La ficha del contacto se contamina y vuelve al contexto del agente | **Confirmado solo vía campos estructurados** | D (ficha de `cliente_recurrente` rep1: `empresa = "Prueba"`, `volumen_semanal = "10"`) + C |

**Correcciones de B5.** El desglose de 25 `tono` se clasificó y coincide con v1:
17 citan el saludo configurado, 3 castigan «Estimado», 2 citan el cierre
determinista, 1 es una fórmula genérica («¿Podemos ayudarle con algo más?»),
1 es tuteo real (`pregunton_precios` rep2: «¿Necesitas que te cotice…?») y 1 no
encaja en las categorías anteriores. La contradicción de registro es real: el
`tone` configurado exige usted formal y el juez castiga «Estimado».

**Corrección de B9 (la más importante).** La v1 sostiene que las notas `[IA]`
vuelven al contexto del agente y cierran el bucle «texto del modelo alimentando
al modelo». El código lo refuta: `renderClientFile` (`prompts.ts:239-251`)
renderiza **solo los campos estructurados** de `CLIENT_FILE_FIELDS`
(`prompts.ts:213-227`); `notes` está marcado como «Ignorado al renderizar»
(`prompts.ts:173-179`) y queda fuera de la lista a propósito desde F2. No existe
el tope de 1.500 caracteres que cita v1. Lo que sí ocurre, y queda confirmado:

- `appendLeadNote` (`pipeline.ts:641-714`) escribe `empresa`, `volumen_semanal`,
  `producto_interes` y `formato` en `contact`, y acumula una línea `[IA]` en
  `contact.notes`.
- Los **campos estructurados** sí viajan al prompt en cada turno. En
  `cliente_recurrente` rep1 viajaron `Empresa: Prueba` y `Volumen semanal: 10`,
  ambos contaminados por el fixture.
- Las **notas `[IA]` no viajan** al modelo; quedan como registro para el equipo
  humano.

---

## 6. Enunciados de v1 refutados o corregidos

| Enunciado de v1 | Estado | Evidencia |
|---|---|---|
| «`judge_latency_ms` incluye los reintentos de `chatJson`» (Anexo B.1) | **Refutado** | `lib/ai/index.ts:123-144` mide cada intento por separado y `judge.ts:183,195` devuelve la latencia del intento exitoso; los reintentos y las pausas no se suman |
| «El agente usa 2 intentos» (`judge_failed`), implícito | **Corregido** | El log dice «tras 2 intentos», pero `MAX_ATTEMPTS = 3` en `lib/ai/index.ts:47`; el número del log es el conteo observado en esa corrida |
| «`notes` alimenta al modelo» / «texto del modelo alimentando al modelo» (B9) | **Refutado** | `prompts.ts:173-179` y `213-227`: `notes` se ignora al renderizar (desde F2) |
| «`renderClientFile` incluye `contact.notes` con tope de 1.500 caracteres» | **Refutado** | No existe ese tope; `notes` no se renderiza |
| «La prohibición de call center vive SOLO en código, dentro de `buildJudgePrompt`» (B5) | **Inexacto** | La lista de frases vive solo en el juez (`prompts.ts:679`), pero el system prompt del agente ya tiene una regla genérica contra fórmulas (`prompts.ts:445`) |
| «Los 6 `fuera_de_kb` corresponden a respuestas respaldadas por `instructions`» (B1) | **Inexacto** | Solo 3 de 6 lo están (boleta para emprendedor; mínimo de 15 bolsas; retiro bajo el mínimo). Los otros 3 no están cubiertos literalmente: total del pedido (`cliente_recurrente` rep0), respuesta de gluten/Valparaíso (`fuera_de_kb` rep1) y «este canal no gestiona boletas» (`reclama_no_recibido` rep1) |
| «Los 6 `fuera_de_kb` cubren cobertura de despacho, boleta/factura, crédito, mínimos» (B1) | **Inexacto** | No hay hallazgos `fuera_de_kb` de crédito ni de cobertura en esa lista |
| «`alucinacion` mal aplicada · 2 falsos positivos» (B2) | **Incompleto** | Hay 7 `alucinacion`: 3 son A1 (reales), 2 son los FP citados, 1 es «podríamos coordinar un envío por transportista externo» (`fuera_cobertura` rep1, no clasificado por v1 y no autorizado por la configuración) y 1 es «solo trabajamos con panes de masa de papa y brioche» (`fuera_de_kb` rep2), incompatible con el SKU activo `Pan ciabatta`, cuya masa es «Sin masa» |
| «`afirmacion_sin_evidencia` · 1 falso positivo» (B3) | **Incompleto** | Además del citado (`pide_boleta_pago` rep2), `cliente_recurrente` rep0 («Una vez que recibamos la transferencia, su pedido entrará a producción…») es futuro condicional y no afirma una acción ya realizada; queda como candidato a FP no clasificado |
| «`turn_metrics` confirma que un turno son 2 llamadas» (Anexo B.2) | **Incompleto** | La captura `capture-full.jsonl` tiene **3** tipos de llamada: 128 conversación, 128 anotación y **63 del juez**; la tabla de B.2 omite las del juez |
| Rangos de tokens de B.2 (conversación 10.780–12.569 / anotación 5.067–5.351) | **No reproduce** | Medición sobre la misma captura: conversación 10.410–12.766 chars y 2.998–3.616 tokens; anotación 5.067–5.877 chars y 1.367–1.662 tokens; el conteo de mensajes llega a 10 y 7 |
| «`matchesHandoffIntent` (pipeline.ts)» | **Corregido** | Vive en `src/server/ai/handoff.ts:26-38`; `pipeline.ts:220` solo lo invoca |
| «`computeScore` / informe de `scripts/lab-run.ts`» | **Corregido** | Vive en `src/server/lab/judge.ts:237-254` |
| «`pipeline.ts:641-645` acumula la nota `[IA]`» | **Corregido** | La firma está en 641; la escritura real está en `pipeline.ts:697-714` |

---

## 7. No verificado en esta revisión

1. **A6/M2** — por qué la anotación no avanza el lead. Se confirmó que
   `criteria` está vacío en 5/5 y que el fallback de instrucciones existe
   (`prompts.ts:590-594`), pero no se inspeccionó la salida cruda de la
   anotación por turno.
2. **M1 (atribución de tokens/caché)** — el mecanismo está verificado en código:
   el fallback reinyecta las instrucciones (2.947 caracteres ≈ 737 tokens) en
   cada llamada de anotación porque ninguna etapa tiene `criteria`. La aritmética
   es consistente (4.453 − 3.774 = +679 por turno), pero **no se aisló con un
   experimento**; queda como atribución consistente, no medida.
3. **M3** — cuánto del score 42 es varianza del juez.
4. **B.2** — la corrida recortada propuesta no se ejecutó; sus rangos de tokens no
   reproducen (ver §6). El script `proxy-capture.mjs` y su captura sí existen y
   suman 319 llamadas, todas `status: 200`.
5. **§7 de v1** sobre si los 4 `judge_failed` fueron solo timeout: se confirmó
   que el log reporta `provider_error — This operation was aborted`, consistente
   con el `AbortController` a 60 s, pero no se descartaron respuestas inválidas
   del proveedor.

---

## 8. Consecuencias para el plan

El plan de corrección de v1 no se reproduce aquí; solo se anotan los cambios de
base fáctica que lo afectan:

- **B9 pierde su parte de `notes`.** El bucle ya estaba cortado por F2. El riesgo
  vigente es la contaminación de los **campos estructurados** (`empresa`,
  `volumen_semanal`), que sí entran al prompt. Cualquier medida debe apuntar a
  esos campos, no a `notes`.
- **B1 sigue justificando I1**, pero el alcance es menor al enunciado: la regla
  dispara también sobre respuestas no cubiertas por `instructions`, así que la
  fuente de conocimiento del juez necesita más que definir KB + comportamiento.
- **I2 (timeout del juez) mantiene su premisa**: el abort a 60 s y el 10 % de
  casos nulos son reales. La corrección sobre `judge_latency_ms` no cambia la
  acción.
- **A6 sube de 10 a 11 casos**; el backfill de `criteria` (C2) sigue siendo la
  acción, con una medición base corregida.

---

## Anexo — Consultas de reproducción

Todas se ejecutaron en PROD en modo lectura:

```bash
ssh vocero "docker exec -i vocero-postgres-1 psql -U postgres -d vocero -P pager=off -f -" <<'SQL'
-- corridas comparadas
select id, status, score, model, judge_model, started_at, finished_at
from agent_test_run
where id in ('run_2k047f1wb4ghlwmqimap','run_pk41lg7gshfsjyyhyhkj','run_ttbdykydfvz7sfb309tk')
order by started_at;

-- casos: veredicto, etapa, avance
select persona, repeat_index, status, veredicto, expect_advance, advanced,
       initial_stage, final_stage, turn_count, judge_latency_ms
from agent_test_case where run_id = 'run_ttbdykydfvz7sfb309tk'
order by persona, repeat_index;

-- hallazgos por tipo
select h->>'tipo' tipo, count(*), count(*) filter (where c.veredicto = 'rojo')
from agent_test_case c, jsonb_array_elements(coalesce(c.hallazgos,'[]'::jsonb)) h
where c.run_id = 'run_ttbdykydfvz7sfb309tk' group by 1 order by 2 desc;

-- tokens y violaciones agregadas por corrida
select c.run_id, sum((m->>'promptTokens')::bigint), sum((m->>'cachedTokens')::bigint),
       sum(coalesce((m->>'guardViolations')::int,0))
from agent_test_case c, jsonb_array_elements(coalesce(c.turn_metrics,'[]'::jsonb)) m
where c.run_id in ('run_2k047f1wb4ghlwmqimap','run_pk41lg7gshfsjyyhyhkj','run_ttbdykydfvz7sfb309tk')
group by 1;

-- configuración
select greeting, tone, voice, length(instructions) from agent_profile;
select name, position, criteria from pipeline_stage order by position;
select kind, length(content) from kb_entry;
select producto, formato, unidades_por_bolsa, precio_bolsa_neto from product where activo;
select comuna from delivery_zone where activa;
SQL
```

Medición de la captura:

```bash
node -e "
const fs=require('fs');
const rows=fs.readFileSync('/tmp/opencode/capture-full.jsonl','utf8').trim().split('\n').map(JSON.parse);
const kind=r=>{const c=r.messages[0].content;return c.startsWith('[ANOTACION]')?'ANOTACION':c.startsWith('[JUEZ]')?'JUEZ':'CONVERSACION'};
const g={};for(const r of rows)(g[kind(r)]=g[kind(r)]||[]).push(r);
for(const k of Object.keys(g)){const a=g[k];
console.log(k,a.length,'chars',Math.min(...a.map(r=>r.promptChars)),'-',Math.max(...a.map(r=>r.promptChars)),
'tokens',Math.min(...a.map(r=>r.prompt)),'-',Math.max(...a.map(r=>r.prompt)));}
"
```

Código citado (HEAD `5dc9d3a`): `src/server/lab/fact-check.ts`,
`src/server/ai/handoff.ts`, `src/server/ai/pipeline.ts`,
`src/server/ai/prompts.ts`, `src/server/ai/reply-guard.ts`,
`src/server/lab/judge.ts`, `src/server/lab/runner.ts`,
`src/server/lab/personas.ts`, `src/server/lab/dialect-check.ts`,
`src/lib/ai/index.ts`, `scripts/seed/business-profile.ts`.
