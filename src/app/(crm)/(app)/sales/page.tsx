import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function SalesPage() {
  return (
    <ComingSoon
      title="Ventas"
      description="Pedidos con sus líneas, precios congelados al momento de la venta y estado de entrega."
      items={[
        "Pedidos con líneas, cantidades y precios congelados",
        "Estado de entrega y cobro",
        "Origen: conversación de WhatsApp o carga manual",
      ]}
    />
  );
}
