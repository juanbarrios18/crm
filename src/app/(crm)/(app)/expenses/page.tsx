import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function ExpensesPage() {
  return (
    <ComingSoon
      title="Gastos"
      description="Los gastos operativos del negocio, separados del costo de lo que producís."
      items={[
        "Gastos por categoría, fecha y responsable",
        "Comprobante y forma de pago",
        "Comparación contra el margen del período",
      ]}
    />
  );
}
