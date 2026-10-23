// Chat, message and image storage helpers (all scoped to an owner).
import { HttpError } from "./identity";
import { json, newId, q, q1, toBuffer } from "./db";
import type { ImagePart, LlmMessage } from "@/lib/llm";

export interface MessageMeta {
  provider?: string;
  providerLabel?: string;
  model?: string;
  actions?: { url: string; label: string }[];
  suggestAgent?: boolean;
  error?: string;
  agent?: { goal: string; status: string; trail?: ({ label: string; url?: string } | string)[]; url?: string };
  interrupted?: boolean;
  /** Senko's mood line for this reply (from the persona's status tag). */
  mood?: string;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageIds: string[];
  meta: MessageMeta;
  createdAt: string;
}

export async function listChats(ownerId: string) {
  return q<{ id: string; title: string; updated_at: string }>(
    "SELECT id, title, updated_at FROM chats WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 500",
    [ownerId]
  );
}

export async function createChat(ownerId: string, title = "New chat") {
  const id = newId("c_");
  await q("INSERT INTO chats (id, owner_id, title) VALUES ($1, $2, $3)", [id, ownerId, title.slice(0, 120)]);
  return { id, title };
}

export async function requireChat(ownerId: string, chatId: string) {
  const chat = await q1<{ id: string; title: string }>("SELECT id, title FROM chats WHERE id = $1 AND owner_id = $2", [chatId, ownerId]);
  if (!chat) throw new HttpError(404, "Chat not found.");
  return chat;
}

export async function getMessages(chatId: string, limit = 400): Promise<StoredMessage[]> {
  const rows = await q<{ id: string; role: string; content: string; image_ids: unknown; meta: unknown; created_at: string }>(
    `SELECT id, role, content, image_ids, meta, created_at FROM (
       SELECT * FROM messages WHERE chat_id = $1 ORDER BY seq DESC LIMIT $2
     ) t ORDER BY seq ASC`,
    [chatId, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role as "user" | "assistant",
    content: r.content,
    imageIds: json<string[]>(r.image_ids, []),
    meta: json<MessageMeta>(r.meta, {}),
    createdAt: r.created_at,
  }));
}

export async function addMessage(
  chatId: string,
  role: "user" | "assistant",
  content: string,
  imageIds: string[] = [],
  meta: MessageMeta = {},
  id = newId("m_")
) {
  await q("INSERT INTO messages (id, chat_id, role, content, image_ids, meta) VALUES ($1, $2, $3, $4, $5, $6)", [
    id,
    chatId,
    role,
    content,
    JSON.stringify(imageIds),
    JSON.stringify(meta),
  ]);
  await q("UPDATE chats SET updated_at = now() WHERE id = $1", [chatId]);
  return id;
}

export async function updateMessage(id: string, content: string, meta: MessageMeta, imageIds?: string[]) {
  if (imageIds?.length) {
    await q("UPDATE messages SET content = $2, meta = $3, image_ids = $4 WHERE id = $1", [id, content, JSON.stringify(meta), JSON.stringify(imageIds)]);
  } else {
    await q("UPDATE messages SET content = $2, meta = $3 WHERE id = $1", [id, content, JSON.stringify(meta)]);
  }
}

export async function maybeTitle(chatId: string, firstUserText: string) {
  const chat = await q1<{ title: string }>("SELECT title FROM chats WHERE id = $1", [chatId]);
  if (chat && chat.title === "New chat" && firstUserText.trim()) {
    const t = firstUserText.trim().replace(/\s+/g, " ");
    await q("UPDATE chats SET title = $2 WHERE id = $1", [chatId, t.length > 48 ? `${t.slice(0, 47)}…` : t]);
  }
}

// ---- images ----

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const OK_MIME = /^image\/(png|jpe?g|webp|gif)$/;

export async function saveImage(ownerId: string, mime: string, data: Buffer) {
  if (!OK_MIME.test(mime)) throw new HttpError(415, `Unsupported image type ${mime}. Use PNG, JPEG, WebP or GIF.`);
  if (data.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Image is larger than 8 MB.");
  if (data.length < 20) throw new HttpError(400, "Image is empty.");
  const id = newId("i_");
  await q("INSERT INTO images (id, owner_id, mime, data) VALUES ($1, $2, $3, $4)", [id, ownerId, mime, data]);
  return id;
}

export async function loadImages(ownerId: string, ids: string[]): Promise<Map<string, ImagePart>> {
  const out = new Map<string, ImagePart>();
  if (!ids.length) return out;
  const rows = await q<{ id: string; mime: string; data: unknown }>(
    "SELECT id, mime, data FROM images WHERE owner_id = $1 AND id = ANY($2::text[])",
    [ownerId, ids]
  );
  for (const r of rows) out.set(r.id, { mime: r.mime, data: toBuffer(r.data).toString("base64") });
  return out;
}

/**
 * Turn stored messages into model input. The most recent images (up to
 * maxImages) are attached for real; older ones become a short placeholder so
 * the model knows they existed. Free providers cap images per request.
 */
export async function toLlmHistory(ownerId: string, msgs: StoredMessage[], maxImages = 6): Promise<LlmMessage[]> {
  const recent = msgs.slice(-40).filter((m) => !m.meta.error || m.content);
  const wanted: string[] = [];
  for (let i = recent.length - 1; i >= 0 && wanted.length < maxImages; i--) {
    for (const id of [...recent[i].imageIds].reverse()) {
      if (wanted.length < maxImages) wanted.push(id);
    }
  }
  const images = await loadImages(ownerId, wanted);
  return recent
    .filter((m) => m.content.trim() || m.imageIds.length)
    .map((m) => {
      const attached = m.imageIds.map((id) => images.get(id)).filter((x): x is ImagePart => !!x);
      const dropped = m.imageIds.length - attached.length;
      const note = dropped > 0 ? `\n[${dropped} earlier image(s) were shared here; not re-sent to save space]` : "";
      return {
        role: m.role,
        content: (m.content || (attached.length ? "(image)" : "")) + note,
        ...(attached.length ? { images: attached } : {}),
      };
    });
}
