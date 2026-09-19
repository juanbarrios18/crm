import { describe, expect, it } from "vitest";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { isRepeatedGreeting } from "@/server/ai/reply-guard";
import { CLOSING_FAREWELL_HUMAN } from "@/server/ai/prompts";

/**
 * 008 — Escalada y cierre deterministas (auditoría A3 y A4).
 *
 * La configuración del negocio ya manda escalar ante una queja o un pedido de
 * descuento, pero el cumplimiento era solo del modelo: en PROD `cliente_enojado`
 * rep0 no escaló y reps 1-2 sí, y el pedido de descuento no escaló nunca. Estos
 * disparadores son una red determinista ANTES del modelo.
 */

describe("matchesHandoffIntent (008) — queja y descuento", () => {
  it.each([
    "estoy muy molesto con el pedido anterior",
    "quiero poner una queja",
    "no me llegó el pedido completo",
    "me cobraron de más",
    "hay descuento si llevo hartas?",
    "¿me hacen mejor precio por volumen?",
    "quiero hablar con un humano",
  ])("escala con: %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(true);
  });

  it("'atienda' solo no dispara: es ambiguo (¿atienden los sábados?)", () => {
    // Decisión documentada del patrón de respaldo: exige verbo de CONTACTO.
    // La persona que pide un humano lo dice con "hablar con un humano" o similar.
    expect(matchesHandoffIntent("prefiero que me atienda una persona")).toBe(false);
  });

  it("no escala por una mención suelta del objeto humano", () => {
    // El patrón de respaldo exige verbo de contacto cerca del objeto.
    expect(matchesHandoffIntent("un asesor me dijo que sí")).toBe(false);
  });

  it("no confunde el modelo de venta del negocio con una queja", () => {
    // "venta al por mayor" es el negocio; no debe disparar escalado.
    expect(matchesHandoffIntent("trabajamos la venta al por mayor")).toBe(false);
  });
});

describe("matchesHandoffIntent (008 P2) — precio especial, documento e historial", () => {
  it.each([
    "y si llevo 20 me hacen precio?",
    "si compro 30 me dejan mejor precio?",
    "y si pido 50, hay descuento?",
    "por 20 me hacen precio?",
    "me mandan la boleta al correo?",
    "me la envian al correo?",
    "me puedes decir que pedidos tengo pendientes?",
    "quiero ver mi historial de compras",
  ])("escala con: %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(true);
  });

  it.each([
    // Consulta de precio con número: el número suelto NO es una cantidad
    // condicional. Un falso positivo acá cortaría una venta en curso.
    "cuanto sale la bolsa de brioche de 12?",
    "y el de 20?",
    "cuanto sale la bolsa de 20 cm?",
    // Emitir la boleta es una capacidad del negocio; solo el ENVÍO por correo
    // exige escalado.
    "me pueden emitir boleta?",
    // El modelo de venta del negocio no es una queja.
    "trabajamos la venta al por mayor",
    // "atienda" sin verbo de contacto es ambiguo (¿atienden los sábados?).
    "prefiero que me atienda una persona",
    // Consulta de producto sin construcción condicional.
    "y el pan de molde blanco XL?",
  ])("no escala con: %s", (text) => {
    expect(matchesHandoffIntent(text)).toBe(false);
  });
});

describe("isRepeatedGreeting (008) — variantes cortas", () => {
  const ctx = (agentTurnsBefore: number) => ({
    greeting: "Hola, somos el equipo comercial de Lamas Foods. ¿Qué pan necesita?",
    agentTurnsBefore,
  });

  it("detecta una variante que no reproduce el saludo configurado", () => {
    expect(
      isRepeatedGreeting("Hola, le saluda Lamas Foods. El pan está a $3.600.", ctx(1))
    ).toBe(true);
  });

  it("no veta el primer turno del agente", () => {
    expect(isRepeatedGreeting("Hola, somos el equipo comercial.", ctx(0))).toBe(false);
  });

  it("no veta una respuesta que no saluda", () => {
    expect(isRepeatedGreeting("El pan de completo está a $3.600.", ctx(2))).toBe(false);
  });
});

describe("CLOSING_FAREWELL_HUMAN (008)", () => {
  it("comunica que una persona va a atender el caso", () => {
    expect(CLOSING_FAREWELL_HUMAN.toLowerCase()).toContain("una persona");
    expect(CLOSING_FAREWELL_HUMAN.toLowerCase()).toContain("equipo comercial");
  });

  it("no es la despedida genérica", () => {
    expect(CLOSING_FAREWELL_HUMAN).not.toContain("¡Buen día!");
  });
});
