import { describe, expect, it } from "vitest";
import { parseCatalogCsv } from "@/server/catalog/import";
import { parseLocalPrice } from "@/lib/catalog";

/**
 * 005 — Import del catálogo (T007). Parser + normalización de precios
 * locales (FR-003): decimal con coma, sin separador de miles, upsert por SKU.
 */

describe("parseLocalPrice", () => {
  it("normaliza decimal con coma", () => {
    expect(parseLocalPrice("2641,8")).toBe(2641.8);
    expect(parseLocalPrice("3748,5")).toBe(3748.5);
  });

  it("normaliza con separador de miles en formato local", () => {
    expect(parseLocalPrice("2.641,8")).toBe(2641.8);
  });

  it("acepta enteros sin decimal", () => {
    expect(parseLocalPrice("4284")).toBe(4284);
    expect(parseLocalPrice(" 4284 ")).toBe(4284);
  });

  it("lanza error ante un valor no numérico", () => {
    expect(() => parseLocalPrice("abc")).toThrow();
  });
});

describe("parseCatalogCsv", () => {
  const CSV = [
    "producto,masa,formato,unidades_por_bolsa,precio_unitario_neto,precio_bolsa_neto,precio_bolsa_con_iva,activo,notas",
    'Pan de hamburguesa,Brioche,12 cm,6,370,2220,"2641,8",SI,',
    "Pan de hamburguesa,Papa,10 cm,12,380,4560,\"5426,4\",SI,\"nota con, coma\"",
  ].join("\n");

  it("parsea filas y normaliza decimales", () => {
    const rows = parseCatalogCsv(CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      producto: "Pan de hamburguesa",
      masa: "Brioche",
      formato: "12 cm",
      unidadesPorBolsa: 6,
      precioUnitarioNeto: 370,
      precioBolsaNeto: 2220,
      precioBolsaConIva: 2641.8,
      activo: true,
      notas: null,
    });
  });

  it("respeta comillas en campo con coma", () => {
    const rows = parseCatalogCsv(CSV);
    expect(rows[1]!.notas).toBe("nota con, coma");
  });

  it("reconoce activo en SI/NO", () => {
    const csv = [
      "producto,masa,formato,unidades_por_bolsa,precio_unitario_neto,precio_bolsa_neto,precio_bolsa_con_iva,activo,notas",
      "Pan,Pan,10 cm,1,100,100,119,SI,",
      "Otro,Pan,10 cm,1,100,100,119,NO,",
    ].join("\n");
    const rows = parseCatalogCsv(csv);
    expect(rows[0]!.activo).toBe(true);
    expect(rows[1]!.activo).toBe(false);
  });

  it("usa 'Sin masa' cuando la columna masa viene vacía", () => {
    const csv = [
      "producto,masa,formato,unidades_por_bolsa,precio_unitario_neto,precio_bolsa_neto,precio_bolsa_con_iva,activo,notas",
      "Pan ciabatta,,Estandar,6,400,2400,2856,SI,",
    ].join("\n");
    const rows = parseCatalogCsv(csv);
    expect(rows[0]!.masa).toBe("Sin masa");
  });

  it("lanza error con fila incompleta", () => {
    const csv = [
      "producto,masa,formato,unidades_por_bolsa,precio_unitario_neto,precio_bolsa_neto,precio_bolsa_con_iva,activo,notas",
      "Pan,Brioche,12 cm,6,370,2220",
    ].join("\n");
    expect(() => parseCatalogCsv(csv)).toThrow();
  });

  it("devuelve vacío sin filas", () => {
    expect(parseCatalogCsv("producto,masa,formato\n")).toEqual([]);
  });
});