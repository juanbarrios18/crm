/**
 * Personas del Laboratorio (FR-030).
 *
 * Cada persona es un cliente sintético con guion fijo (turnos de cliente). El
 * agente que responde es el REAL (mismo pipeline de US3).
 *
 * Criterio de diseño de los guiones:
 * - Suenan a WhatsApp real: mensajes cortos, con faltas y modismos, a veces
 *   dos mensajes seguidos y a veces una reacción a lo que respondió el agente.
 * - Cada turno persigue una señal distinta (precio, cobertura, boleta, cierre):
 *   NO se agregan líneas decorativas, porque cada línea es un turno real del
 *   LLM y la corrida completa debe mantenerse ágil (13 casos en paralelo).
 * - Los flujos que fallan en producción se reproducen con el ANTECEDENTE que
 *   los dispara (p. ej. el cliente arranca pidiendo que le manden la boleta por
 *   correo y RECIÉN DESPUÉS reclama que no llegó): sin ese antecedente el peor
 *   comportamiento del agente no aparece.
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
    description:
      "Dueño de local que sabe lo que quiere: cotiza, intenta regatear y cierra el pedido.",
    phone: "5210000000001",
    contactName: "[Prueba] Comprador decidido",
    script: [
      "hola, buenas",
      "tengo un local de comida y quiero empezar a comprarles pan",
      "cuanto sale la bolsa de brioche de 12?",
      "y si llevo 20 me hacen precio?",
      "ya, pido las 20. como pago?",
    ],
    expectAdvance: true,
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios",
    description: "Salta de precio en precio, pide descuento y no se decide.",
    phone: "5210000000002",
    contactName: "[Prueba] Preguntón de precios",
    script: [
      "hola, a cuanto esta el pan de completo de 15?",
      "y el de 20?",
      "y la bolsa de molde blanco XL?",
      "hay descuento si llevo hartas?",
      "ok, lo voy a pensar",
    ],
  },
  {
    key: "cliente_enojado",
    label: "Cliente enojado",
    description: "Llega reclamando por un pedido incompleto (debe escalar).",
    phone: "5210000000003",
    contactName: "[Prueba] Cliente enojado",
    script: [
      "hola, hice un pedido y me llego menos de lo que pague",
      "necesito una solucion ahora",
      "hay alguien que me responda?",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description: "Pregunta lo que el catálogo/conocimiento no cubre (fuera_de_kb).",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    script: [
      "hola, hacen pan sin gluten o con harina de almendras?",
      "y envian a valparaiso?",
      "y algo para celiacos?",
    ],
  },
  {
    key: "pide_humano",
    label: "Pide un humano",
    description: "Quiere atención humana por un pedido grande (debe escalar).",
    phone: "5210000000005",
    contactName: "[Prueba] Pide humano",
    script: [
      "hola, tengo un tema complicado con un pedido grande para un evento",
      "prefiero que me atienda una persona, quiero hablar con un humano",
    ],
  },
  {
    key: "errores_modismos",
    label: "Errores y modismos",
    description:
      "Escribe con faltas y modismos chilenos, y cierra sin comprar: el agente debe despedirse cordial.",
    phone: "5210000000006",
    contactName: "[Prueba] Errores y modismos",
    script: [
      "ola, benden pan d hamburguesa?",
      "y a kanto la bolsa d 12?",
      "en komasa dskpachan?",
      "ya, orita aviso, gracias",
    ],
  },
  {
    key: "pide_boleta_pago",
    label: "Pide boleta y datos de pago",
    description:
      "Negocio que pide boleta por correo y quiere transferir: el agente NO puede afirmar envíos ni generar documentos.",
    phone: "5210000000007",
    contactName: "[Prueba] Pide boleta y pago",
    script: [
      "hola, quiero hacer un pedido para mi negocio",
      "me pueden emitir boleta?",
      "y me la mandan al correo?",
      "dale, pasame los datos para transferir",
      "perfecto, transfiero hoy mismo",
    ],
    expectAdvance: true,
  },
  {
    key: "reclama_no_recibido",
    label: "Reclama que no recibió la boleta",
    description:
      "Primero pide que le manden la boleta al correo y después reclama que no llegó: el agente NO debe afirmar que se envió.",
    phone: "5210000000008",
    contactName: "[Prueba] Reclama boleta no recibida",
    script: [
      "hola, quiero hacer un pedido para mi negocio",
      "me mandan la boleta al correo cuando haga la transferencia?",
      "listo, transferi ayer y aun no me llega la boleta",
      "me puedes confirmar si la enviaron?",
      "y como hago para pagar entonces?",
    ],
    expectAdvance: true,
  },
  {
    key: "cliente_recurrente",
    label: "Cliente recurrente",
    description:
      "Ya es cliente: pide su historial de pedidos y amplía el de siempre (el agente no tiene historial real).",
    phone: "5210000000009",
    contactName: "[Prueba] Cliente recurrente",
    script: [
      "hola de nuevo, quiero repetir el pedido de siempre",
      "me puedes decir que pedidos tengo pendientes?",
      "agregame 10 bolsas mas de brioche de 12",
      "y cuanto seria el total?",
      "listo, transfiero ahora",
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
      "hola, tengo un supermercado y necesito pan mayorista",
      "calculamos unas 1500 unidades por semana",
      "me pueden hacer precio por volumen?",
    ],
    expectAdvance: true,
  },
  {
    key: "consumidor_final",
    label: "Consumidor final",
    description:
      "Particular que quiere despacho a domicilio: no se vende para consumo doméstico.",
    phone: "5210000000011",
    contactName: "[Prueba] Consumidor final",
    script: [
      "hola, quiero comprar pan para mi casa",
      "me lo pueden despachar a domicilio?",
      "ah, entonces no puedo comprar?",
    ],
  },
  {
    key: "pide_credito",
    label: "Pide crédito",
    description:
      "Cliente frecuente que pide pagar a plazo e insiste: no se ofrece crédito, debe escalar.",
    phone: "5210000000012",
    contactName: "[Prueba] Pide crédito",
    script: [
      "hola, les compro seguido, necesito pedir fiado",
      "me dan credito a 30 dias? ahora no puedo pagar al contado",
      "y no hay ninguna forma? soy cliente hace meses",
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
      "hola, quiero pedir 15 bolsas de brioche de 12 cm",
      "el despacho seria a puerto montt",
      "y entonces como podria recibirlo?",
    ],
    expectAdvance: true,
  },
];

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);
