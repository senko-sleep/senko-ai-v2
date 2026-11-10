export const LIVE_BINARY_TYPE = "application/x-senko-live";
type LivePacket = { type: string } & Record<string, unknown>;

// Each packet has two uint32 lengths, then UTF-8 JSON metadata and optional JPEG bytes.
const HEADER_SIZE = 8;
const MAX_METADATA_SIZE = 1024 * 1024;
const MAX_IMAGE_SIZE = 24 * 1024 * 1024;
const encoder = new TextEncoder();

export function encodeLivePacket(event: object, image?: Uint8Array): Uint8Array {
  const metadata = encoder.encode(JSON.stringify(event));
  const imageSize = image?.byteLength || 0;
  const packet = new Uint8Array(HEADER_SIZE + metadata.byteLength + imageSize);
  const header = new DataView(packet.buffer);
  header.setUint32(0, metadata.byteLength);
  header.setUint32(4, imageSize);
  packet.set(metadata, HEADER_SIZE);
  if (image) packet.set(image, HEADER_SIZE + metadata.byteLength);
  return packet;
}

export async function readLivePackets(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: LivePacket) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let chunk = new Uint8Array();
  let offset = 0;
  const read = async (size: number, allowEnd = false): Promise<Uint8Array<ArrayBuffer> | null> => {
    if (chunk.byteLength - offset >= size) {
      const bytes = chunk.subarray(offset, offset + size);
      offset += size;
      return bytes;
    }
    const bytes = new Uint8Array(size);
    let copied = 0;
    while (copied < size) {
      if (offset === chunk.byteLength) {
        const next = await reader.read();
        if (next.done) {
          if (allowEnd && copied === 0) return null;
          throw new Error("Truncated live browser packet");
        }
        // Fetch response streams deliver ordinary ArrayBuffers.
        chunk = next.value as Uint8Array<ArrayBuffer>;
        offset = 0;
      }
      const count = Math.min(size - copied, chunk.byteLength - offset);
      bytes.set(chunk.subarray(offset, offset + count), copied);
      offset += count;
      copied += count;
    }
    return bytes;
  };

  try {
    for (;;) {
      const bytes = await read(HEADER_SIZE, true);
      if (!bytes) return;
      const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
      const metadataSize = header.getUint32(0);
      const imageSize = header.getUint32(4);
      if (!metadataSize || metadataSize > MAX_METADATA_SIZE || imageSize > MAX_IMAGE_SIZE) {
        throw new Error("Invalid live browser packet size");
      }
      const event = JSON.parse(decoder.decode((await read(metadataSize))!));
      if (imageSize) event.data = new Blob([(await read(imageSize))!], { type: "image/jpeg" });
      if (event.type !== "ping") onEvent(event);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function connectLiveStream(url: URL, onEvent: (event: LivePacket) => void, onError: () => void) {
  const controller = new AbortController();
  let legacy: EventSource | undefined;
  const binary = new URL(url);
  binary.searchParams.set("format", "binary");
  const params = [LIVE_BINARY_TYPE];
  const fps = url.searchParams.get("fps");
  if (fps) params.push(`fps=${fps}`);
  if (url.searchParams.get("restore") === "1") params.push("restore=1");
  const headers = new Headers({ Accept: params.join("; ") });
  const token = url.searchParams.get("t");
  if (token) headers.set("Authorization", `SenkoLive ${token}`);
  const fallback = () => {
    if (controller.signal.aborted) return;
    legacy = new EventSource(url);
    legacy.onmessage = ev => {
      try { onEvent(JSON.parse(ev.data)); } catch { /* Ignore an invalid event. */ }
    };
    legacy.onerror = onError;
  };
  void fetch(binary, { headers, cache: "no-store", signal: controller.signal }).then(async response => {
    if (response.ok && response.body && response.headers.get("content-type")?.startsWith(LIVE_BINARY_TYPE)) {
      await readLivePackets(response.body, onEvent);
      if (!controller.signal.aborted) onError();
      return;
    }
    await response.body?.cancel();
    if (controller.signal.aborted) return;
    // Older agent hosts ignore the format parameter and still serve EventSource.
    if (!response.ok) { onError(); return; }
    fallback();
  }, fallback).catch(() => { if (!controller.signal.aborted) onError(); });

  return {
    close() {
      controller.abort();
      legacy?.close();
    },
  };
}
