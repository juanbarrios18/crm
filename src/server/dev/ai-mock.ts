import { ANNOTATION_MARKER, JUDGE_MARKER } from "@/server/ai/prompts";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENROUTER_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

type InMessage = { role: string; content: string };

export function aiMockCompletion(messages: InMessage[]): string {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Juez del Laboratorio: hallazgos deterministas por persona (P10: el juez ya
  // NO elige veredicto; el pipeline lo deriva del TIPO de hallazgo). Para cerrar
  // el loop del self-test, la persona fuera_de_kb deja de tener hallazgos si el
  // CONOCIMIENTO configurado ya cubre garantías/devoluciones (sugerencia
  // aplicada).
  //
  // `fuera_de_kb` deriva AMARILLO, no rojo: la tabla de severidad aprobada lo
  // clasifica como mejorable. El mock no lo "sube" a rojo a propósito — la
  // persona pregunta por algo que el conocimiento no cubre, y ese es el tipo
  // correcto.
  if (system.includes(JUDGE_MARKER)) {
    const kbSection =
      lastUser
        .split("CONOCIMIENTO CONFIGURADO:")[1]
        ?.split("TRANSCRIPT COMPLETO:")[0] ?? "";
    const kbCoversWarranty = /garant|devoluc/i.test(kbSection);
    if (lastUser.includes("fuera_de_kb") && !kbCoversWarranty) {
      return JSON.stringify({
        hallazgos: [
          {
            tipo: "fuera_de_kb",
            evidencia:
              "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
            sugerencia: {
              pregunta: "¿Cuál es la política de garantías y devoluciones?",
              respuesta:
                "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
            },
          },
        ],
      });
    }
    return JSON.stringify({ hallazgos: [] });
  }

  const text = lastUser.toLowerCase();

  // Segunda llamada del turno (anotación): extracción determinista de datos del
  // lead. El pipeline la trata como best-effort y la valida con `LeadExtraction`.
  if (system.includes(ANNOTATION_MARKER)) {
    if (
      text.includes("lo compro") ||
      text.includes("quiero comprar") ||
      text.includes("me lo llevo")
    ) {
      return JSON.stringify({
        stage: "Interesado",
        note: "Intención de compra explícita.",
      });
    }
    return JSON.stringify({});
  }

  // Llamada de conversación: SOLO texto para el cliente + handoff.
  // Persona pide_humano (el regex de respaldo captura la frase canónica; esta
  // rama cubre variantes que llegan al modelo).
  if (text.includes("humano") || text.includes("asesor")) {
    return JSON.stringify({ reply: "", handoff: true });
  }

  if (
    text.includes("lo compro") ||
    text.includes("quiero comprar") ||
    text.includes("me lo llevo")
  ) {
    return JSON.stringify({
      reply:
        "¡Excelente! Te aparto el producto y un compañero te confirma el pago.",
      handoff: false,
    });
  }

  const eco = lastUser.slice(0, 80);
  return JSON.stringify({ reply: `Respuesta de prueba sobre: ${eco}` });
}
