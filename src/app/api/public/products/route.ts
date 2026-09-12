import { apiError } from "@/lib/api";
import { getActiveProductsPublic } from "@/server/catalog/queries";
import { resolveInstanceOrg } from "@/server/bot/auth";

export const dynamic = "force-dynamic";

/**
 * Catálogo público (US5) — alimenta la web de la marca. Sin autenticación:
 * el dato que expone es de venta (público). Solo productos activos con la
 * proyección pública (`PublicProductSchema`); el costo NUNCA sale (la query
 * no consulta `product_cost` y el serializer valida contra un shape estricto).
 */
export async function GET(_req: Request) {
  const orgId = await resolveInstanceOrg();
  if (!orgId) {
    return apiError(404, "no_organization", "Instancia sin organización");
  }
  const products = await getActiveProductsPublic(orgId);
  return Response.json({ products });
}