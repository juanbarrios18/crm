import { describe, expect, it } from "vitest";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { PERSONAS } from "@/server/lab/personas";

describe("patrón de respaldo de handoff (FR-022 / SC-006)", () => {
  it.each([
    "quiero hablar con un humano",
    "¿puedo hablar con un asesor?",
    "necesito comunicarme con alguien",
    "quiero contactar a una persona real",
    "quiero hablar con alguien por favor",
    "me pasas a un asesor",
    "prefiero atención humana",
    "atencion humana por favor",
  ])("dispara: %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(true);
  });

  it.each([
    "somos 4 personas", // el caso canónico que NO debe disparar
    "somos cuatro personas y queremos reservar",
    "¿tienen taladros?",
    "la persona que me atendió ayer fue amable",
    "mi humano favorito es mi hijo",
    "el asesor fiscal ya me cobró", // sin verbo de contacto ni "un asesor"
  ])("NO dispara: %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(false);
  });
});

/**
 * P7 — acotar el patrón. La alternativa suelta `un asesor` abortaba la
 * conversación ante una mención de paso, y el costo de un falso positivo es una
 * venta en curso. El costo de un falso negativo lo cubre el modelo en la vía
 * principal, que es el mecanismo real: este patrón es la red.
 */
describe("P7 — el objeto humano solo dispara con verbo de contacto", () => {
  it.each([
    "quiero hablar con un asesor",
    "derívame con un humano",
    "pásame con una persona del equipo",
    "me pasas a un asesor",
  ])("dispara (petición real): %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(true);
  });

  it.each([
    "¿cuánto cobra un asesor de eventos?", // mención de paso: ya no aborta
    "un asesor me dijo que sí", // reporta lo que otro dijo
    "necesito un asesor para mi empresa", // describe una necesidad, no pide contacto
    "el asesor de mi hermano trabaja ahí",
  ])("NO dispara (mención suelta, la conversación sigue): %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(false);
  });

  it.each([
    "¿me pasas los datos de transferencia?",
    "¿me pasas el precio del pan de hamburguesa?",
    "pásame el catálogo de panes",
  ])("NO dispara: 'pasa' sin objeto humano: %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(false);
  });

  it("'atiéndanme entre varios' NO dispara: 'atiendan' es ambiguo con horarios", () => {
    // Criterio documentado: "¿atienden los sábados?" es una consulta de horarios,
    // no una petición de humano. El patrón no puede distinguirlas, así que no
    // aborta por sí solo; lo resuelve el modelo en la vía principal.
    expect(matchesHandoffIntent("atiéndanme entre varios")).toBe(false);
    expect(matchesHandoffIntent("¿atienden los sábados?")).toBe(false);
  });

  it("la persona pide_humano del Laboratorio sigue escalando", () => {
    // El guion vive en el producto: si cambia, este test lo sigue en vez de
    // quedarse con una copia desactualizada. Basta una línea que dispare, porque
    // el runner corta el guion al primer handoff.
    const persona = PERSONAS.find((p) => p.key === "pide_humano");
    expect(persona).toBeDefined();
    expect(persona!.script.some((line) => matchesHandoffIntent(line))).toBe(true);
  });
});
