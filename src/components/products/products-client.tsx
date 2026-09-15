"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

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

/** Tasa de IVA usada para el preview (debe coincidir con el server). */
const IVA_RATE = 1.19;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

type AdminProduct = {
  id: string;
  producto: string;
  masa: string;
  formato: string;
  unidadesPorBolsa: number;
  precioUnitarioNeto: number;
  precioBolsaNeto: number;
  precioBolsaConIva: number;
  activo: boolean;
  notas: string | null;
};

async function readErrorMessage(res: Response | null): Promise<string | null> {
  if (!res) return null;
  const data = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return data?.error?.message ?? null;
}

const EMPTY_PRODUCT = {
  producto: "",
  masa: "",
  formato: "",
  unidadesPorBolsa: "6",
  precioBolsaNeto: "",
  activo: true,
  notas: "",
};

export function ProductsClient() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  /* `loadError` es del listado (refetch/borrado); `formError` es del formulario. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/products").catch(() => null);
    if (!res?.ok) {
      setLoadError(await readErrorMessage(res));
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { products: AdminProduct[] };
    setProducts(data.products);
    setLoadError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function resetForm() {
    setForm(EMPTY_PRODUCT);
    setEditingId(null);
  }

  function openCreate() {
    resetForm();
    setFormError(null);
    setSheetOpen(true);
  }

  function startEdit(p: AdminProduct) {
    setEditingId(p.id);
    setForm({
      producto: p.producto,
      masa: p.masa,
      formato: p.formato,
      unidadesPorBolsa: String(p.unidadesPorBolsa),
      precioBolsaNeto: String(p.precioBolsaNeto),
      activo: p.activo,
      notas: p.notas ?? "",
    });
    setFormError(null);
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    resetForm();
    setFormError(null);
  }

  const unidades = Number(form.unidadesPorBolsa);
  const precioNeto = Number(form.precioBolsaNeto.replace(",", "."));
  const previewValid =
    Number.isInteger(unidades) &&
    unidades > 0 &&
    Number.isFinite(precioNeto) &&
    precioNeto >= 0;

  async function submit() {
    if (!previewValid) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      producto: form.producto.trim(),
      masa: form.masa.trim(),
      formato: form.formato.trim(),
      unidadesPorBolsa: unidades,
      precioBolsaNeto: precioNeto,
      activo: form.activo,
      notas: form.notas.trim() ? form.notas.trim() : null,
    };
    const res = await fetch(
      editingId ? `/api/products/${editingId}` : "/api/products",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    ).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setFormError(
        (await readErrorMessage(res)) ?? "No se pudo guardar el producto"
      );
      return;
    }
    closeSheet();
    void refetch();
  }

  async function remove(p: AdminProduct) {
    if (
      !window.confirm(
        `¿Eliminar "${p.producto} · ${p.masa} · ${p.formato}"? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/products/${p.id}`, { method: "DELETE" }).catch(
      () => null
    );
    if (!res?.ok) {
      setLoadError(
        (await readErrorMessage(res)) ?? "No se pudo eliminar el producto"
      );
      return;
    }
    if (editingId === p.id) closeSheet();
    void refetch();
  }

  const canSubmit =
    previewValid &&
    form.producto.trim().length > 0 &&
    form.masa.trim().length > 0 &&
    form.formato.trim().length > 0 &&
    !saving;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Productos</h2>
          <p className="text-sm text-muted-foreground">
            Catálogo de venta que usa el agente para cotizar. El costo interno no
            se muestra acá.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Agregar producto
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl space-y-2">
          {loading && (
            <p className="text-sm text-muted-foreground">Cargando productos…</p>
          )}
          {!loading && products.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Sin productos todavía. Agregá el primero con el botón de arriba.
            </p>
          )}
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {products.map((p) => (
            <div key={p.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {p.producto}{" "}
                    <span className="text-muted-foreground">
                      · {p.masa} · {p.formato}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-text-3">
                    {p.unidadesPorBolsa} un/bolsa · unitario $
                    {fmtPrice(p.precioUnitarioNeto)} · bolsa $
                    {fmtPrice(p.precioBolsaNeto)} neto · $
                    {fmtPrice(p.precioBolsaConIva)} con IVA
                  </p>
                  {p.notas && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.notas}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant={p.activo ? "success" : "secondary"}>
                    {p.activo ? "Activo" : "Inactivo"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Editar producto"
                    onClick={() => startEdit(p)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar producto"
                    onClick={() => void remove(p)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Sheet
        open={sheetOpen}
        onClose={closeSheet}
        title={editingId ? "Editar producto" : "Nuevo producto"}
        description="El precio unitario y el precio con IVA se calculan solos a partir del precio de bolsa neto y las unidades por bolsa (IVA 19%)."
        className="sm:max-w-xl"
        footer={
          <div className="flex gap-2">
            <Button disabled={!canSubmit} onClick={() => void submit()}>
              {editingId ? null : <Plus className="h-4 w-4" />}
              {saving
                ? "Guardando…"
                : editingId
                  ? "Guardar cambios"
                  : "Agregar producto"}
            </Button>
            <Button variant="outline" onClick={closeSheet}>
              <X className="h-4 w-4" />
              Cancelar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="prod-producto">Producto</Label>
              <Input
                id="prod-producto"
                autoFocus
                value={form.producto}
                onChange={(e) => setForm({ ...form, producto: e.target.value })}
                placeholder="Pan de hamburguesa"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prod-masa">Masa</Label>
              <Input
                id="prod-masa"
                value={form.masa}
                onChange={(e) => setForm({ ...form, masa: e.target.value })}
                placeholder="Brioche"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prod-formato">Formato</Label>
              <Input
                id="prod-formato"
                value={form.formato}
                onChange={(e) => setForm({ ...form, formato: e.target.value })}
                placeholder="12 cm"
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="prod-unidades">Unidades por bolsa</Label>
              <Input
                id="prod-unidades"
                type="number"
                min={1}
                step={1}
                value={form.unidadesPorBolsa}
                onChange={(e) =>
                  setForm({ ...form, unidadesPorBolsa: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prod-precio">Precio de bolsa neto ($)</Label>
              <Input
                id="prod-precio"
                type="number"
                min={0}
                step="any"
                value={form.precioBolsaNeto}
                onChange={(e) =>
                  setForm({ ...form, precioBolsaNeto: e.target.value })
                }
                placeholder="2220"
              />
            </div>
          </div>
          {previewValid && (
            <p className="text-xs text-text-3">
              Unitario neto:{" "}
              <span className="font-medium text-text-2">
                ${fmtPrice(roundTo(precioNeto / unidades, 4))}
              </span>
              {" · "}
              Bolsa con IVA:{" "}
              <span className="font-medium text-text-2">
                ${fmtPrice(roundTo(precioNeto * IVA_RATE, 2))}
              </span>
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="prod-notas">Notas (opcional)</Label>
            <Textarea
              id="prod-notas"
              rows={2}
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
              placeholder="Observaciones internas del producto"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={form.activo}
              onChange={(e) => setForm({ ...form, activo: e.target.checked })}
            />
            Producto activo (visible para el agente)
          </label>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </div>
      </Sheet>
    </div>
  );
}
