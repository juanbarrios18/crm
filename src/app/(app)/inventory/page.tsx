import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function InventoryPage() {
  return (
    <ComingSoon
      title="Inventario"
      description="Stock real de lo que vendés y de los insumos que comprás."
      items={[
        "Existencias por producto e insumo",
        "Entradas, salidas y ajustes como movimientos",
        "Alertas de reposición por mínimo",
      ]}
    />
  );
}
