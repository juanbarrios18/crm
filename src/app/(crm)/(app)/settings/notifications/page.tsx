import { InstallPrompt } from "@/components/pwa/install-prompt";
import { PushToggle } from "@/components/pwa/push-toggle";

export const dynamic = "force-dynamic";

export default function NotificationsPage() {
  return (
    <div className="max-w-xl space-y-8">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Notificaciones de handoff</h3>
        <p className="text-sm text-muted-foreground">
          Recibe un aviso en tu móvil cuando la IA escala una conversación a un
          humano. Toca la notificación para abrir directo esa conversación.
        </p>
        <PushToggle />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Instalar en el móvil</h3>
        <p className="text-sm text-muted-foreground">
          Instala Vocero como app para acceder más rápido y habilitar las
          notificaciones en iPhone (requiere PWA instalada en iOS 16.4+).
        </p>
        <InstallPrompt />
      </div>
    </div>
  );
}
