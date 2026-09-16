# Auditoría de interacción del agente — diseño objetivo

> **Qué es**: el resultado de la auditoría pedida a partir del feedback del dueño
> de Lamas Foods (*"no habla chileno, es muy neutro"* y *"es muy cuadriculado,
> parece seguir un set de reglas en vez de una conversación"*).
>
> **Se apoya en**: `docs/harness-agente-prod.md` (inventario del harness actual,
> con el system prompt verbatim y las métricas reales de PROD).
>
> **Estado**: diseño acordado. Pendiente de implementación.
> **Fecha**: 2026-09-16

---

## 0. Veredicto: ¿el modelo o el harness?

**El harness es la causa demostrable. El modelo es un multiplicador que hoy no se
puede aislar, porque el instrumento de medición no lo permite.**

### Por qué el harness, y no el modelo

Hay **cuatro defectos del harness** que hacen el comportamiento deseado
*imposible*, y son **deterministas**: se prueban leyendo el código, no midiendo.
Un modelo mejor no los arregla.

| # | Defecto | Evidencia | Un modelo mejor lo arregla? |
|---|---|---|---|
| D1 | **Contradicción declarativa de idioma.** El código dice `Respondes SIEMPRE en español neutro` (línea 1, texto fijo); los ajustes dicen `con español de Chile` (línea 3). La regla absoluta va primero. | `prompts.ts:108` vs `prompts.ts:109` | **No** — la contradicción sigue ahí |
| D2 | **El harness está escrito en rioplatense.** `Tratá`, `Atendés`, `cotizá`, `podés`, `decile`, `ofrecé`. El modelo imita el registro de sus instrucciones. | 78 reglas + instrucciones del negocio en voseo | **No** — un modelo mejor *imita mejor* |
| D3 | **JSON + campo `stage` obligatorio en cada turno.** Conversar y clasificar el CRM comparten la misma salida. | `lib/ai/index.ts:169` + contrato en `prompts.ts:124-131` | **No** — el esquema sigue igual |
| D4 | **La ficha del cliente nunca vuelve al prompt.** El agente captura empresa, comuna, RUT, volumen… se guardan en `contact` y no se le devuelven. Repregunta. | `pipeline.ts:431-480` (escribe) vs `pipeline.ts:208-213` (solo lee `stageId`) | **No** — el dato sigue sin llegar |

### Por qué el modelo es un factor, pero no la causa

`google/gemini-2.5-flash-lite` con `reasoning.effort` desactivado es el vértice
más barato de la configuración: menos capacidad de sostener matices de registro
y de resistir un prompt de 2.700 tokens con 77 reglas. Contribuye — pero sobre
una base que ya pide lo contrario de lo que el dueño quiere.

### Por qué hoy **no se puede atribuir**, y esto es lo importante

La instrumentación falla de dos formas medidas:

1. **Es ciega al defecto.** El Laboratorio evaluó la persona `errores_modismos`
   (cliente que escribe `"ola, benden pan d hamburguesa?"`) y dio **verde**.
   El transcript real de esa corrida es:

   > CLIENTE: `ola, benden pan d hamburguesa?`
   > AGENTE: `¡Hola! Le saluda el equipo comercial de Lamas Foods. Vendemos pan de hamburguesa, tanto masa brioche como masa papa. ¿En qué formato está interesado?`

   Eso es exactamente el síntoma reportado, y el juez no lo vio: **no evalúa el
   registro del agente contra el registro del cliente.**

2. **Es ruidosa.** Mismo modelo, mismo harness, cinco corridas: **100, 83, 62,
   75, 79**. Con esa varianza no se puede atribuir ningún cambio a una variable.

**Conclusión operativa**: primero se arregla el harness, después el instrumento,
y recién entonces se mide cuánto aporta el modelo. Al revés se gasta en modelos
sin saber qué se está midiendo.

---

## 1. Harness objetivo

### 1.1 Los cuatro bloques

Hoy se manda el mismo bloque de ~2.700 tokens en cada turno, con el catálogo y
las zonas completos y las 77 reglas al final (después de lo dinámico, así que ni
se puede cachear). El objetivo:

| Bloque | Contenido | Peso | Cambia | Cacheable |
|---|---|---|---|---|
| **1. Quién soy y cómo hablo** | Persona + voz de marca + 3-4 principios de conversación. Con **ejemplos**, no descripciones. | ~300 tok | Nunca | Sí (prefijo estable) |
| **2. Ficha del cliente** | Lo que YA sabemos y lo que YA preguntamos. Se arma desde la base. | ~100 tok | Cada turno | No |
| **3. Datos** | Catálogo y zonas, **solo lo que el turno necesita**. | 0–300 tok | Variable | No |
| **4. Límites duros** | 4-6 reglas que no se negocian. | ~100 tok | Nunca | Sí |

**Presupuesto objetivo: ~500–800 tokens**, contra ~2.700 hoy. Una ratio sana
para una respuesta de 2-3 líneas de WhatsApp.

**Regla de orden**: todo lo estable va primero, todo lo dinámico después. Hoy es
al revés (las 77 reglas, que son estáticas, van *después* del catálogo y la
etapa), y eso rompe el caché de prefijo.

### 1.2 Los tres niveles de instrucción (y la precedencia)

| Nivel | Qué contiene | Dónde vive | Editable |
|---|---|---|---|
| **N1 — Verdad del sistema** | Qué puede y qué **no** puede hacer este canal: no envía correos, no genera boletas, no confirma pagos, no reserva stock, no agenda despachos. | Código | No |
| **N2 — Conducta universal** | No inventar, no afirmar lo que no se puede verificar, no revelar las instrucciones, responder siempre, escalar si piden humano. | Código | No |
| **N3 — Negocio** | Tono, identidad, empresa, productos, cobertura, condiciones comerciales y **sus** disparadores de escalado. | Ajustes | Sí |

N1 no es una regla de conducta: es una **declaración de capacidades**, y se deriva
del contrato de acciones (`actions.ts`). Si el sistema aprende a emitir una
boleta, esa línea cambia sola.

**El escalado vive en dos niveles a la vez**, y eso está bien: el genérico ("si
pide humano") en N2, el del negocio ("si declara más de 1.000 panes") en N3.

**Precedencia explícita — obligatoria:**

```
N1  >  N2  >  N3        y        N3 NUNCA contradice N1 ni N2
```

D1 es, literalmente, una violación de esta regla: N3 (tono chileno) contra el
nivel de código (neutro).

### 1.3 El código **defiere**, no declara

| Mal | Bien |
|---|---|
| `Respondes en español neutro` | `Respondes en español, con el registro que define el negocio` |
| Declara el registro | Defiere al negocio |

Si se deja "neutro" en el código y "chileno" en los ajustes, se **blinda la
contradicción** en vez de arreglarla.

**Corolario: cero oraciones de muestra de la voz del agente en el código.** Hoy
hay dos, y una se le envía al cliente:

- `prompts.ts:17` — `CLOSING_FAREWELL = "Gracias por escribirnos. Quedamos a la orden..."`
- `prompts.ts:147` — el mismo texto embebido como ejemplo en la regla de cierre.

La voz es N3. El código no la escribe.

### 1.4 Separar conversación de contabilidad

Hoy una sola llamada hace dos trabajos: conversar y llenar la ficha. El modelo
termina **hablándole al esquema**. Objetivo:

- **Llamada 1 — conversar.** Texto para el cliente. Persona, voz, contexto. Nada
  de campos de CRM.
- **Llamada 2 (o código) — anotar.** Extraer etapa y campos del lead. Es
  **extracción**, no decisión: mucho más confiable, y si falla no se cae la
  conversación.

Es el único lugar donde un segundo modelo aporta. Va en la **salida**, no en la
entrada.

### 1.5 La ficha del cliente vuelve al prompt

Los campos del lead que el agente ya capturó se inyectan en cada turno (bloque 2):

- Negocio, rubro, comuna, RUT, razón social, giro, dirección, correo, frecuencia,
  volumen, producto de interés, formato.
- Notas previas del lead.
- Nombre del contacto.
- **Lo que ya se preguntó** — para no repreguntar.

Es la diferencia entre "es una conversación" y "es un formulario".

### 1.6 Transparencia: que el dueño vea las reglas

Lo que se muestra en el CRM **no** son las 78 reglas. Mostrarlas recrearía el
problema: el dueño intentaría razonar sobre un reglamento y se perdería igual
que el modelo.

1. **Resumen humano de N1 y N2** (5-7 viñetas, en su idioma): "no inventa
   información", "no confirma pagos", "le pide intervenir si el cliente lo
   solicita"…
2. **La configuración propia**, agrupada por tema, no un textarea de 8.000
   caracteres.
3. **"Ver qué recibe el agente"**: el prompt efectivo. Eso además le da gratis
   el instrumento de diagnóstico que hoy no tiene — el dueño no puede ver la
   causa de su propio reclamo.

---

## 2. Modelo de voz

### 2.1 Tres superficies (la variable es la audiencia, no el archivo)

| Superficie | Quién la lee | Registro | Voz |
|---|---|---|---|
| **CRM admin** (`(crm)`, `src/components/`) | El dueño y su equipo | Español **neutro** profesional | Del producto |
| **Web pública** (`(site)`, `src/components/site/`, `src/content/`) | Clientes del negocio | Español del negocio (**chileno**) | Del negocio |
| **Agente WhatsApp** | Clientes del negocio | Tono configurado (**chileno**) | Del negocio |

Web pública y agente son **la misma voz**. El CRM es otra.

**Aclaración que habilita el guardián mecánico**: *español chileno* **no** es
*voseo rioplatense*.

- **Rioplatense:** `vos` + `tenés`, `podés`, `agregá`, `probá`, `revisá`
- **Chileno:** `tú`/`usted` + `tienes`, `puede`, `agregue`, `pruebe`, con léxico
  propio (`cachái`, `al tiro`, `po`)

Por eso un test anti-voseo puede ser **global**, sin chocar con la regla de copy
chileno: `Probá`/`Agregá`/`Tenés`/`Sos` están mal en las tres superficies.

### 2.2 Definición de la voz de Lamas Foods

Decisión del dueño: **trata de usted**, en web pública y en agente.

```
VOZ DE MARCA

Tratamiento: usted, siempre — aunque el cliente tutee.
Dialecto:    español de Chile.
Registro:    cordial y directo, de conversación. Frases cortas.
Largo:       2 o 3 líneas por mensaje. Es WhatsApp, no un correo.
Léxico:      conectores chilenos naturales (ya, al tiro, cualquier cosa).

Prohibido:
  · Fórmulas de call center: "¿en qué podemos ayudarle?",
    "quedamos a su disposición", "estimado cliente".
  · Superlativos de marketing.
  · Hablar de sí mismo como "el equipo" o en tercera persona.
```

**Advertencia que gobierna todo el trabajo de voz:** *"usted"* **no** es la causa
del reclamo. El saludo actual ya usa usted y es exactamente lo que suena a call
center. Lo que cambia no es el tratamiento: es **el largo, el ritmo y los
conectores**.

| Fórmula de call center | Chileno con usted, conversación |
|---|---|
| "¿En qué podemos ayudarle con nuestros panes?" | "Hola, ¿cómo está? Cuénteme qué está necesitando y le paso la lista del día." |
| "Usted puede conocer la planta y probar las masas" | "Puede venir a la planta a probar las masas, si quiere." |
| "El despacho se realiza en 11 comunas de Santiago" | "Despachamos en 11 comunas. ¿Le llega a la suya?" |
| "Quedamos a su disposición para cualquier consulta" | "Cualquier cosa me escribe y lo vemos al tiro." |

### 2.3 El campo `tone` — el mismo fix del harness, aplicado

Hoy, en la base y en el prompt en cada turno:

> `Tratá de "usted".`

**La instrucción que define el tratamiento está escrita en el dialecto que se
quiere eliminar.** Es el mecanismo de D2.

Solución: quitarle la persona verbal al texto.

```
Tratamiento: usted.
Registro: cordial y profesional, español de Chile.
Mensajes de 2 o 3 líneas.
```

Cero verbos conjugados → cero dialecto que imitar. Y sirve para cualquier negocio.

---

## 3. Brecha: strings a reescribir

### 3.1 Copy público (tuteo → usted chileno)

13 puntos. **Ojo**: un barrido por regex no alcanza — `necesites` (subjuntivo) se
escapó de la primera pasada. Requiere revisión, no solo búsqueda.

| Archivo:línea | Hoy | Objetivo |
|---|---|---|
| `lamasfood.ts:107` | "Un armado distinto para **tus** productos gourmet." | "…para **sus** productos gourmet." |
| `lamasfood.ts:132` | `["Pan recién horneado,", "para tu negocio"]` | `["Pan recién horneado,", "para su negocio"]` |
| `lamasfood.ts:156` | "…que la mercadería llegue antes de que **abras**." | "…antes de que **abra**." |
| `lamasfood.ts:175` | "**Eliges** según lo que pida **tu** carta." | "**La elección depende de lo que pida su carta**." |
| `lamasfood.ts:182` | "…antes de que **abras** y no **te quedes** sin stock…" | "…antes de que **abra** y no **se quede** sin stock…" |
| `lamasfood.ts:187` | "Volumen para **tu** negocio" | "Volumen para **su** negocio" |
| `lamasfood.ts:189` | "…la frecuencia que **necesites**." | "…la frecuencia que **necesite**." |
| `lamasfood.ts:197` | "**Puedes** conocer la planta… Si lo **prefieres**… en **tu** local." | "**Puede** conocer la planta… Si lo **prefiere**… en **su** local." |
| `lamasfood.ts:219` | "Si el pan de ayer funcionó en **tu** vitrina…" | "…en **su** vitrina…" |
| `lamasfood.ts:227` | "…la frecuencia que **necesites**." | "…la frecuencia que **necesite**." |
| `lamasfood.ts:228` | "**Escríbenos** y **te** pasamos la lista del día." | "**Escríbanos** y **le** pasamos la lista del día." |
| `nosotros/page.tsx:63` | "¿Armamos **tu** pedido?" | "¿Armamos **su** pedido?" |
| `nosotros/page.tsx:66` | "**Contanos** qué **necesitas** y **te** cotizamos…" | "**Cuéntenos** qué **necesita** y **le** cotizamos…" |

### 3.2 Voseo rioplatense (bug en todas las superficies)

| Archivo:línea | Hoy | Superficie | Objetivo |
|---|---|---|---|
| `(site)/site/error.tsx:38` | "…no **tuyo**. **Probá** de nuevo…" | Pública | "…no **suyo**. **Pruebe** de nuevo…" |
| `(site)/site/not-found.tsx:19` | "**Probá** de nuevo" | Pública | "**Pruebe** de nuevo" |
| `global-not-found.tsx:77` | "**Probá** desde el catálogo." | Pública (`PublicNotFound`) | "**Pruebe** desde el catálogo." |
| `global-not-found.tsx:114` | "**Revisá** la dirección o **volvé** a la bandeja…" | CRM (`CrmNotFound`) | "**Revise** la dirección o **vuelva** a la bandeja…" |
| `products-client.tsx:269` | "Sin productos todavía. **Agregá** el primero…" | CRM | "…**Agregue** el primero…" |
| `products-client.tsx:476` | "**Guardá** el producto primero…" | CRM | "**Guarde** el producto primero…" |
| `shipping-client.tsx:166` | "Sin comunas cargadas. **Agregá** la primera…" | CRM | "…**Agregue** la primera…" |

> `global-not-found.tsx` **ya separa correctamente por host** (`PublicNotFound` /
> `CrmNotFound`). La arquitectura está bien; solo el registro está mal.

### 3.3 Documentación que leen los agentes

| Archivo:línea | Hoy | Objetivo |
|---|---|---|
| `AGENTS.md` | "…**apuntá** el self-test a una base…" | "…**apuntar** el self-test a una base…" |
| `AGENTS.md` | "**Invocálos** con la herramienta `task`." | "**Invocar** con la herramienta `task`." |
| `docs/deploy-hetzner.md` | "…**corré** el self-test…" | "…**correr** el self-test…" |

**Por qué importa más de lo que parece**: el escape hatch del persona dice
extender el idioma *"unless the existing project clearly uses another language"*.
Mientras el repo hable rioplatense, los agentes van a seguir extendiéndolo. **Esta
limpieza es prerrequisito del resto.**

### 3.4 De dónde viene el voseo (investigado)

Tres eslabones, y **ninguno es el persona**, que prohíbe el voseo en artefactos de
forma explícita:

1. **El escape hatch.** "…unless the existing project clearly uses another
   language and you are extending it" se activa porque el repo **ya** tenía voseo
   en `AGENTS.md` y docs.
2. **El persona es la señal más fuerte del prompt**: la instrucción de responder
   en rioplatense es positiva e imperativa; las reglas de artefactos son
   negaciones sobre otra categoría. Reclasificar "¿esto es respuesta o artefacto?"
   tiene que pasar en *cada* `Write`/`Edit`.
3. **No hay ningún gate mecánico.** Cero lint, cero test, cero hook que mire el
   registro de los strings.

**El fix son las tres cosas**: limpiar la voz existente (3.1-3.3), agregar el
guardián, y ajustar el escape hatch para que "otro idioma" signifique *locale*
(español vs inglés) y no *registro*.

---

## 4. Instrumentación: arreglar el Laboratorio antes de medir

| Problema | Fix |
|---|---|
| No evalúa el registro del agente contra el del cliente (dio verde en `errores_modismos`) | Sumar un **criterio de tono con evidencia**: la respuesta del agente debe estar en el registro de la voz de marca. Y una comprobación determinista de dialecto en el transcript. |
| Personas con score 62-100 para el mismo modelo y harness | Correr cada persona N veces y reportar mediana + dispersión, no un único score. Hoy un 100 y un 62 son la misma configuración. |
| Un caso quedó en `judge_failed` sin reintento visible | El juez también necesita el reintento robusto que ya tiene el agente. |

Sin esto, cualquier cambio que se haga después es indistinguible del ruido.

---

## 5. Plan de trabajo

| # | Paquete | Contenido | Depende de |
|---|---|---|---|
| **W0** | **Voz del repo** | 3.1 + 3.2 + 3.3 + test guardián anti-voseo + ajuste del escape hatch | — |
| **W1** | **Niveles y deferencia** | Separar N1/N2/N3 en código; quitar la declaración de idioma; sacar `CLOSING_FAREWELL` y el ejemplo del código; reescribir el campo `tone` sin persona verbal | W0 |
| **W2** | **Separar la salida** | Conversación y contabilidad en llamadas distintas | W1 |
| **W3** | **Ficha del cliente** | Inyectar los campos del lead + notas + lo ya preguntado | W1 |
| **W4** | **Datos bajo demanda** | Catálogo y zonas condicionales; reordenar estático→dinámico para caché | W1 |
| **W5** | **Transparencia** | Panel de reglas N1/N2 + config por tema + "ver qué recibe el agente" | W1 |
| **W6** | **Instrumentación** | Los tres fixes del Laboratorio (§4) | — |
| **W7** | **Medir y atribuir** | Correr el Laboratorio arreglado, con N repeticiones, sobre el harness viejo y el nuevo. Recién acá se responde cuánto aporta el modelo. | W1-W6 |

**W0 y W6 no dependen de nada** y pueden ir en paralelo. W6 conviene temprano:
sin instrumento sano, W1-W5 se hacen a ciegas.

---

## 6. Criterios de éxito

1. **Dialecto**: en una conversación donde el cliente escribe con modismos
   chilenos, la respuesta del agente usa usted chileno y **cero** fórmulas de
   call center. Verificable en el transcript.
2. **No contradicción**: el prompt efectivo no contiene dos registros en tensión.
   Verificable leyendo el prompt.
3. **Conversación, no formulario**: el agente no repregunta un dato ya capturado
   en la ficha. Verificable en el transcript.
4. **Presupuesto**: el system prompt baja de ~2.700 a ~500–800 tokens.
5. **Reglas**: de 77 viñetas a 4-8 principios + 4-6 límites duros.
6. **Instrumento**: el Laboratorio deja de dar verde en `errores_modismos` con la
   respuesta corporativa, y los scores son estables entre corridas.
7. **Guardián**: `pnpm test` falla si entra voseo rioplatense en un string.

---

## Anexo — Lo que se descartó, y por qué

**Un agente barato que decida qué información mandar (router LLM).** Se evaluó y
se descartó:

- Casi todas las decisiones de "qué mandar" las resuelve el **código**: la ficha
  está en la base, la etapa está en la base, el producto es un match de texto, la
  zona es un condicional.
- Decidir qué información corresponde es, en el fondo, **búsqueda** — y la
  búsqueda se resuelve con embeddings, no con una llamada de chat.
- Apila el eslabón débil sobre el eslabón débil: si el modelo no sostiene 77
  reglas, tampoco es confiable eligiendo bien qué recortar.
- Suma una ida y vuelta y un modo de fallar por turno en una conversación en vivo.
- **No arregla ninguno de los cuatro defectos raíz.** Sólo el catálogo — y eso es
  un `if`.

**El router existe porque el prompt pesa 2.700 tokens.** Si baja a ~600, el router
desaparece solo.
