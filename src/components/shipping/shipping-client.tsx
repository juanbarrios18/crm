"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";

/* NOTA: formateo de precio replicado localmente (función pura). No se importa
 * `@/server/ai/prompts` para no arrastrar un módulo server a un client bundle. */
function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const hasCents = Math.round(value * 100) % 100 !== 0;
  const fixed = hasCents ? value.toFixed(2) : String(Math.round(value));
  const dot = fixed.indexOf(".");
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const decPart = dot === -1 ? "" : fixed.slice(dot + 1);
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart ? `${withThousands},${decPart}` : withThousands;
}

type AdminZone = {
  id: string;
  comuna: string;
  costoDespacho: number | null;
  activa: boolean;
};

async function readErrorMessage(res: Response | null): Promise<string | null> {
  if (!res) return null;
  const data = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return data?.error?.message ?? null;
}

const EMPTY_ZONE = { comuna: "", costoDespacho: "", activa: true };

export function ShippingClient() {
  const [zones, setZones] = useState<AdminZone[]>([]);
  const [loading, setLoading] = useState(true);
  /* `loadError` es del listado (refetch/borrado); `formError` es del formulario. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_ZONE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/zones").catch(() => null);
    if (!res?.ok) {
      setLoadError(await readErrorMessage(res));
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { zones: AdminZone[] };
    setZones(data.zones);
    setLoadError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function resetForm() {
    setForm(EMPTY_ZONE);
    setEditingId(null);
  }

  function openCreate() {
    resetForm();
    setFormError(null);
    setSheetOpen(true);
  }

  function startEdit(z: AdminZone) {
    setEditingId(z.id);
    setForm({
      comuna: z.comuna,
      costoDespacho: z.costoDespacho != null ? String(z.costoDespacho) : "",
      activa: z.activa,
    });
    setFormError(null);
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    resetForm();
    setFormError(null);
  }

  async function submit() {
    if (!form.comuna.trim()) return;
    const costoRaw = form.costoDespacho.trim();
    const costo = costoRaw === "" ? null : Number(costoRaw.replace(",", "."));
    if (costo !== null && (!Number.isFinite(costo) || costo < 0)) {
      setFormError("Costo de despacho inválido");
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      comuna: form.comuna.trim(),
      costoDespacho: costo,
      activa: form.activa,
    };
    const res = await fetch(editingId ? `/api/zones/${editingId}` : "/api/zones", {
      method: editingId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setFormError(
        (await readErrorMessage(res)) ?? "No se pudo guardar la zona"
      );
      return;
    }
    closeSheet();
    void refetch();
  }

  async function remove(z: AdminZone) {
    if (!window.confirm(`¿Eliminar la comuna "${z.comuna}"?`)) return;
    const res = await fetch(`/api/zones/${z.id}`, { method: "DELETE" }).catch(
      () => null
    );
    if (!res?.ok) {
      setLoadError(
        (await readErrorMessage(res)) ?? "No se pudo eliminar la zona"
      );
      return;
    }
    if (editingId === z.id) closeSheet();
    void refetch();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Envíos</h2>
          <p className="text-sm text-muted-foreground">
            Comunas con cobertura y su tarifa de despacho. El agente solo ofrece
            envío a las comunas activas de esta lista.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Agregar comuna
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl space-y-2">
          {loading && (
            <p className="text-sm text-muted-foreground">Cargando comunas…</p>
          )}
          {!loading && zones.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Sin comunas cargadas. Agregá la primera con el botón de arriba.
            </p>
          )}
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {zones.map((z) => (
            <div
              key={z.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{z.comuna}</p>
                <p className="text-xs text-text-3">
                  {z.costoDespacho != null
                    ? `$${fmtPrice(z.costoDespacho)} de despacho`
                    : "Sin tarifa definida"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Badge variant={z.activa ? "success" : "secondary"}>
                  {z.activa ? "Activa" : "Inactiva"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Editar comuna"
                  onClick={() => startEdit(z)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Eliminar comuna"
                  onClick={() => void remove(z)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Sheet
        open={sheetOpen}
        onClose={closeSheet}
        title={editingId ? "Editar comuna" : "Nueva comuna de despacho"}
        description="Si no defines costo, el agente dirá que la tarifa no está definida."
        className="sm:max-w-lg"
        footer={
          <div className="flex gap-2">
            <Button
              disabled={saving || !form.comuna.trim()}
              onClick={() => void submit()}
            >
              {editingId ? null : <Plus className="h-4 w-4" />}
              {saving
                ? "Guardando…"
                : editingId
                  ? "Guardar cambios"
                  : "Agregar comuna"}
            </Button>
            <Button variant="outline" onClick={closeSheet}>
              <X className="h-4 w-4" />
              Cancelar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="zone-comuna">Comuna</Label>
              <Input
                id="zone-comuna"
                autoFocus
                value={form.comuna}
                onChange={(e) => setForm({ ...form, comuna: e.target.value })}
                placeholder="Providencia"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zone-costo">Costo de despacho ($, opcional)</Label>
              <Input
                id="zone-costo"
                type="number"
                min={0}
                step="any"
                value={form.costoDespacho}
                onChange={(e) =>
                  setForm({ ...form, costoDespacho: e.target.value })
                }
                placeholder="Sin tarifa"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={form.activa}
              onChange={(e) => setForm({ ...form, activa: e.target.checked })}
            />
            Zona activa (visible para el agente)
          </label>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </div>
      </Sheet>
    </div>
  );
}
