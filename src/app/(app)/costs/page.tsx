import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function CostsPage() {
  return (
    <ComingSoon
      title="Costos"
      description="Costo unitario vigente e histórico por producto, y el margen que sale de ahí."
      items={[
        "Costo unitario vigente e histórico (ledger por movimiento)",
        "Margen derivado del precio y el costo, sin guardarlo",
        "El modelo de datos ya está implementado: falta la interfaz",
      ]}
    />
  );
}
