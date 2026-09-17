import type { ChatMessage } from "@/lib/ai";

/**
 * Roles del historial de la conversación (P5).
 *
 * El proveedor admite SOLO `system | user | assistant`, así que un saliente
 * escrito por una persona del negocio no puede viajar como rol propio: se marca
 * en el TEXTO con `HUMAN_ORIGIN_MARK`, y N2 en `prompts.ts` explica la marca al
 * modelo. Sin la marca, el modelo lee una respuesta escrita por una persona del
 * equipo como si fuera suya y la repite, la contradice o la da por dicha.
 *
 * La marca aplica ÚNICAMENTE al prompt del agente. El transcript del Laboratorio
 * y el prompt del juez mapean por `direction` (cliente/agente) y no la usan.
 */

/** Marca que distingue un saliente humano dentro del prompt del agente. */
export const HUMAN_ORIGIN_MARK = "[ATENCIÓN HUMANA DEL NEGOCIO]";

/** Fila mínima del historial que necesita el mapeo (testeable sin la base). */
export type HistoryMessage = {
  direction: string;
  origin: string;
  aiGenerated: boolean;
  text: string | null;
};

/**
 * ¿El saliente lo escribió el agente?
 *
 * `origin === "ai"` es la marca explícita que deja el pipeline. `aiGenerated`
 * cubre los salientes de IA anteriores a la columna `origin` (008): esa columna
 * nació con default `"operator"`, así que sin este segundo criterio todo el
 * historial viejo del bot se leería como si lo hubiera escrito una persona.
 */
export function isBotOutbound(message: {
  origin: string;
  aiGenerated: boolean;
}): boolean {
  return message.origin === "ai" || message.aiGenerated;
}

/**
 * Cómo representar un saliente HUMANO en el historial. Los roles del proveedor
 * son solo `system | user | assistant`, así que la persona del negocio no tiene
 * rol propio y hay que elegir una representación por llamada.
 *
 * - `"marked-user"` (conversación): el humano viaja como `user` con
 *   `HUMAN_ORIGIN_MARK` delante. Es la representación que explica N2.
 * - `"plain-assistant"` (anotación): el humano viaja como `assistant`, sin
 *   marca, igual que antes de P5. La anotación es extracción pura, su prompt no
 *   trae N2 y un marcador sin explicación sería ruido.
 */
export type HumanOutboundMode = "marked-user" | "plain-assistant";

/**
 * Traduce el historial de la base al historial de una llamada al proveedor.
 *
 * Un entrante es del cliente (`user`). Un saliente del bot es suyo
 * (`assistant`). Un saliente humano se representa según `humanOutbound`.
 * Conserva el orden cronológico tal como llega y descarta lo que no tiene texto
 * (adjuntos y eventos sin cuerpo).
 */
export function toConversationHistory(
  history: readonly HistoryMessage[],
  opts?: { humanOutbound?: HumanOutboundMode }
): ChatMessage[] {
  const mode = opts?.humanOutbound ?? "marked-user";
  const messages: ChatMessage[] = [];
  for (const message of history) {
    if (!message.text) continue;
    if (message.direction === "in") {
      messages.push({ role: "user", content: message.text });
    } else if (isBotOutbound(message)) {
      messages.push({ role: "assistant", content: message.text });
    } else if (mode === "marked-user") {
      messages.push({
        role: "user",
        content: `${HUMAN_ORIGIN_MARK}: ${message.text}`,
      });
    } else {
      messages.push({ role: "assistant", content: message.text });
    }
  }
  return messages;
}
