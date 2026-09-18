import type { PublicProduct } from "@/lib/catalog";
import type { VerdictLevel } from "@/server/lab/pipeline-check";

/**
 * Verificación determinista de HECHOS en el Laboratorio (F0 del plan de
 * optimización de la interacción LLM).
 *
 * El juez LLM es inestable (8 de 13 personas cambian de veredicto entre
 * repeticiones) y por eso no sirve para atribuir. Los hechos, en cambio, se
 * verifican por código contra las fuentes de verdad del negocio:
 *
 * 1. PRECIO: todo `$X` que escribe el agente tiene que existir en el catálogo
 *    (neto, con IVA o unitario) o en las tarifas de despacho.
 * 2. FORMATO: si el agente nombra un producto del catálogo junto a un formato
 *    `N cm`, ese formato tiene que existir PARA ESE producto. Es el caso real
 *    del anexo: "pan de hamburguesa de 15 cm" con el precio del completo 15 cm.
 * 3. AFIRMACIÓN PROHIBIDA: el canal no envía correos, no emite boletas, no
 *    confirma pagos ni agenda despachos (`NIVEL_1_VERDAD_DEL_SISTEMA`). Cualquier
 *    frase que afirme haberlo hecho es una falla grave.
 *
 * Todo hallazgo es tipo `hecho` y fuerza `rojo`: son fallas verificables, no
 * juicios. Solo se escanean los turnos del AGENTE. Puro y sin BD, como
 * `applyPipelineCheck` y `applyDialectCheck`.
 */

export type TranscriptTurn = { role: "cliente" | "agente"; text: string };

export type FactFinding = { tipo: "hecho"; evidencia: string };

const EVIDENCE_MAX_CHARS = 240;

function clip(text: string, max = EVIDENCE_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** `$4.855,20` → 4855.2 · `$5.000` → 5000. Devuelve los montos en orden de aparición. */
export function extractPrices(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/g;
  for (const m of text.matchAll(re)) {
    const int = (m[1] ?? "").replace(/\./g, "");
    const dec = m[2] ?? "";
    out.push(Number(dec ? `${int}.${dec}` : int));
  }
  return out;
}

/**
 * Frases que afirman una acción que el canal NO puede ejecutar.
 *
 * Se comparan en minúsculas CONSERVANDO las tildes: "envié" (pretérito, hecho
 * consumado) y "envíe" (subjuntivo, ofrecimiento: "¿quiere que le envíe…?") solo
 * se distinguen por el acento. Un ofrecimiento no es una afirmación; lo que sí
 * es falla es asegurar que algo ya ocurrió. Por eso los patrones exigen una
 * forma de pretérito o "ya" + participio. La lista es deliberadamente corta.
 */
/**
 * Cierres de palabra que funcionan con tildes. El `\b` de JavaScript solo
 * conoce letras ASCII: después de "envié" NO hay frontera, así que `envié\b`
 * jamás coincide. Se usan estos lookarounds en su lugar.
 */
const INI = "(?:^|\\s)";
const FIN = "(?=\\s|[.,;:!?¿¡)]|$)";
const PRON = "(?:ya\\s+)?(?:se\\s+|le\\s+|te\\s+|les\\s+)?(?:lo\\s+|la\\s+|los\\s+|las\\s+)?";

const FORBIDDEN_CLAIMS: readonly RegExp[] = [
  `${INI}${PRON}(?:envié|mandé|adjunté|generé|agendé)${FIN}`,
  `${INI}ya\\s+(?:se\\s+)?(?:lo\\s+|la\\s+)?(?:enviamos|mandamos|envió|mandó|generó|emitió|agendó|reservó|confirmó)${FIN}`,
  `${INI}ya\\s+(?:está|quedó|fue)\\s+(?:enviad|agendad|reservad|confirmad|generad|emitid)`,
  `${INI}(?:quedó|queda)\\s+agendad`,
  `${INI}(?:boleta|factura)\\s+(?:emitida|generada|enviada)${FIN}`,
  `${INI}(?:recibimos|confirmamos|verifiqué|revisé)\\s+(?:su|el|tu|la)\\s+(?:pago|transferencia)${FIN}`,
  `${INI}pago\\s+confirmado${FIN}`,
  `${INI}(?:reservé|reservamos)\\s+(?:el\\s+)?stock${FIN}`,
].map((source) => new RegExp(source));

function findForbiddenClaim(text: string): string | null {
  const lower = text.toLowerCase();
  for (const re of FORBIDDEN_CLAIMS) {
    const m = lower.match(re);
    if (m) return m[0].trim();
  }
  return null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Formatos `N cm` por producto (nombre normalizado → conjunto de "15 cm"). */
function formatsByProduct(catalog: PublicProduct[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of catalog) {
    const key = normalize(p.producto);
    const set = map.get(key) ?? new Set<string>();
    const cm = normalize(p.formato).match(/(\d+)\s*cm/);
    if (cm) set.add(`${cm[1]} cm`);
    map.set(key, set);
  }
  return map;
}

function allowedPrices(
  catalog: PublicProduct[],
  zones: { costoDespacho: number | null }[]
): Set<number> {
  const set = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (typeof n === "number" && Number.isFinite(n)) set.add(round2(n));
  };
  for (const p of catalog) {
    add(p.precioBolsaNeto);
    add(p.precioBolsaConIva);
    add(p.precioUnitarioNeto);
  }
  for (const z of zones) add(z.costoDespacho);
  return set;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Máximo de bolsas que se acepta en un total calculado. Cubre los pedidos
 * reales (mínimos de 5 y 15, pedidos de decenas) sin admitir cualquier número.
 */
const MAX_UNITS_IN_TOTAL = 200;

/**
 * Un monto es legítimo si está en las fuentes de verdad o si es un múltiplo
 * entero de un precio del catálogo: "10 bolsas a $2.220 → $22.200" es
 * aritmética sobre datos reales, no un precio inventado (falso positivo medido
 * en la baseline F0).
 */
function isDerivedPrice(price: number, allowed: Set<number>): boolean {
  const target = round2(price);
  if (allowed.has(target)) return true;
  for (const base of allowed) {
    if (base <= 0) continue;
    const units = target / base;
    if (units < 2 || units > MAX_UNITS_IN_TOTAL) continue;
    if (Math.abs(units - Math.round(units)) < 1e-6) return true;
  }
  return false;
}

function fmtCl(n: number): string {
  const [int, dec] = n.toFixed(2).split(".");
  const withDots = (int ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return dec === "00" ? withDots : `${withDots},${dec}`;
}

/**
 * Una violación de hechos en un texto del agente. `detail` es legible y
 * autocontenido ("$3.990", `"pan de hamburguesa" en formato 15 cm`, la frase
 * prohibida) para citarlo tanto en el informe del Laboratorio como en la
 * corrección que el pipeline le devuelve al modelo (F5, `reply-guard.ts`).
 */
export type FactViolation = {
  kind: "precio" | "formato" | "afirmacion";
  detail: string;
};

/**
 * Núcleo puro y reutilizable: verifica UN texto del agente contra las fuentes
 * de verdad. Lo comparten el Laboratorio (post-mortem por turno) y el guard
 * de producción (antes de enviar). Sin duplicados: el mismo precio inventado
 * dos veces cuenta una vez.
 */
export function checkAgentText(
  text: string,
  sources: {
    catalog: PublicProduct[];
    zones: { comuna: string; costoDespacho: number | null }[];
  }
): FactViolation[] {
  const prices = allowedPrices(sources.catalog, sources.zones);
  const formats = formatsByProduct(sources.catalog);
  const out: FactViolation[] = [];
  const seen = new Set<string>();
  const push = (key: string, v: FactViolation) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  // 1. Precios fuera de las fuentes de verdad.
  for (const price of extractPrices(text)) {
    if (isDerivedPrice(price, prices)) continue;
    push(`precio:${price}`, { kind: "precio", detail: `$${fmtCl(price)}` });
  }

  // 2. Formato inexistente para un producto nombrado.
  const norm = normalize(text);
  for (const [producto, permitidos] of formats) {
    if (!norm.includes(producto)) continue;
    for (const m of norm.matchAll(/(\d+)\s*cm\b/g)) {
      const formato = `${m[1]} cm`;
      if (permitidos.has(formato)) continue;
      push(`formato:${producto}:${formato}`, {
        kind: "formato",
        detail: `"${producto}" en formato ${formato}`,
      });
    }
  }

  // 3. Afirmaciones que el canal no puede hacer.
  const claim = findForbiddenClaim(text);
  if (claim) push(`claim:${claim}`, { kind: "afirmacion", detail: claim });

  return out;
}

function describeFinding(turno: number, v: FactViolation, text: string): string {
  const cita = `"${clip(text)}"`;
  switch (v.kind) {
    case "precio":
      return `El turno ${turno} del agente cita ${v.detail}, que no está en el catálogo ni en las tarifas de despacho: ${cita}`;
    case "formato":
      return `El turno ${turno} del agente ofrece ${v.detail}, que ese producto no tiene en el catálogo: ${cita}`;
    case "afirmacion":
      return `El turno ${turno} del agente afirma una acción que el canal no puede ejecutar ("${v.detail}"): ${cita}`;
  }
}

export function applyFactCheck(input: {
  transcript: TranscriptTurn[];
  catalog: PublicProduct[];
  zones: { comuna: string; costoDespacho: number | null }[];
  veredicto: VerdictLevel;
  hallazgos: unknown[];
}): { veredicto: VerdictLevel; hallazgos: unknown[] } {
  const nuevos: FactFinding[] = [];
  // Una evidencia por hecho distinto en toda la conversación: el mismo precio
  // inventado en dos turnos no infla el reporte.
  const seen = new Set<string>();

  input.transcript.forEach((turn, index) => {
    if (turn.role !== "agente") return;
    for (const v of checkAgentText(turn.text, input)) {
      const key = `${v.kind}:${v.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nuevos.push({ tipo: "hecho", evidencia: describeFinding(index + 1, v, turn.text) });
    }
  });

  if (nuevos.length === 0) {
    return { veredicto: input.veredicto, hallazgos: input.hallazgos };
  }
  return { veredicto: "rojo", hallazgos: [...nuevos, ...input.hallazgos] };
}
