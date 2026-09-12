# Quickstart — Asistente comercial con contexto de negocio (005)

Cómo probar la feature con los mocks internos (sin tocar WhatsApp ni un LLM real).

## Prerrequisitos

- Entorno de desarrollo con mocks (`WA_MOCK_ENABLED=true`, `OPENROUTER_BASE_URL` → ai-mock).
- `pnpm install` + `pnpm db:migrate` (tablas nuevas).

## 1. Sembrar catálogo y zonas

```bash
# Import idempotente del catálogo (CSV con precios locales)
pnpm seed:products --file="/ruta/productos.csv"

# Import idempotente de zonas de envío (comuna, costo_despacho_neto, activo)
pnpm seed:zones --file="/ruta/despachos.csv"
```

El import exige `DATABASE_URL` en `.env` (no usa el resto del env estricto). Datos reales
de Lamas Foods ya cargados en la instancia: 12 SKUs y 11 comunas.

## 2. Configurar el agente comercial

En Configuración → Agente: activar el agente, pegar las instrucciones comerciales
(modalidades, mínimos, cobertura, crédito, "a quién vendemos") en `instructions` y las
reglas de escalado en `escalation_rules`.

## 3. Verificar proyección pública

```bash
curl http://localhost:3000/api/public/products
# → solo productos activos, proyección pública, SIN costo
```

## 4. Self-test E2E (camino feliz e infeliz)

```bash
pnpm test:e2e
```

El guion `tests/e2e/010-asistente-comercial.md` conduce:

1. **Feliz**: un lead pregunta precio de un SKU → el agente responde con el precio real de
   la BD; pregunta por despacho a comuna con cobertura → responde tarifa y valida mínimo;
   aporta empresa/comuna → el lead queda enriquecido en la ficha del contacto.
2. **Infeliz**: pregunta por un producto inexistente → el agente NO inventa (responde que
   confirmará o escala); comuna sin cobertura → ofrece retiro y registra la comuna; pide
   crédito → responde la política; pide humano → handoff.

## Gate técnico

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```