/**
 * Las 6 personas GUIONADAS del Laboratorio (FR-030). El cliente simulado no
 * usa LLM: son secuencias fijas — determinismo total del lado del cliente.
 * El agente que responde es el REAL (mismo pipeline de US3).
 */

export type Persona = {
  key: string;
  label: string;
  description: string;
  /** Teléfono sintético estable (jamás un número real). */
  phone: string;
  contactName: string;
  script: string[];
};

export const PERSONAS: Persona[] = [
  {
    key: "comprador_decidido",
    label: "Comprador decidido",
    description: "Dueño de local que sabe lo que quiere y va directo a comprar pan.",
    phone: "5210000000001",
    contactName: "[Prueba] Comprador decidido",
    script: [
      "Hola, buenas tardes",
      "Tengo un local de comida y quiero empezar a comprarles pan",
      "¿Cuánto cuesta la bolsa de pan de hamburguesa brioche de 12 cm?",
      "Perfecto, pido 20 bolsas. ¿Cómo pago?",
    ],
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios",
    description: "Pregunta precio y formato tras precio sin decidirse.",
    phone: "5210000000002",
    contactName: "[Prueba] Preguntón de precios",
    script: [
      "Hola, ¿a cuánto está el pan de completo de 15 cm?",
      "¿Y el de 20 cm?",
      "¿Cuánto la bolsa de pan de molde blanco XL?",
      "¿Hay descuento si llevo hartas bolsas?",
      "Ok, lo voy a pensar",
    ],
  },
  {
    key: "cliente_enojado",
    label: "Cliente enojado",
    description: "Llega molesto por un problema con su pedido.",
    phone: "5210000000003",
    contactName: "[Prueba] Cliente enojado",
    script: [
      "Oigan, esto es el colmo",
      "El pedido que me llegó ayer venía con menos bolsas de las que pagué",
      "¿Me van a responder o qué? Quiero una solución YA",
      "Pues espero que sí, no pienso perder mi plata",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description: "Pregunta algo que el catálogo/conocimiento no cubre (fuera_de_kb).",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    script: [
      "Hola, una pregunta",
      "¿Hacen pan sin gluten o con harina de almendras?",
      "¿Y envían a Valparaíso?",
      "¿Tienen algún pan para celíacos?",
    ],
  },
  {
    key: "pide_humano",
    label: "Pide un humano",
    description: "Quiere ser atendido por una persona (debe escalar).",
    phone: "5210000000005",
    contactName: "[Prueba] Pide humano",
    script: [
      "Hola",
      "Tengo un tema complicado con un pedido grande para un evento",
      "Prefiero que me atienda una persona, quiero hablar con un humano",
      "Gracias",
    ],
  },
  {
    key: "errores_modismos",
    label: "Errores y modismos",
    description: "Escribe con faltas de ortografía y modismos chilenos.",
    phone: "5210000000006",
    contactName: "[Prueba] Errores y modismos",
    script: [
      "ola, benden pan d hamburguesa?",
      "y a kanto la bolsa d 11 cm?",
      "en komasa dskpachan?",
      "ya, orita aviso, chau",
    ],
  },
];

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);
