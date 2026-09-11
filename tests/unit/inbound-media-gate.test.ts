import { describe, expect, it } from "vitest";
import { isInboundMediaBlocked } from "@/server/inbox/ingest";

/**
 * 008 — Gate de adjuntos entrantes. La integración completa (mensaje → hilo +
 * aviso, sin asset) se ejercita en el self-test E2E.
 */
describe("isInboundMediaBlocked (gate de adjuntos)", () => {
  it("bloquea tipos binarios cuando el gate está activo (media disabled)", () => {
    for (const type of ["image", "audio", "video", "document", "sticker"]) {
      expect(isInboundMediaBlocked(type, false)).toBe(true);
    }
  });

  it("no bloquea cuando el procesamiento está habilitado", () => {
    for (const type of ["image", "audio", "video", "document", "sticker"]) {
      expect(isInboundMediaBlocked(type, true)).toBe(false);
    }
  });

  it("no bloquea texto", () => {
    expect(isInboundMediaBlocked("text", false)).toBe(false);
  });

  it("no bloquea payloads estructurados (ubicación/contactos), sin archivo", () => {
    expect(isInboundMediaBlocked("location", false)).toBe(false);
    expect(isInboundMediaBlocked("contacts", false)).toBe(false);
  });

  it("no bloquea tipos desconocidos (el webhook ya los filtra aparte)", () => {
    expect(isInboundMediaBlocked("reaction", false)).toBe(false);
  });
});