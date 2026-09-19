import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDeliveryEligibility,
  checkFreeDelivery,
  checkInventedCapability,
  checkInventedDeadline,
  declaresNaturalPerson,
  offersDelivery,
} from "@/server/ai/commercial-rules";

/**
 * P1a/P1b/P1c del plan `run_ejf1ffwxlmifjeeh315f`.
 *
 * El guard comercial es determinista y puro: no infiere la condición del
 * cliente (la recibe como hecho declarado) y verifica la respuesta del agente
 * contra las reglas comerciales de la instantánea congelada. Los casos se
 * anclan a `tests/fixtures/lab/remediacion-ejf1-cases.json` para no reescribir
 * la evidencia a mano.
 */

type FixtureCase = {
  key: string;
  transcript: { role: "cliente" | "agente"; text: string }[];
};

const FIXTURE = path.join(process.cwd(), "tests/fixtures/lab/remediacion-ejf1-cases.json");
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: FixtureCase[] };

/** Texto exacto de un turno del fixture, localizado por un fragmento estable. */
function turnText(key: string, needle: string): string {
  const c = fixture.cases.find((x) => x.key === key);
  if (!c) throw new Error(`fixture case not found: ${key}`);
  const turn = c.transcript.find((t) => t.text.includes(needle));
  if (!turn) throw new Error(`turn not found in ${key}: ${needle}`);
  return turn.text;
}

describe("declaresNaturalPerson", () => {
  it("detecta la declaración de uso personal del fixture consumidor_final#0", () => {
    expect(declaresNaturalPerson(turnText("consumidor_final#0", "para mi casa"))).toBe(true);
  });

  it("detecta variantes de declaración personal", () => {
    for (const text of [
      "quiero pan para mi familia",
      "es para consumo propio",
      "soy particular",
      "no tengo empresa",
      "para mi hogar",
      "en mi casa necesitamos pan",
    ]) {
      expect(declaresNaturalPerson(text), text).toBe(true);
    }
  });

  it("no marca a un comprador que declara negocio", () => {
    expect(declaresNaturalPerson(turnText("comprador_decidido#0", "tengo un local"))).toBe(false);
    expect(declaresNaturalPerson("necesito pan para mi negocio")).toBe(false);
  });
});

describe("offersDelivery", () => {
  it("detecta la oferta de despacho a domicilio del fixture", () => {
    expect(offersDelivery(turnText("consumidor_final#0", "podemos despachar a domicilio"))).toBe(
      true
    );
  });

  it("detecta el encaminamiento de despacho del fixture consumidor_final#2", () => {
    expect(offersDelivery(turnText("consumidor_final#2", "coordinar el despacho"))).toBe(true);
  });

  it("no marca una respuesta que solo ofrece retiro", () => {
    expect(offersDelivery(turnText("consumidor_final#2", "el retiro en nuestra planta"))).toBe(
      false
    );
  });
});

describe("checkDeliveryEligibility", () => {
  it("marca despacho ofrecido a persona natural (fixture consumidor_final#0)", () => {
    const reply = turnText("consumidor_final#0", "podemos despachar a domicilio");
    expect(checkDeliveryEligibility(reply, { clientIsNaturalPerson: true }).map((v) => v.kind)).toEqual(
      ["elegibilidad_despacho"]
    );
  });

  it("marca el encaminamiento de despacho del fixture consumidor_final#2", () => {
    const reply = turnText("consumidor_final#2", "coordinar el despacho");
    expect(checkDeliveryEligibility(reply, { clientIsNaturalPerson: true })).toHaveLength(1);
  });

  it("no marca a un comprador de negocio con despacho", () => {
    const reply = "Podemos despachar a su local; el despacho tiene tarifa según la comuna.";
    expect(checkDeliveryEligibility(reply, { clientIsNaturalPerson: false })).toEqual([]);
  });

  it("nunca marca una respuesta que solo ofrece retiro", () => {
    const reply = turnText("consumidor_final#2", "el retiro en nuestra planta");
    expect(checkDeliveryEligibility(reply, { clientIsNaturalPerson: true })).toEqual([]);
  });

  it("no marca la NEGACIÓN correcta que menciona despacho (control negativo)", () => {
    // El plan exige que la respuesta segura y la corrección correcta no caigan.
    // Sin guarda de negación, "no ofrecemos despacho" dispararía el hallazgo.
    for (const reply of [
      "Para persona natural no ofrecemos despacho, solo retiro en planta con boleta.",
      "El despacho a domicilio está disponible únicamente para negocios con inicio de actividades.",
      "No incluye despacho.",
      "El despacho no está disponible para persona natural.",
    ]) {
      expect(checkDeliveryEligibility(reply, { clientIsNaturalPerson: true })).toEqual([]);
    }
  });

  it("sigue marcando una oferta real que además contiene una negación incidental", () => {
    // Guarda de precisión: "No se preocupe, podemos despachar a domicilio" SÍ es
    // una oferta a persona natural y no debe quedar suprimida por el "No".
    const reply =
      "No se preocupe, podemos despachar a domicilio. El mínimo para despacho es de 15 bolsas.";
    expect(checkDeliveryEligibility(reply, { clientIsNaturalPerson: true })).toHaveLength(1);
  });
});

describe("checkFreeDelivery", () => {
  it("marca el despacho sin costo del fixture comprador_decidido#0", () => {
    const reply = turnText("comprador_decidido#0", "despacho sin costo adicional");
    expect(checkFreeDelivery(reply).map((v) => v.kind)).toEqual(["despacho_gratuito"]);
  });

  it("no marca una negación explícita", () => {
    expect(checkFreeDelivery("no ofrecemos despacho sin costo")).toEqual([]);
    expect(checkFreeDelivery("no ofrecemos despacho sin costo adicional")).toEqual([]);
    expect(checkFreeDelivery("el despacho no es gratis")).toEqual([]);
  });

  it("no marca una cotización normal de despacho con tarifa", () => {
    expect(checkFreeDelivery("El despacho a su comuna tiene un costo de $5.000.")).toEqual([]);
  });
});

describe("checkInventedDeadline", () => {
  it("marca 48 horas hábiles cuando la fuente dice 48 horas", () => {
    const reply = turnText("comprador_decidido#2", "48 horas hábiles");
    const out = checkInventedDeadline(reply, "producción desde confirmación del pago y 48 horas");
    expect(out.map((v) => v.kind)).toEqual(["plazo_inventado"]);
  });

  it("no marca si la fuente misma dice hábiles", () => {
    expect(checkInventedDeadline("se cuentan 48 horas hábiles", "48 horas hábiles")).toEqual([]);
  });

  it("48 horas sin calificativo nunca se marca", () => {
    expect(
      checkInventedDeadline("desde ahí corren 48 horas para el despacho", "48 horas")
    ).toEqual([]);
  });
});

describe("checkInventedCapability", () => {
  it("marca la promesa de revisar historial del fixture cliente_recurrente#0", () => {
    const reply = turnText("cliente_recurrente#0", "puedo revisar su historial");
    expect(checkInventedCapability(reply).map((v) => v.kind)).toEqual(["capacidad_inventada"]);
  });

  it("no marca una negación honesta de acceso", () => {
    expect(checkInventedCapability("No tengo acceso a su historial de pedidos")).toEqual([]);
    expect(
      checkInventedCapability("lamento informarle que no tengo acceso a su historial")
    ).toEqual([]);
  });
});
