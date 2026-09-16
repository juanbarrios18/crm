# MCP — Model Context Protocol

Los servidores MCP dan a Claude herramientas extra (navegador, GitHub, bases de datos,
etc.). **No se instalan desde un archivo suelto**: se registran con el CLI `claude mcp add`
o se declaran en `.mcp.json` (scope de proyecto). Este starter trae:

- **`.mcp.json`** — arranca vacío (`{"mcpServers": {}}`). Lo que se declare aquí queda *scoped al
  proyecto* y se comparte con quien clone el repo.
- **`.mcp.json.example`** — ejemplos listos: **Playwright** (navegador, para self-tests de
  UI) y **GitHub** (issues/PRs, encaja con `speckit-taskstoissues`).

## Opción A — CLI (recomendada)

```bash
# Playwright (navegador headless para verificar UI en el loop)
claude mcp add playwright -- npx -y @playwright/mcp@latest

# GitHub (usa un token desde tu entorno; ver .env.example → GITHUB_TOKEN)
claude mcp add github --env GITHUB_PERSONAL_ACCESS_TOKEN=$GITHUB_TOKEN -- npx -y @modelcontextprotocol/server-github

# Verifica
claude mcp list
```

Usar `--scope project` cuando la entrada deba escribirse en el `.mcp.json` del repo (y se
comparta); por defecto el alcance es local.

## Opción B — editar `.mcp.json`

Copiar las entradas necesarias de `.mcp.json.example` a `.mcp.json`. Formato:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

## Reglas de seguridad (importante)

- **Nunca** poner tokens en claro en `.mcp.json`. Usar interpolación `${VAR}`, que se resuelve
  desde el entorno / `.env`.
- Si por algún motivo se incluye un secreto directo, **gitignorar `.mcp.json`** y dejar solo
  `.mcp.json.example` versionado (ver el bloque comentado en `.gitignore`).
- Los servidores remotos autenticados (los que requieren login interactivo) pueden **no
  estar disponibles en ejecuciones headless/cron** — tenerlo en cuenta para automatizaciones.

## Servidores MCP útiles para el loop SDD

| Servidor | Para qué |
|----------|----------|
| Playwright | Self-test de UI / navegación en la fase Verify |
| GitHub | Crear issues desde `tasks.md`, gestionar PRs |
| Postgres/SQLite | Inspeccionar la BD durante el desarrollo |
| Filesystem | Acceso acotado a rutas fuera del repo (usarlo con cuidado) |

Agregar cualquier otro según el nicho (un MCP de pagos, del proveedor de mensajería, etc.).
