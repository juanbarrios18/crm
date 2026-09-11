# Feature Specification: Asistente comercial con contexto de negocio (catálogo, envíos y leads enriquecidos)

**Feature Branch**: `005-asistente-comercial`

**Created**: 2026-09-09

**Status**: Draft

**Input**: Equiparar el asistente comercial de Vocero con la configuración que hoy vive en
n8n + Google Sheets para el negocio piloto (panificadora mayorista B2B): catálogo de
productos, costos de despacho por comuna, reglas comerciales y leads enriquecidos. n8n
queda descartado; Vocero pasa a ser el centro de todo, con los datos en PostgreSQL.

## Contexto de producto

- **Usuario primario**: el negocio (panificadora mayorista B2B) que opera la instancia y
  atiende a compradores por WhatsApp.
- **Modelo comercial**: venta de panes envasados por bolsa. Dos modalidades:
  DESPACHO (mín. 15 bolsas, cobertura por comuna con costo de envío) y RETIRO EN PLANTA
  (mín. 5 bolsas). Pago por transferencia previa. No crédito. No venta a consumidor final.
- **Datos sensibles**: el COSTO del producto (COGS) es PRIVADO e interno; el catálogo de
  venta (precios) y el costo de envío por comuna son PÚBLICOS (los ve el cliente).
- **Piloto**: la instancia de Lamas Foods se puebla con su catálogo real (13 SKUs) y su
  configuración de envíos. La feature aporta la CAPACIDAD de producto; los datos son
  configuración de la instancia (import/seed idempotente), no código.
- Esta feature reemplaza el camino de `004-integracion-n8n` (cerebro externo): el agente
  nativo de Vocero pasa a tener el contexto comercial.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Catálogo de productos con costo privado (Priority: P1)

Como operador del negocio, administro mi catálogo de productos (producto, masa, formato,
unidades por bolsa, precio unitario neto, precio de bolsa neto y con IVA, activo) y el
costo interno de cada producto. El costo es información sensible: jamás se muestra al
cliente, ni en lo que ve el agente comercial ni en ninguna salida pública.

**Why this priority**: El catálogo es la base de todo el contexto comercial; sin él el
agente no puede cotizar ni el negocio lo comparte con la web. La separación público/privado
del costo es el requisito de confidencialidad central.

**Independent Test**: Importar el catálogo (CSV) y verificar que (a) los productos con
precios normalizados aparecen en la UI, (b) el costo interno se guarda en su tabla propia,
y (c) ningún endpoint público ni el prompt del agente comercial contiene el costo.

**Acceptance Scenarios**:

1. **Given** un CSV de catálogo con decimales en formato local (`"2641,8"`), **When** se
   importa, **Then** los precios se normalizan a `2641.8`, los 13 SKUs se crean (clave única
   `producto + masa + formato`), y re-importar el mismo CSV no duplica (idempotente).
2. **Given** un producto con costo interno registrado, **When** se consulta la proyección
   pública (endpoint o agente comercial), **Then** el campo de costo NO está presente.
3. **Given** un producto dado de baja (`activo = false`), **When** se consulta la proyección
   pública, **Then** no aparece para clientes ni web.

---

### User Story 2 - Zonas de envío y costo de despacho (Priority: P1)

Como operador, administro las comunas con cobertura de despacho y el costo de envío de
cada una (información PÚBLICA: es la tarifa que paga el cliente). El agente comercial
sabe en qué comunas se despacha, cuánto cuesta el envío, y cuándo corresponde ofrecer
retiro en planta.

**Why this priority**: Es la mitad "radio de envíos" del contexto: sin cobertura y tarifas
el agente no puede calificar un lead ni cotizar despacho.

**Independent Test**: Dar de alta una comuna con su tarifa y verificar que el agente la
usa al responder (comuna con cobertura → costo de envío; comuna sin cobertura → ofrece
retiro y registra la comuna).

**Acceptance Scenarios**:

1. **Given** una comuna con cobertura y su costo de despacho cargados, **When** un cliente
   pregunta por despacho, **Then** el agente informa cobertura y costo correctos.
2. **Given** una comuna SIN cobertura, **When** un cliente la menciona, **Then** el agente
   ofrece retiro en planta y registra la comuna como dato del lead (sin rechazar).
3. **Given** una comuna con tarifa pendiente, **When** se consulta, **Then** se muestra
   explícitamente como "sin tarifa definida" y el agente no inventa un costo.

---

### User Story 3 - Lead enriquecido (datos comerciales del contacto) (Priority: P1)

Como operador, cada interesado queda registrado no solo como contacto de WhatsApp, sino
con sus datos comerciales: empresa, rubro, comuna, RUT, razón social, giro, dirección de
facturación, email, frecuencia de despacho, volumen semanal, producto de interés y formato.
El agente comercial completa estos campos durante la conversación, sin dejar la charla.

**Why this priority**: Es la mitad "gestionar clientes" del MVP: convierte una conversación
en un lead accionable y calificable, replicando la hoja `Leads` de hoy.

**Independent Test**: Mantener una conversación simulada donde el cliente da empresa,
comuna y volumen → verificar que el lead queda enriquecido y visible en la UI del contacto.

**Acceptance Scenarios**:

1. **Given** una conversación en curso, **When** el cliente aporta empresa, comuna o
   volumen, **Then** el agente actualiza los campos estructurados del lead (no una nota
   libre) y el cambio se refleja en la ficha del contacto.
2. **Given** un contacto sin teléfono (identidad BSUID), **When** se enriquece el lead,
   **Then** los campos comerciales se guardan igual (la identidad estable no depende del
   teléfono).
3. **Given** un campo ya rellenado, **When** el cliente aporta un valor nuevo del mismo
   campo, **Then** se actualiza (último valor gana) sin duplicar el campo.

---

### User Story 4 - Agente comercial con contexto de negocio (Priority: P1)

Como operador, el agente de WhatsApp atiende a los compradores con el comportamiento
comercial del negocio: catálogo público y zonas de envío inyectados como contexto, reglas
de modalidades/mínimos/cobertura/crédito/"a quién vendemos", y las acciones de siempre
(reply, update_lead, move_stage, handoff). El costo de los productos NUNCA llega al prompt.

**Why this priority**: Es el objetivo central de la feature — que el agente nativo de
Vocero replique (y mejore) al asistente comercial de n8n, sobre datos reales.

**Independent Test**: Con `ai-mock` activo, una conversación simulada donde el cliente
pregunta precio y cobertura → el agente responde usando el catálogo y las zonas; si pide
crédito → responde la política; si pide humano → handoff.

**Acceptance Scenarios**:

1. **Given** el agente activo con instrucciones comerciales y catálogo cargado, **When** un
   cliente pregunta "¿cuánto cuesta el pan de hamburguesa brioche 12 cm?", **Then** el
   agente responde con el precio de la proyección pública correcto.
2. **Given** el agente activo, **When** el cliente pide despacho a una comuna con cobertura,
   **Then** el agente informa el costo de envío y valida el mínimo de 15 bolsas; si pide
   menos, ofrece retiro en planta desde 5 bolsas.
3. **Given** el agente activo, **When** el cliente pide crédito o pago a plazo, **Then** el
   agente responde la política (transferencia previa) sin ofrecer crédito.
4. **Given** el agente activo, **When** el cliente pide hablar con una persona, **Then**
   ocurre handoff (badge + IA silenciada).
5. **Given** el agente activo, **When** se construye el prompt, **Then** el catálogo
   inyectado es la proyección pública: el costo interno no aparece en ninguna sección.

---

### User Story 5 - Catálogo público para la web (Priority: P2)

Como operador, expongo mi catálogo de venta a la página web de la marca: un endpoint
público, sin autenticación, que devuelve solo los productos activos con la proyección
pública (nunca el costo). El mismo contrato alimenta al agente comercial y a la web.

**Why this priority**: La web es un consumidor más del catálogo; valor real pero no
bloquea el flujo de venta por WhatsApp.

**Independent Test**: Llamar `GET /api/public/products` → respuesta JSON solo con campos
públicos de productos activos; verificar que no contiene costo ni campos internos.

**Acceptance Scenarios**:

1. **Given** productos activos e inactivos en el catálogo, **When** se llama
   `GET /api/public/products`, **Then** solo se devuelven los activos, con la proyección
   pública (producto, masa, formato, unidades, precios) y sin costo.
2. **Given** un catálogo con costos internos cargados, **When** se llama el endpoint
   público, **Then** la respuesta no contiene `costo` ni ningún campo del modelo interno.

---

### Edge Cases

- CSV con precios en formato local (`"2641,8"`) o `"4284"` → normalización consistente.
- SKU duplicado en el CSV (`producto+masa+formato` repetido) → upsert idempotente, sin
  duplicar.
- Comuna sin tarifa → nunca inventar un costo; declarar "sin tarifa definida".
- Costo interno intentando filtrarse por proyección pública → excluido por contrato Zod
  (seguro por omisión) + tabla separada (imposibilidad estructural).
- Contacto BSUID sin teléfono → enriquecimiento de lead sigue funcionando.
- Instancia sin catálogo cargado → el agente responde "no tengo ese dato" / escala en vez
  de inventar precios (principio de no alucinación de Vocero).
- Lead ya enriquecido + dato nuevo del mismo campo → último valor gana.
- Restart/duplicado de import → re-ejecutable sin efectos duplicados.

## Requirements *(mandatory)*

### Functional Requirements

**Catálogo (US1)**

- **FR-001**: El sistema MUST exponer `product` como entidad con `producto`, `masa`,
  `formato`, `unidadesPorBolsa`, `precioUnitarioNeto`, `precioBolsaNeto`,
  `precioBolsaConIva`, `activo`, `notas`, con clave única `(organization_id, producto,
  masa, formato)` y `organization_id` NOT NULL.
- **FR-002**: El costo interno MUST vivir en una tabla separada `product_cost` (relación
  1:1 con `product`, `organization_id` NOT NULL), NUNCA como columna de `product`.
- **FR-003**: El sistema MUST proveer un import idempotente de catálogo (CSV) que
  normalice precios con coma decimal y haga upsert por la clave del SKU.
- **FR-004**: La proyección pública de producto (`PublicProductSchema`) MUST estar definida
  una vez y EXCLUIR el costo; toda salida al cliente/web/agente comercial MUST pasar por
  ella. La proyección interna (`InternalProductSchema`) MUST existir para consumo interno.

**Zonas de envío (US2)**

- **FR-010**: El sistema MUST exponer `delivery_zone` con `comuna`, `costoDespacho`,
  `activa`, `organization_id` NOT NULL, y clave única `(organization_id, comuna)`.
- **FR-011**: La tarifa de despacho es PÚBLICA (la ve el cliente) y MUST estar disponible
  para el agente; una comuna sin tarifa MUST declararse como "sin tarifa definida" y el
  agente MUST NOT inventar costos.

**Leads enriquecidos (US3)**

- **FR-020**: `contact` MUST ampliarse con los campos comerciales: `empresa`, `rubro`,
  `comuna`, `rut`, `razonSocial`, `giro`, `direccionFacturacion`, `email`,
  `frecuenciaDespacho`, `volumenSemanal`, `productoInteres`, `formato`
  (todos opcionales, `organization_id` ya obligatorio).
- **FR-021**: La acción `update_lead` del agente MUST permitir actualizar estos campos
  estructurados (último valor gana), además de la nota libre existente.
- **FR-022**: El enriquecimiento MUST funcionar para contactos sin teléfono (identidad
  BSUID estable).

**Agente comercial (US4)**

- **FR-030**: El builder del prompt del agente (`buildAgentSystemPrompt`) MUST inyectar el
  catálogo PÚBLICO y las zonas de envío activas (render-into-context), leídos de la BD.
- **FR-031**: El prompt inyectado MUST ser la proyección pública; el costo interno NUNCA
  se incluye en el prompt del agente comercial.
- **FR-032**: Las reglas comerciales (modalidades, mínimos, cobertura, crédito, "a quién
  vendemos") MUST configurarse en el comportamiento del agente (`agent_profile`) y
  respetarse por el agente; no se codean en el producto.

**Catálogo público para web (US5)**

- **FR-040**: El sistema MUST exponer `GET /api/public/products` sin autenticación que
  devuelva SOLO productos activos con la proyección pública.
- **FR-041**: El endpoint público MUST NOT devolver el costo ni campos internos; si un
  campo interno se agregara a la proyección pública por error, el contrato Zod MUST
  fallarlo (seguro por omisión).

### Key Entities

- **product**: catálogo de venta (campos públicos); clave única por SKU; pertenece a la
  organización.
- **product_cost**: costo interno 1:1 con `product`; solo consumo interno.
- **delivery_zone**: comuna con cobertura y tarifa de despacho pública.
- **contact** (extendido): datos comerciales del cliente sobre la entidad existente.
- **lead / pipeline_stage**: reutilizados; la etapa mapea los estados del negocio
  (Nuevo/Calificado/Cotizado/Ganado/Perdido).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El catálogo (13 SKUs del piloto) se importa y normaliza en un solo paso,
  idempotente; re-importar produce 0 duplicados.
- **SC-002**: El 100% de las salidas públicas (endpoint web, agente comercial) NO contienen
  el campo costo, verificable por test de contrato.
- **SC-003**: En una conversación simulada con `ai-mock`, el agente responde precio y
  cobertura/costo de envío correctos a partir de la BD, sin inventar datos.
- **SC-004**: Un lead conversado con datos comerciales queda enriquecido y visible en la
  ficha del contacto en ≤2s tras el turno del agente.
- **SC-005**: `GET /api/public/products` devuelve solo activos + proyección pública en
  <200ms, sin autenticación.

## Assumptions

- El costo del producto (COGS) NO está disponible hoy (el CSV no lo trae); `product_cost`
  nace vacío y se llena cuando el negocio lo decida.
- La data de comunas con tarifa de despacho está pendiente de proveer por el negocio; la
  entidad y el flujo se construyen igual.
- Las reglas comerciales se configuran por instancia (comportamiento del agente), no en
  código del producto.
- La web consume `GET /api/public/products`; el contrato público es la única fuente para
  el agente comercial y para la web (no hay dos catálogos).
- Multi-tenancy real se mantiene: toda tabla nueva lleva `organization_id` NOT NULL y toda
  query pasa por `scoped()`.

## Out of Scope (v1)

Pedidos/órdenes de compra, inventario y stock, conector Nubox, módulo de repartos/envíos,
asistente interno "Adan" (chat externo + MCP), escritura de datos desde el agente más allá
del lead (write-agents), y MCP de reportes.