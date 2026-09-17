# Plan de corrección y atribución — regresiones del chat tras el PR #22

> **Para quién**: una sesión con contexto limpio que va a ejecutar. Insumos:
> `docs/auditoria-regresiones-pr22.md` + su Anexo A (medición independiente) y
> `docs/bitacora-mejoras-llm.md` (evidencia por fase).
>
> **Estado**: `origin/main` en `81c0569` (PR #22 mergeado). Decisión tomada:
> **no revertir el merge**; corregir y atribuir de a un cambio por vez, con una
> corrida del Laboratorio por fase. Es la Opción C del doc de auditoría,
> ejecutada con el protocolo de su Sección 8.
>
> **Por qué no revertir**: F2 (latencia), F3 (seguridad), F7 (instrumento), F8
> (tono) y F9 (calidad) son ganancias medidas y se conservan. El daño (caché y
> conducta) se ataca de forma aislada y medible.
>
> Las fases con decisión de producto pendiente están marcadas **D1**, **D2** y
> **D3** (cierre del documento).

---

## 1. Objetivo y criterios de éxito

Recuperar la eficiencia (caché/tokens) y la fidelidad conversacional, con
atribución: cada cambio se prueba solo y se decide con su corrida.

| Criterio | Hoy (final) | Baseline | Meta |
|---|---|---|---|
| % de tokens cacheados | 12,1 % | 34,0 % | **≥30 %** |
| Tokens facturados por turno | 4.007 | 2.065 | **≤3.200** |
| `afirmacion_sin_evidencia` | 12 | 5 | **≤6 en dos corridas** |
| `debio_escalar` | 10 | 6 | **≤6** |
| `alucinacion` | 5 | 4 | **≤4** |
| `tono` | 11 | 30 | **≤5** (meta original) |
| Latencia de turno | 794 ms | 1.328 ms | **≤1.000 ms** |

La meta de tokens NO es volver a 2.065: la segunda llamada (anotación) es
legítima. La meta es eliminar la fuga de caché (≈1.000 tokens/turno) y no crecer
más.

## 2. Lo que NO se toca

- **F2** (anotación en paralelo): latencia 1.328 → 794 ms.
- **F3** (marcadores de saliente humano): correcto y de seguridad.
- **F7** (veredicto derivado): instrumento más consistente.
- **F8** (registro del negocio): tono 30 → 11. Solo se corrige la voz del cierre
  (P3).
- **F9** (vocabulario del catálogo): calidad medida (productoInteres/formato
  +3 a +19 pp).

## 3. Protocolo de medición (la parte que faltó la vez anterior)

1. **Un cambio por corrida.** Nunca dos que toquen voz o prefijo en el mismo paso.
2. **Corrida completa**: 39 casos (13 personas × 3), con `pnpm lab:run`.
   Modelos congelados: `google/gemini-2.5-flash-lite` + juez
   `z-ai/glm-5.3-flash`. Temperatura congelada en 0,3, salvo la fase que la
   pruebe (P5). `pnpm lab:check` valida el arranque sin gastar una corrida.
3. **Datos congelados**: `agent_profile`, KB, catálogo y zonas no se tocan
   durante el plan. Un cambio de datos invalida todas las comparaciones.
4. **Métricas obligatorias** por corrida: `promptTokens`, `cachedTokens` y su
   resta (facturados) por turno; latencia; hallazgos por tipo Y por persona;
   `judge_failed`. SQL en el Anexo A del doc de auditoría.
5. **La vara es la conversación, no solo el juez**: antes de tocar código, elegir
   5–10 conversaciones de referencia de la corrida actual y anotarlas a mano
   (saludo, registro, trato, afirmaciones imposibles, uso del nombre) — P0.
6. **Ruido**: el juez es inestable (8 de 13 personas varían entre repeticiones de
   la misma corrida). Si un resultado no se distingue del ruido, correr UNA
   repetición adicional antes de decidir; leer por persona (pareado) antes que
   por agregado.
7. **Una rama, uno o pocos commits atómicos y una PR pequeña por fase.** La
   corrida se hace sobre la rama, antes de abrir la PR; el resultado va en el
   cuerpo de la PR. Lección del #22: nada de "7 cambios juntos".
8. **Rollback por fase**: `git revert` del commit si no cumple el criterio.
9. **Gate técnico por PR**: `pnpm typecheck && pnpm lint && pnpm build && pnpm
   test`; E2E (`pnpm test:e2e`, sobre base recién migrada y sembrada) para fases
   que toquen comportamiento.

Base de cada rama: `git fetch origin && git switch -c <rama> origin/main` (el
`main` local del checkout puede estar atrasado).

Presupuesto: cada corrida ≈10 min y ≈0,6 M tokens de prompt. Total estimado:
6–9 corridas.

## 4. Fases

### P0 — La vara (sin código, sin corrida)

- Elegir 5–10 conversaciones de referencia de `run_uzw4zmt4fyg09sczm7lg`
  (incluir `pide_boleta_pago`, `cliente_recurrente`, `cliente_enojado`,
  `pregunton_precios`).
- Escribirlas con su checklist en `docs/bitacora-correccion-regresiones.md`
  (se crea con la primera fase).
- Salida: los criterios con los que se juzga cada fase, sin mirar el score del
  juez.

### P1 — Línea de tiempo fuera del prefijo cacheable (PRIORIDAD MÁXIMA)

- **Hipótesis**: `renderTemporalContext` (`prompts.ts:255`) se renderiza dentro
  de `buildAgentSystemPrompt` (`prompts.ts:444`) y cambia cada minuto: rompe el
  prefijo en cada turno y el historial deja de viajar en la caché. Evidencia:
  aciertos ~2.960 → ~1.970; dejaron de crecer con la profundidad del turno;
  facturados +1.942/turno.
- **Cambio**: sacarla del system prompt y enviarla como mensaje `system` final
  DESPUÉS del historial (`pipeline.ts:280-295`), manteniendo la precisión al
  minuto. Alternativas si el proveedor no coopera: (a) adjuntarla al último
  mensaje del cliente; (b) variante fecha-sola (sin hora).
- **Archivos**: `src/server/ai/prompts.ts`, `src/server/ai/pipeline.ts`, tests
  de prompt que correspondan.
- **Medición**: caché %, facturados/turno, hallazgos, latencia.
- **Éxito**: caché ≥30 % y facturados ≤3.200, sin empeorar hallazgos.
- **Si no cumple**: probar la variante fecha-sola; si tampoco, investigar la
  caché del proveedor (TTL/enrutamiento) antes de seguir. Tope: 2 corridas.

### P2 — Atribuir el orden del prompt (F6)

- **Hipótesis**: con las reglas fijas fuera del final (F6, `dd7497d`), las reglas
  duras perdieron peso y subieron `afirmacion_sin_evidencia` (5 → 12) y
  `debio_escalar` (6 → 10). No está probado.
- **Cambio**: revertir SOLO el orden (`git revert dd7497d`, con resolución manual
  si choca con F9): las reglas fijas vuelven después de etapa y ficha. Con P1 ya
  aplicado, el orden original no reintroduce el problema de caché, pero se mide
  igual.
- **Medición**: hallazgos graves por persona (foco: boleta, recurrente, enojado),
  caché (confirmar ≥30 %), vara de P0.
- **Éxito**: la suma de graves (`afirmacion_sin_evidencia` + `debio_escalar` +
  `alucinacion`) ≤15 en dos corridas consecutivas (hoy: 27; baseline: 15), o
  evidencia de que el orden NO es la causa. El resultado, positivo o negativo,
  se documenta igual: es la atribución que el dueño pidió.
- **Rollback**: revertir el revert (restaurar F6) si no hay diferencia o si
  empeora. Tope: 2 corridas.

### P3 — Voz del cierre (los 11 `tono` restantes) — **D1**

- **Problema**: `CIERRE_DE_CONVERSACION` (`prompts.ts:346`) pide un cierre tipo
  "quedamos a la orden" y el prompt del juez lista "quedamos a su disposición"
  como fórmula de call center (`prompts.ts:566`). El modelo parafrasea dentro de
  la lista negra. Es la causa #1 de los `tono` restantes.
- **Cambio**: reescribir la regla de cierre y `CLOSING_FAREWELL` (`prompts.ts:43`)
  con un cierre natural. No se toca la lista negra del juez (es la definición de
  producto).
- **D1**: el dueño elige la voz del cierre entre 2–3 propuestas (o prohíbe
  fórmulas explícitamente).
- **Medición**: `tono` ≤5 y revisión de cierres en la vara.
- **Éxito**: `tono` ≤5 sin nuevos hallazgos en otras categorías.

### P4 — Trato con el nombre ("Don Juan")

- **Evidencia**: el agente saluda usando el `Nombre` de la ficha (caso real:
  `"Hola, [Prueba] Preguntón de precios."`). El corpus no puede reproducir "Don"
  porque los nombres son placeholders.
- **Cambio A (corpus)**: nombres realistas en `src/server/lab/personas.ts`
  (`contactName`: "Juan Pérez", "María González", …) para poder medir el trato.
- **Cambio B (prompt)**: regla de trato en N2 o FORMATO: no anteponer títulos
  (Don/Doña/Estimado) ni repetir el nombre en cada mensaje; usarlo con
  naturalidad.
- **D2**: el dueño define la política (recomendado: una vez al inicio, no
  siempre).
- **Medición**: ocurrencias de `don|señor|estimado` en transcripts (SQL ILIKE),
  `tono`, vara de P0. El cambio de corpus invalida comparaciones hacia atrás para
  el trato: la fase mide dentro de sí misma (corrida con nombres y regla vs
  corrida con nombres sin regla).
- **Éxito**: cero tratamientos con título en las referencias, sin subir `tono`.
  Tope: 2 corridas.

### P5 — Temperatura por rol (opcional, diferida)

- **Hipótesis**: la temperatura 0,3 alcanza conversación, anotación y juez
  (`env.ts:51`); en conversación empuja al registro estereotipado, en el juez
  aporta determinismo (deseable).
- **Cambio**: temperatura separada por rol (variables nuevas), conversación en el
  default del modelo; anotación y juez siguen en 0,3.
- **Medición**: vara de P0 + `tono` + afirmaciones. Más temperatura = más ruido:
  exige repeticiones extra.
- **D3**: si se persigue. Se decide después de P1–P3.

### P6 — Duplicación de instrucciones en la anotación (opcional, diferida)

- Las instrucciones del negocio (~921 tokens) viajan en las dos llamadas. El
  recorte total está refutado por medición (mueve la etapa en 17/39); la opción
  es una versión **comprimida** para anotación (solo el proceso comercial),
  medida con el arnés de F9 (comparación por campo sobre 129 turnos + estabilidad
  de etapa contra el piso de ruido de 10–12/39).
- Es el mayor ahorro restante (~20 % del system por turno) y el de mayor riesgo.
- **D3**: se decide con el dueño después de P1–P3.

## 5. Orden y presupuesto

P0 → P1 (1–2 corridas) → P2 (1–2 corridas) → P3 (1 corrida) → P4 (2 corridas)
→ decidir P5/P6.

Total estimado: 6–9 corridas de ~10 min.

## 6. Riesgos

- **Ruido del instrumento**: mitigado con las reglas 5 y 6 del protocolo.
- **La caché puede ser del proveedor**: si P1 no la recupera, la causa no está en
  el código y la decisión pasa a ser de arquitectura (prefijo explícito, reducir
  tokens por otra vía). La medición deja el hecho asentado igual.
- **Datos de la base de desarrollo**: congelarlos (regla 3).
- **Convertir esto en otro PR grande**: prohibido; una rama y una PR por fase.
- **E2E no idempotente**: correr sobre base recién migrada y sembrada.

## 7. Decisiones del dueño

- **D1 (P3)**: voz del cierre.
- **D2 (P4)**: política de trato con el nombre.
- **D3 (P5/P6)**: si se persiguen las fases opcionales.

D1 y D2 se necesitan al llegar a su fase; D3, después de P3.
