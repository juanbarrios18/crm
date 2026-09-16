/**
 * Inyecta datos estructurados schema.org (JSON-LD).
 *
 * `JSON.stringify` no escapa `<`, así que un `</script>` dentro de cualquier
 * string cortaría el bloque y permitiría inyectar HTML. Se reemplaza por su
 * escape unicode antes de emitirlo.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      // El contenido es JSON serializado y escapado por nosotros, no input del
      // usuario: es la única forma de emitir un <script> de datos en React.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
