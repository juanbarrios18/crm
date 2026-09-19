# Tarea: adherencia del agente — nombre, precios y calificación

## Objetivo

Corregir los tres fallos observados en la conversación de prueba del dueño de
Lamas Foods en PROD (`cv_4lerw6h818y1bqm2xqjb`, 2026-09-19 14:08–14:55 UTC):
el agente repite el nombre del cliente en casi cada mensaje, vuelca precios por
formato en vez de acotar la conversación, y no califica al lead de forma
proactiva.

## Problema

Los fallos NO son reglas ausentes: la regla del nombre (`prompts.ts:457`) y la
de precios (`prompts.ts:458`) ya estaban desplegadas — verificado por grep en el
bundle de PROD `/app/.next/server/chunks/1802.js` — y el modelo las incumplió.
Nada determinista las fuerza: `reply-guard.ts` cubre `saludo_repetido`,
`respuesta_repetida` y las reglas comerciales, pero no el nombre.

Causa contribuyente del nombre repetido: la ficha del cliente, con
`- Nombre: <nombre>`, viaja pegada al último mensaje del cliente en CADA turno
(`renderTurnState` → `renderClientFile`), lo que mantiene el nombre con alta
saliencia en cada vuelta.

## Por qué

El dueño pidió extraer la conversación y aplicar el fix; el requisito es "el
nombre una sola vez, no en cada vuelta". Un control probabilístico (solo
prompt) no puede garantizar un "nunca". El guard determinista es agnóstico al
modelo (PROD corre `google/gemini-2.5-flash-lite`).

## Alcance autorizado

- Repositorio local, sin tocar PROD, sin SSH, sin corridas pagadas del
  Laboratorio.
- `src/server/ai/reply-guard.ts`, `src/server/ai/pipeline.ts`,
  `src/server/ai/prompts.ts`, `src/server/inbox/ingest.ts`,
  `src/lib/voice-register.ts` y sus tests.
- La política de precios se aplica al prompt UNIVERSAL (todos los negocios), no
  solo a la config de Lamas Foods.

Fuera de alcance: cambiar el modelo del agente, transcripción de audio (STT),
tocar la config del negocio en la base, corridas del Laboratorio.

## Restricciones

- TDD por unidad: RED → GREEN → REFACTOR. Sin tests no se cierra una unidad.
- Gate: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- Registro: español neutro profesional en código, comentarios y docs. Voseo
  rioplatense PROHIBIDO (lo vigila `tests/unit/voice-register.test.ts`).
- El texto de negocio chileno ("usted") se cita, no se reescribe.
- Commits convencionales por unidad de trabajo, sin atribución de IA.
- Regla de atribución: no cambiar a la vez guard, prompt y config en la misma
  unidad; una unidad = un archivo o un eje.

## Checklist

- [x] T001 — Guard determinista del nombre (RED→GREEN).
      `reply-guard.ts`: nueva violación `nombre_repetido`, `GuardContext.contactName`,
      detector `isRepeatedName` + `stripContactName`; `pipeline.ts` pasa
      `contactName` desde la ficha. Test en `tests/unit/agent-reply-guard.test.ts`.
- [x] T002 — Registro del aviso de adjuntos bloqueados.
      `ingest.ts`: "Enviame" → "Envíeme" (usted). `voice-register.ts`: agregar
      `enviame` a `VOSEO_LEXEMES` para cerrar el hueco del guardián.
- [x] T003 — Prompt: nombre operable, política de precios y calificación.
      `prompts.ts`: refrasear la regla del nombre a forma local/operable; reescribir
      la regla de precios (familias primero, acotar, cotizar solo la opción elegida);
      agregar calificación proactiva de los datos que falten.
- [x] T004 — Verificación: gate técnico completo; E2E si la base está limpia.

## Diseño del guard del nombre (T001)

Regla: el nombre del contacto aparece COMO MÁXIMO UNA VEZ en los salientes del
agente de toda la conversación.

Detección (`isRepeatedName(reply, context)`):

- Sin `contactName` → `false`.
- Token de detección: el primer token del nombre normalizado (el modelo usó
  "Roberto", no el nombre completo). Se exige largo ≥ 4 para evitar falsos
  positivos con palabras cortas.
- Comparación por token completo sobre `normalizeLoose` (minúsculas, sin tildes,
  puntuación colapsada): nunca por substring.
- Dispara SOLO si el nombre ya apareció en algún `previousAgentReplies`. La
  primera mención nunca se veta.
- `contactName` de un solo token de largo < 4 → no se evalúa (conservador).

Resolución:

- La violación se incluye en la corrección (`describeViolation`) para que el
  reintento del modelo no repita el nombre.
- Respaldo determinista `stripContactName(reply, contactName)`: si tras la
  corrección el nombre persiste, se elimina la ocurrencia del nombre con su
  puntuación adyacente y se limpia el espaciado/puntuación huérfana. Se conserva
  el contenido: NO se usa `SAFE_FALLBACK_REPLY` (lección de `run_pk41`: el
  fallback genérico borró contenido válido y el juez lo marcó grave).

Criterios de aceptación del guard:

- Segunda mención → vetada; si el modelo no corrige, se entrega sin el nombre y
  sin perder el resto del mensaje.
- Primera mención → nunca vetada.
- Sin nombre en la ficha → el guard no cambia nada.
- Cero falsos positivos en los casos ya cubiertos por la suite existente.

## Criterios de aceptación

- El nombre del contacto no aparece más de una vez en los salientes del agente;
  hay test que reproduce el caso de PROD (msg2 "Hola, Roberto" permitido; msg4,
  msg8 y msg10 vetados y entregados sin el nombre).
- El aviso de adjuntos bloqueados no tiene voseo y el guardián lo cazaría si
  volviera.
- La regla de precios prohíbe listar varios formatos con precio de una vez y
  exige acotar antes de cotizar.
- La calificación proactiva pide los datos que falten (negocio, comuna, volumen
  semanal, frecuencia) sin volverse formulario.
- Gate técnico verde sin regresión de casos ya verdes.

## Checks aplicables

`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`; E2E con `pnpm dev` +
mocks si la base está limpia. Sin corridas del Laboratorio.

## Progreso

- 2026-09-19: documento creado. Reconocimiento hecho: `reply-guard.ts` (GuardContext,
  `guardReply`, `resolveUncorrectedReply`), `pipeline.ts:455-512` (sitio de
  invocación y contexto), `prompts.ts:453-461` (ESTILO_DE_LOS_MENSAJES),
  `ingest.ts:66` (aviso con voseo), `voice-register.ts` (lista de lexemas sin
  "enviame"). Evidencia de PROD: bundle contiene las dos reglas; el modelo las
  incumplió.
- 2026-09-19: T001 implementado (commit `55ebcc6`). RED observado: 12 tests
  fallando por `isRepeatedName`/`stripContactName` inexistentes y por
  `resolveUncorrectedReply` devolviendo el fallback genérico. GREEN: 46 tests de
  guard en verde. `resolveUncorrectedReply` recibe `guardContext` para strippear
  el nombre sin perder el contenido.
- 2026-09-19: T002 implementado (commit `83ca6e5`). RED observado: el guardián
  marca `src/server/inbox/ingest.ts:66 → Enviame` tras agregar el lexema. GREEN:
  `voice-register` y `dialect-check` en verde.
- 2026-09-19: T003 implementado (commit `63aca7e`). El presupuesto F4 (≤ 8.500
  caracteres para el perfil Lamas Foods) estaba en 8.491: las reglas nuevas
  entraron recuperando espacio de la redundancia del bloque de reglas (ejemplo
  de opciones con precios, que además contradecía la política nueva; contrato
  técnico; nota de estado; fuentes de verdad). Resultado: 8.489.
- 2026-09-19: T004 verificación. Gate: `pnpm test` (61 archivos, 642 tests) en
  verde; `pnpm typecheck` sin errores; `pnpm lint` sin hallazgos; `pnpm build`
  OK tras limpiar `.next` (el primer intento falló por artefactos obsoletos de un
  build anterior, no por los cambios). E2E NO ejecutado: la base por defecto y
  todas las bases `vocero_e2e_*` tienen mensajes de corridas previas (16-20), y
  el self-test no es idempotente sobre una base usada.

## Próximo paso

Tareas T001-T004 cerradas. Pendiente sugerido: corrida del Laboratorio (no
autorizada en esta unidad) para medir adherencia del prompt de nombre y precios
con el modelo real.
