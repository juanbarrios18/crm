# Implementation Plan: Medición confiable y contexto del agente (008)

**Branch**: `008-medicion-contexto-agente` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-medicion-contexto-agente/spec.md`

## Summary

El plan tiene dos bloques con una dependencia dura: primero se construye la
capacidad de **medir** (congelar la configuración de cada corrida y re-juzgar
offline), después se corrige **qué entra al contexto**. El agente se toca al
final.

El orden no es negociable: mientras el instrumento no sea repetible y su ruido no
esté acotado, ninguna mejora del prompt se puede atribuir.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`),
Node 20.

**Primary Dependencies**: Next.js 15 (App Router), Drizzle ORM, PostgreSQL,
Zod, Vitest. Scripts de operación con `esbuild` + `node` (patrón de
`scripts/lab-run.ts`). Sin dependencias de runtime nuevas.

**Storage**: PostgreSQL. Columnas nuevas en `agent_test_run` y una tabla nueva
`agent_test_judgment`, con migración versionada en `drizzle/`.

**Testing**: Vitest (unit) para métricas y prompts; guion E2E en `tests/e2e/`
conducido por `scripts/e2e-selftest.mjs` para el comportamiento del agente.

**Target Platform**: servidor Linux self-hosted (Docker standalone).

**Project Type**: monolito web (Next.js) con scripts de operación.

**Constraints**:
- El sandbox del Laboratorio (`is_test`) JAMÁS toca la WhatsApp Cloud API.
- La re-evaluación no debe ejecutar el pipeline del agente.
- El proveedor es OpenRouter-compatible; la captura por proxy es la técnica de
  evidencia por request ya validada en el repositorio.
- `pnpm build` corre sin base de datos y sin secretos.

**Scale/Scope**: 13 personas × 3 repeticiones = 39 casos por corrida; la
re-evaluación agrega N pasadas por caso, con N = 3 como valor por defecto.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación | Estado |
|---|---|---|
| I. Seguridad de datos primero | La captura por proxy y los registros nuevos no persisten secretos; el token del proveedor sigue viajando solo en el header y nunca se loguea. Las fuentes congeladas son configuración del negocio, no credenciales. | Pasa |
| II. Soberanía / self-hosted | No se agregan servicios externos. La re-evaluación usa el proveedor LLM ya configurado. La tabla nueva y la captura son self-hosted. | Pasa |
| III. Multi-tenancy | `agent_test_judgment` lleva `organization_id NOT NULL` y todas sus consultas pasan por `scoped()`. La instantánea vive en una tabla ya scoped. | Pasa |
| IV. Idempotencia | La re-evaluación es re-ejecutable y reanudable sin duplicar juicios. La migración es re-ejecutable. | Pasa |
| Sandbox del Laboratorio | La re-evaluación no toca el pipeline de envío; no hay ruta que pueda alcanzar la API real. | Pasa |

Sin violaciones que justificar. La sección Complexity Tracking queda vacía.

## Decisiones de diseño

### D1 — La instantánea de configuración se persiste, no se re-deriva

**Decisión**: agregar a `agent_test_run` una columna `config_snapshot` (JSONB) con
las cuatro fuentes textuales ya renderizadas (`kbText`, `behaviorText`,
`catalogText`, `zonesText`) y una columna `config_hash` con un hash de contenido.

**Rationale**: un hash prueba igualdad pero no permite reconstruir. Como el prompt
del juez se rearma desde la configuración viva, sin el texto no se puede
re-juzgar la corrida anterior después de un cambio de configuración. La
consecuencia concreta es que FR-011 a FR-015 quedarían no falsables.

**Alternativas consideradas**: (a) solo un hash — insuficiente, no reconstruye;
(b) tabla sidecar `agent_test_config_snapshot` — más normalizada pero agrega un
join sin beneficio, porque la instantánea es inmutable y se lee siempre junto a la
corrida; (c) guardar el prompt del juez completo — menos flexible, ata el registro
al formato del prompt de una versión.

### D2 — Los juicios repetidos viven en una tabla propia

**Decisión**: crear `agent_test_judgment` con `organization_id`, `run_id`,
`source_case_id`, `pass`, `status`, `veredicto`, `hallazgos`,
`judge_latency_ms` y `created_at`.

**Rationale**: la dispersión exige N observaciones del mismo par (transcript,
configuración). `agent_test_case` tiene un solo `veredicto`, y meter las pasadas
como casos extra rompería `computeScore`, que toma la mediana por persona: las
pasadas entrarían en la mediana y cambiarían el significado del score.

**Alternativas consideradas**: (a) N corridas hijas — multiplica filas y no
permite dispersión dentro de una corrida; (b) `pass_index` en `agent_test_case` —
distorsiona el score y la mediana, rechazado.

### D3 — El re-juez es un comando nuevo que reusa `judgeCase`

**Decisión**: `scripts/lab-rejudge.ts` + script `lab:rejudge` en `package.json`.
Lee los casos de la corrida origen, reconstruye las fuentes desde la instantánea y
llama a `judgeCase` (`judge.ts:142`) una vez por pasada.

**Rationale**: `judgeCase` ya está desacoplado y `compactTranscript`
(`judge.ts:123`) ya existe. El costo es un script de orquestación y persistencia,
no un rediseño. La re-evaluación se agrupa como una corrida con tipo
`rejudge` y referencia a la corrida origen, para reusar el informe existente.

**Alternativas consideradas**: (a) extender `lab-run` con un flag — mezcla dos
responsabilidades y arriesga disparar el agente por accidente; rechazado.

### D4 — Temperatura del juez fijada por entorno con default 0

**Decisión**: `OPENROUTER_JUDGE_TEMPERATURE` (default `0`) en `src/lib/env.ts` y
`.env.example`, aplicada en `judgeCase` (`judge.ts:172`, que hoy pasa solo
`{ judge: true }`).

**Rationale**: FR-007. Sin temperatura fija, dos pasadas del mismo material no son
comparables y el piso de ruido mide el muestreo del proveedor, no el juez.

**Alternativas consideradas**: fijarla en código sin variable — menos flexible
para medir sensibilidad; se prefiere la variable con default determinista.

### D5 — Presupuesto de tiempo del juez explícito

**Decisión**: `JUDGE_TIMEOUT_MS` (default `120000`) pasado a `chatJson` vía
`timeoutMs`, en lugar del default de 60 s de `callProvider`
(`src/lib/ai/index.ts:165`).

**Rationale**: FR-008. Las latencias medidas del juez llegan a 59,2 s y el abort a
60 s produjo 4 casos nulos. El presupuesto de contexto del juez excede su
presupuesto de tiempo.

**Alternativas consideradas**: reducir el prompt del juez — se evalúa como
siguiente paso si el timeout mayor no alcanza, pero primero se mide sin cambiar
dos variables a la vez.

### D6 — El piso de ruido es una métrica de primera clase

**Decisión**: `computeDisagreement` en `src/server/lab/run-metrics.ts`, que sobre
las N pasadas por caso devuelve veredictos distintos por caso, proporción de casos
inestables y piso agregado. El informe lo publica junto al score y lo usa para
marcar diferencias como ruido (FR-005, FR-010).

**Rationale**: `computeDispersion` (`judge.ts:271`) ya reporta inestabilidad
**entre repeticiones distintas**; lo que falta es inestabilidad **del mismo
material entre pasadas**, que es la que define el piso del instrumento. El
comentario de `computeDispersion` ya advierte que con personas inestables no se
pueden atribuir cambios: este plan convierte esa advertencia en un número.

### D7 — La frontera determinista se corre hacia el código

**Decisión**: ampliar `checkAgentText` (`src/server/lab/fact-check.ts:174`)
con la validación de unidades por bolsa, y `FORBIDDEN_CLAIMS`
(`fact-check.ts:66`) con `procesamos`, `agregamos`, `estamos revisando`,
`anotado`.

**Rationale**: FR-022 y FR-023. Son afirmaciones verificables por comparación
contra el catálogo y contra las capacidades del canal. Dejarlas en el juez es
poner una regla determinista detrás de un modelo con ruido medido.

### D8 — El fixture deja de ser citable

**Decisión**: `src/server/lab/personas.ts` con nombres de contacto realistas
(sin `[Prueba]`) y el runner deja de inyectar el nombre donde el agente pueda
citarlo como razón social.

**Rationale**: FR-021. El prefijo `[Prueba]` se guardó como `empresa` en la ficha
y se reinyectó en cada turno; además contamina el transcript y genera hallazgos
falsos.

### D9 — El snapshot se toma antes de tocar la configuración

**Decisión**: tarea de congelamiento de la línea base **antes** de cualquier
cambio de configuración del negocio. Se congela la corrida base con la
configuración vigente en PROD al momento de la auditoría.

**Rationale**: es la única tarea con ventana. Si se aplica la configuración antes
de congelar, la corrida base deja de ser reconstruible y el plan pierde su línea
base. Y hay una razón adicional: el seed **sobrescribe** `agentProfile`, así que
su ejecución borra la configuración con la que se corrió la línea base. Orden
obligatorio: T107 (congelar) → T501 (respaldo con `pg_dump`) → T504 (aplicar).

### D10 — El seed deja de ser destructivo por defecto

**Decisión**: `scripts/seed/business-profile.ts` no sobrescribe una configuración
existente; solo crea cuando no existe, y actualiza únicamente con `--force`. Exige
`--org=<id>` cuando hay más de una organización.

**Rationale**: el script hoy hace `.set(patch)` incondicional (`:71-79`), así que
cualquier ajuste que el dueño haga desde la UI del CRM se pierde en el próximo
seed, sin aviso. La opción elegida protege esa inversión sin resignar la
reinstalabilidad, que es la razón por la que el archivo versionado existe. Para
aplicar la corrección a PROD una vez se usa el forzado explícito, después del
respaldo.

**Alternativas consideradas**: (a) el seed manda siempre — simple, pero el dueño
no puede personalizar sin perderlo; (c) sobrescribir solo campos listados — más
complejo y deja un estado intermedio difícil de razonar.

## Project Structure

### Documentation (this feature)

```text
specs/008-medicion-contexto-agente/
├── spec.md              # this feature
├── plan.md              # this file
└── tasks.md             # estado durable
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── ai/index.ts                 # timeout y temperatura por llamada
│   ├── db/schema.ts                # columnas nuevas + agent_test_judgment
│   ├── db/tenant.ts                # scoped() (sin cambios, se usa)
│   └── env.ts                      # JUDGE_TIMEOUT_MS, OPENROUTER_JUDGE_TEMPERATURE
├── server/
│   ├── ai/
│   │   ├── prompts.ts              # reglas del juez + anotación
│   │   ├── pipeline.ts             # campos promovidos a la ficha
│   │   ├── history.ts              # sin cambios
│   │   └── handoff.ts              # escalada determinista
│   └── lab/
│       ├── runner.ts               # persiste la instantánea al arrancar
│       ├── snapshot.ts             # NUEVO: construir, hashear, cargar
│       ├── rejudge.ts              # NUEVO: re-juzgar N pasadas
│       ├── judge.ts                # temperatura explícita
│       ├── run-metrics.ts          # tasa de nulos + piso de ruido
│       ├── fact-check.ts           # unidades por bolsa + verbos
│       ├── personas.ts             # fixture realista
│       └── dialect-check.ts        # sin cambios
scripts/
├── lab-run.ts                      # informe: nulos y ruido
└── lab-rejudge.ts                  # NUEVO: comando de re-evaluación
tests/
├── unit/                           # métricas, snapshot, reglas del juez
└── e2e/                            # guion de comportamiento del agente
drizzle/
└── 00XX_*.sql                      # migración generada
```

**Structure Decision**: se mantiene el monolito y el patrón de scripts con
`esbuild` de `scripts/lab-run.ts`. La lógica de medición vive en
`src/server/lab/` (testeable con Vitest); los scripts quedan como orquestación
delgada.

## Orden de ejecución

```
Fase 1  Setup (variables, script lab:rejudge)
Fase 2  Instantánea de configuración + congelar línea base   ← ventana única
Fase 3  US1 re-juez offline
Fase 4  US2 confiabilidad y piso de ruido
Fase 5  US3 reglas del juez (re-juzgar la corrida base)
Fase 6  US4 aplicar la configuración corregida               ← corrida 1
Fase 7  US5 memoria del contacto                             ← corrida 2
Fase 8  US6 verificación determinista de hechos              ← corrida 3 (opcional)
Fase 9  US7 comportamiento del agente                        ← corrida 4
Fase 10 Verificación final y cierre                          ← corrida 5
```

Las fases 3, 4 y 5 usan re-evaluación y no consumen corridas del presupuesto.
Presupuesto total: hasta 5 corridas completas, una por fase medida. Las corridas
se ejecutan de a una, y la de la fase 8 se reasigna si sus criterios ya quedan
probados de forma determinista.

**Regla de parada**: no se avanza de fase sin que la anterior se mida sobre el
mismo material. Cada cambio de la fase 3 en adelante se reporta contra el piso de
ruido de la fase 1.

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La configuración de PROD cambia antes de congelar la línea base | Alto: se pierde la referencia | T107 (fase 2) primero, con ventana explícita y respaldo T501 antes de escribir |
| El proveedor no acredita temperatura 0 de forma estable | Medio: el piso mide ruido del proveedor | El piso se mide sobre el material real; si es alto, se documenta antes de interpretar |
| La re-evaluación juzga contra configuración vigente por error | Alto: invalida la comparación | La instantánea es obligatoria; sin ella la re-evaluación falla explícitamente (FR-001) |
| La captura por proxy no cubre la temperatura fijada | Bajo | El proxy ya existe y registra el cuerpo del request |
| Los mocks del E2E reusan identificadores y la base no está limpia | Medio | Correr el self-test sobre base recién migrada y sembrada |
| La línea base vive en PROD y el re-juez lee los casos de su propia base | Alto: sin material no hay re-evaluación | T108 importa la corrida y sus 39 casos al entorno de medición |
| `WA_MOCK_ENABLED` invertido entre Laboratorio y E2E | Alto: medición inválida sin error visible | Verificar la variable antes de cada corrida y de cada E2E |
| La base local está 2 migraciones atrás (`criteria` no existe) | Medio: el Laboratorio no arranca | T109 migra y siembra el entorno de medición |

## Verificación

1. `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
2. Re-evaluación de la corrida base: 0 turnos del agente y comparación publicada.
3. Corrida completa: 0 casos sin veredicto por tiempo.
4. Piso de ruido publicado y usado para calificar las diferencias.
5. `pnpm test:e2e` en verde sobre base limpia, con el guion nuevo.
6. Re-corrida del Laboratorio con la configuración corregida y comparación contra
   la línea base con el piso de ruido como umbral.
