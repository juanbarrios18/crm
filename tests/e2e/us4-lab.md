# Guion E2E — US4: Laboratorio (SIEMPRE contra ai-mock, determinista)

> Conducido con Playwright (MCP) contra `pnpm dev` con ai-mock. El KB inicial
> NO cubre garantías/devoluciones (hueco intencional del guion).
>
> **Sin números de score escritos acá a propósito.** El corpus y la tabla de
> severidad cambian, y las cifras envejecen en silencio (esta guía llegó a decir
> "n/6" con un corpus de 13 personas × 3 repeticiones, y "5 verdes + 1 rojo" con
> una severidad que hoy es otra). El guion verifica COMPORTAMIENTO; el score se
> lee del reporte y se contrasta contra la tabla de severidad.

## Preparación

1. `DELETE /api/dev/wa-mock/outbox` — el outbox debe seguir VACÍO al final.
2. Agente configurado (US3) y proveedor de IA (mock) activo.

## Corrida 1

3. En `/lab`: pulsar "Correr evaluación".
   ✅ La UI muestra el subtítulo permanente "Sandbox interno — no envía
   mensajes reales", progreso en vivo (n/39 = 13 personas × 3 repeticiones) sin
   bloquear la navegación.
4. Al terminar:
   ✅ Reporte con score global y una tarjeta por persona; transcript visible por
   persona.
   ✅ La tarjeta de "Pregunta fuera del conocimiento" muestra el hallazgo
   `fuera_de_kb` con evidencia y sugerencia. `fuera_de_kb` deriva **amarillo**
   (tabla de severidad B2), no rojo.
   ✅ Las personas con `expectAdvance` cuyo guion no dispara la señal de compra
   del ai-mock quedan con hallazgo `pipeline` y por lo tanto en amarillo: el
   veredicto se deriva del TIPO de hallazgo, no de una decisión del juez.
   ✅ La persona "Pide un humano" terminó en handoff (guion cortado).
   ✅ `GET /api/dev/wa-mock/outbox` → VACÍO (ningún mensaje salió a WhatsApp).
   ✅ Las conversaciones de prueba NO aparecen en la bandeja.

## Cerrar el loop

5. En el hallazgo: "Agregar al conocimiento" → editar/confirmar → guardado en
   el KB (visible en `/agent`).
6. Re-correr la evaluación.
   ✅ El historial muestra 2 corridas y el delta es POSITIVO: el hallazgo
   `fuera_de_kb` desapareció al cubrir el KB, así que esa persona pasa de
   amarillo a verde. Las de `pipeline` no cambian (dependen del guion, no del
   KB).

## Caminos infelices

7. Con una corrida en curso, `POST /api/lab/runs` → 409 `run_in_progress`.
8. Corridas huérfanas: cubierto por `src/instrumentation.ts` al boot
   (verificación en el checkpoint de compose, donde el server se reinicia).
