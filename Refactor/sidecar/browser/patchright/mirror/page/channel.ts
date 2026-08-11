/**
 * §5.5.4 / §5.7 — the page → Node push channel. Production wires `push` to
 * an `exposeBinding` call; unit tests wire it to a plain array.
 */
export interface PageToNodeChannel {
  push(bytes: Uint8Array): void;
}

export const DEFAULT_CHUNK_BYTES = 64 * 1024;

/** Splits `bytes` into ordered pieces of at most `chunkBytes` and pushes each. Returns the chunk count. */
export function pushChunked(
  channel: PageToNodeChannel,
  bytes: Uint8Array,
  chunkBytes: number = DEFAULT_CHUNK_BYTES,
): number {
  if (bytes.byteLength === 0) return 0;
  let offset = 0;
  let chunks = 0;
  while (offset < bytes.byteLength) {
    const end = Math.min(offset + chunkBytes, bytes.byteLength);
    channel.push(bytes.subarray(offset, end));
    offset = end;
    chunks += 1;
  }
  return chunks;
}

/** Pushes every already-split wire part (encode.ts) in order — atomicity is the client's job at apply time. */
export function pushFrameParts(channel: PageToNodeChannel, parts: readonly Uint8Array[]): void {
  for (const part of parts) channel.push(part);
}

/** Adapts an `exposeBinding`-style callback (or any `(bytes) => void`) into a `PageToNodeChannel`. */
export function createBindingChannel(sendToNode: (bytes: Uint8Array) => void): PageToNodeChannel {
  return { push: sendToNode };
}
