# Enfoque de negocio: motor de adquisición

**Documento de estrategia.** Define qué se construye, para quién y qué se monetiza. No es
una especificación técnica ni un plan de implementación.

> Registro: español neutro profesional. El código, la documentación y la interfaz del
> repositorio no adoptan variantes regionales.

---

## La decisión en una frase

El producto no es un CRM integral. Es un **motor de adquisición**: encontrar clientes,
convertirlos y aprender de cada conversación para vender mejor la próxima vez.

Todo lo que no alimenta ese ciclo queda fuera del alcance inicial.

---

## 1. El problema

Un negocio local no compra "SEO", ni "un chatbot", ni "una web". Compra dos cosas:
**más clientes** y **menos dinero desperdiciado en publicidad**.

Hoy nadie le cierra el círculo. La agencia ve clics, no ve quién compró. La plataforma de
anuncios optimiza hacia la acción que se le declare, pero no sabe qué conversación terminó
en venta. El negocio intuye; no mide.

La oportunidad es cerrar ese círculo y cobrar por el resultado, no por la herramienta.

---

## 2. El error a evitar: dos ejes que se confunden

| Eje | Qué es | Estado |
|---|---|---|
| Aislamiento de datos | Cada negocio ve solo lo suyo | Resuelto (multi-tenancy) |
| Variación de comportamiento | Cómo opera cada negocio | No resuelto |

El aislamiento se resuelve con multi-tenancy. La variación **no se resuelve con
configuración**: la configuración activa y desactiva, pero no inventa procesos que no
existen en el código.

Consecuencia de diseño: el back-office (inventario, costos, facturación, planificación de
producción) **sale del alcance**. Es trabajo operativo, no generación de demanda, y
multiplica la superficie de soporte.

---

## 3. El recorte correcto: verticales, no funcionalidades

"Achicar el producto" no significa cortar capacidades. Significa **servir un solo rubro**.

Manteniendo las cuatro capacidades y sirviendo un solo tipo de negocio, cada pieza se
pre-construye: el conjunto de palabras clave, los ángulos creativos, las preguntas de
calificación del agente y la estructura del sitio. El producto deja de ser una plataforma
genérica y pasa a ser una máquina repetible que después se clona.

Rubro inicial: **provisión gastronómica (food service)**. Referencia real: LamasFoods.

---

## 4. Las cuatro piezas y su rol

No son cuatro productos. Son cuatro sensores de un mismo ciclo.

| Pieza | Qué hace | Rol en el ciclo | Defendibilidad |
|---|---|---|---|
| Web | Presenta el negocio y lo hace citable | Sustrato | Baja (commodity) |
| Visibilidad | Aparecer en buscadores y en asistentes de IA | Ser encontrado | Media: demanda real, promesa no garantizable |
| Chatbot | Atiende, califica y **registra** | Convertir + sensar | **Alta: es el activo** |
| Anuncios | Propone creatividades | Amplificar | Media: solo con el ciclo cerrado |

La pieza clave es el chatbot, por una razón distinta de la atención: **es el único punto
donde se escucha al mercado**. Registra con qué palabras busca la gente, qué objeción
frena la venta y qué producto se solicita y no existe. Eso es un brief creativo escrito
por el mercado, no inventado por una agencia.

Ciclo completo: *te encuentran → te eligen → convierten → la publicidad aprende de quién
convirtió → vuelve a empezar mejor.*

---

## 5. El foso

Tres capas, en orden de solidez:

1. **Atribución.** La conversación ocurre en un canal propio, así que se posee el último
   toque. Una agencia no lo tiene: ve el clic, no la venta.
2. **Capa de insights.** Patrones agregados de todos los negocios del rubro: qué ángulo
   convierte, qué objeción se repite, qué demanda no está cubierta.
3. **Ciclo creativo.** La objeción escuchada se transforma en ángulo, el ángulo se
   propone, el resultado se mide y alimenta la ronda siguiente.

Las tres dependen de lo mismo: **guardar y estructurar la conversación**.

---

## 6. Atribución: la mecánica

| Camino | Cómo se atribuye |
|---|---|
| Anuncio (clic a WhatsApp) | La plataforma adjunta un objeto `referral` al primer mensaje: `source_id` (identificador del anuncio), `ctwa_clid`, `headline`, `source_url` |
| Cierre del ciclo | El `ctwa_clid` se devuelve a la plataforma por su Conversions API junto al evento de venta |
| Boca a boca u orgánico | El chatbot pregunta durante la conversación |

Dos hechos operativos que condicionan el diseño: el `referral` llega **una sola vez** (en el
primer mensaje) y en una minoría de casos no llega.

Cadena de atribución:
`mensaje(referral) → conversación → contacto → lead → venta(valor)`.

> **Nota de estado.** El CRM actual descarta este objeto: el webhook tipa el payload sin el
> campo `referral`, de modo que la atribución de anuncios se pierde al ingresar. No es un
> sistema por construir, es un dato que hoy no se persiste.

---

## 7. La capa de insights: acumular, no entrenar

Existe una diferencia crítica entre dos formas de "aprender de todos los negocios":

| | Entrenamiento (fine-tuning) | Capa de insights |
|---|---|---|
| Qué enseña | Forma (estilo, tono) | Hechos (qué funciona) |
| Actualización | Costosa y lenta | Inmediata |
| Auditable | No | Sí |
| Borrado por negocio | **Imposible** | Trivial |
| Aporte al foso | Bajo | Alto |

El argumento decisivo es el borrado: **no se puede des-entrenar un modelo** cuando un
negocio solicita eliminar sus datos. Con una capa estructurada, el borrado es una
operación de base de datos.

Regla de límite: **lo crudo permanece dentro de cada negocio; solo cruzan patrones
agregados y no identificables.**

Consecuencia técnica: el foso son los **datos y el ciclo que los produce**, no un modelo
entrenado.

---

## 8. Producto a monetizar

### Unidad de venta

La frontera de los módulos es la frontera del precio. Si un módulo se puede desactivar, se
puede vender por separado.

| Componente | Tipo | Qué incluye |
|---|---|---|
| Alta inicial | Pago único | Web, posicionamiento, configuración del agente, primer set creativo |
| Suscripción base | Mensual | Chatbot, conversaciones, contactos |
| Módulo Presencia | Mensual | Web, posicionamiento en buscadores y asistentes de IA, contenido |
| Módulo Atribución | Mensual | Tracking y reporte de qué anuncio produce clientes |
| Módulo Creativo | Mensual | Propuestas de anuncios a partir de conversaciones e investigación de mercado |
| Módulo Crecimiento | Mensual | Capa de insights y aprendizaje del rubro |
| White-label | Mensual | Licencia para agencias que sirven el rubro |

### Secuencia

1. **Alta + suscripción base.** El diferencial (atribución) se usa para vender, pero se
   cobra como software. Es la etapa donde el valor todavía no está probado.
2. **Módulos.** Se activan a medida que el negocio percibe resultado. El precio acompaña
   al valor.
3. **Precio por resultado.** Solo cuando la medición es confiable: porcentaje de ingreso
   atribuido, o tarifa por lead calificado. Requiere historial propio.
4. **White-label.** Cambia el comprador: agencias del rubro, ticket mayor y menos soporte
   por unidad facturada.

### Lo que no se vende

Gestión de anuncios como servicio, en la etapa inicial. El sistema **propone**; el negocio
publica. Se transfiere la responsabilidad operativa y se evita competir con la automatización
de la propia plataforma de anuncios.

---

## 9. Riesgos

| Riesgo | Por qué importa |
|---|---|
| Agencia con software | Cuatro servicios, cuatro soportes, cero apalancamiento |
| Creatividad disputada | Compiten la agencia, la generación automática de la plataforma y el propio dueño |
| Visibilidad en asistentes de IA | Demanda real, promesa no garantizable: se vende presencia citable, nunca posición |
| Aprendizaje entre negocios | Es el foso y es la línea legal: el negocio A alimenta a su competencia |
| Dependencia de plataforma | Anuncios, webhook y límites dependen de un tercero |

---

## 10. Decisiones abiertas

- **Transparencia del aprendizaje cruzado.** El negocio A aporta los datos que mejoran al
  negocio B, que es su competencia. ¿Se declara, o se aplica en silencio? Define si el
  producto es de confianza o un pasivo latente.
- **Alcance del consentimiento.** Qué autoriza exactamente el negocio sobre las
  conversaciones de sus clientes, y cómo se refleja en los términos.
- **Momento del precio por resultado.** Cuánto historial se necesita antes de ofrecerlo.
- **Segundo rubro.** Cuándo se abre y qué se reutiliza sin cambios.

---

## Qué no se construye todavía

- Motor de extensiones en tiempo de ejecución.
- Entrenamiento de modelos con datos de clientes.
- Segundo vertical.
- Gestión de campañas como servicio.
