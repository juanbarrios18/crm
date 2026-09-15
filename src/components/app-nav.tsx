"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Calculator,
  Factory,
  FlaskConical,
  Inbox,
  Kanban,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  Wallet,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import { useEvents } from "@/components/use-events";
import { InstallPrompt } from "@/components/pwa/install-prompt";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: boolean;
};

/**
 * El sidebar refleja el DOMINIO, no las tablas: relación (entidades vivas que
 * conversan y avanzan) · operación (cosas que se producen, se mueven y cuestan)
 * · sistema (cómo se comporta la máquina).
 *
 * Se agrupa por ANCHURA, no por profundidad: son áreas entre las que el dueño
 * salta todo el día, así que van visibles en vez de detrás de un sub-nav. El
 * sub-nav está reservado para profundidad (configuración de vez en cuando),
 * que es exactamente lo que hace Ajustes.
 */
const NAV_GROUPS: readonly { label: string; items: readonly NavItem[] }[] = [
  {
    label: "Relación",
    items: [
      { href: "/inbox", label: "Bandeja", icon: Inbox, badge: true },
      { href: "/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/contacts", label: "Contactos", icon: Users },
    ],
  },
  {
    label: "Operaciones",
    items: [
      { href: "/products", label: "Productos", icon: Package },
      { href: "/shipping", label: "Envíos", icon: Truck },
      { href: "/inventory", label: "Inventario", icon: Warehouse },
      { href: "/production", label: "Producción", icon: Factory },
      { href: "/costs", label: "Costos", icon: Calculator },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { href: "/sales", label: "Ventas", icon: ShoppingCart },
      { href: "/expenses", label: "Gastos", icon: Wallet },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/agent", label: "Agente", icon: Sparkles },
      { href: "/lab", label: "Laboratorio", icon: FlaskConical },
    ],
  },
];

export function AppNav({
  branding,
  userName,
  role,
}: {
  branding: Branding;
  userName: string;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  async function refetchUnread() {
    const res = await fetch("/api/conversations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as {
      conversations: { unreadCount: number }[];
    };
    setUnread(data.conversations.reduce((a, c) => a + c.unreadCount, 0));
  }

  useEffect(() => {
    void refetchUnread();
  }, []);

  useEvents({
    onMessageNew: () => void refetchUnread(),
    onConversationUpdated: () => void refetchUnread(),
  });

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  const close = () => setOpen(false);

  const brand = (
    <div className="mb-4 flex items-center gap-2.5 px-2">
      <span
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm bg-brand text-[15px] font-bold text-white"
        aria-hidden
      >
        {branding.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[16px] font-[650] leading-tight tracking-tight">
          {branding.name}
        </span>
        <span className="block text-[11px] text-text-3">Sistema de gestión</span>
      </span>
    </div>
  );

  const links = (
    <nav className="flex flex-col gap-3.5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={cn(
                  "flex items-center gap-[11px] rounded-sm px-2.5 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-tint font-semibold text-brand-text"
                    : "text-text-2 hover:bg-accent"
                )}
              >
                <item.icon
                  className={cn("h-[18px] w-[18px]", active ? "text-brand" : "text-text-3")}
                  strokeWidth={1.7}
                />
                <span className="flex-1">{item.label}</span>
                {item.badge && unread > 0 && (
                  <span
                    className={cn(
                      "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold",
                      active ? "bg-brand text-white" : "bg-border-strong text-text-2"
                    )}
                  >
                    {unread}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const settingsLink = (
    <Link
      href="/settings"
      onClick={close}
      className={cn(
        "flex items-center gap-[11px] rounded-sm px-2.5 py-2 text-sm font-medium transition-colors",
        pathname.startsWith("/settings")
          ? "bg-brand-tint font-semibold text-brand-text"
          : "text-text-2 hover:bg-accent"
      )}
    >
      <Settings
        className={cn(
          "h-[18px] w-[18px]",
          pathname.startsWith("/settings") ? "text-brand" : "text-text-3"
        )}
        strokeWidth={1.7}
      />
      Ajustes
    </Link>
  );

  const userSection = (
    <div className="mt-1 flex items-center gap-2.5 rounded-sm px-2.5 py-2 hover:bg-accent">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
        {initials(userName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{userName}</span>
        <span className="block text-[11px] text-text-3">
          {role === "owner" ? "Propietario" : "Equipo"} · En línea
        </span>
      </span>
      <button
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
        className="rounded p-1 text-text-3 hover:text-foreground"
        onClick={() => void handleSignOut()}
      >
        <LogOut className="h-4 w-4" strokeWidth={1.7} />
      </button>
    </div>
  );

  const content = (
    <>
      {brand}
      {links}
      <div className="flex-1" />
      <div className="mt-2">
        <InstallPrompt />
      </div>
      {settingsLink}
      {userSection}
    </>
  );

  return (
    <>
      {/* Sidebar de escritorio */}
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-subtle px-3 pb-3.5 pt-4 md:flex">
        {content}
      </aside>

      {/* Barra superior móvil */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-subtle px-3 md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menú"
          className="rounded-sm p-1.5 text-text-2 hover:bg-accent"
        >
          <Menu className="h-5 w-5" strokeWidth={1.7} />
        </button>
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm bg-brand text-[11px] font-bold text-white"
            aria-hidden
          >
            {branding.name.charAt(0).toUpperCase()}
          </span>
          <span className="truncate text-[14px] font-[650]">{branding.name}</span>
        </span>
        {unread > 0 && (
          <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-semibold text-white">
            {unread}
          </span>
        )}
      </header>

      {/* Drawer móvil */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-subtle px-3 pb-3.5 pt-4 shadow-xl">
            <button
              onClick={close}
              aria-label="Cerrar menú"
              className="absolute right-3 top-3 rounded-sm p-1 text-text-3 hover:text-foreground"
            >
              <X className="h-4 w-4" strokeWidth={1.7} />
            </button>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
