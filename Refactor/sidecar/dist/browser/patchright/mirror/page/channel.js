"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CHUNK_BYTES = void 0;
exports.pushChunked = pushChunked;
exports.pushFrameParts = pushFrameParts;
exports.createBindingChannel = createBindingChannel;
exports.DEFAULT_CHUNK_BYTES = 64 * 1024;
/** Splits `bytes` into ordered pieces of at most `chunkBytes` and pushes each. Returns the chunk count. */
function pushChunked(channel, bytes, chunkBytes = exports.DEFAULT_CHUNK_BYTES) {
    if (bytes.byteLength === 0)
        return 0;
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
function pushFrameParts(channel, parts) {
    for (const part of parts)
        channel.push(part);
}
/** Adapts an `exposeBinding`-style callback (or any `(bytes) => void`) into a `PageToNodeChannel`. */
function createBindingChannel(sendToNode) {
    return { push: sendToNode };
}
//# sourceMappingURL=channel.js.map