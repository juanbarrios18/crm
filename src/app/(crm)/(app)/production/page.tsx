import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function ProductionPage() {
  return (
    <ComingSoon
      title="Producción"
      description="Qué fabricás, con qué insumos y a qué costo."
      items={[
        "Órdenes de producción con estado",
        "Consumo de insumos por receta",
        "Merma y rendimiento por lote",
      ]}
    />
  );
}
