import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 005 — Contrato del endpoint público (T019). `GET /api/public/products`
 * devuelve solo la proyección pública (FR-040) y nunca el costo (FR-041).
 */

const { GET } = await import("@/app/api/public/products/route");
const { getActiveProductsPublic } = await import("@/server/catalog/queries");
const { resolveInstanceOrg } = await import("@/server/bot/auth");

vi.mock("@/server/catalog/queries", () => ({
  getActiveProductsPublic: vi.fn(),
  getActiveZones: vi.fn(),
}));

vi.mock("@/server/bot/auth", () => ({
  resolveInstanceOrg: vi.fn(),
}));

const mockedGet = vi.mocked(getActiveProductsPublic);
const mockedResolve = vi.mocked(resolveInstanceOrg);

beforeEach(() => {
  mockedGet.mockReset();
  mockedResolve.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/public/products", () => {
  it("devuelve 404 sin organización", async () => {
    mockedResolve.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/public/products"));
    expect(res.status).toBe(404);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("devuelve la proyección pública de los productos activos", async () => {
    mockedResolve.mockResolvedValue("org_1");
    mockedGet.mockResolvedValue([
      {
        producto: "Pan de hamburguesa",
        masa: "Brioche",
        formato: "12 cm",
        unidadesPorBolsa: 6,
        precioUnitarioNeto: 370,
        precioBolsaNeto: 2220,
        precioBolsaConIva: 2641.8,
        activo: true,
        notas: null,
      },
    ]);

    const res = await GET(new Request("http://localhost/api/public/products"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { products: Record<string, unknown>[] };
    expect(json.products).toHaveLength(1);
    const first = json.products[0]!;
    expect(first).toHaveProperty("producto");
    expect(first).toHaveProperty("precioBolsaConIva", 2641.8);
    expect(first).not.toHaveProperty("costo");
    expect(first).not.toHaveProperty("margen");
  });
});