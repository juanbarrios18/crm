import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T002 (P0 del plan `run_ejf1ffwxlmifjeeh315f`).
 *
 * 1. INTEGRIDAD: los JSONL de evidencia son la fuente inmutable de la auditoría.
 *    Este test falla si alguien los edita, en vez de dejar que una comparación
 *    posterior se haga contra material alterado.
 * 2. FIXTURE: el conjunto reducido y etiquetado por humanos debe seguir siendo
 *    coherente con esa fuente y conservar las etiquetas de la auditoría.
 *
 * El fixture es la base de los tests RED de P1 (elegibilidad, hechos,
 * capacidades). No se re-juzga para elegir la etiqueta.
 */

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "specs/008-medicion-contexto-agente/evidence");
const RUN_JSONL = "run_ejf1ffwxlmifjeeh315f-run.jsonl";
const CASES_JSONL = "run_ejf1ffwxlmifjeeh315f-cases.jsonl";

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readSums(): Map<string, string> {
  const raw = readFileSync(path.join(EVIDENCE, "SHA256SUMS"), "utf8");
  const out = new Map<string, string>();
  for (const line of raw.trim().split("\n")) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+(.+)$/);
    if (match) out.set(match[2]!.trim(), match[1]!);
  }
  return out;
}

const LABEL_DOMAIN = [
  "confirmado",
  "probable",
  "ambiguo",
  "falso_positivo",
  "indeterminado",
  "anomalia",
] as const;

type FixtureCase = {
  key: string;
  persona: string;
  repeatIndex: number;
  transcript: { role: "cliente" | "agente"; text: string }[];
  observed: { expectAdvance: boolean; advanced: boolean; finalStage: string | null };
  label: (typeof LABEL_DOMAIN)[number];
  labelReason: string;
  sourceRule: string;
};

type Fixture = {
  schemaVersion: number;
  source: string;
  sourceHashes: { cases: string; run: string };
  cases: FixtureCase[];
};

function loadFixture(): Fixture {
  const file = path.join(ROOT, "tests/fixtures/lab/remediacion-ejf1-cases.json");
  return JSON.parse(readFileSync(file, "utf8")) as Fixture;
}

describe("evidencia de la corrida ejf1 — integridad", () => {
  const sums = readSums();

  it("SHA256SUMS declara ambos JSONL", () => {
    expect(sums.has(RUN_JSONL)).toBe(true);
    expect(sums.has(CASES_JSONL)).toBe(true);
  });

  it.each([RUN_JSONL, CASES_JSONL])(
    "%s coincide con el hash publicado (fuente inmutable)",
    (file) => {
      expect(sha256(path.join(EVIDENCE, file))).toBe(sums.get(file));
    }
  );

  it("el fixture declara los hashes reales de las fuentes", () => {
    const fixture = loadFixture();
    expect(fixture.sourceHashes.cases).toBe(sha256(path.join(EVIDENCE, CASES_JSONL)));
    expect(fixture.sourceHashes.run).toBe(sha256(path.join(EVIDENCE, RUN_JSONL)));
  });
});

describe("fixture etiquetado de la corrida ejf1", () => {
  const fixture = loadFixture();

  it("tiene la forma esperada y etiquetas dentro del dominio", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(13);
    const keys = new Set<string>();
    for (const c of fixture.cases) {
      expect(keys.has(c.key)).toBe(false);
      keys.add(c.key);
      expect(LABEL_DOMAIN).toContain(c.label);
      expect(c.transcript.length).toBeGreaterThan(0);
      expect(c.labelReason.length).toBeGreaterThan(0);
      expect(c.sourceRule.length).toBeGreaterThan(0);
    }
  });

  it("conserva las etiquetas de la auditoría en los casos clave", () => {
    const byKey = new Map(fixture.cases.map((c) => [c.key, c]));
    for (const key of ["consumidor_final#0", "consumidor_final#1", "consumidor_final#2"]) {
      expect(byKey.get(key)?.label).toBe("confirmado");
    }
    expect(byKey.get("comprador_decidido#0")?.label).toBe("confirmado");
    expect(byKey.get("comprador_decidido#2")?.label).toBe("confirmado");
    expect(byKey.get("cliente_recurrente#0")?.label).toBe("confirmado");
    // Ambiguo NO se convierte automáticamente en fallo del agente.
    expect(byKey.get("cliente_recurrente#2")?.label).toBe("indeterminado");
    expect(byKey.get("errores_modismos#0")?.label).toBe("ambiguo");
    expect(byKey.get("pregunton_precios#0")?.label).toBe("ambiguo");
  });

  it("las anomalías de pipeline son handoff temprano sin avance", () => {
    const byKey = new Map(fixture.cases.map((c) => [c.key, c]));
    for (const key of ["pide_boleta_pago#1", "reclama_no_recibido#2"]) {
      const c = byKey.get(key);
      expect(c?.observed.expectAdvance).toBe(true);
      expect(c?.observed.advanced).toBe(false);
      expect(c?.observed.finalStage).toBe("Nuevo");
      expect(c?.label).toBe("anomalia");
    }
  });

  it("el caso citado por el plan conserva la evidencia del defecto comercial", () => {
    const byKey = new Map(fixture.cases.map((c) => [c.key, c]));
    const cero = byKey.get("consumidor_final#0");
    const texto = cero?.transcript.map((t) => t.text).join(" ") ?? "";
    expect(texto).toContain("para mi casa");
    expect(texto.toLowerCase()).toContain("podemos despachar a domicilio");
  });
});
