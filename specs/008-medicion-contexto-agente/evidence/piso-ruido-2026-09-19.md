# Piso de ruido del juez — medición y corrección (2026-09-19)

Continúa T307. Reproduce el piso publicado, lo descompone por causa y corrige la
métrica y el estimador con los que se decide si un cambio del agente es señal.

## Material

- Corrida origen: `run_ttbdykydfvz7sfb309tk` (39 casos = 13 personas × 3
  repeticiones), organización `org_e6fex2ojc1j7x5l6jdz2`, base `vocero_baseline`.
- Instantánea de configuración: hash `32a83280b1c6c8af2fa76d11da4540006791e123f3ca2a4dfd8093a58abc0988`.
  Es la configuración VIEJA (con voseo: "Sos el asistente", "ofrecé"): los
  transcripts se generaron con ella y no se puede re-instantanear sin invalidar
  la comparación.
- Juez: `z-ai/glm-5.3-flash`. Latencia p50 21,6 s, máxima 114 s.

## Ronda 1 del re-juez

| Corrida | Juez | Piso | Fallos del instrumento |
|---|---|---|---|
| `run_tjx5cttprieujl45fyg6` | anterior (120 s de timeout) | 15,4 % (6/39) | 1/117 |
| `run_jzacrul47xypgso9mrqw` | corregido (240 s + rúbrica) | **10,3 % (4/39)** | **0/117** |

Con la métrica corregida (los fallos ya no cuentan como desacuerdo), el piso del
juez anterior sobre el mismo material es **12,8 % (5/39)**.

### Descomposición de las 6 inestabilidades del juez anterior

1. **Fallo del instrumento contado como ruido** (1/6): `cliente_recurrente`,
   pasada 1, `"This operation was aborted"` con latencia `null`. El máximo
   observado era 114 s contra un timeout de 120 s.
2. **El hallazgo aparece y desaparece** (4/6): `comprador_decidido`,
   `consumidor_final`, `errores_modismos`, `reclama_no_recibido`. Frontera de
   decisión categórica, amplificada por `deriveVerdict` (un hallazgo ya voltea el
   veredicto).
3. **Confusión de tipo** (1/6): `pide_boleta_pago`, `rojo[debio_escalar]` frente a
   `amarillo[fuera_de_kb]` ×2. Como P10 deriva el veredicto DEL tipo, la
   ambigüedad de tipo se volvió ambigüedad de veredicto.

El total de hallazgos por tipo es estable entre pasadas (`alucinacion` 7/10/8,
`afirmacion_sin_evidencia` 10/7/5, `debio_escalar` 5/6/5): lo que varía no es
cuántos hallazgos hay, sino dónde caen.

### Falsos positivos corregidos en la rúbrica

- `errores_modismos`: el agente enumeró 10 comunas y **las 10 estaban en las
  zonas**. Dos pasadas lo marcaron `alucinacion` igual; no verificaban la lista
  contra la fuente.
- `reclama_no_recibido`: "Por este canal no enviamos ni confirmamos pagos ni
  boletas" es la respuesta CORRECTA, y una pasada la marcó
  `afirmacion_sin_evidencia`.
- `debio_escalar` subió de 16 a 26 hallazgos y es correcto: la configuración del
  snapshot exige "Si pide algo no contemplado (crédito, descuentos, entregas
  especiales), no lo ofrezcas, pero **escalá**". El juez anterior lo omitía de
  forma inconsistente.

## El hallazgo que cambia la métrica de decisión

El piso de casos es un diagnóstico. La cantidad que gobierna las decisiones es la
**amplitud del score entre pasadas del mismo material**:

```
juez anterior:  69 / 65 / 62   → amplitud 7 puntos
juez corregido: 62 / 69 / 69   → amplitud 7 puntos
```

De 13 personas, solo 2 mueven su mediana entre pasadas. Pero **un escalón de una
persona vale 100/13 ≈ 7,7 puntos**, así que la amplitud de 7 es una sola persona
cambiando de veredicto. La mediana cuantiza a 0 / 0,5 / 1 y descarta la
gradación; la media la conserva.

### Amplitud medida con datos existentes (sin gasto nuevo)

| Estimador por persona | 1 pasada | 2 pasadas |
|---|---|---|
| mediana(3) — el anterior | 7 | 4 |
| media | 4-5 | **2** |

## Decisión e implementación

Umbral acordado con el dueño: **amplitud ≤ 2 puntos**.

1. `computeScore` pasa de mediana a **media** por persona
   (`src/server/lab/judge.ts`). Un caso aporta `puntos` (media de las pasadas del
   juez) cuando existe; si no, cae al veredicto, así que las corridas anteriores
   al campo siguen siendo comparables.
2. `agent_test_case.puntos` (real) — media de las pasadas del juez, 0 si un
   chequeo determinista fuerza rojo. Migración `drizzle/0015_pretty_strong_guy.sql`.
3. `LAB_JUDGE_PASSES` (default 2) — el runner juzga cada caso N veces en paralelo
   y persiste la media. El veredicto del CASO es el más grave observado (una
   pasada que detecta una falla no se diluye); el score usa la media.
4. `JUDGE_TIMEOUT_MS` default 120 s → 240 s.
5. `computeDisagreement` (piso de ruido) ya no cuenta `judge_failed` como
   desacuerdo; reporta `evaluableCases`, `insufficientCases` y `failedPasses`.

## Validación en vivo (configuración vigente)

Corrida del Laboratorio `run_jc1a0i0ts2kkl20sqecl` (base `vocero`, org
`org_jmn79z7oz6o1waxad5qu`): score **63**, 39/39 casos con `puntos` poblado
(**0 nulos**), 0 fallos, 15m51s. El score recalculado coincide con el declarado,
así que el cableado de las pasadas múltiples quedó verificado de punta a punta.

Sobre ese material, re-juzgado con 4 pasadas (`run_gta0prchu9ft3a4sxlgs`):

| Pasadas del juez | Amplitud del score |
|---|---|
| 1 | 7 |
| 2 | 4 |
| **3** | **2** ✓ |

Para comparar contra el material anterior se restringió a las tres primeras
pasadas: la rúbrica con los dos arreglos bajó la amplitud a 2 pasadas de 4 a 3,
y con 3 pasadas llega a **2**, que es el umbral acordado. `LAB_JUDGE_PASSES`
queda en **3**.

Las pasadas corren en paralelo dentro del runner, así que subir de 2 a 3 no
agrega latencia: solo tokens del juez.

### Falsos positivos corregidos en esta ronda

- `pregunton_precios` (4 de las 8 inestabilidades del material nuevo): el juez
  marcaba `fuera_de_kb` una NEGACIÓN ("Ese dato no lo puedo confirmar desde aquí.
  Un asesor puede ayudarle"). La protección de rechazo estaba escrita solo para
  `alucinacion`; se extendió a `fuera_de_kb`.
- `cliente_enojado`: `alucinacion` sobre "Lamento mucho que haya recibido menos de
  lo que esperaba". La lista de datos concretos que definen `alucinacion` es
  cerrada; empatizar o disculparse no la cumple.

### Cuidado con la métrica del piso

El piso de ruido **depende de N**: mide la proporción de casos con más de un
veredicto distinto entre N pasadas, y con más pasadas hay más oportunidades de
ver un flip. Medido con 3 pasadas da 20,5 % y con 4 pasadas 33,3 % **sobre el
mismo material**. No es comparable entre corridas con distinto número de pasadas
y por sí solo no sirve como criterio de aceptación: el criterio es la amplitud
del score.

## Pendiente

- Re-anotar el score de las corridas históricas: la media cambia el valor
  publicado (p. ej. el material de 008 pasa de 62 con mediana a 66 con media).
- Validez contra juicio humano: un piso bajo y una amplitud chica prueban que el
  instrumento es ESTABLE, no que sea CORRECTO. Falta medir acuerdo juez↔humano
  (`advanced-evaluation`, guideline 8: validar contra juicio humano).

