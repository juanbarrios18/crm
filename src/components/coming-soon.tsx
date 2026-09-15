import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Página completa para módulos del mapa de información que todavía no tienen
 * interfaz. El texto es la especificación del módulo, no un placeholder vacío:
 * `items` describe qué va a vivir acá cuando esté implementado.
 */
export function ComingSoon({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  /** Qué va a vivir acá cuando esté implementado. */
  items: string[];
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>Qué va a incluir</CardTitle>
                <Badge variant="secondary">Próximamente</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-sm text-text-3"
                  >
                    <span
                      className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-3"
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
