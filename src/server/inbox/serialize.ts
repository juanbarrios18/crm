import { schema } from "@/lib/db";

/**
 * Serializa un mensaje (y su adjunto opcional) al shape que consume la UI.
 * Módulo neutro: lo usan ingesta, envío y plantillas — así `send.ts` no
 * depende de `ingest.ts` y se evita un ciclo de imports.
 */
export function serializeMessage(
  m: typeof schema.message.$inferSelect,
  media: typeof schema.mediaAsset.$inferSelect | null = null
) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    type: m.type,
    text: m.text,
    status: m.status,
    aiGenerated: m.aiGenerated,
    origin: m.origin,
    media: media
      ? {
          assetId: media.id,
          kind: media.kind,
          mimeType: media.mimeType,
          fileName: media.fileName,
          fileSize: media.fileSize,
          caption: media.caption,
          fetchStatus: media.fetchStatus,
          payload: media.payload,
        }
      : null,
    createdAt: (m.waTimestamp ?? m.createdAt).toISOString(),
  };
}
