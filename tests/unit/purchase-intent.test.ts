import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  declaresPurchaseIntent,
  PURCHASE_INTENT_REGEX,
  resolvePurchaseIntentTarget,
} from "@/server/ai/purchase-intent";

/**
 * P3 (plan `run_ejf1ffwxlmifjeeh315f`).
 *
 * Red determinista de intención de compra. El diagnóstico de
 * `tests/unit/lab-pipeline-anomaly.test.ts` mostró que en las dos anomalías
 * (`pide_boleta_pago#1`, `reclama_no_recibido#2`) la anotación del modelo no
 * promovió una señal de compra explícita del primer turno ("quiero hacer un
 * pedido"), amplificado por el corte temprano del handoff.
 *
 * Este módulo es la RED de alta precisión: no reemplaza al modelo, cubre el
 * caso explícito antes/independiente de él. Un falso positivo mueve un lead sin
 * señal real, así que la calibración es deliberadamente estrecha.
 */

const FIXTURE = path.join(
  process.cwd(),
  "tests/fixtures/lab/remediacion-ejf1-cases.json"
);

type FixtureCase = {
  persona: string;
  transcript: { role: "cliente" | "agente"; text: string }[];
};

/** Primer turno del cliente de la persona, leído de la evidencia congelada. */
function firstClientTurn(persona: string): string {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    cases: FixtureCase[];
  };
  const c = raw.cases.find((x) => x.persona === persona);
  if (!c) throw new Error(`persona no encontrada en el fixture: ${persona}`);
  const turn = c.transcript.find((t) => t.role === "cliente");
  if (!turn) throw new Error(`la persona no tiene turno de cliente: ${persona}`);
  return turn.text;
}

describe("declaresPurchaseIntent — red determinista de intención de compra", () => {
  it.each([
    "quiero hacer un pedido",
    "quiero hacer un pedido para mi negocio",
    "quiero pedir",
    "quiero comprar",
    "quiero encargar",
    "quiero repetir el pedido de siempre",
    "vengo a pedir",
    "vengo a comprar",
    "necesito hacer un pedido",
    "necesito pedir",
    "necesito comprar",
    "me gustaría hacer un pedido",
    "quería hacer un pedido",
    "quiero empezar a comprarles pan",
    "quiero dejar encargado",
    "quiero cerrar el pedido",
    "quiero confirmar el pedido",
    "vengo a encargar",
    "voy a transferir",
    "quiero transferir",
    "transfiero hoy",
    "pásame los datos para transferir",
    "quiero pagar",
    "¿cómo pago?",
  ])("detecta la declaración explícita en primera persona: %s", (text) => {
    expect(declaresPurchaseIntent(text)).toBe(true);
  });

  it.each([
    "cuanto sale la bolsa de brioche de 12?", // consulta de precio
    "y el de 20?", // consulta de precio
    "me pueden emitir boleta?", // consulta de capacidad
    "hay descuento si llevo hartas?", // lo cubre la red de handoff
    "ok, lo voy a pensar", // declinación
    "hola, buenas", // saludo
    "necesito una solucion ahora", // reclamo, no compra
    "prefiero que me atienda una persona", // handoff, no compra
    "y cuanto seria el total?", // pregunta sobre un pedido ya existente
  ])("NO dispara con señal débil o ambigua: %s", (text) => {
    expect(declaresPurchaseIntent(text)).toBe(false);
  });

  it("detecta el turno inicial medido de pide_boleta_pago", () => {
    const first = firstClientTurn("pide_boleta_pago");
    expect(first).toBe("hola, quiero hacer un pedido para mi negocio");
    expect(declaresPurchaseIntent(first)).toBe(true);
  });

  it("detecta el turno inicial medido de reclama_no_recibido", () => {
    const first = firstClientTurn("reclama_no_recibido");
    expect(first).toBe("hola, quiero hacer un pedido para mi negocio");
    expect(declaresPurchaseIntent(first)).toBe(true);
  });

  it("el texto vacío no declara nada", () => {
    expect(declaresPurchaseIntent("")).toBe(false);
  });

  it("expone el patrón como constante documentada", () => {
    expect(PURCHASE_INTENT_REGEX).toBeInstanceOf(RegExp);
  });
});

/**
 * Posiciones reales del pipeline sembrado (`on-signup.ts` / criterios de
 * Lamas Foods): Nuevo=0, En conversación=1, Interesado=2, Cliente=3 (won),
 * Perdido=4 (lost).
 */
const STAGES = [
  { id: "stg_nuevo", position: 0, kind: "open" },
  { id: "stg_conv", position: 1, kind: "open" },
  { id: "stg_int", position: 2, kind: "open" },
  { id: "stg_cliente", position: 3, kind: "won" },
  { id: "stg_perdido", position: 4, kind: "lost" },
] as const;

const OPEN_STAGES = STAGES.filter((s) => s.kind === "open").map(
  ({ id, position }) => ({ id, position })
);

describe("resolvePurchaseIntentTarget — regla de avance determinista", () => {
  it("etapa inicial + intención → siguiente etapa abierta", () => {
    expect(
      resolvePurchaseIntentTarget({
        declaresIntent: true,
        currentStage: { id: "stg_nuevo", position: 0, kind: "open" },
        openStages: OPEN_STAGES,
      })
    ).toEqual({ id: "stg_conv" });
  });

  it("etapa inicial sin intención → null", () => {
    expect(
      resolvePurchaseIntentTarget({
        declaresIntent: false,
        currentStage: { id: "stg_nuevo", position: 0, kind: "open" },
        openStages: OPEN_STAGES,
      })
    ).toBeNull();
  });

  it("ya avanzado a Interesado + intención → null (no salta ni re-avanza)", () => {
    expect(
      resolvePurchaseIntentTarget({
        declaresIntent: true,
        currentStage: { id: "stg_int", position: 2, kind: "open" },
        openStages: OPEN_STAGES,
      })
    ).toBeNull();
  });

  it("en Cliente (ganado) + intención → null (no override)", () => {
    expect(
      resolvePurchaseIntentTarget({
        declaresIntent: true,
        currentStage: { id: "stg_cliente", position: 3, kind: "won" },
        openStages: OPEN_STAGES,
      })
    ).toBeNull();
  });

  it("en Perdido (perdido) + intención → null (no revive un lead perdido)", () => {
    expect(
      resolvePurchaseIntentTarget({
        declaresIntent: true,
        currentStage: { id: "stg_perdido", position: 4, kind: "lost" },
        openStages: OPEN_STAGES,
      })
    ).toBeNull();
  });

  it("sin etapa actual (lead sin fila) → null", () => {
    expect(
      resolvePurchaseIntentTarget({
        declaresIntent: true,
        currentStage: null,
        openStages: OPEN_STAGES,
      })
    ).toBeNull();
  });

  it("etapa inicial sin siguiente etapa abierta → null", () => {
    expect(
      resolvePurchaseIntentTarget({
        declaresIntent: true,
        currentStage: { id: "stg_nuevo", position: 0, kind: "open" },
        openStages: [{ id: "stg_nuevo", position: 0 }],
      })
    ).toBeNull();
  });
});
