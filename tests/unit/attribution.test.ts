import { describe, expect, it } from "vitest";
import { parseReferral } from "@/server/inbox/attribution";
import type { WebhookMessage } from "@/server/inbox/webhook";

/**
 * Atribución de anuncios de clic a WhatsApp: el parser del objeto `referral`
 * que Meta adjunta al primer mensaje de la conversación. Son funciones puras;
 * la persistencia se ejercita en el self-test E2E.
 */
describe("parseReferral", () => {
  it("referral completo devuelve los cuatro campos", () => {
    const result = parseReferral({
      source_id: "120210000000000000",
      ctwa_clid: "clic-abc-123",
      headline: "Envío gratis hoy",
      source_url: "https://fb.me/anuncio",
    });
    expect(result).toEqual({
      sourceId: "120210000000000000",
      ctwaClid: "clic-abc-123",
      headline: "Envío gratis hoy",
      sourceUrl: "https://fb.me/anuncio",
    });
  });

  it("sin referral (undefined o null) devuelve null", () => {
    expect(parseReferral(undefined)).toBeNull();
    expect(parseReferral(null)).toBeNull();
  });

  it("referral parcial (solo source_id) deja el resto en null y no rompe", () => {
    expect(parseReferral({ source_id: "solo-fuente" })).toEqual({
      sourceId: "solo-fuente",
      ctwaClid: null,
      headline: null,
      sourceUrl: null,
    });
  });

  it("campos desconocidos extra se ignoran sin error", () => {
    const result = parseReferral({
      source_id: "anuncio-1",
      ctwa_clid: "clic-1",
      desconocido: "se ignora",
      anidado: { a: 1 },
    });
    expect(result).toEqual({
      sourceId: "anuncio-1",
      ctwaClid: "clic-1",
      headline: null,
      sourceUrl: null,
    });
  });

  it("tipos inválidos degradan el campo a null sin lanzar", () => {
    expect(() => parseReferral({ source_id: 123 })).not.toThrow();
    expect(parseReferral({ source_id: 123 })).toBeNull();

    expect(parseReferral({ source_id: "anuncio-2", ctwa_clid: 999 })).toEqual({
      sourceId: "anuncio-2",
      ctwaClid: null,
      headline: null,
      sourceUrl: null,
    });
  });

  it("objeto sin ningún campo útil devuelve null", () => {
    expect(parseReferral({})).toBeNull();
    expect(parseReferral({ otro: "valor" })).toBeNull();
  });

  it("entrada que no es un objeto devuelve null", () => {
    expect(parseReferral("referral")).toBeNull();
    expect(parseReferral(42)).toBeNull();
    expect(parseReferral([])).toBeNull();
  });
});

describe("WebhookMessage con referral", () => {
  it("acepta el campo referral opcional en el tipo", () => {
    const msg: WebhookMessage = {
      id: "wamid.x",
      timestamp: "1722800000",
      type: "text",
      text: { body: "hola" },
      referral: { source_id: "anuncio-1" },
    };
    expect(msg.referral).toEqual({ source_id: "anuncio-1" });
  });
});
