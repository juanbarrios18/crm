import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { runAgentTurn } from "@/server/ai/pipeline";
import type { ChatTiming } from "@/lib/ai";
import { renderCatalog, renderDeliveryZones, renderKb } from "@/server/ai/prompts";
import { getActiveProductsPublic, getActiveZones } from "@/server/catalog/queries";
import { computeScore, judgeCase } from "@/server/lab/judge";
import { PERSONAS, type Persona } from "@/server/lab/personas";
import { applyPipelineCheck } from "@/server/lab/pipeline-check";

/**
 * Runner del Laboratorio (FR-030/FR-034): corrida en segundo plano DENTRO del
 * proceso (sin cola externa), turnos secuenciales con debounce 0, timeout
 * global de 20 minutos, y lock de concurrencia por índice parcial UNIQUE en
 * BD (máx. 1 corrida `running` por organización).
 *
 * Sandbox (FR-031): las conversaciones se crean con is_test=true; el pipeline
 * del agente persiste las respuestas sin tocar la API, y el sender real lanza
 * si algo intenta enviarlas.
 */

const RUN_TIMEOUT_MS = 20 * 60 * 1000;

/** Casos en paralelo (conversaciones independientes). Acota la pared de tiempo. */
const LAB_CONCURRENCY = 4;

export class RunConflictError extends Error {}

export async function startRun(organizationId: string): Promise<string> {
  const db = getDb();
  let runId: string;
  try {
    const inserted = await db
      .insert(schema.agentTestRun)
      .values({ id: newId("testRun"), organizationId, status: "running" })
      .returning();
    runId = inserted[0]!.id;
  } catch (err) {
    // Violación del índice parcial UNIQUE → ya hay una corrida activa.
    if (isUniqueViolation(err)) {
      throw new RunConflictError("Ya hay una corrida en curso");
    }
    throw err;
  }

  await db.insert(schema.agentTestCase).values(
    PERSONAS.map((p) => ({
      id: newId("testCase"),
      organizationId,
      runId,
      persona: p.key,
      status: "pending" as const,
    }))
  );

  // Fire-and-forget in-process: el POST regresa ya; el progreso va por SSE.
  void executeRun(runId, organizationId).catch(async (err) => {
    console.error("[lab] corrida falló:", err);
    await failRun(runId, organizationId, String(err));
  });

  return runId;
}

async function executeRun(
  runId: string,
  organizationId: string
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("timeout de 20 minutos superado")),
      RUN_TIMEOUT_MS
    )
  );
  try {
    await Promise.race([runAllCases(runId, organizationId), timeout]);
  } catch (err) {
    await failRun(runId, organizationId, String(err));
  }
}

async function runAllCases(
  runId: string,
  organizationId: string
): Promise<void> {
  const db = getDb();
  const cases = await db
    .select()
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId))
    .orderBy(asc(schema.agentTestCase.createdAt));

  const kbEntries = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));
  const kbText = renderKb(kbEntries);

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  const behaviorText = profile
    ? [
        `Nombre: ${profile.name}`,
        profile.tone ? `Tono: ${profile.tone}` : null,
        profile.instructions ? `Instrucciones: ${profile.instructions}` : null,
        profile.escalationRules ? `Escalado: ${profile.escalationRules}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  // Ground truth del juez: catálogo público + zonas de envío (FR-030). Sin
  // esto, el juez tacha de alucinación todo precio/cobertura que el agente
  // cite correctamente desde el catálogo.
  const catalogText = renderCatalog(await getActiveProductsPublic(organizationId));
  const zonesText = renderDeliveryZones(await getActiveZones(organizationId));

  let done = 0;
  const total = cases.length;
  // Modelos usados en la corrida (el primero observado; el entorno es estable).
  const stats: { agentModel: string | null; judgeModel: string | null } = {
    agentModel: null,
    judgeModel: null,
  };
  publishProgress(organizationId, runId, "running", done, total);

  // Casos en paralelo acotado: cada caso es una conversación/contacto
  // independiente. Sin esto, 13 guiones secuenciales superan el timeout en
  // modelos lentos (reasoning / proveedores con alta latencia).
  const queue = [...cases];
  const worker = async (): Promise<void> => {
    const testCase = queue.shift();
    if (!testCase) return;
    await runOneCase(organizationId, testCase, { kbText, behaviorText, catalogText, zonesText }, stats);
    done += 1;
    publishProgress(organizationId, runId, "running", done, total);
    return worker();
  };
  await Promise.all(
    Array.from({ length: Math.min(LAB_CONCURRENCY, queue.length) }, () => worker())
  );

  const finalCases = await db
    .select({
      status: schema.agentTestCase.status,
      veredicto: schema.agentTestCase.veredicto,
    })
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, runId));
  const score = computeScore(finalCases);

  await getDb()
    .update(schema.agentTestRun)
    .set({
      status: "done",
      score,
      finishedAt: new Date(),
      model: stats.agentModel,
      judgeModel: stats.judgeModel,
    })
    .where(eq(schema.agentTestRun.id, runId));
  publishProgress(organizationId, runId, "done", done, total, score);
}

/** Ejecuta UN caso (conversación + juez + check de pipeline) y lo persiste. */
async function runOneCase(
  organizationId: string,
  testCase: typeof schema.agentTestCase.$inferSelect,
  ground: {
    kbText: string;
    behaviorText: string;
    catalogText: string;
    zonesText: string;
  },
  stats: { agentModel: string | null; judgeModel: string | null }
): Promise<void> {
  const db = getDb();
  const persona = PERSONAS.find((p) => p.key === testCase.persona);
  if (!persona) return;

  await db
    .update(schema.agentTestCase)
    .set({ status: "running" })
    .where(eq(schema.agentTestCase.id, testCase.id));

  const {
    transcript,
    conversationId,
    agentModel,
    latencyMs,
    turnCount,
    turnMetrics,
    initialStage,
    finalStage,
    advanced,
  } = await runConversation(organizationId, persona);

  const outcome = await judgeCase({
    personaKey: persona.key,
    transcript,
    kbText: ground.kbText,
    behaviorText: ground.behaviorText,
    catalogText: ground.catalogText,
    zonesText: ground.zonesText,
  });

  if (agentModel) stats.agentModel = agentModel;
  if (outcome.status === "done") stats.judgeModel = outcome.model;

  // Verificación determinista del pipeline (FR-030): si la persona debía
  // avanzar de etapa y el lead no se movió, es un defecto del flujo.
  let veredicto = outcome.status === "done" ? outcome.verdict.veredicto : null;
  let hallazgos: unknown[] | null =
    outcome.status === "done" ? [...outcome.verdict.hallazgos] : null;
  if (outcome.status === "done") {
    const checked = applyPipelineCheck({
      expectAdvance: persona.expectAdvance ?? false,
      advanced,
      initialStage,
      finalStage,
      veredicto: outcome.verdict.veredicto,
      hallazgos: outcome.verdict.hallazgos,
    });
    veredicto = checked.veredicto;
    hallazgos = checked.hallazgos;
  }

  await db
    .update(schema.agentTestCase)
    .set({
      conversationId,
      transcript,
      status: outcome.status,
      veredicto,
      hallazgos,
      latencyMs,
      turnCount,
      turnMetrics,
      judgeLatencyMs: outcome.status === "done" ? outcome.latencyMs : null,
      initialStage,
      finalStage,
      expectAdvance: persona.expectAdvance ?? false,
      advanced,
    })
    .where(eq(schema.agentTestCase.id, testCase.id));
}

/** Conversa el guion completo contra el agente real; corta al primer handoff. */
async function runConversation(
  organizationId: string,
  persona: Persona
): Promise<{
  transcript: { role: "cliente" | "agente"; text: string }[];
  conversationId: string;
  agentModel: string | null;
  latencyMs: number;
  turnCount: number;
  turnMetrics: ChatTiming[];
  initialStage: string | null;
  finalStage: string | null;
  advanced: boolean;
}> {
  const db = getDb();
  // Timing acumulado de los turnos REALES del agente en esta conversación.
  let agentModel: string | null = null;
  let latencyMs = 0;
  let turnCount = 0;
  const turnMetrics: ChatTiming[] = [];

  // Contacto sintético ARCHIVADO (no aparece en la lista ni genera leads).
  const contactId = await upsertTestContact(organizationId, persona);

  const convId = newId("conversation");
  await db.insert(schema.conversation).values({
    id: convId,
    organizationId,
    contactId,
    isTest: true,
    aiEnabled: true,
  });

  // Pipeline (FR-030): el contacto de prueba arranca con un lead en la primera
  // etapa abierta, igual que un contacto real. Así el agente puede moverlo.
  await seedTestLead(organizationId, contactId);
  const initialStage = await getLeadStage(contactId);

  for (const line of persona.script) {
    const now = new Date();
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId,
      conversationId: convId,
      direction: "in",
      type: "text",
      text: line,
      status: "delivered",
      waTimestamp: now,
    });
    await db
      .update(schema.conversation)
      .set({ lastInboundAt: now, lastMessageAt: now, updatedAt: now })
      .where(eq(schema.conversation.id, convId));

    // Turno REAL del agente, secuencial y sin debounce (FR-030).
    const timing = await runAgentTurn(convId);
    if (timing) {
      agentModel = timing.model;
      latencyMs += timing.latencyMs;
      turnCount += 1;
      turnMetrics.push(timing);
    }

    const convRows = await db
      .select({ handoffAt: schema.conversation.handoffAt })
      .from(schema.conversation)
      .where(eq(schema.conversation.id, convId))
      .limit(1);
    if (convRows[0]?.handoffAt) break; // primer handoff → fin del guion
  }

  const messages = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, convId))
    .orderBy(asc(schema.message.createdAt));

  // Un handoff no deja mensaje saliente: se representa en el transcript para
  // que el juez sepa que el agente SÍ escaló (evita falsos `debio_escalar`).
  const convFinal = await db
    .select({
      handoffAt: schema.conversation.handoffAt,
      handoffReason: schema.conversation.handoffReason,
    })
    .from(schema.conversation)
    .where(eq(schema.conversation.id, convId))
    .limit(1);
  const handoffReason = convFinal[0]?.handoffAt
    ? (convFinal[0].handoffReason ?? "modelo")
    : null;

  const transcript = messages
    .filter((m) => m.text)
    .map((m) => ({
      role: m.direction === "in" ? ("cliente" as const) : ("agente" as const),
      text: m.text!,
    }));
  if (handoffReason) {
    transcript.push({
      role: "agente",
      text: `(handoff: la conversación pasó a atención humana — motivo: ${handoffReason})`,
    });
  }

  // Etapa final del lead: avance = posición posterior a la inicial.
  const finalStage = await getLeadStage(contactId);
  const advanced =
    initialStage !== null &&
    finalStage !== null &&
    finalStage.position > initialStage.position;

  return {
    conversationId: convId,
    transcript,
    agentModel,
    latencyMs,
    turnCount,
    turnMetrics,
    initialStage: initialStage?.name ?? null,
    finalStage: finalStage?.name ?? null,
    advanced,
  };
}

/**
 * Deja un lead de prueba en la primera etapa abierta (idempotente entre
 * corridas). Igual que `onLeadActivity`, pero sin depender de la ingesta.
 */
async function seedTestLead(
  organizationId: string,
  contactId: string
): Promise<void> {
  const db = getDb();
  const firstStage = await db
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(
      and(
        eq(schema.pipelineStage.organizationId, organizationId),
        eq(schema.pipelineStage.kind, "open")
      )
    )
    .orderBy(asc(schema.pipelineStage.position))
    .limit(1);
  const stageId = firstStage[0]?.id;
  if (!stageId) return; // pipeline sin etapas abiertas

  const existing = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(eq(schema.lead.contactId, contactId))
    .limit(1);
  if (existing[0]) {
    await db
      .update(schema.lead)
      .set({
        stageId,
        position: 0,
        updatedAt: new Date(),
        lastActivityAt: new Date(),
      })
      .where(eq(schema.lead.id, existing[0].id));
    return;
  }

  await db
    .insert(schema.lead)
    .values({
      id: newId("lead"),
      organizationId,
      contactId,
      stageId,
      position: 0,
      lastActivityAt: new Date(),
    })
    .onConflictDoNothing({ target: [schema.lead.contactId] });
}

/** Etapa actual del lead de un contacto (con posición, para medir avance). */
async function getLeadStage(
  contactId: string
): Promise<{ name: string; position: number } | null> {
  const db = getDb();
  const rows = await db
    .select({
      name: schema.pipelineStage.name,
      position: schema.pipelineStage.position,
    })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(eq(schema.lead.contactId, contactId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertTestContact(
  organizationId: string,
  persona: Persona
): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone: persona.phone,
      waIdentity: persona.phone,
      name: persona.contactName,
      archivedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.waIdentity],
    })
    .returning();
  if (inserted[0]) return inserted[0].id;
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.phone, persona.phone)
      )
    )
    .limit(1);
  return rows[0]!.id;
}

async function failRun(
  runId: string,
  organizationId: string,
  error: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.agentTestRun)
    .set({ status: "failed", error, finishedAt: new Date() })
    .where(eq(schema.agentTestRun.id, runId));
  publishProgress(organizationId, runId, "failed", 0, PERSONAS.length);
}

function publishProgress(
  organizationId: string,
  runId: string,
  status: string,
  done: number,
  total: number,
  score?: number | null
): void {
  publish(organizationId, {
    type: "lab.run",
    data: { runId, status, progress: { done, total }, score },
  });
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}
