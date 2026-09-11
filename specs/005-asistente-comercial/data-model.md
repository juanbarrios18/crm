# Data Model — Asistente comercial con contexto de negocio (005-asistente-comercial)

Convenciones globales (igual que la 001): IDs `text` con nanoid prefijado; toda tabla de
dominio lleva `organization_id text NOT NULL` FK→`organization` (`ON DELETE CASCADE`) e
índice org-first; timestamps `timestamptz`; enums como `text` con CHECK vía enum Drizzle.

## Entidades nuevas

### product (catálogo de venta — PÚBLICO)
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `prd_` |
| organization_id | text NOT NULL FK CASCADE | índice org-first |
| producto | text NOT NULL | p. ej. "Pan de hamburguesa" |
| masa | text NOT NULL | p. ej. "Brioche", "Papa" |
| formato | text NOT NULL | p. ej. "12 cm", "Estandar" |
| unidades_por_bolsa | integer NOT NULL | unidades por bolsa (SKU) |
| precio_unitario_neto | numeric(12,4) NOT NULL | precio unitario neto |
| precio_bolsa_neto | numeric(12,4) NOT NULL | precio de bolsa neto |
| precio_bolsa_con_iva | numeric(12,4) NOT NULL | precio de bolsa con IVA |
| activo | boolean NOT NULL default true | dado de baja = fuera de lo público |
| notas | text | |
| created_at / updated_at | timestamptz | |

UNIQUE `(organization_id, producto, masa, formato)` → clave del SKU (idempotencia del import).

### product_cost (costo interno — PRIVADO)
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `prc_` |
| organization_id | text NOT NULL FK CASCADE | |
| product_id | text NOT NULL FK→product CASCADE | UNIQUE (1:1 con product) |
| costo | numeric(12,4) | costo del producto (COGS) |
| margen | numeric(12,4) | margen calculado (opcional) |
| created_at / updated_at | timestamptz | |

Separación ESTRUCTURAL del costo: ninguna query pública ni el agente comercial JOINean esta
tabla. Nace vacía (el negocio no proveyó costos).

### delivery_zone (radio de envíos — PÚBLICO)
| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `dz_` |
| organization_id | text NOT NULL FK CASCADE | |
| comuna | text NOT NULL | p. ej. "Macul" |
| costo_despacho | numeric(12,4) NULL | tarifa pública; NULL = "sin tarifa definida" |
| activa | boolean NOT NULL default true | cobertura vigente |
| created_at / updated_at | timestamptz | |

UNIQUE `(organization_id, comuna)`.

## Extensión de entidad existente

### contact (campos comerciales del lead — P3)
Se AGREGAN columnas (todas opcionales, `text` nullable):

| Columna | Notas |
|---|---|
| empresa | nombre de la empresa del interesado |
| rubro | rubro/giro abreviado del negocio |
| comuna | comuna del interesado (dato de cobertura) |
| rut | RUT del negocio |
| razon_social | razón social |
| giro | giro completo |
| direccion_facturacion | dirección de facturación |
| email | email de contacto |
| frecuencia_despacho | frecuencia esperada (semanal/mensual…) |
| volumen_semanal | volumen semanal estimado |
| producto_interes | producto de interés |
| formato | formato de interés |

La `etapa` del lead ya mapea los estados del negocio vía `pipelineStage` (Nuevo/Calificado/
Cotizado/Ganado/Perdido); no se cambia el modelo de lead.

## Proyecciones (Zod, en `src/lib/catalog.ts`)

- **PublicProductSchema**: `producto`, `masa`, `formato`, `unidadesPorBolsa`,
  `precioUnitarioNeto`, `precioBolsaNeto`, `precioBolsaConIva`, `activo`, `notas`.
  SIN `costo` ni `margen`. Seguro por omisión: campos nuevos NO se exponen hasta que se
  agreguen al schema público.
- **InternalProductSchema**: campos públicos + `costo`, `margen`. Consumo interno (Adan,
  reportes futuros).

## Relaciones (resumen)

organization 1—N {product, delivery_zone} · product 1—1 product_cost ·
contact (extendido) 1—1 lead (ya existente).

## Idempotencia del import

Clave natural `(organization_id, producto, masa, formato)` → upsert (ON CONFLICT DO UPDATE).
Re-importar el mismo CSV no crea duplicados (Principio IV).