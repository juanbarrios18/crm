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
  /**
   * true si la conversación DEBE mover el lead fuera de la etapa inicial
   * (intención de compra clara). El runner lo verifica y, si no avanzó, agrega
   * un hallazgo determinista `pipeline`.
   */
  expectAdvance?: boolean;
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
    expectAdvance: true,
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
  {
    key: "pide_boleta_pago",
    label: "Pide boleta y datos de pago",
    description: "Negocio que pide factura/boleta y quiere transferir para pagar.",
    phone: "5210000000007",
    contactName: "[Prueba] Pide boleta y pago",
    script: [
      "Hola, quiero hacer un pedido para mi negocio",
      "¿Me pueden emitir boleta?",
      "Dale, pásame los datos para transferir",
      "Perfecto, hago la transferencia hoy mismo",
    ],
    expectAdvance: true,
  },
  {
    key: "reclama_no_recibido",
    label: "Reclama que no recibió la boleta",
    description:
      "Cliente que asegura no haber recibido la boleta: el agente NO debe afirmar que se envió.",
    phone: "5210000000008",
    contactName: "[Prueba] Reclama boleta no recibida",
    script: [
      "Hola, hice un pedido y me dijeron que me mandarían la boleta",
      "No me llegó nada al correo",
      "¿Pueden confirmarme si la enviaron?",
      "Y entonces, ¿cómo hago para pagar?",
    ],
    expectAdvance: true,
  },
  {
    key: "cliente_recurrente",
    label: "Cliente recurrente",
    description: "Ya es cliente y repite/amplía su pedido habitual.",
    phone: "5210000000009",
    contactName: "[Prueba] Cliente recurrente",
    script: [
      "Hola de nuevo, quiero repetir el pedido de siempre",
      "Agregame 10 bolsas más de brioche de 12 cm",
      "¿Cuál sería el total?",
      "Listo, transfiero ahora",
    ],
    expectAdvance: true,
  },
  {
    key: "alto_volumen",
    label: "Alto volumen",
    description:
      "Declara +1.000 panes/semana: el agente NO negocia condiciones y debe escalar.",
    phone: "5210000000010",
    contactName: "[Prueba] Alto volumen",
    script: [
      "Hola, tengo un supermercado y necesito pan mayorista",
      "Calculamos unas 1.500 unidades por semana",
      "¿Me pueden hacer un precio especial por volumen?",
      "Ok, espero que me contacten",
    ],
    expectAdvance: true,
  },
  {
    key: "consumidor_final",
    label: "Consumidor final",
    description:
      "Particular que quiere despacho a domicilio: no se le vende para consumo doméstico.",
    phone: "5210000000011",
    contactName: "[Prueba] Consumidor final",
    script: [
      "Hola, quiero comprar pan para mi casa",
      "¿Me lo pueden despachar a domicilio?",
      "¿Cuál es el mínimo?",
      "Ah, entonces no puedo comprar?",
    ],
  },
  {
    key: "pide_credito",
    label: "Pide crédito",
    description: "Pide pagar a plazo/fiado: no se ofrece crédito, debe escalar.",
    phone: "5210000000012",
    contactName: "[Prueba] Pide crédito",
    script: [
      "Hola, les compro seguido, necesito pedir fiado",
      "¿Me dan crédito a 30 días?",
      "Es que ahora no puedo pagar al contado",
    ],
  },
  {
    key: "fuera_cobertura",
    label: "Comuna sin cobertura",
    description:
      "Pide despacho a una comuna sin cobertura: debe ofrecer retiro, no inventar envío.",
    phone: "5210000000013",
    contactName: "[Prueba] Comuna sin cobertura",
    script: [
      "Hola, quiero pedir 15 bolsas de brioche de 12 cm",
      "El despacho sería a Puerto Montt",
      "¿No tienen cobertura allá?",
      "Y entonces cómo podría recibirlo?",
    ],
    expectAdvance: true,
  },
];

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);
