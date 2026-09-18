"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { summarizeRules } from "@/server/ai/rule-summary";
import type { AgentVoice } from "@/lib/agent-voice";

type Profile = {
  enabled: boolean;
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
  /** Voz estructurada (F6); null → el prompt usa solo el tono libre. */
  voice: AgentVoice | null;
};

/** Límites del servidor (PUT /api/agent/profile); el contador los muestra. */
const INSTRUCTIONS_MAX = 8000;
const ESCALATION_MAX = 4000;

function CharCounter({ value, max }: { value: string | null; max: number }) {
  const chars = (value ?? "").length;
  const warning = chars >= max * 0.8;
  return (
    <p className={`text-xs ${warning ? "text-amber-600" : "text-muted-foreground"}`}>
      {chars.toLocaleString("es-MX")} / {max.toLocaleString("es-MX")} caracteres
    </p>
  );
}

type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

type PromptPayload = {
  rules: { nivel1: string[]; nivel2: string[] };
  effectivePrompt: string;
  clientFileNote: string;
};

export function AgentClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [kbSize, setKbSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [saved, setSaved] = useState(false);

  const refetch = useCallback(async () => {
    const [p, kb, size] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb/size").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null]);
    if (p) {
      setProfile(p.profile);
      setAiConfigured(p.aiConfigured);
    }
    if (kb) setEntries(kb.entries);
    if (size) setKbSize(size);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  async function saveProfile(patch: Partial<Profile>) {
    await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void refetch();
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h2 className="font-semibold">Agente de IA</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-primary">Guardado ✓</span>}
          <span className="text-sm text-muted-foreground">
            {profile.enabled ? "Encendido" : "Apagado"}
          </span>
          <button
            role="switch"
            aria-checked={profile.enabled}
            aria-label="Agente encendido"
            disabled={!aiConfigured}
            onClick={() => void saveProfile({ enabled: !profile.enabled })}
            className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${
              profile.enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                profile.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </header>

      {!aiConfigured && (
        <div className="mx-6 mt-6 rounded-lg border border-brand-soft bg-brand-tint p-6 text-center">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">Configure su proveedor de IA para activar el agente</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Agregue <code className="rounded bg-secondary px-1">OPENROUTER_API_TOKEN</code> y{" "}
            <code className="rounded bg-secondary px-1">OPENROUTER_MODEL</code> a las variables
            de entorno de la instancia y reiníciela. Mientras tanto puede dejar listo el
            comportamiento y el conocimiento aquí abajo.
          </p>
        </div>
      )}

      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <ProfileSection profile={profile} onSave={saveProfile} />
        <KbSection entries={entries} kbSize={kbSize} onChanged={() => void refetch()} />
      </div>

      <div className="px-6 pb-6">
        <RulesSection />
      </div>
    </div>
  );
}

function ProfileSection({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (patch: Partial<Profile>) => Promise<void>;
}) {
  const [form, setForm] = useState(profile);
  useEffect(() => setForm(profile), [profile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comportamiento</CardTitle>
        <CardDescription>
          Cómo se presenta y actúa el agente al responder a sus clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Identidad y tono
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Nombre del agente</Label>
            <Input
              id="agent-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-voice-trato">Tratamiento</Label>
              <select
                id="agent-voice-trato"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.voice?.tratamiento ?? "usted"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    voice: {
                      tratamiento: e.target.value as AgentVoice["tratamiento"],
                      pais: form.voice?.pais ?? "",
                      largo: form.voice?.largo ?? "medio",
                    },
                  })
                }
              >
                <option value="usted">Usted</option>
                <option value="tu">Tú</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-voice-pais">País o región</Label>
              <Input
                id="agent-voice-pais"
                placeholder="Chile"
                value={form.voice?.pais ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    voice: {
                      tratamiento: form.voice?.tratamiento ?? "usted",
                      pais: e.target.value,
                      largo: form.voice?.largo ?? "medio",
                    },
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-voice-largo">Largo de los mensajes</Label>
              <select
                id="agent-voice-largo"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.voice?.largo ?? "medio"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    voice: {
                      tratamiento: form.voice?.tratamiento ?? "usted",
                      pais: form.voice?.pais ?? "",
                      largo: e.target.value as AgentVoice["largo"],
                    },
                  })
                }
              >
                <option value="corto">Corto (1-2 líneas)</option>
                <option value="medio">Medio (2-3 líneas)</option>
              </select>
            </div>
          </div>
          {form.voice && !form.voice.pais.trim() && (
            <p className="text-xs text-muted-foreground">
              Indique el país o región para que el agente use ese español.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="agent-tone">Matices de tono (opcional)</Label>
            <Input
              id="agent-tone"
              placeholder="p. ej. cercano y directo"
              value={form.tone ?? ""}
              onChange={(e) => setForm({ ...form, tone: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Instrucciones
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="agent-instructions">Instrucciones</Label>
            <Textarea
              id="agent-instructions"
              rows={5}
              placeholder="Qué debe y no debe hacer el agente…"
              value={form.instructions ?? ""}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
            <CharCounter value={form.instructions} max={INSTRUCTIONS_MAX} />
            {!form.instructions && (
              <p className="text-xs text-muted-foreground">Sin configurar</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Escalado
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="agent-escalation">Reglas de escalado</Label>
            <Textarea
              id="agent-escalation"
              rows={3}
              placeholder="Cuándo pasar la conversación a un humano…"
              value={form.escalationRules ?? ""}
              onChange={(e) => setForm({ ...form, escalationRules: e.target.value })}
            />
            <CharCounter value={form.escalationRules} max={ESCALATION_MAX} />
            {!form.escalationRules && (
              <p className="text-xs text-muted-foreground">Sin configurar</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Saludo
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="agent-greeting">Saludo</Label>
            <Input
              id="agent-greeting"
              placeholder="Saludo para conversaciones nuevas"
              value={form.greeting ?? ""}
              onChange={(e) => setForm({ ...form, greeting: e.target.value })}
            />
            {!form.greeting && (
              <p className="text-xs text-muted-foreground">Sin configurar</p>
            )}
          </div>
        </div>

        <Button
          onClick={() =>
            void onSave({
              ...form,
              voice: form.voice && form.voice.pais.trim() ? form.voice : null,
            })
          }
        >
          Guardar comportamiento
        </Button>
      </CardContent>
    </Card>
  );
}

function KbSection({
  entries,
  kbSize,
  onChanged,
}: {
  entries: KbEntry[];
  kbSize: { chars: number; warnAt: number; warning: boolean } | null;
  onChanged: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [block, setBlock] = useState("");

  async function addQa() {
    if (!question.trim() || !answer.trim()) return;
    await fetch("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "qa", question, answer }),
    }).catch(() => null);
    setQuestion("");
    setAnswer("");
    onChanged();
  }

  async function addBlock() {
    if (!block.trim()) return;
    await fetch("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "block", content: block }),
    }).catch(() => null);
    setBlock("");
    onChanged();
  }

  async function remove(id: string) {
    await fetch(`/api/kb/${id}`, { method: "DELETE" }).catch(() => null);
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>
              La única fuente de verdad del agente: lo que no está aquí, no lo
              afirma.
            </CardDescription>
          </div>
          {kbSize && (
            <Badge variant={kbSize.warning ? "warning" : "secondary"}>
              {kbSize.chars.toLocaleString("es-MX")} caracteres
            </Badge>
          )}
        </div>
        {kbSize?.warning && (
          <p className="text-xs text-[#8a6d3b]">
            El conocimiento se acerca al límite del contexto del modelo (v1 lo
            inyecta completo en cada turno). Considere depurar entradas.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nueva pregunta / respuesta</p>
          <Input
            placeholder="Pregunta (p. ej. ¿Hacen envíos?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            placeholder="Respuesta"
            rows={2}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => void addQa()}
            disabled={!question.trim() || !answer.trim()}
          >
            <Plus className="h-4 w-4" /> Agregar P/R
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Nuevo bloque de texto libre</p>
          <Textarea
            placeholder="Horarios, direcciones, políticas…"
            rows={3}
            value={block}
            onChange={(e) => setBlock(e.target.value)}
          />
          <Button size="sm" onClick={() => void addBlock()} disabled={!block.trim()}>
            <Plus className="h-4 w-4" /> Agregar bloque
          </Button>
        </div>

        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-md border p-3">
              <div className="min-w-0 flex-1 text-sm">
                {e.kind === "qa" ? (
                  <>
                    <p className="font-medium">{e.question}</p>
                    <p className="mt-0.5 text-muted-foreground">{e.answer}</p>
                  </>
                ) : (
                  <p className="whitespace-pre-wrap text-muted-foreground">{e.content}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Eliminar entrada"
                onClick={() => void remove(e.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {entries.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Sin entradas todavía: agregue lo que el agente debe saber.
            </p>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function RulesSection() {
  const [data, setData] = useState<PromptPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/agent/prompt")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: PromptPayload | null) => {
        if (active && json) setData(json);
        else if (active) setFailed(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const groups = data ? summarizeRules(data.rules.nivel1, data.rules.nivel2) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reglas del agente</CardTitle>
        <CardDescription>
          Reglas fijas del producto que el agente respeta en cada respuesta,
          agrupadas por tema. La configuración del negocio nunca puede
          contradecirlas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {failed && (
          <p className="text-sm text-muted-foreground">
            No se pudo cargar el resumen de reglas.
          </p>
        )}
        {!data && !failed && (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group.topic} className="space-y-1">
              <p className="text-sm font-medium">{group.topic}</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {group.rules.map((rule, index) => (
                  <li key={`${group.topic}-${index}`}>{rule}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Ver qué recibe el agente
          </Button>
          <p className="text-xs text-muted-foreground">
            {data
              ? data.clientFileNote
              : "Vista previa del prompt base con los datos de esta instancia."}
          </p>
          {open && data && (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-secondary p-3 font-mono text-xs">
              {data.effectivePrompt}
            </pre>
          )}
          {open && failed && (
            <p className="text-sm text-muted-foreground">
              No se pudo cargar el prompt.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
