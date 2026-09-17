import { describe, expect, it } from "vitest";
import {
  HUMAN_ORIGIN_MARK,
  isBotOutbound,
  toConversationHistory,
  type HistoryMessage,
} from "@/server/ai/history";

/**
 * P5 — roles del historial: el cliente, el bot y las personas del negocio no
 * pueden confundirse. El proveedor solo admite `system | user | assistant`, así
 * que el saliente humano se marca en el texto.
 */

function msg(partial: Partial<HistoryMessage>): HistoryMessage {
  return {
    direction: "out",
    origin: "operator",
    aiGenerated: false,
    text: "texto",
    ...partial,
  };
}

describe("roles del historial (P5)", () => {
  it("un entrante es del cliente, sin importar el origen", () => {
    const result = toConversationHistory([
      msg({ direction: "in", text: "¿tienen pan?" }),
    ]);
    expect(result).toEqual([{ role: "user", content: "¿tienen pan?" }]);
  });

  it("un saliente del bot (origin ai) es assistant, SIN marca", () => {
    const result = toConversationHistory([
      msg({ origin: "ai", aiGenerated: true, text: "Sí, tenemos." }),
    ]);
    expect(result).toEqual([{ role: "assistant", content: "Sí, tenemos." }]);
    expect(result[0]!.content).not.toContain(HUMAN_ORIGIN_MARK);
  });

  it("un saliente humano del CRM (operator) es user CON marca", () => {
    const result = toConversationHistory([
      msg({ origin: "operator", text: "Le confirmo yo el pedido." }),
    ]);
    expect(result).toEqual([
      { role: "user", content: `${HUMAN_ORIGIN_MARK}: Le confirmo yo el pedido.` },
    ]);
  });

  it("un saliente manual desde la app de WhatsApp es user CON marca", () => {
    const result = toConversationHistory([
      msg({ origin: "manual", text: "Respondido desde el teléfono." }),
    ]);
    expect(result[0]?.role).toBe("user");
    expect(result[0]?.content).toContain(HUMAN_ORIGIN_MARK);
  });

  it("una plantilla es user CON marca", () => {
    const result = toConversationHistory([
      msg({ origin: "template", text: "Recordatorio de pedido." }),
    ]);
    expect(result[0]?.role).toBe("user");
    expect(result[0]?.content).toContain(HUMAN_ORIGIN_MARK);
  });

  it("los cuatro orígenes quedan distinguibles en un mismo historial", () => {
    const result = toConversationHistory([
      msg({ direction: "in", origin: "operator", text: "hola" }),
      msg({ origin: "ai", aiGenerated: true, text: "respuesta del bot" }),
      msg({ origin: "operator", text: "respuesta de una persona" }),
      msg({ origin: "manual", text: "respuesta desde el teléfono" }),
    ]);
    expect(result.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "user",
    ]);
    // Solo los dos primeros hablan "en nombre propio" del agente; los dos
    // humanos van marcados para que el modelo no los dé por suyos.
    expect(result[1]!.content).toBe("respuesta del bot");
    expect(result[2]!.content).toContain(HUMAN_ORIGIN_MARK);
    expect(result[3]!.content).toContain(HUMAN_ORIGIN_MARK);
  });

  it("un turno de operador entre dos del bot queda distinguible", () => {
    const result = toConversationHistory([
      msg({ origin: "ai", aiGenerated: true, text: "bot 1" }),
      msg({ origin: "operator", text: "persona 1" }),
      msg({ origin: "ai", aiGenerated: true, text: "bot 2" }),
    ]);
    expect(result[0]).toEqual({ role: "assistant", content: "bot 1" });
    expect(result[1]!.role).toBe("user");
    expect(result[1]!.content).toContain(HUMAN_ORIGIN_MARK);
    expect(result[2]).toEqual({ role: "assistant", content: "bot 2" });
  });

  it("un saliente de IA anterior a la columna origin se lee como del bot", () => {
    // 008 introdujo `origin` con default "operator": el historial viejo del bot
    // quedó con aiGenerated en true y origin en "operator". Sin el fallback de
    // aiGenerated, se leería como si lo hubiera escrito una persona.
    expect(isBotOutbound({ origin: "operator", aiGenerated: true })).toBe(true);
    const result = toConversationHistory([
      msg({ origin: "operator", aiGenerated: true, text: "bot legacy" }),
    ]);
    expect(result).toEqual([{ role: "assistant", content: "bot legacy" }]);
  });

  it("ignora mensajes sin texto (adjuntos, eventos) y conserva el orden", () => {
    const result = toConversationHistory([
      msg({ direction: "in", text: "uno" }),
      msg({ direction: "in", text: null }),
      msg({ origin: "ai", aiGenerated: true, text: "dos" }),
      msg({ origin: "operator", text: "tres" }),
    ]);
    expect(result.map((m) => m.content.split(": ").pop())).toEqual([
      "uno",
      "dos",
      "tres",
    ]);
  });

  it("un historial vacío devuelve un arreglo vacío", () => {
    expect(toConversationHistory([])).toEqual([]);
  });

  it("en modo plain-assistant el humano va como assistant sin marca (anotación)", () => {
    const result = toConversationHistory(
      [
        msg({ direction: "in", text: "hola" }),
        msg({ origin: "operator", text: "responde una persona" }),
      ],
      { humanOutbound: "plain-assistant" }
    );
    expect(result).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "responde una persona" },
    ]);
    expect(result[1]!.content).not.toContain(HUMAN_ORIGIN_MARK);
  });

  it("el bot no se marca en ningún modo", () => {
    const history = [msg({ origin: "ai", aiGenerated: true, text: "bot" })];
    expect(
      toConversationHistory(history, { humanOutbound: "plain-assistant" })
    ).toEqual([{ role: "assistant", content: "bot" }]);
    expect(toConversationHistory(history)).toEqual([
      { role: "assistant", content: "bot" },
    ]);
  });
});
