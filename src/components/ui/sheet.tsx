"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sheet lateral (drawer por la derecha) con backdrop. Se desmonta por completo
 * al cerrar (`open=false`) para que los inputs del formulario arranquen limpios
 * en cada apertura.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l bg-background shadow-xl",
          className
        )}
      >
        <header className="border-b px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">{title}</h2>
              {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="shrink-0 rounded-sm border p-1.5 text-text-3 hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
