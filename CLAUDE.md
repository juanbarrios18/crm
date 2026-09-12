# Vocero CRM — Guía del agente

La guía canónica del proyecto vive en [`AGENTS.md`](AGENTS.md). Es la **única
fuente de verdad** para: stack, mapa del código (fronteras de modificación),
reglas de la constitución, Definición de Hecho y Modo Objetivo / Loop SDD.

Leé `AGENTS.md` antes de actuar. No edites este archivo para cambiar reglas:
editá `AGENTS.md` y el cambio se refleja en todos los asistentes.

Referencias:

- Constitución (autoridad máxima): [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
- Subagentes: `.claude/agents/` (prompts) — memoria compartida en `.opencode/agent-memory/<agente>/`
- Loop SDD: skill `loop-sdd` (`/loop-sdd <objetivo>`)
