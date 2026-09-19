/**
 * Self-test E2E de comportamiento — conduce la app real en localhost con los
 * mocks (wa-mock + ai-mock) por las superficies de usuario, en vez de darle
 * el guion al humano. Cubre tests/e2e/us-bsuid.md y tests/e2e/us-bot-api.md.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      BOT_API_KEY configurada y BD migrada
 *   2) node --env-file=.env scripts/e2e-selftest.mjs
 *
 * Sale con código 1 si algún check falla (apto para CI o para el gate previo
 * a declarar "Hecho").
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY;

/**
 * Guardrail: este self-test corre contra los mocks locales y JAMÁS puede pegarle
 * a una API real (gasta dinero). Aborta ANTES de cualquier request, y cubre los
 * DOS canales externos: el proveedor LLM y la Graph API de WhatsApp.
 */
const ES_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/;
const CANALES = [
  ["OPENROUTER_BASE_URL", process.env.OPENROUTER_BASE_URL ?? ""],
  ["META_GRAPH_BASE_URL", process.env.META_GRAPH_BASE_URL ?? ""],
];
const REMOTOS = CANALES.filter(([, url]) => !ES_LOCAL.test(url));
if (REMOTOS.length > 0 || process.env.WA_MOCK_ENABLED !== "true") {
  const detalle = REMOTOS.length
    ? REMOTOS.map(([k, v]) => `  ${k}=${v}`).join("\n")
    : "  WA_MOCK_ENABLED no está en true";
  console.error(
    `\n[ABORTADO] El self-test solo corre contra los mocks locales; esto apunta afuera:\n` +
      `${detalle}\n\n` +
      "Poné en .env:\n" +
      "  WA_MOCK_ENABLED=true\n" +
      "  OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock\n" +
      "  META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph\n"
  );
  process.exit(1);
}

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      // Better Auth valida Origin (CSRF) en los endpoints de auth.
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  }
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

function bot(path, opts = {}) {
  return api(path, {
    ...opts,
    headers: { "x-api-key": BOT_KEY ?? "", ...(opts.headers ?? {}) },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PN = "PN-E2E-1";

async function main() {
  if (!BOT_KEY || BOT_KEY.length < 16) {
    console.error(
      "BOT_API_KEY ausente o corta (<16): los checks de /api/bot/* no pueden correr."
    );
    process.exit(1);
  }

  // Gate de adjuntos entrantes (008): si WA_INBOUND_MEDIA_ENABLED=true el
  // selftest ejercita la preview de binarios; si no, ejercita el aviso de
  // "adjuntos no soportados".
  const MEDIA_ENABLED = process.env.WA_INBOUND_MEDIA_ENABLED === "true";

  console.log("== Setup: registro/login + conexión WhatsApp ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    // Re-corrida: el registro se cierra tras la primera organización.
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({
      wabaId: "WABA-E2E",
      phoneNumberId: PN,
      token: "tok-e2e",
    }),
  });
  ok(
    "conexión WhatsApp guardada (vía wa-mock)",
    conn.res.ok,
    JSON.stringify(conn.json)
  );
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  console.log("\n== us-bsuid: inbound sin wa_id ==");
  const inb1 = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      fromUserId: "bsu_e2e_1",
      name: "Dueña Dental",
      text: "hola, vi su anuncio",
      waMessageId: "wamid.e2e.bsuid.1",
    }),
  });
  ok("inbound BSUID entregado", inb1.res.ok, JSON.stringify(inb1.json));
  await sleep(1200);

  let convs = (await api("/api/conversations")).json?.conversations ?? [];
  const bsuidConv = convs.find((c) => c.contact.name === "Dueña Dental");
  ok("conversación con nombre de perfil (no el BSUID crudo)", !!bsuidConv);
  ok("contacto BSUID sin teléfono", bsuidConv?.contact.phone === null);

  const reply = await api(`/api/conversations/${bsuidConv?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "¡Hola! Te atendemos enseguida" }),
  });
  ok("respuesta a contacto BSUID enviable", reply.res.ok, JSON.stringify(reply.json));

  const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "el destinatario del envío es el BSUID",
    outbox.some((o) => o.to === "bsu_e2e_1"),
    JSON.stringify(outbox.map((o) => o.to))
  );

  // Idempotencia: re-entrega del mismo wa_message_id
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      fromUserId: "bsu_e2e_1",
      name: "Dueña Dental",
      text: "hola, vi su anuncio",
      waMessageId: "wamid.e2e.bsuid.1",
    }),
  });
  await sleep(800);
  const msgs =
    (await api(`/api/conversations/${bsuidConv?.id}/messages`)).json?.messages ??
    [];
  const inCount = msgs.filter((m) => m.direction === "in").length;
  ok("webhook duplicado no duplica mensajes", inCount === 1, `in=${inCount}`);

  console.log("\n== us-bsuid: reconciliación 521/52 ==");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: "5214621349768",
      name: "Kevin MX",
      text: "uno",
    }),
  });
  await sleep(800);
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN, from: "524621349768", text: "dos" }),
  });
  await sleep(800);
  const contacts =
    (await api("/api/contacts?q=Kevin%20MX")).json?.contacts ?? [];
  ok(
    "521 y 52 resuelven a UN solo contacto",
    contacts.length === 1,
    `n=${contacts.length}`
  );

  const mxConv = ((await api("/api/conversations")).json?.conversations ?? []).find(
    (c) => c.contact.name === "Kevin MX"
  );
  ok("el contacto reconciliado conserva su conversación", !!mxConv);

  console.log("\n== us-bot-api: autorización ==");
  const noKey = await api("/api/bot/media/media123");
  ok("media sin API key → 401", noKey.res.status === 401);
  const badKey = await api("/api/bot/media/media123", {
    headers: { "x-api-key": "x".repeat(BOT_KEY.length) },
  });
  ok("media con API key equivocada → 401", badKey.res.status === 401);
  const resetNoKey = await api("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: mxConv?.id }),
  });
  ok("reset sin API key → 401", resetNoKey.res.status === 401);

  console.log("\n== us-bot-api: typing + leído ==");
  const convId = mxConv?.id;
  const outboxBeforeTyping =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const typ = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "POST /api/bot/typing → ok:true (leído + escribiendo…)",
    typ.res.ok && typ.json?.ok === true,
    JSON.stringify(typ.json)
  );
  const outboxAfterTyping =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "typing NO contamina el outbox",
    outboxAfterTyping === outboxBeforeTyping,
    `antes=${outboxBeforeTyping} después=${outboxAfterTyping}`
  );

  const typ404 = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe" }),
  });
  ok("typing con conversación inexistente → 404", typ404.res.status === 404);

  console.log("\n== us-bot-api: media proxy ==");
  const med = await bot("/api/bot/media/media123");
  const medBytes = med.res.ok ? await med.res.arrayBuffer() : new ArrayBuffer(0);
  ok(
    "GET /api/bot/media/{id} → binario con content-type",
    med.res.ok &&
      medBytes.byteLength > 0 &&
      (med.res.headers.get("content-type") ?? "").includes("image"),
    `status=${med.res.status} bytes=${medBytes.byteLength}`
  );
  const medBad = await bot("/api/bot/media/no-es-media");
  ok(
    "mediaId que Graph no reconoce → error tipado, no 500",
    medBad.res.status === 404 || medBad.res.status === 502,
    `status=${medBad.res.status}`
  );

  console.log("\n== us-bot-api: IA pausada y reset ==");
  const pause = await api(`/api/conversations/${convId}`, {
    method: "PATCH",
    body: JSON.stringify({ aiEnabled: false }),
  });
  ok("IA pausada desde la bandeja", pause.res.ok, JSON.stringify(pause.json));

  const typPaused = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "typing con IA pausada → ok:false ai_paused (no toca Meta)",
    typPaused.res.ok &&
      typPaused.json?.ok === false &&
      typPaused.json?.reason === "ai_paused",
    JSON.stringify(typPaused.json)
  );

  const msgsBeforeReset =
    ((await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [])
      .length;
  const rst = await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "POST /api/bot/reset → ok:true",
    rst.res.ok && rst.json?.ok === true,
    JSON.stringify(rst.json)
  );
  await sleep(400);
  convs = (await api("/api/conversations")).json?.conversations ?? [];
  const afterReset = convs.find((c) => c.id === convId);
  ok(
    "reset reactiva la IA (sale del handoff)",
    afterReset?.aiEnabled === true && !afterReset?.handoffAt,
    JSON.stringify({
      aiEnabled: afterReset?.aiEnabled,
      handoffAt: afterReset?.handoffAt,
    })
  );
  const msgsAfterReset =
    ((await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [])
      .length;
  ok(
    "el reset conserva el historial (auditoría)",
    msgsAfterReset === msgsBeforeReset,
    `antes=${msgsBeforeReset} después=${msgsAfterReset}`
  );

  const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
  const firstStage = [...stages].sort((a, b) => a.position - b.position)[0];
  const detail = (await api(`/api/contacts/${afterReset?.contact.id}`)).json;
  ok(
    "reset regresa el lead a la primera etapa",
    !detail?.lead || detail?.stage?.id === firstStage?.id,
    `etapa=${detail?.stage?.name} esperada=${firstStage?.name}`
  );

  console.log("\n== 008: paridad inbox — echoes de coexistence (US1) ==");
  const LEAD = "5214627008001"; // canónica: 524627008001

  // Un inbound primero: la conversación existe y la ventana queda abierta.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      name: "Lead 008",
      text: "hola, quiero informes",
      waMessageId: "wamid.e2e.008.in.1",
    }),
  });
  await sleep(1200);
  const findConv008 = async () =>
    (((await api("/api/conversations")).json?.conversations) ?? []).find(
      (c) => c.contact.phone === "524627008001"
    );
  let conv008 = await findConv008();
  ok("conversación del lead 008 creada", Boolean(conv008), "sin conversación");
  const inboundAtBefore = conv008?.lastInboundAt;

  // Echo: el dueño contesta A MANO desde la app del teléfono.
  const echo1 = await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "te contesto yo, dame un minuto",
      waMessageId: "wamid.e2e.008.echo.1",
    }),
  });
  ok("echo entregado al webhook", echo1.res.ok, JSON.stringify(echo1.json));
  await sleep(900);

  const msgs1 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const manual1 = msgs1.find((m) => m.text === "te contesto yo, dame un minuto");
  ok(
    "el mensaje manual aparece como saliente origin=manual",
    manual1?.direction === "out" && manual1?.origin === "manual" && manual1?.status === "sent",
    JSON.stringify(manual1)
  );

  conv008 = await findConv008();
  ok(
    "la IA quedó pausada con handoff manual_reply",
    conv008?.aiEnabled === false && conv008?.handoffReason === "manual_reply",
    JSON.stringify({ aiEnabled: conv008?.aiEnabled, reason: conv008?.handoffReason })
  );
  ok(
    "el echo NO tocó la ventana de 24 h (lastInboundAt intacto)",
    conv008?.lastInboundAt === inboundAtBefore,
    `${inboundAtBefore} → ${conv008?.lastInboundAt}`
  );

  // Idempotencia: el mismo echo otra vez no duplica.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "te contesto yo, dame un minuto",
      waMessageId: "wamid.e2e.008.echo.1",
    }),
  });
  await sleep(700);
  const msgs2 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  ok(
    "echo duplicado (mismo wamid) no duplica el mensaje",
    msgs2.filter((m) => m.text === "te contesto yo, dame un minuto").length === 1
  );

  // Variante defensiva: echoes bajo la clave `messages`.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "segundo mensaje manual",
      waMessageId: "wamid.e2e.008.echo.2",
      useMessagesKey: true,
    }),
  });
  await sleep(700);
  const msgs3 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  ok(
    "echo bajo la clave `messages` también se ingiere (parser tolerante)",
    msgs3.some((m) => m.text === "segundo mensaje manual" && m.origin === "manual")
  );

  // Echo hacia un número SIN conversación previa → la crea.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: "5214627008002",
      text: "hola, te escribo del anuncio",
      waMessageId: "wamid.e2e.008.echo.3",
    }),
  });
  await sleep(700);
  const convNew = (((await api("/api/conversations")).json?.conversations) ?? []).find(
    (c) => c.contact.phone === "524627008002"
  );
  ok("echo a número nuevo crea contacto y conversación", Boolean(convNew));

  // Reactivación desde el CRM (flujo existente de handoff).
  const react = await api(`/api/conversations/${conv008.id}`, {
    method: "PATCH",
    body: JSON.stringify({ reactivate: true }),
  });
  conv008 = await findConv008();
  ok(
    "reactivar la IA desde el CRM limpia el handoff",
    react.res.ok && conv008?.aiEnabled === true && !conv008?.handoffReason
  );

  console.log("\n== 008: enviar adjuntos desde el composer (US2) ==");
  const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]);
  const mediaForm = new FormData();
  mediaForm.set(
    "file",
    new Blob([JPEG_BYTES], { type: "image/jpeg" }),
    "local.jpg"
  );
  mediaForm.set("caption", "mira nuestro local");
  const upRes = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: mediaForm,
  });
  const upJson = await upRes.json().catch(() => null);
  ok("imagen con caption enviada (201)", upRes.status === 201, JSON.stringify(upJson));

  const msgs4 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const sentImg = msgs4.find((m) => m.media?.caption === "mira nuestro local");
  ok(
    "el saliente con imagen trae asset disponible y origin=operator",
    sentImg?.type === "image" &&
      sentImg?.origin === "operator" &&
      sentImg?.media?.fetchStatus === "available",
    JSON.stringify(sentImg)
  );

  const imgBin = await fetch(`${BASE}/api/media/${sentImg?.media?.assetId}`, {
    headers: { cookie, origin: BASE },
  });
  ok(
    "GET /api/media/{id} sirve el binario con su content-type",
    imgBin.ok && (imgBin.headers.get("content-type") ?? "").includes("image/jpeg")
  );

  const outbox008 = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "el envío llegó a Graph como type=image con media id subido",
    outbox008.some((o) => o.type === "image" && JSON.stringify(o.body).includes("media-up-"))
  );

  // Camino infeliz: archivo que excede el límite (imagen > 5 MB) → 413 previo.
  const bigForm = new FormData();
  bigForm.set(
    "file",
    new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: "image/png" }),
    "grande.png"
  );
  const bigRes = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: bigForm,
  });
  ok("imagen de 6 MB → 413 too_large ANTES de enviar", bigRes.status === 413);

  // Ubicación (payload estructurado, sin archivo).
  const locRes = await api(`/api/conversations/${conv008.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      type: "location",
      location: { latitude: 21.019, longitude: -101.257, name: "Oficina Central" },
    }),
  });
  ok("ubicación enviada", locRes.res.ok, JSON.stringify(locRes.json));
  const msgs5 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const sentLoc = msgs5.find((m) => m.type === "location" && m.direction === "out");
  ok(
    "la ubicación viaja como payload (lat/long/name) sin binario",
    sentLoc?.media?.kind === "location" && sentLoc?.media?.payload?.latitude === 21.019,
    JSON.stringify(sentLoc?.media)
  );
  const outboxLoc = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "Graph recibió type=location",
    outboxLoc.some((o) => o.type === "location")
  );

  console.log("\n== 008: previews de adjuntos entrantes (US3) ==");
  if (MEDIA_ENABLED) {
    await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: LEAD,
        type: "image",
        mediaId: "media-e2e-img-1",
        caption: "foto de mi negocio",
        waMessageId: "wamid.e2e.008.in.img",
      }),
    });
    await sleep(1600); // ingesta + descarga in-process del binario
    const msgs6 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
    const inImg = msgs6.find((m) => m.media?.caption === "foto de mi negocio");
    ok(
      "imagen entrante queda disponible tras la descarga in-process",
      inImg?.direction === "in" &&
        inImg?.media?.kind === "image" &&
        inImg?.media?.fetchStatus === "available",
      JSON.stringify(inImg?.media)
    );
    const inImgBin = await fetch(`${BASE}/api/media/${inImg?.media?.assetId}`, {
      headers: { cookie, origin: BASE },
    });
    ok("el binario entrante se sirve desde el volumen local", inImgBin.ok);

    // Camino infeliz: media cuya descarga falla (metadata sin url) → failed,
    // el mensaje se conserva y /api/media responde 410.
    await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: LEAD,
        type: "image",
        mediaId: "broken-no-url",
        waMessageId: "wamid.e2e.008.in.broken",
      }),
    });
    await sleep(1600);
    const msgs8 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
    const broken = msgs8.find((m) => m.id !== inImg?.id && m.media?.fetchStatus === "failed");
    ok(
      "descarga fallida degrada a failed sin perder el mensaje",
      Boolean(broken),
      JSON.stringify(msgs8.filter((m) => m.media).map((m) => m.media))
    );
    if (broken) {
      const goneRes = await fetch(`${BASE}/api/media/${broken.media.assetId}`, {
        headers: { cookie, origin: BASE },
      });
      ok("asset fallido → 410 gone en /api/media", goneRes.status === 410);
    }

    // Echo CON adjunto (AC-5 de US1): la foto que el dueño mandó desde el cel.
    await api("/api/dev/wa-mock/echo", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        to: LEAD,
        type: "image",
        mediaId: "media-e2e-echo-img",
        caption: "así quedaría tu logo",
        waMessageId: "wamid.e2e.008.echo.img",
      }),
    });
    await sleep(1600);
    const msgs9 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
    const echoImg = msgs9.find((m) => m.media?.caption === "así quedaría tu logo");
    ok(
      "echo con imagen: manual + asset descargado y previsualizable",
      echoImg?.origin === "manual" && echoImg?.media?.fetchStatus === "available",
      JSON.stringify(echoImg?.media)
    );
  } else {
    console.log(
      "  (gate de adjuntos activo: se saltea la preview de binarios entrantes)"
    );
  }

  // Ubicación entrante: payload estructurado, NO pasa por el gate.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "location",
      location: { latitude: 20.5, longitude: -100.8, name: "Mi taller" },
      waMessageId: "wamid.e2e.008.in.loc",
    }),
  });
  await sleep(900);
  const msgs7 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const inLoc = msgs7.find((m) => m.type === "location" && m.direction === "in");
  ok(
    "ubicación entrante trae payload directo",
    inLoc?.media?.payload?.name === "Mi taller",
    JSON.stringify(inLoc?.media)
  );

  console.log("\n== 008: gate de adjuntos entrantes (no soportados) ==");
  if (!MEDIA_ENABLED) {
    const GATE_LEAD = "5214627008990"; // canónico: 524627008990
    await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: GATE_LEAD,
        name: "Lead adjuntos",
        type: "image",
        mediaId: "media-gate-e2e-1",
        caption: "foto del producto",
        waMessageId: "wamid.e2e.gate.in.1",
      }),
    });
    await sleep(1600); // ingesta + aviso
    const gateConv = (((await api("/api/conversations")).json?.conversations) ?? []).find(
      (c) => c.contact.phone === "524627008990"
    );
    ok("conversación del lead de adjuntos creada", Boolean(gateConv), "sin conversación");
    const gateMsgs = gateConv
      ? (await api(`/api/conversations/${gateConv.id}/messages`)).json?.messages ?? []
      : [];
    const gateIn = gateMsgs.find((m) => m.direction === "in" && m.type === "image");
    ok(
      "imagen entrante queda en el hilo SIN asset (gate activo)",
      Boolean(gateIn) && gateIn.media === null,
      JSON.stringify(gateIn)
    );
    const gateOut = gateMsgs.find(
      (m) => m.direction === "out" && m.type === "text" && m.origin === "operator"
    );
    ok(
      "se respondió el aviso de adjuntos no soportados",
      Boolean(gateOut) && typeof gateOut.text === "string" && gateOut.text.includes("adjuntos"),
      JSON.stringify(gateOut)
    );
  } else {
    console.log(
      "  (procesamiento de adjuntos habilitado: se saltea el aviso de no soportados)"
    );
  }


  console.log("\n== 005: asistente comercial con contexto de negocio ==");
  const CATALOG_LEAD = "5214628006005"; // canónico: 524628006005

  const pubProds = (await api("/api/public/products")).json?.products ?? [];
  ok(
    "GET /api/public/products → arreglo de productos activos",
    Array.isArray(pubProds) && pubProds.length > 0,
    JSON.stringify(pubProds)
  );
  ok(
    "el catálogo público NUNCA expone costo/margen",
    pubProds.every((p) => p.costo === undefined && p.margen === undefined),
    JSON.stringify(pubProds[0])
  );

  const inbound005 = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: CATALOG_LEAD,
      name: "Lead comercial",
      type: "text",
      text: "¿Cuánto cuesta el pan de hamburguesa?",
      waMessageId: "wamid.e2e.005.in.1",
    }),
  });
  ok(
    "inbound del lead comercial entregado al webhook",
    inbound005.res.ok,
    JSON.stringify(inbound005.json)
  );
  await sleep(2500); // espera el turno del agente (ai-mock)

  const conv005 = (((await api("/api/conversations")).json?.conversations) ?? []).find(
    (c) => c.contact.phone === "524628006005"
  );
  ok("la conversación del lead comercial se creó", Boolean(conv005));

  const msgs005 =
    (await api(`/api/conversations/${conv005?.id}/messages`)).json?.messages ?? [];
  ok(
    "el agente respondió al mensaje comercial",
    msgs005.some((m) => m.direction === "out" && m.origin === "ai"),
    JSON.stringify(msgs005.at(-1))
  );

  // El contacto NO debe haber recibido ningún campo de costo en sus datos.
  const contact005 = (await api(`/api/contacts/${conv005?.contact?.id ?? ""}`)).json?.contact;
  ok(
    "el contacto no expone costo/margen",
    Boolean(contact005) &&
      contact005.costo === undefined &&
      contact005.margen === undefined
  );

  console.log("\n== 013: remediacion ejf1 — handoff determinista y precision ==");

  /*
   * Redes deterministas de 008 (plan sección 7). Corren en el pipeline ANTES
   * del modelo, así que su efecto es observable contra la app real sin que el
   * ai-mock sepa nada: si el último entrante matchea el patrón de escalado, el
   * pipeline entrega el cierre cordial y aplica handoff con motivo "cliente".
   *
   * Cada escenario usa un teléfono sintético propio (canónico 52462900130x)
   * para no colisionar con contactos ni conversaciones previas, y waMessageId
   * únicos. Los casos replican los defectos medidos en la corrida
   * run_ejf1ffwxlmifjeeh315f (tests/fixtures/lab/remediacion-ejf1-cases.json).
   */
  const findConv013 = async (canonicalPhone) =>
    (((await api("/api/conversations")).json?.conversations) ?? []).find(
      (c) => c.contact.phone === canonicalPhone
    );

  // Persona natural — consulta de historial: el canal no puede gestionarla y la
  // configuración manda derivar (patrón HISTORY_REQUEST).
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: "5214629001301", // canónico: 524629001301
      name: "Lead 013 historial",
      text: "me puedes decir que pedidos tengo pendientes?",
      waMessageId: "wamid.e2e.013.in.historial.1",
    }),
  });
  await sleep(1800); // el handoff no usa el LLM, pero el webhook se procesa aparte
  const convHistorial = await findConv013("524629001301");
  ok(
    "013: conversación de historial creada",
    Boolean(convHistorial),
    "sin conversación"
  );
  ok(
    "historial → handoff con motivo cliente",
    Boolean(convHistorial?.handoffAt) && convHistorial?.handoffReason === "cliente",
    JSON.stringify({
      handoffAt: convHistorial?.handoffAt,
      reason: convHistorial?.handoffReason,
    })
  );
  const msgsHistorial = convHistorial
    ? (await api(`/api/conversations/${convHistorial.id}/messages`)).json?.messages ?? []
    : [];
  ok(
    "el cierre de escalado llega al cliente (menciona a una persona)",
    msgsHistorial.some(
      (m) =>
        m.direction === "out" &&
        typeof m.text === "string" &&
        m.text.includes("una persona")
    ),
    JSON.stringify(msgsHistorial.filter((m) => m.direction === "out").map((m) => m.text))
  );

  // Descuento pedido con cantidad condicional: "si llevo 20 me hacen precio?".
  // Es el defecto determinista comprador_decidido#0/#2.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: "5214629001302", // canónico: 524629001302
      name: "Lead 013 descuento",
      text: "y si llevo 20 me hacen precio?",
      waMessageId: "wamid.e2e.013.in.descuento.1",
    }),
  });
  await sleep(1800);
  const convDescuento = await findConv013("524629001302");
  ok(
    "descuento por volumen → handoff con motivo cliente (comprador_decidido#0/#2)",
    Boolean(convDescuento?.handoffAt) && convDescuento?.handoffReason === "cliente",
    JSON.stringify({
      handoffAt: convDescuento?.handoffAt,
      reason: convDescuento?.handoffReason,
    })
  );

  // Envío de boleta por correo: el canal no lo gestiona, exige derivar. Es el
  // defecto determinista pide_boleta_pago#2. La continuidad exige además que el
  // agente NO afirme haber enviado el documento.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: "5214629001303", // canónico: 524629001303
      name: "Lead 013 boleta",
      text: "y me la mandan al correo?",
      waMessageId: "wamid.e2e.013.in.boleta.1",
    }),
  });
  await sleep(1800);
  const convBoleta = await findConv013("524629001303");
  ok(
    "envío de boleta por correo → handoff con motivo cliente (pide_boleta_pago#2)",
    Boolean(convBoleta?.handoffAt) && convBoleta?.handoffReason === "cliente",
    JSON.stringify({
      handoffAt: convBoleta?.handoffAt,
      reason: convBoleta?.handoffReason,
    })
  );
  const msgsBoleta = convBoleta
    ? (await api(`/api/conversations/${convBoleta.id}/messages`)).json?.messages ?? []
    : [];
  const outBoleta = msgsBoleta.filter((m) => m.direction === "out");
  ok(
    "continuidad: el agente no afirma haber enviado la boleta",
    outBoleta.length > 0 &&
      outBoleta.every(
        (m) => !/ya se la envi|se la envié|ya la enviamos/i.test(m.text ?? "")
      ),
    JSON.stringify(outBoleta.map((m) => m.text))
  );

  // Intención de compra explícita: la red determinista AVANZA el lead, no lo
  // deriva. El mensaje no debe disparar handoff y el agente sí debe responder.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: "5214629001304", // canónico: 524629001304
      name: "Lead 013 compra",
      text: "hola, quiero hacer un pedido para mi negocio",
      waMessageId: "wamid.e2e.013.in.compra.1",
    }),
  });
  await sleep(2500); // turno del agente (ai-mock)
  const convCompra = await findConv013("524629001304");
  ok(
    "013: conversación de intención de compra creada",
    Boolean(convCompra),
    "sin conversación"
  );
  ok(
    "la intención de compra no escala por sí sola",
    Boolean(convCompra) && !convCompra?.handoffAt,
    JSON.stringify({
      handoffAt: convCompra?.handoffAt,
      reason: convCompra?.handoffReason,
    })
  );
  const msgsCompra = convCompra
    ? (await api(`/api/conversations/${convCompra.id}/messages`)).json?.messages ?? []
    : [];
  ok(
    "el agente respondió el pedido sin escalar",
    msgsCompra.some((m) => m.direction === "out" && m.origin === "ai"),
    JSON.stringify(msgsCompra.at(-1))
  );

  // Control de precisión: una consulta de precio simple NO debe cortar la venta
  // en curso (falso positivo del patrón de escalado).
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: "5214629001305", // canónico: 524629001305
      name: "Lead 013 precio",
      text: "cuanto sale la bolsa de brioche de 12?",
      waMessageId: "wamid.e2e.013.in.precio.1",
    }),
  });
  await sleep(2500);
  const convPrecio = await findConv013("524629001305");
  ok(
    "consulta de precio simple → sin handoff (la venta sigue viva)",
    Boolean(convPrecio) && !convPrecio?.handoffAt,
    JSON.stringify({
      handoffAt: convPrecio?.handoffAt,
      reason: convPrecio?.handoffReason,
    })
  );
  const msgsPrecio = convPrecio
    ? (await api(`/api/conversations/${convPrecio.id}/messages`)).json?.messages ?? []
    : [];
  ok(
    "el agente cotizó sin escalar",
    msgsPrecio.some((m) => m.direction === "out" && m.origin === "ai"),
    JSON.stringify(msgsPrecio.at(-1))
  );

  console.log("\n== 006: push endpoints (config/subscribe/unsubscribe) ==");
  const pushCfg = await api("/api/push/config");
  ok(
    "GET /api/push/config responde con la VAPID pública",
    pushCfg.res.ok && "publicKey" in (pushCfg.json ?? {}),
    JSON.stringify(pushCfg.json)
  );

  const PUSH_ENDPOINT = "https://push.example.test/sub/e2e-1";
  const sub1 = await api("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: PUSH_ENDPOINT,
      keys: { auth: "auth-e2e", p256dh: "p256dh-e2e" },
    }),
  });
  ok("POST /api/push/subscribe → ok", sub1.res.ok, JSON.stringify(sub1.json));

  const sub2 = await api("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: PUSH_ENDPOINT,
      keys: { auth: "auth-e2e", p256dh: "p256dh-e2e" },
    }),
  });
  ok("re-suscribir el mismo endpoint no duplica (upsert)", sub2.res.ok);

  const badSub = await api("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: "no-es-url", keys: {} }),
  });
  ok(
    "subscribe con body inválido → 422",
    badSub.res.status === 422,
    `status=${badSub.res.status}`
  );

  const unsub = await api("/api/push/unsubscribe", {
    method: "DELETE",
    body: JSON.stringify({ endpoint: PUSH_ENDPOINT }),
  });
  ok(
    "DELETE /api/push/unsubscribe → ok",
    unsub.res.ok,
    JSON.stringify(unsub.json)
  );

  console.log("\n== 007: sitio público LamasFood y ruteo por host ==");

  /*
   * El sitio es anónimo, así que se pide SIN cookie. El host se fuerza con
   * `x-forwarded-host` (que es como lo setea el proxy en producción y lo que el
   * middleware prioriza), así se prueban las dos superficies sin tocar DNS.
   */
  const SITE = { "x-forwarded-host": "lamasfood.cl" };
  const ADMIN = { "x-forwarded-host": "admin.lamasfood.cl" };

  async function get(path, headers = {}) {
    const res = await fetch(`${BASE}${path}`, { headers, redirect: "manual" });
    const text = await res.text().catch(() => "");
    return { res, text };
  }

  const landing = await get("/", SITE);
  ok("host público: GET / → 200", landing.res.status === 200, `status=${landing.res.status}`);
  ok(
    "host público: la landing es de LamasFood, no del CRM",
    landing.text.includes("LamasFood") &&
      !landing.text.includes("Sistema de gestión"),
    landing.text.slice(0, 120)
  );
  ok(
    "host público: un solo <h1> (HTML semántico)",
    (landing.text.match(/<h1/g) ?? []).length === 1,
    `h1=${(landing.text.match(/<h1/g) ?? []).length}`
  );
  const landingCache = landing.res.headers.get("cache-control") ?? "";
  /*
   * En `next dev` Next.js fuerza `no-store, must-revalidate` en las respuestas,
   * así que el `s-maxage` que pone el middleware solo se observa contra un build
   * de producción (`next start`), donde se verificó. Acá se acepta cualquiera de
   * las dos: lo que se prueba en dev es que la respuesta NO salga sin política.
   */
  ok(
    "host público: la respuesta declara una política de caché explícita",
    /s-maxage=\d+/.test(landingCache) || landingCache.includes("no-store"),
    landingCache || "(sin cache-control)"
  );

  const catalog = await get("/catalogo", SITE);
  ok("host público: GET /catalogo → 200", catalog.res.status === 200, `status=${catalog.res.status}`);
  ok(
    "catálogo: expone los productos del catálogo real",
    pubProds.some((p) => catalog.text.includes(p.producto)),
    `productos=${pubProds.length}`
  );
  ok(
    "catálogo: datos estructurados ItemList para SEO",
    catalog.text.includes('"@type":"ItemList"') && catalog.text.includes('"@type":"Product"')
  );

  /*
   * Guard del requisito: el catálogo público NO publica precios; los cotiza el
   * agente por WhatsApp. No alcanza con que la ficha no los pinte — Next
   * serializa los props de los componentes de servidor en el HTML (payload RSC),
   * así que se busca el precio en TODO el HTML servido.
   * Se chequean nombres de campo (inequívocos) y valores con decimales (un
   * entero corto daría falsos positivos: `fontWeight:400`).
   */
  const priceFields = ["precioBolsaConIva", "precioBolsaNeto", "precioUnitarioNeto"];
  const priceValues = pubProds
    .flatMap((p) => priceFields.map((f) => String(p[f])))
    .filter((v) => v.includes("."));
  const priceLeaks = [
    ...priceFields.filter((f) => catalog.text.includes(f)),
    ...priceValues.filter((v) => catalog.text.includes(v)),
  ];
  ok(
    "catálogo: no filtra precios en el HTML (ni campos ni valores)",
    priceLeaks.length === 0,
    priceLeaks.slice(0, 3).join(", ")
  );
  ok(
    "catálogo: los datos estructurados no publican precio",
    !catalog.text.includes('"price"') && !catalog.text.includes("priceCurrency")
  );

  // Aislamiento entre superficies: el dominio público no expone el CRM.
  for (const p of ["/inbox", "/login", "/api/products", "/api/events"]) {
    const r = await get(p, SITE);
    ok(`host público: ${p} → 404 (no se expone)`, r.res.status === 404, `status=${r.res.status}`);
  }

  /*
   * Guard explícito del requisito: un visitante de la web pública NUNCA debe
   * terminar en el admin. No alcanza con el status — una redirección a /inbox o
   * /login también lo llevaría ahí, así que se exige que no haya `location`.
   */
  const leaks = [];
  for (const p of ["/inbox", "/login", "/", "/catalogo", "/no-existe"]) {
    const r = await get(p, SITE);
    const loc = r.res.headers.get("location") ?? "";
    if (loc.includes("/inbox") || loc.includes("/login")) leaks.push(`${p} → ${loc}`);
  }
  ok(
    "host público: nada redirige al admin (ni /inbox ni /login)",
    leaks.length === 0,
    leaks.join(", ")
  );

  const canon = await get("/site", SITE);
  ok(
    "host público: /site redirige a su forma canónica (sin contenido duplicado)",
    canon.res.status === 308 && (canon.res.headers.get("location") ?? "").endsWith("/"),
    `status=${canon.res.status} loc=${canon.res.headers.get("location")}`
  );

  ok(
    "host público: /api/public/products sigue disponible",
    (await get("/api/public/products", SITE)).res.status === 200
  );
  ok(
    "healthcheck responde en AMBOS hosts (no depende del ruteo)",
    (await get("/api/health", SITE)).res.status === 200 &&
      (await get("/api/health", ADMIN)).res.status === 200
  );

  // robots/sitemap por host.
  const robotsPublic = (await get("/robots.txt", SITE)).text;
  const robotsAdmin = (await get("/robots.txt", ADMIN)).text;
  ok(
    "robots.txt público: permite indexar y bloquea solo /api/",
    robotsPublic.includes("Allow: /") && robotsPublic.includes("Disallow: /api/"),
    robotsPublic.replace(/\n/g, "|")
  );
  ok(
    "robots.txt admin: bloquea todo",
    robotsAdmin.includes("Disallow: /") && !robotsAdmin.includes("Allow: /"),
    robotsAdmin.replace(/\n/g, "|")
  );
  const sitemapPublic = (await get("/sitemap.xml", SITE)).text;
  const sitemapAdmin = (await get("/sitemap.xml", ADMIN)).text;
  ok(
    "sitemap público: lista la landing y el catálogo",
    sitemapPublic.includes("<loc>") && sitemapPublic.includes("/catalogo")
  );
  ok("sitemap admin: vacío (el CRM no se indexa)", !sitemapAdmin.includes("<loc>"));

  // El subdominio de gestión no sirve el sitio público.
  ok(
    "host admin: /site → 404",
    (await get("/site", ADMIN)).res.status === 404,
    `status=${(await get("/site", ADMIN)).res.status}`
  );

  // Camino infeliz: ruta inexistente del sitio.
  const missing = await get("/catalogo/no-existe", SITE);
  ok(
    "camino infeliz: ruta inexistente del sitio → 404",
    missing.res.status === 404,
    `status=${missing.res.status}`
  );
  /*
   * El status solo no alcanza: sin el catch-all, Next sirve su 404 por defecto
   * (sin layout, sin marca) y el check pasaba igual. Acá se exige que la página
   * salga con la marca del sitio y SIN filtrar el CRM.
   */
  ok(
    "ese 404 sale con la marca del sitio, no el 404 pelado de Next",
    missing.text.includes("No encontramos esta página") &&
      missing.text.includes("LamasFood") &&
      !missing.text.includes("Sistema de gestión"),
    `${missing.text.length} bytes`
  );

  console.log("\n-- 007: foto de producto (US3) --");
  const adminProds = (await api("/api/products")).json?.products ?? [];
  const target = adminProds[0];
  ok("hay un producto para probar la foto", Boolean(target), JSON.stringify(adminProds[0]));

  if (target) {
    // Un PNG real de 1×1: se sube, se sirve público y se borra.
    const PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const form = new FormData();
    form.append("file", new Blob([PNG], { type: "image/png" }), "e2e.png");

    const upload = await fetch(`${BASE}/api/products/${target.id}/image`, {
      method: "POST",
      headers: { origin: BASE, cookie },
      body: form,
    });
    const uploadJson = await upload.json().catch(() => null);
    ok("POST /api/products/:id/image → 200", upload.ok, `status=${upload.status}`);
    ok(
      "la imagen queda referenciada por una ruta pública",
      typeof uploadJson?.imagen === "string" &&
        uploadJson.imagen.startsWith("/api/public/media/"),
      JSON.stringify(uploadJson?.imagen)
    );

    const assetId = String(uploadJson?.imagen ?? "").split("/").pop();
    const served = await fetch(`${BASE}/api/public/media/${assetId}`);
    ok(
      "la foto se sirve SIN sesión (es pública)",
      served.status === 200 && (served.headers.get("content-type") ?? "").includes("image/png"),
      `status=${served.status} type=${served.headers.get("content-type")}`
    );
    ok(
      "la foto pública se cachea de forma inmutable",
      (served.headers.get("cache-control") ?? "").includes("immutable"),
      served.headers.get("cache-control") ?? "(sin cache-control)"
    );

    const afterUpload = (await get("/catalogo", SITE)).text;
    ok(
      "el catálogo público refleja la foto sin esperar la revalidación",
      afterUpload.includes(assetId)
    );

    const bad = new FormData();
    bad.append("file", new Blob([Buffer.from("no soy una imagen")], { type: "text/plain" }), "x.txt");
    const badRes = await fetch(`${BASE}/api/products/${target.id}/image`, {
      method: "POST",
      headers: { origin: BASE, cookie },
      body: bad,
    });
    ok(
      "camino infeliz: subir un tipo no soportado → 415",
      badRes.status === 415,
      `status=${badRes.status}`
    );

    const noAuth = await fetch(`${BASE}/api/products/${target.id}/image`, {
      method: "DELETE",
    });
    ok(
      "camino infeliz: borrar la foto sin sesión → 401",
      noAuth.status === 401,
      `status=${noAuth.status}`
    );

    const del = await fetch(`${BASE}/api/products/${target.id}/image`, {
      method: "DELETE",
      headers: { origin: BASE, cookie },
    });
    ok("DELETE /api/products/:id/image → 200", del.ok, `status=${del.status}`);
    const goneServed = await fetch(`${BASE}/api/public/media/${assetId}`);
    ok(
      "la foto ya no se sirve después de quitarla",
      goneServed.status === 404,
      `status=${goneServed.status}`
    );
  }

  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("ERROR FATAL:", err);
  process.exit(1);
});
