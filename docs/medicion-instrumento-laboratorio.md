# Medición del instrumento del Laboratorio (Fase F)

> **Qué responde**: si el criterio de registro del juez del Laboratorio —que es un
> LLM y no es determinista— atrapa el caso que motivó toda la auditoría: el agente
> respondiendo con registro de call center a un cliente que escribe con modismos.
>
> **Cómo se obtuvo**: una corrida real del Laboratorio contra el proveedor
> configurado, disparada con `pnpm lab:run` (CLI headless, PR #15). La corrida se
> ejecutó sobre `main` actualizado (`34bd72f`: W0 de voz + W6 de instrumento) más la
> CLI. **No** incluye las fases B ni C, que viven en PRs sin mergear: así la
> comparación contra la corrida almacenada aísla el instrumento.
>
> **Fecha**: 2026-09-17 · **Presupuesto**: corrida 1 de 2 autorizadas.

---

## 1. La pregunta central, respondida

| | Corrida de referencia | Corrida de esta medición |
|---|---|---|
| ID | `run_nttw3a3s05f5uordhksr` | `run_vngfka7jq6qxcy52mcw7` |
| Fecha | 2026-09-15 19:50 | 2026-09-16 22:19 |
| Instrumento | Juez **anterior** a W6 (1 caso por persona) | Juez **con el criterio de registro** (3 repeticiones) |
| Score | 79 | 54 |
| Casos | 13 | 39 |
| `errores_modismos` | **verde** | **amarillo, amarillo, amarillo** |

**Respuesta: sí, el criterio de registro del juez atrapa el caso.**
En las tres repeticiones de `errores_modismos` el veredicto pasó de verde a
amarillo, y el hallazgo es de tipo `tono`, señalando exactamente las fórmulas que
el dueño reportó:

- `hallazgo [tono]: ¡Hola! Le saluda el equipo comercial de Lamas Foods.`
  (repeticiones 0 y 2)
- `hallazgo [tono]: Quedamos a su disposición ante cualquier otra consulta. ¡Que tenga un excelente día!`
  (repetición 2)
- `hallazgo [tono]: Quedamos a su disposición si decide avanzar o tiene alguna otra
  consulta. ¡Que tenga un buen día!` (repetición 1)

El criterio cumple su función, así que **no se gastó ningún intento de ajuste**.

La comprobación determinista de dialecto **no** participa de este resultado: el
agente no escribe voseo, y el problema reportado nunca fue de dialecto sino de
registro. Es la confirmación empírica de lo que el plan anticipaba.

## 2. El problema sigue presente en el agente

La medición no arregla al agente: lo **ve**. El agente sigue escribiendo
`¡Hola! Le saluda el equipo comercial de Lamas Foods.` —el síntoma textual que
reportó el dueño— y ahora el juez lo marca. Ese es exactamente el estado deseado
del instrumento: antes no había forma de ver la causa del reclamo.

## 3. Números crudos de la corrida

```
run:        run_vngfka7jq6qxcy52mcw7
estado:     done
score:      54
modelo:     google/gemini-2.5-flash-lite
juez:       z-ai/glm-5.3-flash
inicio:     2026-09-16T22:19:32Z
fin:        2026-09-16T22:30:51Z
duración:   679 s (11 min 19 s) para 39 casos
casos:      39 (13 personas × 3 repeticiones)
```

| Veredicto | Casos |
|---|---|
| verde | 10 |
| amarillo | 20 |
| rojo | 8 |
| sin veredicto (`judge_failed`) | 1 |

| Hallazgo | Cantidad |
|---|---|
| `tono` | 30 |
| `fuera_de_kb` | 9 |
| `debio_escalar` | 6 |
| `afirmacion_sin_evidencia` | 5 |
| `alucinacion` | 4 |
| `judge_failed` | 1 |

### Dispersión: 8 de 13 personas inestables

```
estable   alto_volumen        amarillo, amarillo, amarillo
INESTABLE cliente_enojado     verde, amarillo, verde
estable   cliente_recurrente  rojo, rojo            (2 de 3 juzgadas)
estable   comprador_decidido  amarillo, amarillo, amarillo
INESTABLE consumidor_final    verde, rojo, rojo
estable   errores_modismos    amarillo, amarillo, amarillo
INESTABLE fuera_cobertura     verde, verde, amarillo
INESTABLE fuera_de_kb         verde, rojo, amarillo
INESTABLE pide_boleta_pago    amarillo, rojo, rojo
INESTABLE pide_credito        amarillo, verde, verde
INESTABLE pide_humano         verde, verde, amarillo
INESTABLE pregunton_precios   rojo, amarillo, amarillo
estable   reclama_no_recibido amarillo, amarillo, amarillo
```

## 4. Qué NO se puede concluir con esta corrida

**La caída del score (79 → 54) no es atribuible a un empeoramiento del agente.**
Con 8 de 13 personas inestables, la dispersión es del orden de la señal: la misma
configuración produce veredictos distintos entre repeticiones. Además el
instrumento cambió (juez más estricto y 3 repeticiones en vez de 1), así que la
comparación de scores mezcla dos causas.

Lo que **sí** es concluyente es el cambio de veredicto en `errores_modismos`, y no
por el score: esa persona dio **amarillo en 3 de 3 repeticiones**, es decir, es
estable, y su veredicto era verde con el juez anterior. Un cambio de estable a
estable es atribuible.

**Consecuencia para la fase de recorte del harness**: la comparación de scores
entre corridas **no puede validar** un recorte del prompt con esta dispersión. Eso
es exactamente lo que el plan anticipa al decir que, con muchas personas
inestables, la comparación no es concluyente.

## 5. Estado del entorno

- `OPENROUTER_BASE_URL=https://openrouter.ai/api` y `WA_MOCK_ENABLED=false`, tal
  como estaban. **No se modificó `.env`**: no hubo nada que restaurar.
- Las 39 conversaciones son `is_test`. El sender lanza si algo intenta enviarlas:
  no se envió nada a WhatsApp.
- Costo: 39 conversaciones reales + 39 juicios. Corrida **1 de 2** autorizadas.
- Se escribieron conversaciones y contactos de prueba en la base de **desarrollo**.
