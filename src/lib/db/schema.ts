import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ============================================================
 * Auth (Better Auth + plugin organization)
 * ============================================================ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  metadata: text("metadata"),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/* ============================================================
 * Dominio (toda tabla lleva organization_id NOT NULL + índice org-first)
 * ============================================================ */

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Llave de resolución WhatsApp (003): teléfono normalizado (521→52) o
     * `bsuid:<id>` cuando Meta no manda wa_id. Estable de por vida.
     */
    waIdentity: text("wa_identity").notNull(),
    /** Teléfono como ATRIBUTO opcional (003): falta en contactos BSUID. */
    phone: text("phone"),
    /** Business-Scoped User ID si se conoce (003). */
    waUserId: text("wa_user_id"),
    name: text("name").notNull(),
    notes: text("notes"),
    archivedAt: timestamp("archived_at"),
    /** 005 — datos comerciales del lead (enriquecimiento por el agente). */
    empresa: text("empresa"),
    rubro: text("rubro"),
    comuna: text("comuna"),
    rut: text("rut"),
    razonSocial: text("razon_social"),
    giro: text("giro"),
    direccionFacturacion: text("direccion_facturacion"),
    email: text("email"),
    frecuenciaDespacho: text("frecuencia_despacho"),
    volumenSemanal: text("volumen_semanal"),
    productoInteres: text("producto_interes"),
    formato: text("formato"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_org_wa_identity_uq").on(t.organizationId, t.waIdentity),
    index("contact_org_wa_user_id_idx").on(t.organizationId, t.waUserId),
    index("contact_org_name_idx").on(t.organizationId, t.name),
  ]
);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** open = etapa normal · won / lost = anclas no borrables */
    kind: text("kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    /**
     * Criterio de entrada a la etapa (F3): una o dos líneas que dicen cuándo un
     * lead pasa a estar acá. Es el ÚNICO insumo de la anotación para juzgar el
     * avance; reemplaza a las instrucciones completas del negocio en esa llamada.
     */
    criteria: text("criteria"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("stage_org_pos_idx").on(t.organizationId, t.position)]
);

export const lead = pgTable(
  "lead",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    stageId: text("stage_id")
      .notNull()
      .references(() => pipelineStage.id),
    position: integer("position").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_contact_uq").on(t.contactId),
    index("lead_org_stage_idx").on(t.organizationId, t.stageId, t.position),
  ]
);

export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /** Conversación del Laboratorio: jamás toca la API de WhatsApp. */
    isTest: boolean("is_test").notNull().default(false),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    handoffAt: timestamp("handoff_at"),
    handoffReason: text("handoff_reason", {
      // 008: manual_reply = el dueño respondió desde la app del teléfono.
      enum: ["cliente", "modelo", "error", "ventana", "manual_reply"],
    }),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    // Atribución del anuncio de clic a WhatsApp (referral). El referral llega
    // UNA sola vez, en el primer mensaje de la conversación, así que vive en la
    // conversación y no en el contacto.
    /** referral.source_id: identificador del anuncio de Meta. */
    attributionSourceId: text("attribution_source_id"),
    /** referral.ctwa_clid: identificador del clic en el anuncio. */
    attributionCtwaClid: text("attribution_ctwa_clid"),
    /** referral.headline: titular del anuncio. */
    attributionHeadline: text("attribution_headline"),
    /** referral.source_url: URL de origen del anuncio. */
    attributionSourceUrl: text("attribution_source_url"),
    /** Momento de la captura; NULL indica que la conversación aún no tiene atribución. */
    attributionCapturedAt: timestamp("attribution_captured_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Una conversación real por contacto; las de prueba no compiten.
    uniqueIndex("conversation_org_contact_real_uq")
      .on(t.organizationId, t.contactId)
      .where(sql`${t.isTest} = false`),
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt),
  ]
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /** ID de WhatsApp — UNIQUE (idempotencia). Nullable en salientes de prueba. */
    waMessageId: text("wa_message_id").unique(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    type: text("type").notNull().default("text"),
    text: text("text"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    /**
     * 008 — Origen del saliente: IA (bot), operador del CRM, manual desde la
     * app de WhatsApp Business del teléfono (echo), o plantilla. En entrantes
     * queda el default y la UI lo ignora.
     */
    origin: text("origin", {
      enum: ["ai", "operator", "manual", "template"],
    })
      .notNull()
      .default("operator"),
    /** 008 — Adjunto del mensaje (imagen, doc, ubicación…), si lo hay. */
    mediaAssetId: text("media_asset_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    waTimestamp: timestamp("wa_timestamp"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("message_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    ),
  ]
);

/**
 * 008 — Adjuntos: archivo (imagen/video/audio/documento/sticker) copiado al
 * volumen local (`MEDIA_DIR`) o contenido estructurado (location/contacts) en
 * `payload`. Meta expira sus archivos (~30 días): el disco propio es la
 * fuente durable (constitución II: sin S3/R2).
 */
export const mediaAsset = pgTable(
  "media_asset",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "image",
        "video",
        "audio",
        "document",
        "sticker",
        "location",
        "contacts",
      ],
    }).notNull(),
    /** media id de Graph (entrantes/salientes subidos); NULL en location/contacts. */
    waMediaId: text("wa_media_id"),
    mimeType: text("mime_type"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    caption: text("caption"),
    /** location {latitude, longitude, name?, address?} o contacts (subset). */
    payload: jsonb("payload"),
    /** Ruta relativa dentro de MEDIA_DIR; NULL si aún no descargado o no aplica. */
    storagePath: text("storage_path"),
    fetchStatus: text("fetch_status", {
      enum: ["available", "pending", "failed"],
    })
      .notNull()
      .default("pending"),
    fetchError: text("fetch_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("media_asset_org_idx").on(t.organizationId, t.createdAt),
    index("media_asset_wa_media_idx").on(t.waMediaId),
  ]
);

export const metaCredentials = pgTable(
  "meta_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    displayPhoneNumber: text("display_phone_number"),
    verifiedName: text("verified_name"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("meta_credentials_org_uq").on(t.organizationId),
    // El webhook enruta por phone_number_id: debe ser único en la instancia.
    uniqueIndex("meta_credentials_phone_uq").on(t.phoneNumberId),
  ]
);

export const agentProfile = pgTable(
  "agent_profile",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    name: text("name").notNull().default("Asistente"),
    tone: text("tone"),
    instructions: text("instructions"),
    escalationRules: text("escalation_rules"),
    greeting: text("greeting"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_profile_org_uq").on(t.organizationId)]
);

export const kbEntry = pgTable(
  "kb_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["qa", "block"] }).notNull(),
    question: text("question"),
    answer: text("answer"),
    content: text("content"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);

export const template = pgTable(
  "template",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["draft", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("draft"),
    rejectionReason: text("rejection_reason"),
    waTemplateId: text("wa_template_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("template_org_name_lang_uq").on(
      t.organizationId,
      t.name,
      t.language
    ),
  ]
);

export const agentTestRun = pgTable(
  "agent_test_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "done", "failed"] })
      .notNull()
      .default("running"),
    score: integer("score"),
    error: text("error"),
    // Modelo del agente y del juez usados en la corrida (Laboratorio).
    model: text("model"),
    judgeModel: text("judge_model"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    // Lock de concurrencia en BD: máximo 1 corrida activa por organización.
    uniqueIndex("test_run_org_running_uq")
      .on(t.organizationId)
      .where(sql`${t.status} = 'running'`),
    index("test_run_org_idx").on(t.organizationId, t.startedAt),
  ]
);

export const agentTestCase = pgTable(
  "agent_test_case",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentTestRun.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),
    /**
     * Repetición de la persona dentro de la corrida (0..N-1). Cada persona se
     * evalúa N veces para poder medir la dispersión del instrumento; el índice
     * identifica cada repetición. Su valor por defecto (0) conserva válidas las
     * corridas anteriores, que tenían un solo caso por persona.
     */
    repeatIndex: integer("repeat_index").notNull().default(0),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    transcript: jsonb("transcript"),
    veredicto: text("veredicto", { enum: ["verde", "amarillo", "rojo"] }),
    hallazgos: jsonb("hallazgos"),
    // Tiempos de respuesta del modelo (ms): agente (suma de turnos) y juez.
    latencyMs: integer("latency_ms"),
    turnCount: integer("turn_count"),
    judgeLatencyMs: integer("judge_latency_ms"),
    // Telemetría por turno del agente: [{model, latencyMs, promptTokens,
    // completionTokens, cachedTokens, provider}] del intento exitoso.
    turnMetrics: jsonb("turn_metrics"),
    // Pipeline (FR-030): etapa del lead al inicio/fin del guion y si se esperaba
    // avanzar. `advanced` es la verificación determinista del flujo de pipeline.
    initialStage: text("initial_stage"),
    finalStage: text("final_stage"),
    expectAdvance: boolean("expect_advance"),
    advanced: boolean("advanced"),
    status: text("status", {
      enum: ["pending", "running", "done", "judge_failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("test_case_run_idx").on(t.runId)]
);

/* ============================================================
 * 005 — Contexto comercial del negocio
 * ============================================================ */

/**
 * Catálogo de venta (PÚBLICO). El costo NO vive acá: vive en product_cost
 * (tabla separada, consumo interno). La clave del SKU es
 * (organization_id, producto, masa, formato) → idempotencia del import.
 */
export const product = pgTable(
  "product",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    producto: text("producto").notNull(),
    masa: text("masa").notNull(),
    formato: text("formato").notNull(),
    unidadesPorBolsa: integer("unidades_por_bolsa").notNull(),
    precioUnitarioNeto: numeric("precio_unitario_neto", { precision: 12, scale: 4 }).notNull(),
    precioBolsaNeto: numeric("precio_bolsa_neto", { precision: 12, scale: 4 }).notNull(),
    precioBolsaConIva: numeric("precio_bolsa_con_iva", { precision: 12, scale: 4 }).notNull(),
    /**
     * Imagen para la web pública. Guarda una RUTA o URL, nunca un binario:
     *   - subida desde el admin → `/api/public/media/<assetId>`
     *   - fijada a mano       → `/site/...` o una URL absoluta
     * Nullable: un producto sin foto se muestra con el placeholder local.
     */
    imagen: text("imagen"),
    activo: boolean("activo").notNull().default(true),
    notas: text("notas"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("product_org_sku_uq").on(
      t.organizationId,
      t.producto,
      t.masa,
      t.formato
    ),
    index("product_org_idx").on(t.organizationId),
  ]
);

/**
 * Ledger de costos de producto (PRIVADO, COGS): append-only.
 *
 * El costo NO es un estado mutable sino un evento: cambia por compra, lote o
 * fecha, y una venta vieja debe poder recalcularse con el costo que regía
 * entonces. Por eso cada fila es un MOVIMIENTO con `vigenteDesde` y solo se
 * agrega; jamás se hace UPDATE del costo. `margen` NO se guarda: es DERIVADO
 * de `(precio - costo) / precio` y se pudre apenas cambia el precio o el
 * costo, así que se calcula on-demand con `computeMargin`
 * (src/server/catalog/costs.ts).
 *
 * A diferencia de la vieja `product_cost` (1:1 con UNIQUE por producto), aquí
 * NO hay índice único por producto: la historia es una SERIE de movimientos.
 * La idempotencia se logra por `(organization_id, referencia)` cuando el hecho
 * trae clave de origen (p.ej. una compra), vía índice parcial; las cargas
 * manuales sin referencia son un log y sí pueden repetirse.
 *
 * Ninguna salida pública (agente comercial, endpoint web) consulta esta tabla
 * — separación estructural del dato sensible.
 */
export const productCostMovement = pgTable(
  "product_cost_movement",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    /** Costo neto por unidad, en la misma unidad que `product.precioUnitarioNeto`. */
    costoUnitario: numeric("costo_unitario", { precision: 12, scale: 4 }).notNull(),
    /** Desde cuándo rige. Permite costo histórico: una venta vieja usa el costo de su momento. */
    vigenteDesde: timestamp("vigente_desde").notNull().defaultNow(),
    /** De dónde salió el dato. */
    origen: text("origen", { enum: ["manual", "compra", "importacion"] })
      .notNull()
      .default("manual"),
    /** Clave del origen (p.ej. id de compra): hace idempotente re-importar el mismo hecho. */
    referencia: text("referencia"),
    nota: text("nota"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("product_cost_movement_org_product_vigente_idx").on(
      t.organizationId,
      t.productId,
      t.vigenteDesde
    ),
    // Reimportar el mismo origen no duplica. Las cargas manuales (sin
    // referencia) sí pueden repetirse: son un log.
    uniqueIndex("product_cost_movement_org_referencia_uq")
      .on(t.organizationId, t.referencia)
      .where(sql`${t.referencia} is not null`),
  ]
);

/** Zona de envío: comuna con cobertura y tarifa PÚBLICA (la paga el cliente). */
export const deliveryZone = pgTable(
  "delivery_zone",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    comuna: text("comuna").notNull(),
    costoDespacho: numeric("costo_despacho", { precision: 12, scale: 4 }),
    activa: boolean("activa").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("delivery_zone_org_comuna_uq").on(t.organizationId, t.comuna),
    index("delivery_zone_org_idx").on(t.organizationId),
  ]
);

/**
 * 006 — Suscripción Web Push por usuario y dispositivo.
 * `endpoint` UNIQUE (idempotencia del subscribe); `auth` y `p256dh` se cifran
 * en reposo (Principio I) como un único blob JSON en `keys_cipher`/`iv`/`tag`.
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    keysCipher: text("keys_cipher").notNull(),
    keysIv: text("keys_iv").notNull(),
    keysTag: text("keys_tag").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("push_subscription_endpoint_uq").on(t.endpoint),
    index("push_subscription_org_idx").on(t.organizationId),
    index("push_subscription_org_user_idx").on(t.organizationId, t.userId),
  ]
);
