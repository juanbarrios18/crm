import { describe, expect, it } from "vitest";
import { isOrphanRun, ORPHAN_GRACE_MS } from "@/server/lab/orphan-runs";

/**
 * Regla de limpieza de corridas huérfanas al arranque. La corrida headless
 * (`pnpm lab:run`) vive en OTRO proceso: un `pnpm dev` que arranca en el medio
 * no puede darla por muerta. En producción un arranque sí implica que el runner
 * murió (corre dentro del server), así que ahí se conserva la regla vieja.
 */

const now = new Date("2026-09-18T00:00:00Z");

describe("isOrphanRun", () => {
  it("en producción toda corrida running es huérfana al arrancar", () => {
    expect(isOrphanRun({ startedAt: now, now, isProduction: true })).toBe(true);
  });

  it("fuera de producción respeta una corrida reciente (puede ser headless)", () => {
    const startedAt = new Date(now.getTime() - 10 * 60 * 1000);
    expect(isOrphanRun({ startedAt, now, isProduction: false })).toBe(false);
  });

  it("fuera de producción sí limpia una corrida más vieja que la gracia", () => {
    const startedAt = new Date(now.getTime() - ORPHAN_GRACE_MS - 1);
    expect(isOrphanRun({ startedAt, now, isProduction: false })).toBe(true);
  });
});
