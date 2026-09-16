import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findVoseo } from "@/lib/voice-register";

/**
 * Guardián de REGISTRO (voz). No valida comportamiento: valida que el código y
 * la documentación que lee el agente no vuelvan al voseo rioplatense.
 *
 * Modelo de voz del producto:
 *   - CRM admin (`src/components/`, `src/app/(crm)/`) → español neutro.
 *   - Web pública (`src/app/(site)/`, `src/components/site/`, `src/content/`)
 *     → español chileno, con trato de usted.
 *   - Documentación (`AGENTS.md`, `docs/`) → neutro/impersonal.
 *
 * El rioplatense (`agregá`, `probá`, `tenés`, `sos`) está mal en las tres.
 *
 * Alcance: todo lo que un agente LEE (código de `src/`, definiciones de
 * `.opencode/`, tests, `AGENTS.md` y `docs/`). El entorno primea al modelo
 * tanto como el prompt, así que el registro se vigila en todo el repo y no solo
 * en los strings que ve el usuario final.
 *
 * Por qué el escaneo de markdown quita bloques de código cercados y fragmentos
 * inline: hay documentos que CITAN el dialecto verbatim como evidencia del
 * defecto, y citar está permitido mientras que escribirlo como prosa propia no.
 * Quitar el código deja esas citas exentas sin abrir la puerta a que el resto de
 * la prosa del documento se contagie.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Lista EXPLÍCITA de lexemas voseo. NO es una regex por terminación a propósito:
 * `está`, `acá`, `más`, `además` y `jamás` también terminan en `-á` y son español
 * neutro legítimo; una regla por sufijo los marcaría en falso.
 */

/**
 * Documentos de evidencia: citan el dialecto verbatim para documentar el defecto.
 * Sus citas están en prosa (negritas/comillas), no en spans de código, así que el
 * stripping de markdown no alcanza a eximirlas. Se excluye el archivo entero a
 * propósito; el resto de la documentación NO tiene esa dispensa.
 */
const EVIDENCE_DOCS = new Set<string>([
  "docs/harness-agente-prod.md",
  "docs/auditoria-interaccion-agente.md",
]);

/**
 * Definición de la regla, no una violación de ella: estos archivos contienen la
 * lista de lexemas voseo y fixtures que los citan a propósito. Escanearlos sería
 * pedirles que se marquen a sí mismos. `src/lib/voice-register.ts` es la fuente
 * única de la lista, así que también está exento.
 */
const RULE_DEFINITION_FILES = new Set<string>([
  "tests/unit/voice-register.test.ts",
  "src/lib/voice-register.ts",
]);

function listFiles(dir: string, keep: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

/** Quita bloques y spans de código conservando los números de línea. */
function stripCode(markdown: string): string {
  const withoutFences = markdown.replace(/```[^\n]*\n[\s\S]*?```/g, (block) =>
    block.replace(/[^\n]/g, "")
  );
  return withoutFences.replace(/`[^`\n]*`/g, (span) => " ".repeat(span.length));
}

function collectFiles(): string[] {
  return [
    ...listFiles(join(REPO_ROOT, "src"), (file) => /\.(ts|tsx)$/.test(file)),
    ...listFiles(join(REPO_ROOT, ".opencode"), (file) => file.endsWith(".md")),
    ...listFiles(join(REPO_ROOT, "tests"), (file) =>
      /\.(ts|tsx|md)$/.test(file)
    ),
    join(REPO_ROOT, "AGENTS.md"),
    ...listFiles(join(REPO_ROOT, "docs"), (file) => file.endsWith(".md")),
  ];
}

type Violation = { file: string; line: number; word: string };

function scan(files: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const absolute of files) {
    const file = relative(REPO_ROOT, absolute);
    if (EVIDENCE_DOCS.has(file) || RULE_DEFINITION_FILES.has(file)) {
      continue;
    }

    const raw = readFileSync(absolute, "utf8");
    const text = file.endsWith(".md") ? stripCode(raw) : raw;

    text.split("\n").forEach((line, index) => {
      for (const { word } of findVoseo(line)) {
        violations.push({ file, line: index + 1, word });
      }
    });
  }
  return violations;
}

describe("registro — guardián de voseo rioplatense", () => {
  it("encuentra archivos que escanear (no pasa en vacío)", () => {
    expect(collectFiles().length).toBeGreaterThan(10);
  });

  it("no deja voseo rioplatense en src/**, AGENTS.md ni docs/**", () => {
    const violations = scan(collectFiles());
    const detail = violations
      .map((v) => `  ${v.file}:${v.line} → ${v.word}`)
      .join("\n");

    expect(
      violations,
      [
        "voseo rioplatense no permitido; use usted/neutro (CRM y docs) o usted",
        "chileno (web pública). Ocurrencias:",
        detail || "  (ninguna)",
      ].join("\n")
    ).toEqual([]);
  });

  it("no confunde voseo con español neutro terminado en -á (sin falsos positivos)", () => {
    const matches = (sample: string) => findVoseo(sample).length > 0;

    expect(matches("Agregá el primero con el botón de arriba.")).toBe(true);
    expect(matches("Si tenés dudas, escribinos.")).toBe(true);
    expect(matches("¿Armamos su pedido?")).toBe(false);
    expect(matches("El costo está acá y además es más barato; jamás sube.")).toBe(
      false
    );
  });
});
