# Implementation — Channel (page ↔ Node binary push)

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/channel.ts` |
| **LOC ceiling** | 200 |
| **Contracts implemented** | [04-wire.md](../../contracts/04-wire.md), [07-recovery.md](../../contracts/07-recovery.md) (delivery path); redesign §4 channel; D-SPEC-2 |
| **Invariants** | Page pushes opaque binary parts to Node; never `page.evaluate` for bulk frame bodies. Control messages (rate, forceFlush) are small and separate from frame parts. Node receives → rewrite → mirror → relay. |
| **Ban list** | Fetching frame bodies via `evaluate` returning JSON/strings of the tree. Re-entering JSON ferry. Dropping parts under congestion (degrade rate instead). Parsing API responsibilities in channel. |

---

## Types / signatures

```ts
/** Injected into page; uses Binding / CDP Transfer / MessagePort as chosen binding. */
interface InPageChannel {
  /** Transfer or copy Uint8Array part bytes to Node. */
  pushPart(bytes: Uint8Array): void;
  /** Optional: zero-copy transfer list when binding supports it. */
  pushPartTransfer(bytes: Uint8Array): void;
}

/** Node side. */
interface NodeChannel {
  start(page: PageLike, handlers: ChannelHandlers): Promise<void>;
  stop(): Promise<void>;
  sendRate(msg: RateMessage): Promise<void>;
  sendForceFlush(): Promise<void>;
}

interface ChannelHandlers {
  onPart(bytes: Uint8Array): void;       // establish or live part
  onProducerFault(err: ChannelFault): void;
}

interface ChannelFault {
  errorCode: string;
  phase: 'encode' | 'channel';
  message: string;
}
```

---

## Transport selection (normative constraints)

Allowed mechanisms (pick one primary; document in code comments):

1. **Playwright/Patchright `page.exposeBinding` / CDP `Runtime.binding`** receiving `ArrayBuffer` / base64 — prefer ArrayBuffer.
2. **CDP `DOM`/`Runtime` raw binary binding** if available without stringifying.
3. **WebSocket to local sidecar sidecar-loopback** only if binding cannot carry binary — still no JSON tree.

MUST NOT: `page.evaluate(() => JSON.stringify(frame))`.

Chunking of frames into parts is encode’s job; channel pushes each part as one message.

---

## Step-by-step — Node `start`

1. Install binding named stably e.g. `__speculumPushFramePart`.
2. On each call: validate `bytes` non-empty; update `lastFrameReceivedAt`; invoke `onPart(bytes)`.
3. Install control evaluate functions or bindings for rate/forceFlush consumed by in-page clock.
4. Wire activity signals (network, CDP) to watchdog timestamps in orchestration.

### `onPart` pipeline (orchestration calls, not all in this file)

1. [node-rewrite.md](node-rewrite.md) — decode string table, rewrite URLs, re-encode once.
2. [node-mirror.md](node-mirror.md) — apply rewritten ops to flat mirror.
3. Relay opaque rewritten bytes to API (header fields readable).

### Establish hold

During establish epoch, in-page may push establish parts immediately and buffer live parts until end — **or** push all and Node holds live until establishEnd seen. Prefer **in-page hold** (establish.md) so Node mirror applies establish first.

---

## Backpressure signal

If Node outbound queue / mirror apply lags:

1. Signal rate policy congestion ([clock.md](clock.md)).
2. MUST NOT drop parts.
3. MAY delay ACK if binding has flow control; page encode still produces at clock rate into a bounded in-page queue — if in-page queue exceeds soft limit, mark congestion for rate degrade (still no drop of committed frames).

---

## Resync

Resync stream is produced from Node mirror serialize — **page channel not involved** for body production (PP-REC-2). Channel may still carry live frames that client buffers while desynced.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-WIRE-3` | No JSON tree on channel |
| `PP-WIRE-1` | Bodies opaque end-to-end past rewrite |
| `PP-FR-7` | Stall detection uses last part time |
| `PP-LOAD-1..2` | Congestion → rate down; QueueDropped=0 |
| `PP-REC-2` | Resync not page-produced |
