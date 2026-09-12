// 006 — Genera un par de claves VAPID para el Web Push.
// Uso: node scripts/generate-vapid.mjs
import webPush from "web-push";

const keys = webPush.generateVAPIDKeys();

console.log("Agregá estas líneas a tu .env (y al panel de tu hosting):");
console.log("");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`# VAPID_SUBJECT=mailto:tu@correo.com  (opcional, identifica al servidor)`);
