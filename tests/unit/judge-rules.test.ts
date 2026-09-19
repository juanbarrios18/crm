import { describe, expect, it } from "vitest";
import { buildJudgePrompt } from "@/server/ai/prompts";

/**
 * 008 — Reglas del juez corregidas contra la configuración real.
 *
 * El baseline tenía falsos positivos sistemáticos: el juez castigaba el saludo
 * que configuró el dueño (17 de 25 hallazgos de tono), marcaba `fuera_de_kb`
 * respuestas respaldadas por el comportamiento configurado, trataba un rechazo
 * de cobertura como alucinación, ignoraba la línea de handoff y tomaba una
 * afirmación de capacidad como una acción realizada.
 *
 * Estas pruebas fijan las reglas en el prompt: si alguien las revierte, se ve.
 */

const prompt = () =>
  buildJudgePrompt({
    persona: "pregunton_precios",
    personaLabel: "Preguntón de precios",
    personaDescription: "Salta de precio en precio.",
    transcript: [{ role: "cliente", text: "¿a cuánto?" }],
    kbText: "",
    behaviorText: "Instrucciones: ...",
    catalogText: "catálogo",
    zonesText: "zonas",
  });

describe("buildJudgePrompt (008) — las cuatro fuentes y el rechazo", () => {
  it("un rechazo explícito nunca es alucinación", () => {
    expect(prompt().system).toContain("Un RECHAZO explícito nunca es alucinación");
  });

  it("fuera_de_kb exige ausencia en las cuatro fuentes, no solo en el conocimiento", () => {
    expect(prompt().system).toContain("que no está en NINGUNA de las cuatro fuentes");
  });

  it("una capacidad configurada no es una acción realizada", () => {
    expect(prompt().system).toContain(
      "Una afirmación de CAPACIDAD no es una acción realizada"
    );
  });
});

describe("buildJudgePrompt (008) — escalado y voz configurada", () => {
  it("la línea de handoff cuenta como escalado ocurrido", () => {
    expect(prompt().system).toContain("el escalado OCURRIÓ");
  });

  it("reproducir el saludo o el tono configurados no es un hallazgo", () => {
    expect(prompt().system).toContain(
      "Reproducir el saludo o el tono que el negocio configuró NO es un hallazgo"
    );
  });

  it("la regla anti-call-center ya no es universal: exige que la voz NO la contenga", () => {
    expect(prompt().system).toContain("SIN que la voz configurada las contenga");
    // La redacción vieja castigaba la fórmula sin mirar la configuración.
    expect(prompt().system).not.toContain(
      "usa fórmulas de call center o lenguaje de atención telefónica en vez de conversación natural"
    );
  });
});

describe("buildJudgePrompt (008) — el saludo configurado llega al juez", () => {
  it("el comportamiento configurado se renderiza en el mensaje del usuario", () => {
    const built = buildJudgePrompt({
      persona: "p1",
      transcript: [{ role: "agente", text: "Hola" }],
      kbText: "kb",
      behaviorText: "Saludo configurado: Hola, somos el equipo comercial.",
      catalogText: "catálogo",
      zonesText: "zonas",
    });
    expect(built.user).toContain("COMPORTAMIENTO CONFIGURADO:");
    expect(built.user).toContain(
      "Saludo configurado: Hola, somos el equipo comercial."
    );
  });
});

/**
 * Piso de ruido del instrumento: cada regla de acá nace de un caso real del
 * baseline (`run_tjx5cttprieujl45fyg6`) que oscilaba entre pasadas del MISMO
 * transcript. Son desambiguaciones, no reglas nuevas de negocio.
 */
describe("buildJudgePrompt — desambiguación de tipos (piso de ruido)", () => {
  it("una lista se verifica elemento por elemento contra su fuente", () => {
    // `errores_modismos`: el agente enumeró 10 comunas y las 10 estaban en las
    // zonas; dos pasadas lo marcaron como alucinación igual.
    expect(prompt().system).toContain("verifique CADA elemento contra su fuente");
    expect(prompt().system).toContain("Enumerar un SUBCONJUNTO correcto");
  });

  it("una negación nunca es afirmacion_sin_evidencia", () => {
    // `reclama_no_recibido`: "no enviamos ni confirmamos pagos" es la respuesta
    // correcta, y una pasada la marcó como acción no verificable.
    expect(prompt().system).toContain(
      "Una NEGACIÓN nunca es `afirmacion_sin_evidencia`"
    );
  });

  it("declinar un pedido no contemplado no exime de escalar", () => {
    // `comprador_decidido`: pidió descuento, el agente declinó sin escalar.
    expect(prompt().system).toContain("no eliminan la obligación de escalar");
  });

  it("los tipos no son excluyentes y tienen orden de gravedad", () => {
    // `pide_boleta_pago`: la misma respuesta fue `debio_escalar` en una pasada y
    // `fuera_de_kb` en las otras, y el veredicto cambió con el tipo.
    expect(prompt().system).toContain("DESAMBIGUACIÓN DE TIPOS");
    expect(prompt().system).toContain("reporte TODAS las que apliquen");
    expect(prompt().system).toContain("nunca elija la más leve");
  });

  it("una negación o derivación tampoco es fuera_de_kb", () => {
    // `pregunton_precios`: "Ese dato no lo puedo confirmar desde aquí. Un asesor
    // puede ayudarle" es la respuesta correcta, y dos pasadas la marcaron
    // `fuera_de_kb`. La protección de rechazo solo estaba escrita para
    // `alucinacion`.
    expect(prompt().system).toContain("tampoco son `fuera_de_kb`");
    expect(prompt().system).toContain("haya declinado responderlo");
  });

  it("empatizar o disculparse no es alucinación", () => {
    // `cliente_enojado`: "Lamento mucho que haya recibido menos de lo que
    // esperaba" fue marcado `alucinacion`.
    expect(prompt().system).toContain("La lista de datos concretos es CERRADA");
    expect(prompt().system).toContain("NUNCA es `alucinacion`");
  });
});
