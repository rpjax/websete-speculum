# ContextBus

**Status:** **SEALED** (2026-08-23). Name **LOCKED**: `ContextBus`.  
**Law:** this file is the transport contract. Code is a **deterministic reflection** of this file — two correct implementations must be behaviourally interchangeable for the same inputs.  
**Index:** [README.md](README.md). Consumers: [multi-document.md](multi-document.md), [input-unified-design-draft.md](input-unified-design-draft.md) (temporary).  
**Supersedes (as foundation):** ad-hoc Control/Loose types in `projectionBus.ts` as the *transport* model. Multi-doc intent (RPC vs fan-out, heartbeat, TCS) **survives** as `invoke` / `emit` behaviour here.

---

## 0. One-liner

**ContextBus** is a dumb JS transport between browsing contexts on one fabric. It routes envelopes and delivers `emit` (fire-and-forget) and `invoke` (awaitable RPC with heartbeat). It does not know scroll, input, mint, frames, or the sidecar.

---

## 1. Topic queue

| Topic | State |
|-------|--------|
| Name `ContextBus` / `IContextBus` | **LOCKED** |
| Transport-only (no domain) | **LOCKED** |
| Envelope `{ channel, source, destination, type, event }` | **LOCKED** (CB-06: `channel` required) |
| Separate registries: events vs invocations | **LOCKED** (§6.2) |
| `emit` / `onEvent` | **LOCKED** |
| `invoke` / `onInvocation` + transport protocol | **LOCKED** |
| Reserved transport `type` strings | **LOCKED** |
| `invoke` unicast only (never `*`) | **LOCKED** (CB-12) |
| `emit` destination required (no default) | **LOCKED** (CB-01) |
| Broadcast excludes self | **LOCKED** (CB-02) |
| `invocationId` = u32 monotonic per source | **LOCKED** (CB-03) |
| Idle 2000ms / heartbeat 500ms / no max wall | **LOCKED** (CB-04) |
| Missing handler → `no_handler` response (no `started`) | **LOCKED** (CB-05) |
| `invoke` to self = local short-circuit | **LOCKED** (CB-07) |
| Multiple `onEvent`, registration order | **LOCKED** (CB-08) |
| Non-cloneable → throw | **LOCKED** (CB-09) |
| Second `onInvocation` → replace | **LOCKED** (CB-10) |
| Duplicate unicast: carrier MUST NOT + dest dedupe | **LOCKED** (CB-11) |
| Reserved destination **`CONTEXT_BUS_RUNTIME`** | **LOCKED** (CB-13) |
| Carrier hop wiring | **IMPL** + invariants (§9) |
| Legacy `ProjectionBus` cutover | **OUT OF SEAL SCOPE** |

---

## 2. What this file is (and is not)

**Is:** inter-context transport contract, TypeScript surface, receive/dispatch algorithms, failure modes.

**Is not:** context registry, scroll census, `getScopeId`/`mint`, frame bytes, input Applier, session MessagePack, sidecar. Those **use** ContextBus with domain `type` / `name` strings.

---

## 3. Responsibilities

| Does | Does not |
|------|----------|
| Validate and route envelopes | Interpret domain payloads |
| `emit` / `onEvent` | Own context registry or mint document ids |
| `invoke` / `onInvocation` (TCS, heartbeat, response) | Know scroll / input / frames |
| try/catch around invocation handlers | Choose domain retry policy |
| Drop malformed envelopes (§10) | Guarantee delivery if target context is gone |

**Identity:**

- Each **document/algorithm** bus instance exposes `contextId` (= that context’s `mine`), range **`1 … CONTEXT_ID_MAX_DOCUMENT`** (`0xFFFFFFFE`).
- **`0` is never a valid** `source` / `destination` id.
- **Root runtime** is addressed as **`CONTEXT_BUS_RUNTIME = 0xFFFFFFFF`** (**LOCKED** CB-13). Never minted as a document id. Mint counter must not allocate this value.
- The root heap’s bus implementation **answers** both: its document `contextId` (normally `1`) **and** `CONTEXT_BUS_RUNTIME` (same process/facade — routing treats RUNTIME as local to the root carrier endpoint).

---

## 4. Envelope

```ts
/** LOCKED CB-13 — never mint as document contextId. */
export const CONTEXT_BUS_RUNTIME = 0xffff_ffff as const;
/** Max mintable / document contextId (inclusive). */
export const CONTEXT_ID_MAX_DOCUMENT = 0xffff_fffe as const;

export type BusDestination = '*' | number;
// number: document contextId in 1…CONTEXT_ID_MAX_DOCUMENT, or CONTEXT_BUS_RUNTIME

export type BusEnvelope<TType extends string = string, TEvent = unknown> = {
  /** Multiplex flag — LOCKED CB-06. Ignore carrier messages without this. */
  channel: typeof CONTEXT_BUS_CHANNEL;
  /** Emitting document contextId, or CONTEXT_BUS_RUNTIME when runtime emits. */
  source: number;
  /** `*` = broadcast; else unicast (document id or CONTEXT_BUS_RUNTIME). */
  destination: BusDestination;
  /**
   * Domain event name, OR reserved transport-protocol type (§5).
   * Not the invocation *name* (that is inside request-invocation.event.name).
   */
  type: TType;
  /** Structured-clone-safe across heaps (CB-09). */
  event: TEvent;
};

/** LOCKED CB-06 */
export const CONTEXT_BUS_CHANNEL = 'speculum.context.bus' as const;
```

**LOCKED fields:** `channel`, `source`, `destination`, `type`, `event`.

### 4.1 Validation (normative)

Malformed if any of:

- missing `channel` or `channel !== CONTEXT_BUS_CHANNEL`
- `source` / unicast `destination` not in  
  `{1…CONTEXT_ID_MAX_DOCUMENT} ∪ {CONTEXT_BUS_RUNTIME}`
- `destination` neither `'*'` nor an allowed id
- `type` not a non-empty string
- `event` missing (`null` allowed as empty body)

**Malformed → drop silently.**

### 4.2 `channel` (**LOCKED** CB-06)

Carrier multiplex discriminator (same role as today’s `speculum.projection.bus` tag on `postMessage`). Not a domain concept.

- Every envelope **must** carry `channel: CONTEXT_BUS_CHANNEL`.
- Inbound carrier messages without this exact value → **ignore**.

---

## 5. Transport-protocol types (reserved)

```ts
export type TransportProtocolType =
  | 'request-invocation'
  | 'invocation-started'
  | 'invocation-heartbeat'
  | 'invocation-response';

export type InvocationId = number; // u32 monotonic per source bus — LOCKED CB-03

export type RequestInvocationEvent = {
  invocationId: InvocationId;
  name: string;
  args: unknown;
};

export type InvocationStartedEvent = { invocationId: InvocationId };
export type InvocationHeartbeatEvent = { invocationId: InvocationId };

export type InvocationResponseEvent = {
  invocationId: InvocationId;
  result?: unknown;
  error?: BusErrorPayload;
};

export type BusErrorPayload = {
  message: string;
  name?: string;
};
```

Domain must not `onEvent` these `type`s. Transport envelopes are always **unicast**.

`allocInvocationId()`: per source instance, monotonic `u32`, skip 0, wrap carefully (OPEN detail: wrap to 1 after `0xFFFFFFFF`).

---

## 6. Public API

```ts
export type BusDeliveryMeta = {
  source: number;
  destination: BusDestination;
  type: string;
};

export type BusEventHandler<T = unknown> = (
  event: T,
  meta: BusDeliveryMeta,
) => void | Promise<void>;

export type BusInvocationHandler<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
  meta: BusDeliveryMeta,
) => TResult | Promise<TResult>;

export type EmitOptions = {
  /** Required — LOCKED CB-01. */
  destination: BusDestination;
};

export type InvokeOptions = {
  /** Unicast only — LOCKED CB-12. Document id or CONTEXT_BUS_RUNTIME. */
  destination: number;
  /** Idle timeout; default DEFAULT_INVOKE_IDLE_TIMEOUT_MS (CB-04). */
  timeoutMs?: number;
};

export type InvokeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BusErrorPayload };

export const DEFAULT_INVOKE_IDLE_TIMEOUT_MS = 2000;
export const HEARTBEAT_INTERVAL_MS = 500;
/** Seen-set TTL for request-invocation dedupe (CB-11). */
export const INVOKE_DEDUPE_TTL_MS = 5000;

export interface IContextBus {
  /** Document contextId for this heap’s algorithm instance (`1…CONTEXT_ID_MAX_DOCUMENT`). */
  readonly contextId: number;
  /**
   * True on the root-heap bus that also serves CONTEXT_BUS_RUNTIME.
   * Nested document buses: false.
   */
  readonly servesRuntime: boolean;

  emit<T = unknown>(type: string, event: T, opts: EmitOptions): void;

  invoke<TArgs = unknown, TResult = unknown>(
    name: string,
    args: TArgs,
    opts: InvokeOptions,
  ): Promise<InvokeResult<TResult>>;

  onEvent<T = unknown>(type: string, handler: BusEventHandler<T>): () => void;

  onInvocation<TArgs = unknown, TResult = unknown>(
    name: string,
    handler: BusInvocationHandler<TArgs, TResult>,
  ): () => void;

  dispose(): void;
}
```

### 6.1 Semantics

| API | Notes |
|-----|--------|
| `emit` | `opts.destination` **required**; omit → **throw** `TypeError` (CB-01). Fire-and-forget — **no** awaiter / result. |
| `onEvent` | Many handlers per type, registration order (CB-08). Bus does not await handler Promises; rejections **swallowed**. |
| `invoke` | Never `destination: '*'`; bad dest → **throw**. Domain failures → `{ ok: false }`. Await is **event/TCS-based** (idle timeout + response); does **not** imply a blocked JS thread or serialized invokes — many invokes may be in flight. |
| `onInvocation` | One handler per `name`; second call **replaces** (CB-10) |

**Non-normative for domain authors (see input draft D-UI-29/30):** ContextBus has **no** domain words. Domain APIs (e.g. projection `emitFrame`) are a separate vocabulary; their implementation chooses `bus.emit` vs `bus.invoke` only by whether a **result** is needed. Hot-path volume alone does not forbid `invoke`.

### 6.2 Two namespaces (**LOCKED**)

Events (`emit`/`onEvent` by `type`) ≠ invocations (`invoke`/`onInvocation` by `name`). No collision.

### 6.3 `dispose` (**LOCKED**)

1. Clear all handlers.  
2. Pending local invokes → `{ ok: false, error: { message: 'bus_disposed', name: 'BusDisposed' } }`.  
3. Drop inbound; detach carrier.  
4. In-flight destination handlers: still attempt `invocation-response`; else source idle-timeouts.

---

## 7. `emit` algorithm (normative)

```text
emit(type, event, opts):
  if opts missing or opts.destination missing → throw TypeError     // CB-01
  if type is TransportProtocolType or empty → throw TypeError
  if destination === '*'
    recipients = all fabric participants EXCEPT self                 // CB-02
  else
    recipients = [destination]  // unicast route §9
  if not structuredClone-safe(event) → throw DataCloneError|TypeError  // CB-09
  envelope = { channel: CONTEXT_BUS_CHANNEL, source: this.contextId, destination, type, event }
  deliver(envelope)
```

Local dispatch when this instance is a recipient:

```text
for handler in eventHandlers[type] in registration order:
  try
    ret = handler(event, meta)
    if Promise → void ret.catch(() => {})
  catch → swallow
```

---

## 8. `invoke` algorithm (normative)

### 8.1 Source

```text
invoke(name, args, opts):
  if name empty → throw TypeError
  if opts.destination missing or === '*' or invalid id → throw TypeError
  if opts.destination === this.contextId
     OR (opts.destination === CONTEXT_BUS_RUNTIME AND this.servesRuntime):
       → LOCAL_INVOKE (CB-07) …
       handler = invocationHandlers.get(name)
       if !handler → return { ok: false, error: { message: 'no_handler', name: 'NoInvocationHandler' } }
       try return { ok: true, value: await handler(args, meta) }
       catch err → return { ok: false, error: serialize(err) }
       // no envelopes, no heartbeat
  invocationId = allocInvocationId()
  timeoutMs = opts.timeoutMs ?? DEFAULT_INVOKE_IDLE_TIMEOUT_MS
  pending.set(invocationId, TCS + idleTimer(timeoutMs))
  send request-invocation { invocationId, name, args } → destination
  on started|heartbeat (matching id): resetIdleTimer(timeoutMs)
  on response (matching id): clear; resolve ok/result or ok/error (exactly one)
  on idle timeout: resolve { ok: false, error: { message: 'timeout', name: 'InvokeTimeout' } }
  late response after settle: drop
```

### 8.2 Destination

```text
on request-invocation addressed to this id:
  handler = invocationHandlers.get(name)
  if !handler:
    send invocation-response {
      invocationId,
      error: { message: 'no_handler', name: 'NoInvocationHandler' }
    } → source
    // NO invocation-started — LOCKED CB-05
    return
  send invocation-started → source
  every HEARTBEAT_INTERVAL_MS until settled: send invocation-heartbeat → source
  try
    value = await handler(args, meta)
    stop heartbeat; send response { result: value }
  catch err
    stop heartbeat; send response { error: serialize(err) }
```

`serialize`: `Error` → `{ message, name }`; else `{ message: String(err) }`; **no stack**.

### 8.3 Response shape (**LOCKED**)

Exactly one of `result` | `error`.

### 8.4 Idle / heartbeat (**LOCKED** CB-04)

| | |
|--|--|
| Idle | Source: no started/heartbeat/response for `timeoutMs` → timeout |
| Reset | Any of those three for this `invocationId` |
| Heartbeat | Destination while handler not settled, every 500ms |
| Max wall | None in v1 |

### 8.5 Concurrent + reentrancy (**LOCKED**)

Many outstanding invokes (by `invocationId`). `invoke` from inside a handler allowed; cycles are domain’s problem.

---

## 9. Routing invariants

### 9.1 Unicast

Deliver to the participant whose id equals `destination`.

**Duplicate delivery (**LOCKED** CB-11) — defense in depth:**

1. **Carrier MUST NOT** deliver the same logical send twice. Retries, if any, are a carrier bug.
2. **Destination MUST** best-effort dedupe inbound **`request-invocation`** by key `(source, invocationId)`:
   - First sight → process (§8.2).
   - Duplicate while primary still in-flight or already completed recently → **drop** (do not run handler again; do not send a second response).
3. Retention window for the seen-set: **PROPOSED** `max(2 * DEFAULT_INVOKE_IDLE_TIMEOUT_MS, 5000)` ms after terminal response or drop; exact constant **LOCKED** as `INVOKE_DEDUPE_TTL_MS = 5000`.
4. Domain `emit` unicasts are **not** required to dedupe (no id); duplicate domain events may fire handlers twice — domain protocols that need idempotency carry their own ids.

### 9.2 Broadcast `*`

Every participant **except** the emitter (CB-02). Never used for transport-protocol types.

### 9.3 Transport replies

Unicast to request `source` only.

### 9.4 Carrier

Missing/wrong `channel` → ignore message (CB-06).

---

## 10. Receive

```text
receive(envelope):
  if malformed → drop
  addressedHere =
    envelope.destination === '*'
    OR envelope.destination === this.contextId
    OR (envelope.destination === CONTEXT_BUS_RUNTIME AND this.servesRuntime)
  if not addressedHere
    → forward or drop (carrier)
  if type is TransportProtocolType → handleTransport
  else → onEvent dispatch
```

---

## 11. Programming errors vs `InvokeResult`

| Situation | Behaviour |
|-----------|-----------|
| Reserved type / empty name / missing emit dest / invoke `*` | **throw** |
| Handler throw / timeout / no_handler / disposed | `{ ok: false, … }` |
| Event handler throw | swallow |

---

## 12. Decision sheet — all CLOSED

| ID | LOCKED |
|----|--------|
| **CB-12** | `invoke` never `'*'` |
| **CB-01** | `emit` destination **required**; absent → throw |
| **CB-02** | Broadcast **excludes** self |
| **CB-03** | `invocationId` = u32 monotonic per source |
| **CB-04** | idle 2000ms, heartbeat 500ms, no max wall |
| **CB-05** | no handler → `no_handler` response, no `started` |
| **CB-06** | `channel: 'speculum.context.bus'` **required** |
| **CB-07** | self-invoke / runtime-local = short-circuit |
| **CB-08** | many `onEvent`, registration order |
| **CB-09** | non-cloneable → throw |
| **CB-10** | second `onInvocation` → replace |
| **CB-11** | Carrier MUST NOT duplicate; dest dedupe `(source, invocationId)`; TTL 5000ms |
| **CB-13** | `CONTEXT_BUS_RUNTIME = 0xFFFFFFFF`; never minted; root bus `servesRuntime` |

---

## 13. Relation to multi-document.md

Transport → this file. Multi-doc keeps mint, indexer, emitFrame ownership, resync Control-plane entry. **Mint must not allocate `CONTEXT_BUS_RUNTIME`.** Amend multi-doc §4 to point here (wording cleanup).

---

## 14. SEAL checklist

- [x] CB-01…CB-13 answered
- [x] Topic queue clear of OPEN (cutover OUT OF SCOPE; carrier IMPL)
- [x] decision-log.md index → SEALED
- [x] No domain types in this file

---

## 15. Decision log (this file)

| Date | Note |
|------|------|
| 2026-08-23 | Name LOCKED. Transport-only LOCKED. Split from input draft. |
| 2026-08-23 | Gap pass + CB-01…CB-12 sheet. |
| 2026-08-23 | LOCKED: CB-01,02,03,04,05,07,08,09,10,12. Clarified channel + duplicate unicast. Added CB-13. |
| 2026-08-23 | LOCKED CB-06 (`channel` required). LOCKED CB-11 (carrier MUST NOT + dest dedupe TTL 5000ms). |
| 2026-08-23 | **SEALED.** LOCKED CB-13 `CONTEXT_BUS_RUNTIME = 0xFFFFFFFF`; `servesRuntime` on root bus. |
| 2026-08-23 | Clarify: `invoke` await = event/TCS (parallel OK); bus has no domain semantics. Domain `emitFrame` ≠ `bus.emit` (see input draft D-UI-29/30). |
