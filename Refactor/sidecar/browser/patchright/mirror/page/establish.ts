/**
 * §5.6 — establish payload helpers, the establish↔live handoff state machine
 * (§5.6.6) and the `establishEnd` checksum (§5.6.4 / PP-EST-7).
 */

export type EstablishBeginPayload = {
  generation: number;
  viewport: { width: number; height: number };
  scrollViewport: { x: number; y: number };
  scrollElements: { node: number; top: number; left: number }[];
};

export function buildEstablishBegin(
  generation: number,
  viewport: { width: number; height: number },
  scrollViewport: { x: number; y: number },
  scrollElements: { node: number; top: number; left: number }[] = [],
): EstablishBeginPayload {
  return { generation, viewport, scrollViewport, scrollElements };
}

export type EstablishChunkPayload = { bytes: Uint8Array };

export function buildEstablishChunk(bytes: Uint8Array): EstablishChunkPayload {
  return { bytes };
}

export type EstablishEndPayload = { nodeCount: number; checksum: number };

export function buildEstablishEnd(nodeCount: number, checksum: number): EstablishEndPayload {
  return { nodeCount, checksum };
}

export const ESTABLISH_CHUNK_BYTES_DEFAULT = 64 * 1024;

/**
 * Splits well-formed HTML into chunks at a `>` boundary at or before the byte
 * budget, so every prefix stays parseable (§5.6.3). Not a full HTML parser —
 * a best-effort boundary heuristic, sufficient because the whole stream is
 * still verified by `establishEnd.checksum` (§5.6.4).
 */
export function splitHtmlIntoChunks(html: string, chunkBytes: number = ESTABLISH_CHUNK_BYTES_DEFAULT): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let start = 0;
  while (start < html.length) {
    let lo = start + 1;
    let hi = html.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (encoder.encode(html.slice(start, mid)).length <= chunkBytes) lo = mid;
      else hi = mid - 1;
    }
    let end = lo;
    if (end < html.length) {
      const boundary = html.lastIndexOf('>', end);
      if (boundary > start) end = boundary + 1;
    }
    if (end <= start) end = Math.min(start + 1, html.length);
    chunks.push(html.slice(start, end));
    start = end;
  }
  return chunks;
}

// ---------------------------------------------------------------- §5.6.4 checksum

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Simple FNV-1a accumulator over the establish node stream (tag order + count), per §5.6.4. */
export class EstablishChecksum {
  private hash = FNV_OFFSET_BASIS;
  private count = 0;

  addNode(tag: string): void {
    this.count += 1;
    for (let i = 0; i < tag.length; i++) {
      this.hash ^= tag.charCodeAt(i);
      this.hash = Math.imul(this.hash, FNV_PRIME);
    }
    this.hash ^= this.count & 0xff;
    this.hash = Math.imul(this.hash, FNV_PRIME);
  }

  get nodeCount(): number {
    return this.count;
  }

  get checksum(): number {
    return this.hash >>> 0;
  }
}

export function computeEstablishChecksum(tags: Iterable<string>): { nodeCount: number; checksum: number } {
  const c = new EstablishChecksum();
  for (const tag of tags) c.addNode(tag);
  return { nodeCount: c.nodeCount, checksum: c.checksum };
}

/**
 * Browser-identical establish verify walk — must match client
 * `PageProjectionRegistry.buildFromDocument` (anchored elements only, skip
 * `data-pp-cssom-id`, no `instanceof`). Used after serialize so HTML parser
 * fixups cannot desync PP-EST-7.
 */
export const ESTABLISH_HTML_CHECKSUM_SCRIPT = `html => {
  const FNV_OFFSET_BASIS = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;
  let hash = FNV_OFFSET_BASIS;
  let count = 0;
  const addTag = (tag) => {
    count += 1;
    for (let i = 0; i < tag.length; i++) {
      hash ^= tag.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
    hash ^= count & 0xff;
    hash = Math.imul(hash, FNV_PRIME);
  };
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  document.documentElement.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) return { nodeCount: 0, checksum: 0 };
    doc.open();
    doc.write(html);
    doc.close();
    const walk = (node) => {
      if (node.nodeType !== 1) return;
      if (node.hasAttribute && node.hasAttribute('data-pp-cssom-id')) return;
      const raw = node.getAttribute && node.getAttribute('speculum-anchor');
      if (raw) {
        const id = Number(raw);
        if (Number.isInteger(id) && id > 0) addTag(node.tagName.toLowerCase());
      }
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) walk(children[i]);
    };
    if (doc.documentElement) walk(doc.documentElement);
    return { nodeCount: count, checksum: hash >>> 0 };
  } finally {
    iframe.remove();
  }
}`;

// ---------------------------------------------------------------- §5.6.6 establish↔live handoff

export type EstablishHandoffPhase = 'idle' | 'accumulate' | 'snapshot' | 'emitAfterEnd';

export type EstablishHandoffState<TFrame> = {
  phase: EstablishHandoffPhase;
  pendingFrames: TFrame[];
};

export function createEstablishHandoff<TFrame>(): EstablishHandoffState<TFrame> {
  return { phase: 'idle', pendingFrames: [] };
}

/** §5.6.6.a — open the epoch and begin accumulating live frames before the walk starts. */
export function openEstablishEpoch<TFrame>(state: EstablishHandoffState<TFrame>): void {
  state.phase = 'accumulate';
  state.pendingFrames = [];
}

/**
 * A live frame produced while establish is in flight. Returns false (and
 * drops nothing on the floor — the caller must not have called this at all)
 * when no establish epoch is open, so a mutation is never silently lost.
 */
export function accumulateDuringEstablish<TFrame>(
  state: EstablishHandoffState<TFrame>,
  frame: TFrame,
): boolean {
  if (state.phase !== 'accumulate' && state.phase !== 'snapshot') return false;
  state.pendingFrames.push(frame);
  return true;
}

/** §5.6.6.b — the walk captured its snapshot; frames keep accumulating until `establishEnd`. */
export function markSnapshotTaken<TFrame>(state: EstablishHandoffState<TFrame>): void {
  if (state.phase === 'accumulate') state.phase = 'snapshot';
}

/** §5.6.6.c — after `establishEnd`, drain and emit the accumulated frames in `sequence` order. */
export function drainForEmitAfterEnd<TFrame>(state: EstablishHandoffState<TFrame>): TFrame[] {
  state.phase = 'emitAfterEnd';
  const frames = state.pendingFrames;
  state.pendingFrames = [];
  state.phase = 'idle';
  return frames;
}
