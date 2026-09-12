# Contract: Catálogo público (`GET /api/public/products`)

Contrato de la feature `005-asistente-comercial` (US5). Endpoint público, sin
autenticación, para alimentar la web de la marca. Misma proyección pública que consume el
agente comercial.

## Endpoint

`GET /api/public/products`

**Auth**: NINGUNA (público). Resuelve la org única de la instancia vía
`resolveInstanceOrg()`.

**Respuesta**: `200 OK`

```json
{
  "products": [
    {
      "producto": "Pan de hamburguesa",
      "masa": "Brioche",
      "formato": "12 cm",
      "unidadesPorBolsa": 6,
      "precioUnitarioNeto": 370,
      "precioBolsaNeto": 2220,
      "precioBolsaConIva": 2641.8,
      "activo": true,
      "notas": null
    }
  ]
}
```

## Garantías (reglas duras del contrato)

1. **Solo productos activos** (`activo = true`).
2. **Solo proyección pública**: el payload valida contra `PublicProductSchema` (Zod).
   El costo y el margen NO existen en el shape — si un campo interno se agregara por error,
   el schema falla (seguro por omisión).
3. **Sin sesión**: la web no requiere auth; el dato que expone es de venta (público).

## Errores

| Caso | HTTP | Body |
|---|---|---|
| Instancia sin organización | 404 | `{ "error": { "code": "no_organization", ... } }` |
| Invariante rota (>1 org) | 500 | `{ "error": { "code": "internal", ... } }` |

## No incluido (v1)

Paginación, orden/filtros, datos de costos, detalles de producto individual, cache headers
(se agregan en la fase web).