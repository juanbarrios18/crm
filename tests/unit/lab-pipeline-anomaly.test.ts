import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchesHandoffIntent } from "@/server/ai/handoff";

/**
 * T007 (P3 del plan `run_ejf1ffwxlmifjeeh315f`).
 *
 * Diagnóstico de los dos amarillos de pipeline tras handoff:
 * `pide_boleta_pago#1` y `reclama_no_recibido#2` quedaron en la etapa inicial
 * pese a `expectAdvance`.
 *
 * El plan pide distinguir tres hipótesis, no suponer la causa:
 * - H1: la anotación asíncrona no termina antes de leer la etapa.
 * - H2: el handoff temprano corta el guion antes de que exista señal exigible.
 * - H3: el lead sí cambia, pero la lectura/comparación de etapa no lo refleja.
 *
 * H1 y H3 quedan REFUTADAS por construcción del código (no por opinión):
 * - `runAgentTurn` espera la anotación con `settleAnnotation` y mueve el lead
 *   ANTES de retornar (`pipeline.ts`, bloque de anotación). El runner llama al
 *   turno con `await` y recién después lee la etapa: no hay carrera.
 * - `runConversation` lee `finalStage` DESPUÉS del bucle, con una consulta
 *   nueva a `getLeadStage`: no hay lectura cacheada ni comparación obsoleta.
 *
 * H2 queda CONFIRMADA por un experimento natural sobre el material congelado:
 * dentro de una misma persona, las repeticiones que escalaron temprano
 * ejecutaron menos turnos de cliente y no avanzaron, mientras que las que
 * llegaron al final del guion sí avanzaron. El corte ocurre exactamente en el
 * turno que dispara el handoff.
 *
 * Este test NO cambia expectativas ni esconde el hallazgo: fija la causa.
 */

const FIXTURE = path.join(
  process.cwd(),
  "tests/fixtures/lab/remediacion-ejf1-cases.json"
);
/**
 * Fuente completa (solo lectura) para el experimento natural: el fixture está
 * reducido a los casos etiquetados, y la correlación necesita las 39
 * observaciones para comparar repeticiones de una misma persona.
 */
const FULL_RUN = path.join(
  process.cwd(),
  "specs/008-medicion-contexto-agente/evidence/run_ejf1ffwxlmifjeeh315f-cases.jsonl"
);

type FixtureCase = {
  key: string;
  persona: string;
  repeatIndex: number;
  transcript: { role: "cliente" | "agente"; text: string }[];
  observed: {
    expectAdvance: boolean;
    advanced: boolean;
    initialStage: string | null;
    finalStage: string | null;
  };
};

type RunCase = {
  persona: string;
  repeat_index: number;
  transcript: { role: "cliente" | "agente"; text: string }[];
  expect_advance: boolean;
  advanced: boolean;
  initial_stage: string | null;
  final_stage: string | null;
};

function loadCases(): FixtureCase[] {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: FixtureCase[] };
  return raw.cases;
}

function loadFullRun(): RunCase[] {
  return readFileSync(FULL_RUN, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RunCase);
}

function clientTurns(c: FixtureCase): string[] {
  return c.transcript.filter((t) => t.role === "cliente").map((t) => t.text);
}

function runClientTurns(c: RunCase): string[] {
  return c.transcript.filter((t) => t.role === "cliente").map((t) => t.text);
}

const ANOMALIES = [
  { persona: "pide_boleta_pago", key: "pide_boleta_pago#1" },
  { persona: "reclama_no_recibido", key: "reclama_no_recibido#2" },
] as const;

describe("T007 — anomalías de pipeline tras handoff", () => {
  const cases = loadCases();

  it.each(ANOMALIES)(
    "$key no avanzó y quedó en la etapa inicial",
    ({ key }) => {
      const c = cases.find((x) => x.key === key);
      expect(c).toBeDefined();
      expect(c!.observed.expectAdvance).toBe(true);
      expect(c!.observed.advanced).toBe(false);
      expect(c!.observed.initialStage).toBe("Nuevo");
      expect(c!.observed.finalStage).toBe("Nuevo");
    }
  );

  it.each(ANOMALIES)(
    "$key se detuvo en el turno que dispara el handoff (causa H2)",
    ({ persona, key }) => {
      const c = cases.find((x) => x.key === key);
      expect(c).toBeDefined();
      const turns = clientTurns(c!);
      // El guion completo de la persona es más largo que lo ejecutado: el
      // handoff cortó la conversación antes de los turnos de compra.
      const fullScript = Math.max(
        ...loadFullRun()
          .filter((x) => x.persona === persona)
          .map((x) => runClientTurns(x).length)
      );
      expect(turns.length).toBeLessThan(fullScript);
      // El último turno ejecutado es justamente el que la red determinista
      // marca como disparador de escalado.
      const last = turns[turns.length - 1]!;
      expect(matchesHandoffIntent(last)).toBe(true);
    }
  );

  it("el avance correlaciona con llegar al final del guion, no con la persona", () => {
    const full = loadFullRun();
    for (const { persona } of ANOMALIES) {
      const reps = full
        .filter((c) => c.persona === persona)
        .sort((a, b) => a.repeat_index - b.repeat_index);
      expect(reps).toHaveLength(3);
      const fullScript = Math.max(...reps.map((r) => runClientTurns(r).length));
      for (const c of reps) {
        // Regla del experimento natural: si se ejecutó el guion completo,
        // avanzó; si el handoff lo cortó antes, quedó en la etapa inicial.
        if (runClientTurns(c).length === fullScript) {
          expect(c.advanced).toBe(true);
        } else {
          expect(c.advanced).toBe(false);
        }
      }
    }
  });

  it("el corte por handoff es condición NECESARIA pero no suficiente (control negativo)", () => {
    // Honestidad del diagnóstico: sobre las 39 observaciones, no toda
    // repetición truncada quedó sin avanzar. Hay DOS contraejemplos
    // (`cliente_recurrente#1`, `comprador_decidido#1`) que se cortaron antes
    // del final del guion y aun así avanzaron. Por lo tanto el corte por
    // handoff explica POR QUÉ no se ejecutan los turnos posteriores, pero no
    // alcanza por sí solo para explicar la etapa inicial: la diferencia es si
    // el lead YA había avanzado antes del turno de escalado.
    const full = loadFullRun();
    const truncated = full.filter((c) => {
      const reps = full.filter((r) => r.persona === c.persona);
      const fullScript = Math.max(...reps.map((r) => runClientTurns(r).length));
      return runClientTurns(c).length < fullScript;
    });
    const truncatedNotAdvanced = truncated.filter((c) => !c.advanced);
    const truncatedAdvanced = truncated.filter((c) => c.advanced);
    // Existen ambos casos: el corte no determina el resultado por sí solo.
    expect(truncatedNotAdvanced.length).toBeGreaterThan(0);
    expect(truncatedAdvanced.length).toBeGreaterThan(0);
    // Y las dos anomalías caen del lado que no avanzó.
    for (const { key } of ANOMALIES) {
      expect(truncatedNotAdvanced.some((c) => `${c.persona}#${c.repeat_index}` === key)).toBe(
        true
      );
    }
  });

  it("la señal de compra del turno inicial no se anotó antes del corte", () => {
    // El complemento del diagnóstico: en las dos anomalías el cliente declaró
    // intención de compra explícita ("quiero hacer un pedido") en el PRIMER
    // turno, y el lead seguía en la etapa inicial al momento del corte. Es
    // decir: además del corte, la anotación no promovió una señal de avance
    // explícita. Ese es el defecto de flujo a corregir o a justificar, no la
    // carrera (H1) ni la lectura (H3), ambas refutadas arriba.
    for (const { key } of ANOMALIES) {
      const c = cases.find((x) => x.key === key);
      const first = clientTurns(c!)[0] ?? "";
      expect(first.toLowerCase()).toContain("pedido");
      expect(c!.observed.finalStage).toBe("Nuevo");
    }
  });

  it("H1 refutada: el turno espera la anotación antes de retornar", () => {
    // Evidencia de código, no de comportamiento: el runner mide la etapa
    // después de `await runAgentTurn`, y el turno no retorna hasta cerrar la
    // anotación. Si eso cambiara, este test debe fallar para forzar revisión.
    const pipeline = readFileSync(
      path.join(process.cwd(), "src/server/ai/pipeline.ts"),
      "utf8"
    );
    expect(pipeline).toContain("await settleAnnotation(annotationPromise)");
    const runner = readFileSync(
      path.join(process.cwd(), "src/server/lab/runner.ts"),
      "utf8"
    );
    expect(runner).toContain("const timing = await runAgentTurn(convId)");
  });

  it("H3 refutada: la etapa final se lee con una consulta nueva tras el bucle", () => {
    const runner = readFileSync(
      path.join(process.cwd(), "src/server/lab/runner.ts"),
      "utf8"
    );
    // La lectura de la etapa final vive después del bucle de turnos y consulta
    // `getLeadStage` de nuevo (no reutiliza el valor inicial).
    const loopEnd = runner.indexOf("if (convRows[0]?.handoffAt) break;");
    const finalRead = runner.indexOf("const finalStage = await getLeadStage(contactId);");
    expect(loopEnd).toBeGreaterThan(-1);
    expect(finalRead).toBeGreaterThan(loopEnd);
  });
});
