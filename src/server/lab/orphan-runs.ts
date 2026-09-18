/**
 * Regla de limpieza de corridas huérfanas al arranque del servidor.
 *
 * El runner del Laboratorio vive dentro del proceso que lo dispara. En
 * producción ese proceso es el server: si el server arranca, cualquier corrida
 * `running` quedó sin dueño y se marca fallida (FR-034).
 *
 * Fuera de producción NO se puede asumir eso: `pnpm lab:run` ejecuta el runner
 * en su propio proceso, y `pnpm dev` arranca y se recompila todo el tiempo. Un
 * arranque del server en el medio daba por muerta una corrida headless viva
 * (medido el 2026-09-18: 17 de 39 casos perdidos). Por eso en desarrollo solo
 * se limpian las corridas más viejas que la gracia, que es el propio timeout
 * del runner: pasado ese plazo, ningún runner legítimo sigue vivo.
 */

/** Igual al timeout global del runner (`RUN_TIMEOUT_MS` en runner.ts). */
export const ORPHAN_GRACE_MS = 30 * 60 * 1000;

export function isOrphanRun(input: {
  startedAt: Date;
  now: Date;
  isProduction: boolean;
}): boolean {
  if (input.isProduction) return true;
  return input.now.getTime() - input.startedAt.getTime() > ORPHAN_GRACE_MS;
}
