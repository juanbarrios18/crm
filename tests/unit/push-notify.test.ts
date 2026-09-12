import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-test";
});

const sendNotification = vi.fn();

vi.mock("web-push", () => ({
  default: { sendNotification, setVapidDetails: vi.fn() },
}));

// Push deshabilitado (sin VAPID en el entorno): notifyHandoff debe ser no-op.
vi.mock("@/server/push/vapid", () => ({
  getVapid: () => null,
}));

describe("006 — suscripciones push (cifrado en reposo)", () => {
  it("decryptKeys revierte el cifrado (roundtrip auth/p256dh)", async () => {
    const { encryptSecret } = await import("@/lib/crypto");
    const { decryptKeys } = await import("@/server/push/subscriptions");
    const keys = { auth: "auth-secret", p256dh: "p256dh-public" };
    const enc = encryptSecret(JSON.stringify(keys));
    const row = {
      keysCipher: enc.cipher,
      keysIv: enc.iv,
      keysTag: enc.tag,
    } as Parameters<typeof decryptKeys>[0];

    expect(decryptKeys(row)).toEqual(keys);
  });
});

describe("006 — notifyHandoff sin VAPID (degradación silenciosa)", () => {
  it("no envía nada y no lanza", async () => {
    const { notifyHandoff } = await import("@/server/push/notify");
    await expect(notifyHandoff("org_1", "cv_1", "modelo")).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
