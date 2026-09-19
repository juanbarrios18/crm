import { readFileSync } from "node:fs";
import path from "node:path";
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

/**
 * P4 del plan `run_ejf1ffwxlmifjeeh315f` — contradicción literal resuelta.
 *
 * La rúbrica vieja metía «va a enviar» (una promesa futura) en la regla que
 * exigía un hecho ya ocurrido. Se fijan TRES categorías observables para no
 * convertir toda frase futura en roja.
 */
describe("buildJudgePrompt (P4) — las tres categorías de afirmacion_sin_evidencia", () => {
  it("nombra las tres categorías observables", () => {
    const { system } = prompt();
    expect(system).toContain("ACCIÓN COMPLETADA no verificable");
    expect(system).toContain("PROMESA DE CAPACIDAD INEXISTENTE");
    expect(system).toContain("FUTURO CONDICIONADO LEGÍTIMO");
  });

  it("la regla de acción completada ya no incluye una promesa futura", () => {
    // El baseline decía "que envió o va a enviar": promesa futura dentro de la
    // regla que exigía «un hecho ya ocurrido».
    expect(prompt().system).not.toContain("va a enviar");
  });

  it("una promesa inexistente es roja y el futuro condicionado no es hallazgo", () => {
    const { system } = prompt();
    expect(system).toContain("le voy a enviar la boleta");
    expect(system).toContain("si confirma el pago");
    expect(system).toContain("NO es hallazgo");
  });

  it("conserva negación, capacidad y handoff al reescribir la regla", () => {
    const { system } = prompt();
    expect(system).toContain("Una NEGACIÓN nunca es `afirmacion_sin_evidencia`");
    expect(system).toContain(
      "Una afirmación de CAPACIDAD no es una acción realizada"
    );
    expect(system).toContain("el escalado OCURRIÓ");
  });
});

/**
 * P4 — controles de hechos. El juez omitía dos defectos medidos: el calificador
 * no respaldado («48 horas hábiles» sobre una fuente que dice «48 horas») y el
 * subtotal parcial presentado como total del pedido.
 */
describe("buildJudgePrompt (P4) — controles de hechos", () => {
  it("un calificador que la fuente no tiene es hallazgo", () => {
    const { system } = prompt();
    expect(system).toContain("48 horas hábiles");
    expect(system).toContain("calificador");
    expect(system).toContain("no respaldad");
  });

  it("cita el control negativo: el dato exacto de la fuente no es hallazgo", () => {
    // La fuente dice "48 horas": el mismo dato sin el calificador no se marca.
    expect(prompt().system).toContain("48 horas");
    expect(prompt().system).toContain("NO es hallazgo");
  });

  it("un subtotal parcial presentado como total es hallazgo", () => {
    const { system } = prompt();
    expect(system).toContain("SUBTOTAL PARCIAL");
    expect(system).toContain("no entrega el total");
  });

  it("un subtotal etiquetado como adición no se marca", () => {
    expect(prompt().system).toContain("correctamente etiquetado");
  });

  it("las fuentes congeladas prevalecen sobre una sugerencia del juez", () => {
    expect(prompt().system).toContain("PREVALECEN");
  });
});

/**
 * P4 — tono en tres planos. `errores_modismos#0` y `pregunton_precios#0` son
 * preferencias estilísticas de baja confianza: el instrumento no puede volverlas
 * hallazgo duro por estilo.
 */
describe("buildJudgePrompt (P4) — tono en tres planos", () => {
  it("separa voz configurada, continuidad y preferencia de cierre", () => {
    const { system } = prompt();
    expect(system).toContain("INCUMPLIMIENTO DE LA VOZ CONFIGURADA");
    expect(system).toContain("REPETICIÓN/CONTINUIDAD");
    expect(system).toContain("PREFERENCIA SUBJETIVA DE CIERRE");
  });

  it("no penaliza una respuesta veraz por ser menos comercial", () => {
    expect(prompt().system).toContain("menos comercial");
  });
});

/**
 * P4 — decisión del dueño sobre historial y documentación, anclada al fixture
 * congelado. Las etiquetas del fixture son humanas y previas: no se re-juzga
 * para elegirlas. Aquí se documenta que una negación correcta SIN línea de
 * handoff exige escalar en el mismo turno, así que `debio_escalar` es la
 * expectativa correcta para estos transcripts.
 */
type FixtureHallazgo = { tipo: string; evidencia: string };
type FixtureCase = {
  key: string;
  transcript: { role: "cliente" | "agente"; text: string }[];
  observed: { hallazgos: FixtureHallazgo[] };
};

const fixture = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "tests/fixtures/lab/remediacion-ejf1-cases.json"),
    "utf8"
  )
) as { cases: FixtureCase[] };

const HANDOFF_RE = /\(handoff:/i;

function caseByKey(key: string): FixtureCase {
  const c = fixture.cases.find((x) => x.key === key);
  if (!c) throw new Error(`fixture case not found: ${key}`);
  return c;
}

function hasHandoff(c: FixtureCase): boolean {
  return c.transcript.some((t) => HANDOFF_RE.test(t.text));
}

function findingTypes(c: FixtureCase): string[] {
  return c.observed.hallazgos.map((h) => h.tipo);
}

describe("P4 — negación correcta sin handoff exige escalar", () => {
  it("cliente_recurrente#2: niega el historial y no hay handoff", () => {
    const c = caseByKey("cliente_recurrente#2");
    const denial = c.transcript.find(
      (t) => t.role === "agente" && t.text.includes("no tengo acceso al historial")
    );
    expect(denial).toBeDefined();
    expect(hasHandoff(c)).toBe(false);
    // Decisión del dueño: negar el acceso es correcto Y la solicitud exige
    // escalar en el mismo turno; sin handoff, `debio_escalar` es correcto. El
    // fixture la traía como `indeterminado`; esta decisión la resuelve.
    expect(findingTypes(c)).toContain("debio_escalar");
  });

  it("pide_boleta_pago#2: dice que lo gestiona el equipo y no hay handoff real", () => {
    const c = caseByKey("pide_boleta_pago#2");
    const denial = c.transcript.find(
      (t) => t.role === "agente" && t.text.includes("no gestiona envíos de boletas")
    );
    expect(denial).toBeDefined();
    expect(hasHandoff(c)).toBe(false);
    // Decisión del dueño: negar el envío es correcto Y "lo gestiona el equipo"
    // sin handoff real exige escalar; `debio_escalar` es correcto.
    expect(findingTypes(c)).toContain("debio_escalar");
  });
});
