---
description: Ejecuta un OBJETIVO de punta a punta en modo loop autónomo (SDD).
---

Carga la skill `loop-sdd` (herramienta `skill`) y ejecuta el loop
Discover → Plan → Execute → Verify → Iterate sobre el flujo Spec Kit de este
repo para el siguiente objetivo:

$ARGUMENTS

Reglas del loop (ver `AGENTS.md` → "Modo Objetivo — Loop SDD"):

- Agrupa TODAS las preguntas bloqueantes al inicio y hazlas UNA sola vez.
- No pares a pedir permiso por pasos reversibles; no delegues la prueba al dueño.
- Vuelve SOLO cuando el objetivo esté verificado EN VIVO (gate técnico
  `typecheck + lint + build + test` + self-test E2E con camino infeliz y
  evidencia observable) o ante un bloqueo real (decisión de producto,
  credenciales/acceso, acción irreversible o hacia afuera, techo de costo).
- Mantén al día los artefactos SDD en `specs/` (spec/plan/tasks).
