/**
 * Contenido editorial de la web pública de LamasFoods.
 *
 * Vive en código (tipado) a propósito: la web es estática y liviana, y un CMS
 * agregaría una dependencia de runtime que la Constitución II no permite en v1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROCEDENCIA DE LOS TEXTOS
 *
 * El enfoque y los argumentos salen de la comunicación real de la marca en
 * Instagram (@lamasfoods), profesionalizados: mismo ángulo comercial —el pan
 * está pensado para el uso gastronómico del cliente—, sin la hipérbole de
 * redes. El diferencial que sostiene todos los textos es el comportamiento
 * real de cada masa:
 *
 *   · Masa de papa  → al presionarla NO vuelve a su forma: abraza los
 *                     ingredientes y contiene los líquidos.
 *   · Masa de brioche → al presionarla DEBE volver a su forma: alta, brillante
 *                     y elástica. Fermentación larga.
 *
 * Ver `docs/contenido-lamasfood-instagram.md` para el material de origen y sus
 * huecos.
 *
 * PENDIENTE DE DATOS REALES: las imágenes son placeholders abstractos en
 * `public/site/` y se reemplazan por las fotos reales usando el MISMO nombre de
 * archivo. Los datos de contacto (dirección, correo, horarios) siguen siendo
 * falsos y están marcados con `// REEMPLAZAR`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const SITE_NAME = "LamasFoods";

/**
 * Bajada de marca. Se renderiza en letra chica bajo el logotipo (header) y en
 * el pie, así que tiene que ser corta: una etiqueta, no una frase.
 */
export const SITE_TAGLINE = "Panadería artesanal";

/** Datos de contacto. Los campos marcados siguen pendientes del negocio. */
export const CONTACT = {
  // REEMPLAZAR — datos reales del negocio
  phoneDisplay: "+56 9 0000 0000",
  whatsapp: "56900000000",
  email: "hola@lamasfood.cl",
  address: "Av. Siempre Viva 123, Santiago",
  // REEMPLAZAR — horarios reales
  hours: "Lunes a sábado · 07:00 a 19:00",
  /** El mismo horario en formato schema.org (lo consume el JSON-LD). */
  hoursSchema: "Mo-Sa 07:00-19:00",
  instagram: "https://instagram.com/",
  facebook: "https://facebook.com/",
} as const;

/** Link de WhatsApp con mensaje pre-cargado: el CTA principal del sitio. */
export const WHATSAPP_HREF = whatsappHref(
  "Hola LamasFoods, quiero hacer un pedido mayorista."
);

/** Arma un link de WhatsApp con un mensaje propio (p. ej. por producto). */
export function whatsappHref(message: string): string {
  return `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(message)}`;
}

/** Placeholder local para productos sin foto cargada. */
export const PRODUCT_PLACEHOLDER = "/site/producto-placeholder.jpg";

/**
 * Texto que muestra una ficha cuyo producto todavía no tiene copy propio.
 *
 * No es relleno: describe lo que sí es verdad de cualquier producto del
 * catálogo y deriva al canal de venta, así que una ficha nueva nunca queda con
 * lorem ipsum ni con un hueco.
 */
export const PRODUCT_DESCRIPTION_FALLBACK =
  "Pan artesanal horneado todos los días. Consúltanos por masas, formatos y disponibilidad.";

/**
 * Copy de cada producto del catálogo, indexado por el nombre comercial que trae
 * la base (`product.producto`).
 *
 * Por qué un mapa en contenido y no una columna en la base: la descripción es
 * editorial, no comercial, y meterla en la tabla obligaría a migración + campo
 * en el admin. El catálogo se agrupa por nombre de producto, así que el nombre
 * es una clave natural estable. Si el negocio carga un producto nuevo, cae al
 * fallback y el sitio nunca se rompe.
 *
 * Las claves tienen que coincidir EXACTAMENTE con `product.producto`. Las que
 * están marcadas como no cargadas todavía existen igual para que, el día que se
 * carguen, la ficha salga con texto propio y no con el fallback.
 *
 * OJO con "Pan de completo": la marca comunica ese mismo pan como "hot dog" de
 * forma consistente (así está en su ficha técnica), pero el catálogo lo guarda
 * como "Pan de completo". El copy nombra las dos formas para que el cliente lo
 * encuentre buscando cualquiera de las dos.
 */
export const PRODUCT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "Pan de hamburguesa":
    "La masa define el armado. La de papa da una miga húmeda que abraza los ingredientes y contiene los jugos; la de brioche es alta, brillante y elástica, y vuelve a su forma al presionarla.",
  "Pan de completo":
    "Pan de hot dog (completo) de miga suave y esponjosa, con un sabor ligero a mantequilla. Al presionarlo no vuelve a su forma: abraza los ingredientes y aguanta el armado cargado.",
  "Pan ciabatta":
    "Ligera, con una textura que le da carácter. Versátil para sándwiches y para acompañar cualquier plato.",
  "Pan de molde":
    "Miga tierna y corte parejo. Disponible en masa brioche y en blanco XL de 22 rebanadas por unidad.",
  // No están en el catálogo todavía: si el negocio los carga, ya tienen copy.
  Baguette: "Crujiente por fuera y suave por dentro. Ideal para sándwiches.",
  Bagel: "Un armado distinto para sus productos gourmet.",
};

/** Descripción de una ficha; cae al fallback si el producto no tiene copy. */
export function productDescription(producto: string): string {
  return PRODUCT_DESCRIPTIONS[producto] ?? PRODUCT_DESCRIPTION_FALLBACK;
}

export type NavItem = { label: string; href: string };

export const NAV: readonly NavItem[] = [
  { label: "Inicio", href: "/" },
  { label: "Catálogo", href: "/catalogo" },
  { label: "Nosotros", href: "/nosotros" },
  { label: "Contacto", href: "/#contacto" },
] as const;

/**
 * Hero de portada. Las fotos NO se declaran acá: son assets locales que el
 * componente `SiteHero` importa para que Next conozca sus dimensiones y las
 * optimice (`src/assets/banner_mobile.png` y `src/assets/banner_desktop.jpg`).
 */
export const HERO = {
  eyebrow: "Horneado todos los días",
  // El H1 se parte en dos líneas para respetar la composición de la referencia.
  titleLines: ["Pan recién horneado,", "para su negocio"],
  subtitle:
    "Elaboramos pan artesanal para negocios de comida: hamburgueserías, sangucherías, cafeterías, restaurantes y cadenas. Cada masa está pensada para un uso concreto, con el mismo resultado todos los días.",
  primaryCta: { label: "Ver catálogo", href: "/catalogo" },
  secondaryCta: { label: "Pedir por WhatsApp", href: WHATSAPP_HREF },
} as const;

/**
 * Contenido de la página "Nosotros": quién es la empresa, en prosa.
 *
 * Vive en su propia página (`/nosotros`) a propósito, NO en la landing: la
 * portada existe para poner en valor el producto, y la historia de la empresa
 * distrae de eso. La portada vende lo que horneamos; acá se cuenta quién lo
 * hornea.
 *
 * Limitación conocida: no hay historia institucional (año de fundación,
 * equipo, origen). Eso NO se inventa. Cuando el negocio lo aporte, va acá.
 */
export const NOSOTROS = {
  eyebrow: "Nosotros",
  title: "Pan artesanal para negocios de comida",
  body: [
    "LamasFoods elabora pan artesanal para abastecer a negocios gastronómicos: hamburgueserías, sangucherías, cafeterías, restaurantes, almacenes y cadenas de comida. Toda nuestra producción está pensada para ellos, desde el local de barrio hasta la operación con varias sucursales.",
    "Cada masa que horneamos responde a un uso concreto. La de papa da una miga húmeda que abraza los ingredientes y contiene los líquidos; la de brioche es alta, brillante y elástica, y devuelve la forma al armado. Esa diferencia es lo que hace que una hamburguesa se sostenga hasta el último bocado.",
    "Trabajamos con fermentación larga, porque de ahí sale el sabor, y con despacho programado por zona para que la mercadería llegue antes de que abra.",
  ],
} as const;

export type ValueProp = {
  title: string;
  description: string;
  image: string;
  cta: { label: string; href: string };
};

export const VALUE_PROPS_TITLE = "Por qué elegirnos";
export const VALUE_PROPS_INTRO =
  "Trabajamos con negocios que necesitan surtido constante y un producto que se sostenga en la vitrina. Esto es lo que nos diferencia.";

export const VALUE_PROPS: readonly ValueProp[] = [
  {
    title: "Cada masa, para un uso distinto",
    description:
      "La masa de papa da una miga húmeda que abraza los ingredientes y contiene los jugos. La de brioche es alta, brillante y elástica: vuelve a su forma y sostiene el armado. La elección depende de lo que pida su carta.",
    image: "/site/prop-masas.jpg",
    cta: { label: "Ver masas", href: "/catalogo" },
  },
  {
    title: "Entrega programada",
    description:
      "Despachamos en 11 comunas de Santiago con frecuencia coordinada, para que la mercadería llegue antes de que abra y no se quede sin stock a mitad de servicio.",
    image: "/site/prop-entrega.jpg",
    cta: { label: "Ver zonas", href: "/#contacto" },
  },
  {
    title: "Volumen para su negocio",
    description:
      "Formatos y tamaños que se adaptan desde la cafetería de barrio hasta la cadena. La cotización se arma según el volumen y la frecuencia que necesite.",
    image: "/site/prop-volumen.jpg",
    cta: { label: "Ver catálogo", href: "/catalogo" },
  },
] as const;

export const VISIT = {
  title: "Visítanos",
  body: "Puede conocer la planta, probar las masas y armar el pedido con nosotros. Si lo prefiere, coordinamos la primera entrega en su local.",
  cta: { label: "Coordinar una visita", href: WHATSAPP_HREF },
  images: [
    { src: "/site/visita-1.jpg", alt: "Pan recién horneado saliendo del horno" },
    { src: "/site/visita-2.jpg", alt: "Mesa de trabajo con masas preparadas" },
  ],
} as const;

export const GALLERY = [
  { src: "/site/galeria-1.jpg", alt: "Bollos recién horneados en bandeja" },
  { src: "/site/galeria-2.jpg", alt: "Detalle de miga de pan artesanal" },
  { src: "/site/galeria-3.jpg", alt: "Pan de molde rebanado" },
  { src: "/site/galeria-4.jpg", alt: "Masa fermentando antes del horneado" },
] as const;

export const GALLERY_NOTES = [
  {
    title: "Nuestro proceso",
    body: "Cada masa reposa el tiempo que necesita. Sin atajos: la fermentación larga es de donde sale el sabor, y es lo que hace que la miga se sostenga en la vitrina.",
  },
  {
    title: "Calidad constante",
    body: "Medimos y repetimos. Si el pan de ayer funcionó en su vitrina, el de mañana funcionará igual.",
  },
] as const;

export const CATALOG_COPY = {
  eyebrow: "Catálogo",
  title: "Nuestros productos",
  intro:
    "Cada producto se lista con sus masas y sus formatos. La cotización la hacemos por WhatsApp, según el volumen y la frecuencia que necesite.",
  empty: "Estamos actualizando el catálogo. Escríbanos y le pasamos la lista del día.",
  emptyCta: { label: "Consultar disponibilidad", href: WHATSAPP_HREF },
} as const;

/** SEO — description por página (el title se compone con el template del layout). */
export const SEO = {
  defaultTitle: `${SITE_NAME} — ${SITE_TAGLINE}`,
  defaultDescription:
    "Pan artesanal al por mayor para negocios de comida: hamburgueserías, sangucherías, cafeterías, restaurantes y cadenas. Pan de papa, brioche y hot dog en distintos formatos. Despacho en Santiago y cotización por WhatsApp.",
  catalogTitle: "Catálogo",
  // Solo productos que existen en el catálogo: prometer acá un pan que no se
  // vende es la peor forma de perder a alguien que llegó desde Google.
  catalogDescription:
    "Catálogo de pan artesanal al por mayor: pan de hamburguesa en masa de papa y brioche, pan de hot dog (completo), ciabatta y pan de molde. Tamaños y formatos disponibles; cotización por WhatsApp.",
  nosotrosTitle: "Nosotros",
  nosotrosDescription:
    "LamasFoods elabora pan artesanal para abastecer a negocios gastronómicos: hamburgueserías, sangucherías, cafeterías, restaurantes, almacenes y cadenas. Fermentación larga, masas pensadas para cada uso y despacho programado en Santiago.",
  ogImage: "/site/og.jpg",
} as const;
