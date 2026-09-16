/**
 * Formateo de valores para la web pública.
 *
 * Los precios del catálogo se guardan con 4 decimales (`numeric(12,4)`) porque
 * el precio unitario se deriva del precio de bolsa entre las unidades. En CLP
 * no circulan decimales, así que se redondea al peso para mostrar.
 */
const CLP = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const DECIMAL = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 2,
});

/** `2641.8` → `"$2.642"`. */
export function formatClp(value: number): string {
  return CLP.format(Math.round(value));
}

/** Precio unitario: puede ser fraccionario, así que conserva decimales. */
export function formatClpPrecise(value: number): string {
  return value % 1 === 0
    ? CLP.format(value)
    : `$${DECIMAL.format(value)}`;
}
