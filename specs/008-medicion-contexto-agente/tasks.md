# Tasks: Medición confiable y contexto del agente (008)

Estado durable para reanudar. Se marca a medida que se completa.

**Regla de parada**: no se avanza de fase sin medir la anterior sobre el mismo
material. Toda diferencia de resultado se reporta contra el piso de ruido.

**Ventana única**: la fase 2 congela la línea base con la configuración vigente en
PROD. Ningún cambio de configuración (fase 6) puede ejecutarse antes, y ninguna
escritura en PROD (T504, T505) puede ejecutarse antes del respaldo (T501).

**Presupuesto**: hasta 5 corridas completas del Laboratorio, una por fase medida.
Reparto: corrida 1 = fase 6 (configuración), corrida 2 = fase 7 (memoria),
corrida 3 = fase 8 (hechos), corrida 4 = fase 9 (comportamiento), corrida 5 =
cierre (T903). Las pasadas de re-evaluación (fases 3 a 5) no consumen corridas
porque no ejecutan al agente.

El tope es un techo, no una meta: si los criterios de una fase se prueban de forma
determinista (tests unitarios, verificación por código), esa corrida no se gasta y
se reasigna. Cada corrida se ejecuta solo después de cerrar la anterior, para no
mezclar atribuciones.

**Disciplina de entorno (footgun)**: el Laboratorio exige `WA_MOCK_ENABLED=false`
(llamadas reales al proveedor) y el self-test E2E exige `WA_MOCK_ENABLED=true`
(mocks). Alternar mal produce mediciones inválidas sin error visible: una corrida
con mocks devuelve respuestas enlatadas y un E2E sin mocks intenta golpear la API
real. Verificar la variable antes de cada corrida y antes de cada E2E.

## Fase 1 — Setup

- [x] T001 `src/lib/env.ts`: agregar `JUDGE_TIMEOUT_MS` (default `120000`) y
      `OPENROUTER_JUDGE_TEMPERATURE` (default `0`).
- [x] T002 `package.json`: agregar el script `lab:rejudge` con el mismo patrón de
      `lab:run` (bundle con `esbuild` + `node --env-file=.env`).
- [x] T003 `.specify/feature.json`: apuntar a `specs/008-medicion-contexto-agente`.
- [x] T004 `.env.example`: documentar `JUDGE_TIMEOUT_MS` y
      `OPENROUTER_JUDGE_TEMPERATURE`. Hecho con autorización del dueño mediante un
      script: las reglas del entorno deniegan lectura/escritura de `.env.*` a las
      herramientas de archivo, así que se editó por shell.

## Fase 2 — Fundacional: instantánea de configuración (bloquea todo)

> **Ventana cerrada el 2026-09-18**: el material crudo de la línea base ya está
> preservado fuera de PROD, en `specs/008-medicion-contexto-agente/evidence/`:
> la configuración completa (`prod-config-2026-09-18.sql`, 30 INSERTs), la corrida
> (`run_ttb-run.jsonl`), sus 39 casos con transcripts (`run_ttb-cases.jsonl`) y los
> hashes de integridad (`SHA256SUMS`). T107 queda solo para adjuntar la
> instantánea vía el comando, que es trabajo de plomería: el riesgo de perder la
> referencia ya no existe.

- [x] T101 `src/lib/db/schema.ts`: en `agentTestRun` agregar `kind`
      (`run`|`rejudge`), `sourceRunId`, `configSnapshot` (JSONB) y `configHash`
      (text); agregar la tabla `agentTestJudgment` con `organizationId` NOT NULL,
      `runId`, `sourceCaseId`, `pass`, `status`, `veredicto`, `hallazgos` (JSONB),
      `judgeLatencyMs`, `createdAt` e índices por `runId`+`pass` y `sourceCaseId`.
- [x] T102 `pnpm db:generate` → `drizzle/0014_gifted_marvex.sql`. Solo agrega la
      tabla y las columnas; no toca datos existentes. `pnpm typecheck` en verde.
- [x] T103 `src/server/lab/snapshot.ts` (NUEVO): `buildSnapshot()` puro que arma
      `{ kbText, behaviorText, catalogText, zonesText }` reusando `renderKb`,
      `renderCatalog`, `renderDeliveryZones` y el armado de comportamiento que hoy
      vive en `runner.ts:138-166`; `hashSnapshot()` estable; `persistSnapshot(runId,
      snapshot)` y `loadSnapshot(runId)` con `scoped()`.
- [ ] T104 `src/server/lab/runner.ts`: persistir la instantánea al iniciar la
      corrida (`startRun`, `runner.ts:59`), antes de ejecutar el primer caso.
- [x] T105 `scripts/lab-rejudge.ts` (NUEVO): modo `--snapshot-run <id>` que
      adjunta la instantánea a una corrida existente usando la configuración
      vigente. Es el mecanismo de congelamiento de la línea base.
- [ ] T106 `tests/unit/lab-snapshot.test.ts` (NUEVO): hash estable ante el mismo
      contenido, distinto ante un cambio, y round-trip persistir/cargar.
- [x] T107 **Congelar la línea base**: ejecutar `--snapshot-run
      run_ttbdykydfvz7sfb309tk` contra PROD y guardar la evidencia (hash y
      conteo de casos). Sin esto la fase 6 no puede empezar.
- [x] T108 Importar la línea base al entorno de medición: exportar de PROD la fila
      de `agent_test_run` y sus 39 `agent_test_case` de
      `run_ttbdykydfvz7sfb309tk`, e insertarlas en la base local de medición. El
      re-juez lee los casos de su propia base, así que sin esto no tiene material.
- [x] T109 Migrar la base local de medición: `pnpm db:migrate` aplicó 0012, 0013 y
      0014. Verificado: 15 migraciones, `pipeline_stage.criteria` existe y
      `agent_test_judgment` creada.
- [ ] T111 Sembrar la configuración del negocio en la base local de medición para
      las corridas del Laboratorio (catálogo, zonas, perfil).

## Fase 3 — US1: re-evaluación offline (P1)

**Meta**: re-juzgar una corrida existente sin ejecutar el agente.
**Test independiente**: re-evaluar la línea base y confirmar 0 turnos nuevos.

- [x] T201 [US1] `src/server/lab/rejudge.ts` (NUEVO): `rejudgeRun(runId, passes)`
      que carga casos e instantánea, llama a `judgeCase` (`judge.ts:142`) una vez
      por pasada y persiste cada resultado en `agentTestJudgment`. Debe ser
      reanudable: salta las pasadas ya registradas.
- [x] T202 [US1] `scripts/lab-rejudge.ts`: modo `--run <id> [--passes N]` que crea
      la corrida de re-evaluación (tipo `rejudge`, referencia a la corrida origen),
      orquesta `rejudgeRun` e imprime el resumen.
- [x] T203 [US1] `scripts/lab-run.ts`: en el informe, mostrar corrida origen y
      re-evaluación lado a lado sobre el mismo material, con los casos sin veredicto
      visibles.
- [ ] T204 [P] [US1] `tests/unit/lab-rejudge.test.ts` (NUEVO): orquestación con
      `judgeCase` mockeado, reanudación sin duplicar y fallo explícito cuando falta
      la instantánea.
- [x] T205 [US1] Ejecutar la re-evaluación de la línea base y guardar la evidencia
      (0 turnos del agente, conteo de juicios).

## Fase 4 — US2: confiabilidad y piso de ruido (P1)

**Meta**: una corrida no pierde casos por tiempo y el ruido es un número visible.
**Test independiente**: juzgar N veces el mismo material y publicar la dispersión.

- [x] T301 [US2] `src/server/lab/judge.ts`: pasar la temperatura del juez desde
      `OPENROUTER_JUDGE_TEMPERATURE` en la llamada de `judgeCase` (`judge.ts:172`).
- [x] T302 [US2] `src/server/lab/judge.ts`: pasar `JUDGE_TIMEOUT_MS` a `chatJson`
      vía `timeoutMs` en lugar del default de `callProvider`
      (`src/lib/ai/index.ts:165`).
- [x] T303 [US2] `src/server/lab/run-metrics.ts`: `computeJudgeFailureRate()` que
      cuenta casos sin veredicto sobre el total, y sumarlo a `summarizeRun`.
- [x] T304 [US2] `src/server/lab/run-metrics.ts`: `computeDisagreement()` sobre las
      pasadas por caso: veredictos distintos por caso, proporción de casos
      inestables y piso agregado.
- [x] T305 [US2] `scripts/lab-run.ts`: publicar la tasa de casos sin veredicto y el
      piso de ruido, y marcar como indistinguible de ruido toda diferencia que no lo
      supere.
- [x] T306 [P] [US2] `tests/unit/lab-run-metrics.test.ts`: cubrir tasa de nulos,
      dispersión entre pasadas idénticas y entre pasadas divergentes.
- [x] T307 [US2] Medir el piso de ruido de la línea base con N=3 pasadas y
      publicarlo junto a la corrida.

## Fase 5 — US3: reglas del juez (P1)

**Meta**: el juez juzga contra la configuración real y contra las cuatro fuentes.
**Test independiente**: re-juzgar la línea base y ver que los falsos positivos
conocidos no se reproducen.
**Depende de**: fase 3 y fase 4 (medición y piso de ruido).

- [x] T401 [US3] `src/server/ai/prompts.ts` (`buildJudgePrompt`, `:679`): la regla
      de tono se evalúa contra la voz configurada; el texto que reproduce esa voz no
      es hallazgo.
- [x] T402 [US3] `src/server/ai/prompts.ts` (`:676`): el tema fuera de conocimiento
      solo es hallazgo si falta en conocimiento **y** comportamiento **y** catálogo
      **y** zonas.
- [x] T403 [US3] `src/server/ai/prompts.ts` (`:673`): `alucinacion` exige
      contradicción con una fuente; un rechazo de cobertura nunca lo es.
- [x] T404 [US3] `src/server/ai/prompts.ts`: la línea de handoff del transcript
      cuenta como escalado ocurrido.
- [x] T405 [US3] `src/server/ai/prompts.ts` (`:674`): una afirmación de capacidad
      no se trata como acción ya realizada.
- [x] T406 [P] [US3] `tests/unit/judge.test.ts`: cubrir las cinco reglas con los
      casos citados de la auditoría.
- [ ] T407 [US3] Re-juzgar la línea base con las reglas corregidas, comparar contra
      el piso de ruido y registrar la evidencia de SC-004 y SC-005.

## Fase 6 — US4: aplicar la configuración corregida (P2)

**Meta**: PROD pasa a la configuración ya codificada y deja de introducir
contradicciones y ausencias.
**Depende de**: fase 2 (línea base congelada). No arranca sin T107.
**Usa**: corrida 1 de 5 del presupuesto.

- [x] T501 [US4] Respaldo antes de escribir en PROD: `pg_dump` completo de la base
      (`--format=custom --compress=9`, 226 KB) verificado con `pg_restore --list`
      (24 tablas con datos), guardado en `~/vocero-backups/` y en PROD
      (`/root/`), mismo sha256 `bb9b539f…`. Tomado ANTES de cualquier escritura y
      antes del seed, así que preserva el estado pre-seed.
- [x] T502 [US4] `scripts/seed/business-profile.ts` (C3, opción B): el seed no
      sobrescribe una configuración existente; solo crea si no existe, y requiere
      un forzado explícito (`--force`) para actualizar. Exigir `--org=<id>` cuando
      hay más de una organización.
- [x] T503 [US4] `src/server/seed/business-profile.ts` (C4, opción B): ajustar el
      texto de "A QUIÉN VENDEMOS" para que la persona natural pueda comprar solo
      con retiro en planta y boleta, sin contradecir la línea de consumo doméstico
      (FR-019).
- [x] T504 [US4] Aplicar la configuración a PROD con el seed forzado y la
      organización explícita: `pnpm seed:business-profile --org=<id> --force`.
      Aplica C1 (voz), C2 (criterios de las 5 etapas) y C4. Verificar en la base
      que las 5 etapas quedaron con criterio y que la voz es consistente
      (FR-016, FR-019). Aplicado el 2026-09-19: 5/5 etapas con criterio
      (`sin_criterio=0`), voz `{tratamiento: usted, pais: Chile, largo: medio}`,
      C4 presente (retiro en planta con boleta y «NO incluye despacho»), 0
      coincidencias de voseo y `enabled=true` intacto. Ensayado antes en
      `vocero_scratch` restaurada del respaldo: texto de configuración idéntico
      (md5 `e76d030a…`).
- [x] T505 [US4] Purgar el conocimiento basura (opción A) y verificar que no
      queden mensajes internos (FR-018). Borrada la única fila
      (`kb_lnbu1z6nmn8jagm8hs67`, 365 chars, con notas internas al equipo);
      `kb_entry` queda en 0 filas.
- [ ] T506 [P] [US4] `tests/unit/prompt-stability.test.ts`: verificar que con
      criterios configurados la anotación no incluye las instrucciones (FR-017).
- [ ] T507 [US4] Correr el Laboratorio completo (corrida 1 de 5) con la
      configuración aplicada y comparar contra la línea base usando el piso de
      ruido (SC-007).

## Fase 7 — US5: memoria del contacto verificable (P2)

**Meta**: la ficha reinyectada solo lleva datos trazables.
**Depende de**: fase 4 (para medir la diferencia).
**Medición**: corrida 2 de 5.

- [ ] T601 [US5] `src/server/lab/personas.ts`: nombres de contacto realistas, sin
      el prefijo del fixture.
- [ ] T602 [US5] `src/server/lab/runner.ts`: dejar de inyectar el nombre del
      fixture donde el agente pueda citarlo como razón social.
- [ ] T603 [US5] `src/server/ai/pipeline.ts` (`appendLeadNote`, `:641-714`):
      promover un campo solo cuando es trazable a lo que el cliente declaró o a
      carga humana (FR-020).
- [ ] T604 [P] [US5] `tests/unit/`: cubrir que un campo sin respaldo no se
      promueve y que el fixture no aparece en la ficha.
- [ ] T605 [US5] Reproducir las personas afectadas y confirmar 0 ocurrencias del
      fixture (SC-006).

## Fase 8 — US6: verificación determinista de hechos (P3)

**Meta**: los hechos objetivos los verifica el código, no el juez.
**Depende de**: fase 5 (para no confundir el efecto con ruido).
**Medición**: corrida 3 de 5. No se gasta si los tests deterministas ya prueban
SC-008; en ese caso la corrida se reasigna.

- [x] T701 [US6] `src/server/lab/fact-check.ts` (`checkAgentText`, `:174`):
      validar la cantidad de unidades por bolsa contra el catálogo (FR-022).
- [x] T702 [US6] `src/server/lab/fact-check.ts` (`FORBIDDEN_CLAIMS`, `:66`):
      agregar `procesamos`, `agregamos`, `estamos revisando`, `anotado` (FR-023).
- [x] T703 [P] [US6] `tests/unit/`: cubrir la cotización con unidades cruzadas y
      cada verbo nuevo.
- [x] T704 [US6] Confirmar que los casos correspondientes se detectan sin invocar
      al juez (SC-008).

## Fase 9 — US7: comportamiento del agente (P3)

**Meta**: escalada, cierre y repetición estables.
**Depende de**: fase 5.
**Medición**: corrida 4 de 5.

- [x] T801 [US7] `src/server/ai/handoff.ts` (`matchesHandoffIntent`, `:37`):
      escalada determinista por queja y por pedido de descuento por volumen
      (FR-024).
- [x] T802 [US7] `src/server/ai/prompts.ts` (`CLOSING_FAREWELL`): cuando el motivo
      del handoff es cliente, el cierre comunica que una persona atenderá el caso
      (FR-025).
- [ ] T803 [US7] `src/server/ai/reply-guard.ts`: detector de respuesta repetida
      ante una pregunta distinta (FR-026).
- [x] T804 [US7] `src/server/ai/reply-guard.ts`: ampliar la detección de saludo
      re-pegado a variantes cortas (FR-027).
- [x] T805 [P] [US7] `tests/unit/`: cubrir escalada determinista, cierre con
      promesa, repetición y variantes de saludo.
- [ ] T806 [US7] `tests/e2e/013-*.md` + checks en `scripts/e2e-selftest.mjs` para
      los cuatro comportamientos.

## Fase 10 — Verificación y cierre

- [ ] T901 `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- [ ] T902 `pnpm test:e2e` con mocks (`WA_MOCK_ENABLED=true`) sobre una base
      limpia (`vocero_e2e` migrada y sembrada), dejarlo verde.
- [ ] T903 Corrida completa del Laboratorio (corrida 5 de 5) con todo aplicado y
      comparación final contra la línea base, con el piso de ruido como umbral.
- [ ] T904 Actualizar `specs/README.md` (tabla de estado) y `docs/` si cambia el
      flujo de medición.
- [ ] T905 Cerrar `tasks.md` con la evidencia y las correcciones nacidas de la
      verificación.

## Dependencias & Execution Order

```
Fase 1 Setup
   └─► Fase 2 Fundacional (instantánea)  ← bloquea todo
         └─► Fase 3 US1 (re-juez)  ─► Fase 4 US2 (ruido)  ─► Fase 5 US3 (reglas juez)
                                                                     │
                         ┌───────────────────────────────────────────┤
                         ▼                     ▼                     ▼
                   Fase 6 US4 (config)   Fase 7 US5 (memoria)   Fase 8 US6 (hechos)
                                                                     │
                                                                     ▼
                                                              Fase 9 US7 (agente)
                                                                     │
                                                                     ▼
                                                              Fase 10 cierre
```

- Fases 3, 4 y 5 son estrictamente secuenciales.
- Fases 6, 7 y 8 pueden solaparse una vez cerrada la fase 5, pero cada una se mide
  por separado.
- La fase 9 no depende de 6, 7 u 8, solo de la 5.
- La fase 10 no arranca sin las anteriores.

## Parallel Opportunities

- T204, T306 y T406 son tests unitarios independientes entre sí.
- T504, T604 y T703 son tests de fases distintas y pueden escribirse en paralelo
  una vez que su fase está habilitada.
- T601/T602 (fixture) y T701/T702 (fact-check) tocan archivos distintos y pueden
  desarrollarse en paralelo dentro de su fase.

## Decisiones resueltas (2026-09-18)

| # | Decisión | Resolución | Impacto en el plan |
|---|---|---|---|
| C1 | Voz y registro del negocio | Ya codificada en `src/server/seed/business-profile.ts:39-86`; PROD conserva la versión vieja porque el seed no se re-corrió | Pasa de decisión a ejecución (T504) |
| C2 | Criterio de entrada por etapa | Ya codificada en `LAMAS_FOODS_STAGE_CRITERIA` (`:93-104`) | Pasa de decisión a ejecución (T504) |
| C3 | Qué manda un re-seed | **Opción B**: no sobrescribir si la configuración ya existe; solo con forzado explícito | Código nuevo (T502) + uso forzado puntual (T504) |
| C4 | Modalidad de venta a persona natural | **Opción B**: puede comprar solo con retiro en planta y boleta | Edición del texto del seed (T503) |
| KB | Qué conocimiento cargar | **Opción A**: purgar y reevaluar más adelante | T505 |

Autorizaciones concedidas por el dueño:

- Acceso a PROD por `ssh vocero`, en lectura y escritura.
- Escritura en PROD permitida, **con respaldo previo obligatorio** (T501).
- Presupuesto: **hasta 5 corridas completas del Laboratorio**, una por fase
  medida. Las pasadas de re-evaluación no cuentan como corrida.

Fuera de decisión: la tabla de auditoría por request (`llm_call`) queda fuera de
alcance; la evidencia por request se obtiene con la captura por proxy.

## Resultados de la primera medición (2026-09-19)

Base: `vocero_baseline` (réplica de PROD). Comando:
`DATABASE_URL=<baseline> pnpm lab:rejudge --run run_ttbdykydfvz7sfb309tk --passes 3`
(117 juicios, ~25 min con concurrencia 4).

### Sólido

- **`judge_failed` 4/39 (10.3%) → 0/39 en las 3 pasadas.** El timeout del juez
  era la causa; con `JUDGE_TIMEOUT_MS=120000` no queda ningún caso sin veredicto.
  **SC-001 cumplido.**
- **Piso de ruido: 23.1 %** (9 de 39 casos cambian de veredicto entre pasadas del
  MISMO transcript, con temperatura 0). Ninguna diferencia de score por debajo de
  eso es un resultado. **SC-003 con número.**
- Veredictos por pasada: p1 20 verde / 5 amarillo / 14 rojo · p2 23/5/11 · p3
  24/2/13. El baseline tenía 7/16/12.

### Contaminado — no usar como ablación limpia

La re-evaluación arrancó con las reglas viejas y **se reinició a mitad** con las
nuevas (corrección de concurrencia): 6 de 117 juicios usaron las reglas viejas.
Además:

- La instantánea usada es la **vieja**, capturada antes de agregar el saludo al
  comportamiento. El arreglo del saludo (T401) **no llegó a aplicarse**: el juez
  siguió sin ver el saludo configurado.
- El baseline son 39 observaciones únicas; la re-evaluación, 39×3. Los conteos
  crudos no son comparables sin normalizar por caso.

Lectura indicativa (hallazgos por caso), **no confirmatoria**:

| tipo | baseline /caso | re-juez /caso | lectura |
|---|---|---|---|
| `tono` | 0.64 | 0.17 | mejora fuerte |
| `fuera_de_kb` | 0.15 | 0.06 | mejora |
| `alucinacion` | 0.18 | 0.17 | sin cambio |
| `afirmacion_sin_evidencia` | 0.13 | 0.17 | sin mejora |
| `debio_escalar` | 0.13 | 0.17 | sin mejora |

`pipeline` 10 → 0 es por diseño: el re-juez no aplica los chequeos deterministas.

### Observación sobre el instrumento

**Los 39 casos produjeron al menos un hallazgo en las 3 pasadas.** Un juez que
nunca dice "sin problemas" es sospechoso de sobre-reportar. Vale investigarlo
antes de confiar en el score.

## Progreso

- 2026-09-18: spec.md + plan.md + tasks.md escritos a partir de las auditorías de
  la corrida `run_ttbdykydfvz7sfb309tk`.
- 2026-09-18: bloqueos resueltos. El dueño concedió acceso y escritura a PROD con
  respaldo previo, autorizó un tope de 5 corridas e instruyó C3 opción B, C4
  opción B y purga del conocimiento. Se corrigió la clasificación: C1 y C2 no eran
  decisiones abiertas sino ejecución del seed ya codificado.
- 2026-09-18 (ejecución): verificado el entorno (SSH a PROD operativo, PostgreSQL
  local en `vocero-dev-postgres-1`, token de OpenRouter presente, modelos locales
  idénticos a PROD, Playwright instalado, RDD apagado). Detectados y agregados al
  plan tres huecos: la base local está migraciones atrás, la línea base vive en
  PROD y el E2E necesita base limpia y mocks encendidos (T108, T109, T110 y la
  disciplina de `WA_MOCK_ENABLED`). **Línea base preservada** en `evidence/`.
  Fase 1 completa y T101/T102 hechos; `pnpm typecheck` en verde.
- 2026-09-18 (ejecución, continuación): **corrección importante**: PROD NO está
  desactualizado (14 migraciones, coincide con el código deployado). La que estaba
  atrás era la base local, ya migrada (T109). Respaldo completo de PROD tomado y
  verificado antes de cualquier escritura (T501), guardado en dos ubicaciones.
  T004 hecho con autorización del dueño.
- 2026-09-19 (madrugada, primer bloque): fases 1 a 5 ejecutadas. Instantánea +
  re-juez + métricas + reglas del juez. Primeros resultados reales: `judge_failed`
  a 0 y piso de ruido de 23,1 % (ver sección de resultados).
- 2026-09-19 (segundo bloque): fases 8 y 9 implementadas con tests (verificación
  determinista de unidades por bolsa y de los verbos de acción; escalada por
  queja y por descuento; cierre de handoff con promesa explícita; saludo
  re-pegado por fórmula). Código de la fase 6 (seed no destructivo + texto de
  C4). 499 tests y typecheck en verde. **No se ejecutó la escritura a PROD.**
- Hallazgo de implementación: T804, tal como lo pedía la auditoría (vetar
  variantes de saludo), **contradecía una lección medida** en PROD
  (`run_pk41`): vetar cualquier "Hola" rechazaba respuestas correctas. Se
  implementó quirúrgico: solo la FÓRMULA ("le saluda", "somos el equipo").
- T803 (detector de respuesta repetida) queda **diferido**: necesita llevar la
  respuesta anterior del agente al contexto del guard, que hoy no la recibe.
- **Próximo, en sesión limpia**: T407 (ablación limpia de las reglas, con la
  instantánea nueva que incluye el saludo) es lo primero, porque el resultado
  actual está contaminado. Después T111 (sembrar la base local con la config
  nueva), fases 6 a 9 y cierre. Conviene revisar con el dueño antes de la fase 6.
- 2026-09-19 (fase 6, escritura a PROD): T504 y T505 ejecutados con autorización
  del dueño. Ensayo previo en `vocero_scratch` (restaurada del respaldo) y luego
  aplicación a PROD por túnel SSH, sin exponer credenciales. Verificación por
  huella de fila (md5 de `t::text` agregado) antes/después: **solo cambiaron
  `agent_profile`, `pipeline_stage` y `kb_entry`**; las otras 20 tablas quedaron
  idénticas. Etapas con criterio 5/5, voz en usted, C4 coherente, `kb_entry` en 0.
  T507 (corrida 1 de 5) sigue pendiente.
- 2026-09-19 (piso de ruido): reproducido el piso publicado sobre
  `run_ttbdykydfvz7sfb309tk` y descompuesto por causa. La métrica ya no cuenta
  `judge_failed` como desacuerdo (antes 1 de las 6 inestabilidades era un timeout,
  no una discrepancia del juez). Correcciones de rúbrica sobre casos reales
  (verificación de listas contra la fuente, negación ≠ `afirmacion_sin_evidencia`,
  declinar no exime de escalar, precedencia entre tipos) y `JUDGE_TIMEOUT_MS` a
  240 s. Ronda 1: piso **10,3 % (4/39)** y **0 fallos** (antes 12,8 % con la
  métrica corregida y 1/117). **Hallazgo central**: la amplitud del score entre
  pasadas seguía en 7 puntos porque la mediana por persona cuantiza; se cambió a
  media (`FR-033`), se agregó `agent_test_case.puntos` (media de las pasadas) y
  `LAB_JUDGE_PASSES=2` en el runner. Amplitud medida con el nuevo estimador:
  **2 puntos**. Evidencia completa en `evidence/piso-ruido-2026-09-19.md`.
  Pendiente: confirmar la amplitud ≤ 2 en una corrida del Laboratorio en vivo y
  re-anotar los scores históricos (la media cambia el valor publicado).
