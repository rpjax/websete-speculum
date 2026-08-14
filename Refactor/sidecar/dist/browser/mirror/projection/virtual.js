"use strict";
(() => {
  // browser/mirror/projection/virtual/clock/timerFrameClock.ts
  var FRAME_RATE_LADDER = [60, 30, 15, 5];
  var DEFAULTS = {
    frameRateHz: 60,
    hiddenRateHz: 1,
    rateRecoverMs: 5e3,
    frameStallMs: 1e3
  };
  var TimerFrameClock = class {
    onBoundary = null;
    timerId = null;
    running = false;
    nextDeadlineMs = 0;
    lastTickAtMs;
    currentRateHz;
    topRateHz;
    lastRecoverAtMs = 0;
    hidden = false;
    stallWatchId = null;
    nowFn;
    opts;
    constructor(opts = {}) {
      this.opts = opts;
      this.nowFn = opts.now ?? (() => performance.now());
      this.topRateHz = opts.frameRateHz ?? DEFAULTS.frameRateHz;
      this.currentRateHz = this.topRateHz;
      this.lastTickAtMs = this.nowFn();
    }
    get rateHz() {
      return this.currentRateHz;
    }
    get isHidden() {
      return this.hidden;
    }
    now() {
      return this.nowFn();
    }
    start(onBoundary) {
      this.onBoundary = onBoundary;
      this.running = true;
      this.nextDeadlineMs = this.nowFn() + this.periodMs();
      this.arm();
      this.armStallWatch();
    }
    stop() {
      this.running = false;
      this.clearTimer();
      this.clearStallWatch();
    }
    setRateHz(hz) {
      this.setRateHzWithReason(hz, "config");
    }
    setHidden(hidden) {
      this.hidden = hidden;
      if (hidden) this.setRateHzWithReason(this.opts.hiddenRateHz ?? DEFAULTS.hiddenRateHz, "hidden");
      else this.setRateHzWithReason(this.topRateHz, "hidden");
    }
    degrade() {
      if (this.hidden) return;
      const ladder = this.opts.rateLadder ?? FRAME_RATE_LADDER;
      const idx = ladder.indexOf(this.currentRateHz);
      const nextIdx = idx === -1 ? 0 : Math.min(idx + 1, ladder.length - 1);
      this.setRateHzWithReason(ladder[nextIdx], "degrade");
    }
    recoverStep() {
      if (this.hidden) return false;
      const now = this.nowFn();
      const recoverMs = this.opts.rateRecoverMs ?? DEFAULTS.rateRecoverMs;
      if (now - this.lastRecoverAtMs < recoverMs) return false;
      const ladder = this.opts.rateLadder ?? FRAME_RATE_LADDER;
      const idx = ladder.indexOf(this.currentRateHz);
      if (idx <= 0) return false;
      this.setRateHzWithReason(ladder[idx - 1], "recover");
      this.lastRecoverAtMs = now;
      return true;
    }
    checkStall() {
      const now = this.nowFn();
      const stallMs = this.opts.frameStallMs ?? DEFAULTS.frameStallMs;
      const sinceLastTickMs = now - this.lastTickAtMs;
      if (sinceLastTickMs < stallMs) return false;
      this.opts.onStall?.({ sinceLastTickMs });
      this.forceBoundary();
      return true;
    }
    forceBoundary() {
      this.lastTickAtMs = this.nowFn();
      this.onBoundary?.();
    }
    setRateHzWithReason(hz, reason) {
      if (hz <= 0 || hz === this.currentRateHz) return;
      const fromHz = this.currentRateHz;
      this.currentRateHz = hz;
      this.opts.onRateChanged?.({ fromHz, toHz: hz, reason });
      if (!this.running) return;
      this.clearTimer();
      this.nextDeadlineMs = this.nowFn() + this.periodMs();
      this.arm();
    }
    armStallWatch() {
      this.clearStallWatch();
      this.stallWatchId = setInterval(() => this.checkStall(), 500);
    }
    clearStallWatch() {
      if (this.stallWatchId !== null) {
        clearInterval(this.stallWatchId);
        this.stallWatchId = null;
      }
    }
    periodMs() {
      return 1e3 / this.currentRateHz;
    }
    clearTimer() {
      if (this.timerId !== null) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
    }
    arm() {
      if (!this.running) return;
      const delay = Math.max(0, this.nextDeadlineMs - this.nowFn());
      this.timerId = setTimeout(() => this.onTimer(), delay);
    }
    onTimer() {
      this.timerId = null;
      if (!this.running) return;
      const now = this.nowFn();
      this.lastTickAtMs = now;
      const period = this.periodMs();
      this.nextDeadlineMs += period;
      if (this.nextDeadlineMs < now) {
        this.nextDeadlineMs = now + period;
      }
      this.onBoundary?.();
      this.arm();
    }
  };

  // browser/mirror/projection/models/telemetry.ts
  var DEFAULT_TELEMETRY_CONFIG = {
    enabled: false,
    frameEmitted: true,
    transportDeferred: true,
    aggregate: true,
    applyResult: true,
    desync: true,
    applyOverrun: true,
    clock: true,
    aggregateIntervalMs: 1e4
  };
  var TELEMETRY_BOOL_CAPS = [
    "enabled",
    "frameEmitted",
    "transportDeferred",
    "aggregate",
    "applyResult",
    "desync",
    "applyOverrun",
    "clock"
  ];

  // browser/mirror/projection/virtual/config/projectionConfig.ts
  var PROJECTION_CONFIG_GLOBAL = "__SPECULUM_PROJECTION__";
  var DEFAULTS2 = {
    transport: "loopback",
    frameRateHz: 60,
    bufferedAmountWatermark: 256 * 1024,
    maxFrameBytes: 1 << 20
  };
  var cached;
  function asPositiveNumber(value, fallback, label) {
    if (value === void 0 || value === null) return fallback;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`ProjectionConfig.${label} must be a positive number (got ${String(value)})`);
    }
    return n;
  }
  function asTransport(value) {
    if (value === void 0 || value === null) return DEFAULTS2.transport;
    if (value === "console" || value === "loopback" || value === "discard") return value;
    throw new Error(
      `ProjectionConfig.transport must be "console" | "loopback" | "discard" (got ${String(value)})`
    );
  }
  function asBool(value, fallback) {
    if (value === void 0 || value === null) return fallback;
    if (typeof value === "boolean") return value;
    throw new Error(`ProjectionConfig.telemetry field must be boolean (got ${String(value)})`);
  }
  function resolveTelemetry(raw) {
    if (raw === void 0 || raw === null) {
      return { ...DEFAULT_TELEMETRY_CONFIG };
    }
    if (typeof raw !== "object") {
      throw new Error("ProjectionConfig.telemetry must be an object");
    }
    const bag = raw;
    const resolved = { ...DEFAULT_TELEMETRY_CONFIG };
    for (const key of TELEMETRY_BOOL_CAPS) {
      resolved[key] = asBool(bag[key], DEFAULT_TELEMETRY_CONFIG[key]);
    }
    resolved.aggregateIntervalMs = asPositiveNumber(
      bag.aggregateIntervalMs,
      DEFAULT_TELEMETRY_CONFIG.aggregateIntervalMs,
      "telemetry.aggregateIntervalMs"
    );
    return resolved;
  }
  function readProjectionConfig() {
    if (cached !== void 0) return cached;
    const raw = globalThis.__SPECULUM_PROJECTION__;
    if (raw === void 0 || raw === null || typeof raw !== "object") {
      throw new Error(
        `ProjectionConfig missing: inject buildConfigPreScript() before virtual.js (expected globalThis.${PROJECTION_CONFIG_GLOBAL})`
      );
    }
    const bag = raw;
    const transport = asTransport(bag.transport);
    const dataPlaneUrl = typeof bag.dataPlaneUrl === "string" ? bag.dataPlaneUrl.trim() : "";
    if (transport === "loopback" && dataPlaneUrl.length === 0) {
      throw new Error('ProjectionConfig.dataPlaneUrl is required when transport is "loopback"');
    }
    const resolved = {
      transport,
      dataPlaneUrl,
      frameRateHz: asPositiveNumber(bag.frameRateHz, DEFAULTS2.frameRateHz, "frameRateHz"),
      bufferedAmountWatermark: asPositiveNumber(
        bag.bufferedAmountWatermark,
        DEFAULTS2.bufferedAmountWatermark,
        "bufferedAmountWatermark"
      ),
      maxFrameBytes: asPositiveNumber(bag.maxFrameBytes, DEFAULTS2.maxFrameBytes, "maxFrameBytes"),
      telemetry: Object.freeze(resolveTelemetry(bag.telemetry)),
      generation: asPositiveNumber(bag.generation, 1, "generation")
    };
    cached = Object.freeze(resolved);
    return cached;
  }

  // browser/mirror/projection/virtual/dom/mutationBuffer.ts
  var MutationBuffer = class {
    records = [];
    push(batch) {
      for (let i = 0; i < batch.length; i++) this.records.push(batch[i]);
    }
    hasWork() {
      return this.records.length > 0;
    }
    /** Freezes and clears the buffer; returns what was pending. */
    drain() {
      if (this.records.length === 0) return this.records;
      const out = this.records;
      this.records = [];
      return out;
    }
    /** Pushes records back to the front (build failed / needs retry next tick). */
    reclaim(records) {
      if (records.length === 0) return;
      this.records = records.concat(this.records);
    }
  };

  // browser/mirror/projection/virtual/dom/domMutationObserver.ts
  var OBSERVE_OPTIONS = {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true
  };
  var DomMutationObserver = class {
    buffer;
    root;
    observer = null;
    constructor(opts) {
      this.buffer = opts.buffer;
      this.root = opts.root ?? document;
    }
    start() {
      this.stop();
      this.observer = new MutationObserver((records) => this.buffer.push(records));
      this.observer.observe(this.root, OBSERVE_OPTIONS);
    }
    stop() {
      this.observer?.disconnect();
      this.observer = null;
    }
    /** Test hook: feed records without a live MutationObserver. */
    ingestForTest(records) {
      this.buffer.push(records);
    }
  };

  // browser/mirror/projection/models/domNodeKey.ts
  var NONE_DOM_NODE_KEY = 0;

  // browser/mirror/projection/virtual/dom/domNodeTable.ts
  var DomNodeTable = class {
    byNode = /* @__PURE__ */ new WeakMap();
    byKey = /* @__PURE__ */ new Map();
    finalizers;
    nextKey = 1;
    currentGeneration = 1;
    constructor() {
      this.finalizers = new FinalizationRegistry((key) => {
        const ref = this.byKey.get(key);
        if (ref !== void 0 && ref.deref() === void 0) {
          this.byKey.delete(key);
        }
      });
    }
    get generation() {
      return this.currentGeneration;
    }
    /**
     * Bootstrap-only initialization (Stage 3, frame-protocol-production-completeness): a hard
     * navigation re-injects this whole script into a fresh JS realm, so the *identity map* is
     * already empty by construction — there is nothing to clear here, unlike `bumpGeneration()`.
     * This exists purely so a fresh instance reports the `generation` the orchestrator
     * (`lab/virtualBrowser.ts`) already knows this navigation is (via `ProjectionConfig.generation`),
     * so `resyncVirtual`'s frame — and every ordinary tick after it — carries the right number for
     * `bootstrap.ts` to decide whether to prepend `EPOCH_RESET`.
     */
    setGeneration(generation) {
      this.currentGeneration = generation;
    }
    get size() {
      return this.byKey.size;
    }
    allocate(node) {
      const existing = this.byNode.get(node);
      if (existing !== void 0) return existing;
      const key = this.nextKey;
      this.nextKey += 1;
      this.byNode.set(node, key);
      this.byKey.set(key, new WeakRef(node));
      this.finalizers.register(node, key, node);
      return key;
    }
    /**
     * Forces a specific id (frame-protocol.md §1.2 — id `1` is reserved for `Document`, not
     * allocated like an ordinary node). Idempotent. Advances `nextKey` past `key` so ordinary
     * `allocate()` calls never collide with it.
     */
    bind(node, key) {
      if (this.byNode.has(node)) return;
      this.byNode.set(node, key);
      this.byKey.set(key, new WeakRef(node));
      this.finalizers.register(node, key, node);
      if (key >= this.nextKey) this.nextKey = key + 1;
    }
    keyOf(node) {
      return this.byNode.get(node) ?? NONE_DOM_NODE_KEY;
    }
    has(node) {
      return this.byNode.has(node);
    }
    get(key) {
      if (key === NONE_DOM_NODE_KEY) return void 0;
      const ref = this.byKey.get(key);
      if (ref === void 0) return void 0;
      const node = ref.deref();
      if (node === void 0) {
        this.byKey.delete(key);
        return void 0;
      }
      return node;
    }
    release(node) {
      const key = this.byNode.get(node);
      if (key === void 0) return;
      this.byNode.delete(node);
      this.byKey.delete(key);
      this.finalizers.unregister(node);
    }
    bumpGeneration() {
      this.byNode = /* @__PURE__ */ new WeakMap();
      this.byKey.clear();
      this.currentGeneration += 1;
      return this.currentGeneration;
    }
    /**
     * frame-protocol.md §5.8 `resyncVirtual` — clears the identity map so it can be rebuilt from a
     * live walk. Unlike `bumpGeneration()`, this does NOT advance `generation`: `resync` is a
     * same-generation "the client's copy is being replaced wholesale" signal, not an
     * `EPOCH_RESET`. `nextKey` is left untouched, so freshly (re)allocated ids never collide with
     * ids issued before the reset.
     */
    resetIdentity() {
      this.byNode = /* @__PURE__ */ new WeakMap();
      this.byKey.clear();
    }
    /** Live `[id, node]` pairs, skipping any key whose `WeakRef` has already been collected. */
    *liveEntries() {
      for (const [key, ref] of this.byKey) {
        const node = ref.deref();
        if (node !== void 0) yield [key, node];
      }
    }
  };

  // browser/mirror/projection/models/opcodes.ts
  var NAMES = {
    [1 /* Check */]: "check",
    [2 /* EpochReset */]: "epochReset",
    [3 /* StrDef */]: "strDef",
    [32 /* NodeNew */]: "nodeNew",
    [33 /* NodeDrop */]: "nodeDrop",
    [64 /* Insert */]: "insert",
    [65 /* Remove */]: "remove",
    [96 /* AttrSet */]: "attrSet",
    [97 /* AttrDel */]: "attrDel",
    [98 /* TextSet */]: "textSet"
  };
  function opCodeName(code) {
    return NAMES[code] ?? `unknown(${code})`;
  }

  // browser/mirror/projection/models/frame.ts
  var FRAME_WIRE_VERSION = 1;
  var DOCUMENT_ID = 1;
  var INSERT_AT_END = 0;
  var CHECK_SCOPE_TABLE = 0;
  function createFrame(args) {
    return {
      version: FRAME_WIRE_VERSION,
      flags: { resync: args.resync ?? false },
      generation: args.generation,
      sequence: args.sequence,
      preTableHash: args.preTableHash ?? 0n,
      ops: args.ops
    };
  }

  // browser/mirror/projection/models/rowHash.ts
  var FNV_OFFSET_BASIS = 14695981039346656037n;
  var FNV_PRIME = 1099511628211n;
  var MASK64 = 0xffffffffffffffffn;
  var sharedEncoder = new TextEncoder();
  function h64Bytes(bytes, seed = FNV_OFFSET_BASIS) {
    let h = seed;
    for (let i = 0; i < bytes.length; i++) {
      h ^= BigInt(bytes[i]);
      h = h * FNV_PRIME & MASK64;
    }
    return h;
  }
  function h64Str(value, seed = FNV_OFFSET_BASIS) {
    return h64Bytes(sharedEncoder.encode(value), seed);
  }
  function h64U32(value, seed = FNV_OFFSET_BASIS) {
    let h = seed;
    h ^= BigInt(value & 255);
    h = h * FNV_PRIME & MASK64;
    h ^= BigInt(value >>> 8 & 255);
    h = h * FNV_PRIME & MASK64;
    h ^= BigInt(value >>> 16 & 255);
    h = h * FNV_PRIME & MASK64;
    h ^= BigInt(value >>> 24 & 255);
    h = h * FNV_PRIME & MASK64;
    return h;
  }
  function addMod64(a, b) {
    return a + b & MASK64;
  }
  function subMod64(a, b) {
    return a - b & MASK64;
  }
  function hashName(name) {
    return h64Str(`\0N${name}`);
  }
  function hashValue(value) {
    return h64Str(`\0V${value}`);
  }
  function hashAttr(name, value) {
    return h64Str(`\0A${name}${value}`);
  }
  function computeRowHash(id, kind, parent, prevSibling, contentHash) {
    let h = h64U32(id);
    h = h64U32(kind, h);
    h = h64U32(parent, h);
    h = h64U32(prevSibling, h);
    h ^= contentHash;
    h = h * FNV_PRIME & MASK64;
    return h;
  }
  var TableHashTracker = class {
    total = 0n;
    rowHashes = /* @__PURE__ */ new Map();
    get value() {
      return this.total;
    }
    get size() {
      return this.rowHashes.size;
    }
    has(id) {
      return this.rowHashes.has(id);
    }
    upsert(id, newRowHash) {
      const old = this.rowHashes.get(id);
      if (old !== void 0) this.total = subMod64(this.total, old);
      this.rowHashes.set(id, newRowHash);
      this.total = addMod64(this.total, newRowHash);
    }
    remove(id) {
      const old = this.rowHashes.get(id);
      if (old === void 0) return;
      this.total = subMod64(this.total, old);
      this.rowHashes.delete(id);
    }
    clear() {
      this.total = 0n;
      this.rowHashes.clear();
    }
  };

  // browser/mirror/projection/models/replicatedTable.ts
  var NONE = 0;
  var ReplicatedTable = class {
    rows = /* @__PURE__ */ new Map();
    /** ELEMENT rows only — id -> attrName -> that attribute's own contentHash contribution. */
    attrHashes = /* @__PURE__ */ new Map();
    /** Derived, non-hashed: id -> the id currently linked immediately after it under the same parent. */
    nextSiblingOf = /* @__PURE__ */ new Map();
    /** Derived, non-hashed: parentId -> the id currently linked last under that parent (0 = none). */
    lastChildOf = /* @__PURE__ */ new Map();
    tracker = new TableHashTracker();
    /** Stamped onto every row `setRow` touches until changed again — one frame, one `lms` (§4 preamble). */
    currentSequence = 0;
    get tableHash() {
      return this.tracker.value;
    }
    /**
     * Call once per frame before applying its ops (producer: `tableFrameBuilder.ts`/`resync.ts`;
     * client: `replicatedTableApply.ts`) — every row touched by a subsequent op this pass stamps
     * `lms` with this value (§1.3/§4: "every instruction that touches a row sets that row's
     * `lms = sequence`"). Not part of `rowHash`/`tableHash` (§1.5) — diagnostics/GC only (§1.6).
     */
    setSequence(sequence) {
      this.currentSequence = sequence;
    }
    /** Row count — excludes the implicit, never-stored Document row (id 1). */
    get size() {
      return this.rows.size;
    }
    has(id) {
      return this.rows.has(id);
    }
    getRow(id) {
      return this.rows.get(id);
    }
    /**
     * §4.1 `CHECK.scope = 1` — Σ `rowHash` (mod 2^64) over ids in `[lo, hi]` inclusive. O(size),
     * not O(1): OPEN-3 resolves the *model* (id ranges over per-bucket partial sums) but its O(1)
     * bucket-maintenance mechanism is not built, and the v0 producer never emits `scope: 1` (only
     * resync's whole-table close, §5.8 step 4) — this exists so a client still decodes and
     * evaluates one correctly (P7: strict, not silently ignored) rather than leaving it unusable.
     */
    hashRange(lo, hi) {
      let sum = 0n;
      for (const [id, row] of this.rows) {
        if (id >= lo && id <= hi) sum = addMod64(sum, row.rowHash);
      }
      return sum;
    }
    /** Drops every row and derived index — `EPOCH_RESET` (§4.1) and resync's wholesale replace (§5.8). */
    reset() {
      this.rows.clear();
      this.attrHashes.clear();
      this.nextSiblingOf.clear();
      this.lastChildOf.clear();
      this.tracker.clear();
    }
    // ---- NODE_NEW (§4.2) — always creates a detached row (parent=0, prevSibling=0). ----
    createElementRow(id, tagName, attrs) {
      const attrMap = /* @__PURE__ */ new Map();
      let sum = hashName(tagName);
      for (let i = 0; i < attrs.length; i++) {
        const { name, value } = attrs[i];
        const h = hashAttr(name, value);
        attrMap.set(name, h);
        sum = addMod64(sum, h);
      }
      this.attrHashes.set(id, attrMap);
      this.setRow(id, 1 /* Element */, NONE, NONE, sum);
    }
    /** TEXT/COMMENT (`value`) or DOCTYPE (`name`) — both a single content-carrying string field. */
    createLeafRow(id, kind, contentField) {
      this.setRow(id, kind, NONE, NONE, hashValue(contentField));
    }
    // ---- ATTR_SET / ATTR_DEL / TEXT_SET (§4.4) — content-only, topology untouched. ----
    setAttrs(id, attrs) {
      const row = this.rows.get(id);
      if (row === void 0) return;
      const attrMap = this.attrHashes.get(id) ?? /* @__PURE__ */ new Map();
      let sum = row.contentHash;
      for (let i = 0; i < attrs.length; i++) {
        const { name, value } = attrs[i];
        const old = attrMap.get(name);
        if (old !== void 0) sum = subMod64(sum, old);
        const h = hashAttr(name, value);
        attrMap.set(name, h);
        sum = addMod64(sum, h);
      }
      this.attrHashes.set(id, attrMap);
      this.setRow(id, row.kind, row.parent, row.prevSibling, sum);
    }
    delAttrs(id, names) {
      const row = this.rows.get(id);
      if (row === void 0) return;
      const attrMap = this.attrHashes.get(id);
      if (attrMap === void 0) return;
      let sum = row.contentHash;
      for (let i = 0; i < names.length; i++) {
        const old = attrMap.get(names[i]);
        if (old === void 0) continue;
        sum = subMod64(sum, old);
        attrMap.delete(names[i]);
      }
      this.setRow(id, row.kind, row.parent, row.prevSibling, sum);
    }
    setValue(id, value) {
      const row = this.rows.get(id);
      if (row === void 0) return;
      this.setRow(id, row.kind, row.parent, row.prevSibling, hashValue(value));
    }
    // ---- INSERT / REMOVE (§4.3) — topology only, content untouched. ----
    /**
     * §4.3 `INSERT` table effect: unlinks each id from wherever it currently is (a move), then
     * links the whole batch, in wire order, immediately before `before` (or at the end of
     * `parent`'s children when `before === 0`). Exactly two rows change per link (the linked id,
     * and whichever row now follows it) — never O(children in parent).
     */
    insertBatch(parent, before, ids) {
      let prev = before === NONE ? this.lastChildOf.get(parent) ?? NONE : this.rows.get(before)?.prevSibling ?? NONE;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const existing = this.rows.get(id);
        if (existing !== void 0 && existing.parent !== NONE) this.unlink(id, existing);
        this.linkAfter(id, parent, prev);
        prev = id;
      }
      if (before !== NONE) this.relinkPrevSibling(before, prev);
      else this.lastChildOf.set(parent, prev);
    }
    /**
     * §4.3 `REMOVE` table effect: detaches each id and repairs the sibling that followed it.
     * `parent` is redundant with the table (§4.3: "kept as a cheap assert") — accepted here for
     * call-site symmetry with `RemoveOp`; precondition validation (Stage 2) is what actually checks
     * it against `getRow(id).parent`, not this method.
     */
    removeBatch(_parent, ids) {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const row = this.rows.get(id);
        if (row === void 0) continue;
        this.unlink(id, row);
        this.setRow(id, row.kind, NONE, NONE, row.contentHash);
      }
    }
    /** `NODE_DROP` (§4.2, OPEN-1/OPEN-2, Stage 3) — permanently removes one row's contract state. */
    dropRow(id) {
      this.rows.delete(id);
      this.attrHashes.delete(id);
      this.nextSiblingOf.delete(id);
      this.lastChildOf.delete(id);
      this.tracker.remove(id);
    }
    /**
     * `NODE_DROP`'s actual `Table` effect (§4.2: "drops each row **and all its descendants** — a
     * detached row may still have children"). `id` is a subtree root (validated by the caller —
     * `replicatedTableApply.ts` — to have `parent = 0` before this runs); its descendants are
     * discovered by walking the same derived links `INSERT`/`REMOVE` already maintain
     * (`lastChildOf` + each child's own `prevSibling`), never touched by `unlink()` when only the
     * *root* of a detached subtree was itself detached from its old parent. Returns every id
     * actually dropped (root + descendants) so the caller (producer: `tableFrameBuilder.ts`) can
     * release the matching `DomNodeTable` identity entries too.
     */
    dropSubtree(id) {
      const ids = [];
      this.collectSubtreeIds(id, ids);
      for (let i = 0; i < ids.length; i++) this.dropRow(ids[i]);
      return ids;
    }
    /**
     * Read-only twin of {@link dropSubtree}'s discovery walk — same root+descendants list, no
     * mutation. Lets a caller that needs to know the *full* set before the table effect actually
     * runs (producer: `tableFrameBuilder.ts`'s `emitNodeDropSweep`, which must release every
     * descendant's `DomNodeTable` identity too, not just the swept root's — a live JS reference
     * that later reinserts an unreleased descendant would otherwise be handed back its old,
     * already-dropped id, corrupting `ReplicatedTable` silently instead of being re-described as
     * new content) query it ahead of the real drop.
     */
    subtreeIds(id) {
      const ids = [];
      this.collectSubtreeIds(id, ids);
      return ids;
    }
    /**
     * Detached (`parent === 0`) subtree roots whose `lms` is at least `maxAge` frame-`sequence`s
     * behind `currentSequence` — OPEN-2's deferred-age GC sweep candidates (§1.6). Non-root
     * detached descendants (`parent !== 0`, pointing at another detached row) are excluded: they
     * are collected transitively by `dropSubtree` once their root is chosen, never listed on the
     * wire themselves (§4.2). Bounded by `limit` — same "forced flush over unbounded per-tick
     * work" reasoning as `MAX_DIRTY_NODES` (§8).
     */
    collectDroppableIds(currentSequence, maxAge, limit) {
      const out = [];
      for (const [id, row] of this.rows) {
        if (out.length >= limit) break;
        if (row.parent !== NONE) continue;
        if (currentSequence - row.lms >= maxAge) out.push(id);
      }
      return out;
    }
    collectSubtreeIds(id, out) {
      out.push(id);
      let child = this.lastChildOf.get(id) ?? NONE;
      while (child !== NONE) {
        this.collectSubtreeIds(child, out);
        const row = this.rows.get(child);
        child = row?.prevSibling ?? NONE;
      }
    }
    // ---- internals ----
    setRow(id, kind, parent, prevSibling, contentHash) {
      const rowHash = computeRowHash(id, kind, parent, prevSibling, contentHash);
      this.rows.set(id, { kind, parent, prevSibling, contentHash, rowHash, lms: this.currentSequence });
      this.tracker.upsert(id, rowHash);
    }
    relinkPrevSibling(id, prevSibling) {
      const row = this.rows.get(id);
      if (row === void 0) return;
      this.setRow(id, row.kind, row.parent, prevSibling, row.contentHash);
    }
    linkAfter(id, parent, prevId) {
      const row = this.rows.get(id);
      const kind = row?.kind ?? 1 /* Element */;
      const contentHash = row?.contentHash ?? 0n;
      this.setRow(id, kind, parent, prevId, contentHash);
      if (prevId !== NONE) this.nextSiblingOf.set(prevId, id);
    }
    /** Removes `id` from its current position, repairing its neighbor's `prevSibling`/`lastChildOf`. */
    unlink(id, row) {
      if (row.parent === NONE) return;
      const nextId = this.nextSiblingOf.get(id) ?? NONE;
      this.nextSiblingOf.delete(id);
      if (nextId !== NONE) {
        this.relinkPrevSibling(nextId, row.prevSibling);
        if (row.prevSibling !== NONE) this.nextSiblingOf.set(row.prevSibling, nextId);
      } else if (this.lastChildOf.get(row.parent) === id) {
        this.lastChildOf.set(row.parent, row.prevSibling);
      }
    }
  };

  // browser/mirror/projection/virtual/frame/binaryWriter.ts
  var BinaryWriter = class {
    buf;
    view;
    offset = 0;
    strings = [];
    stringIndex = /* @__PURE__ */ new Map();
    textEncoder = new TextEncoder();
    constructor(initialCapacity = 4096) {
      this.buf = new Uint8Array(initialCapacity);
      this.view = new DataView(this.buf.buffer);
    }
    get length() {
      return this.offset;
    }
    reset() {
      this.offset = 0;
      this.strings.length = 0;
      this.stringIndex.clear();
    }
    ensure(extra) {
      const need = this.offset + extra;
      if (need <= this.buf.length) return;
      let cap = this.buf.length || 4096;
      while (cap < need) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf.subarray(0, this.offset));
      this.buf = next;
      this.view = new DataView(this.buf.buffer);
    }
    u8(v) {
      this.ensure(1);
      this.buf[this.offset++] = v & 255;
    }
    u16(v) {
      this.ensure(2);
      this.view.setUint16(this.offset, v >>> 0, true);
      this.offset += 2;
    }
    u32(v) {
      this.ensure(4);
      this.view.setUint32(this.offset, v >>> 0, true);
      this.offset += 4;
    }
    i32(v) {
      this.ensure(4);
      this.view.setInt32(this.offset, v | 0, true);
      this.offset += 4;
    }
    /** Raw UTF-8 bytes (establishChunk) — not string-table interned. */
    utf8Raw(value) {
      const b = this.textEncoder.encode(value);
      this.u32(b.length);
      this.ensure(b.length);
      this.buf.set(b, this.offset);
      this.offset += b.length;
    }
    f64(v) {
      this.ensure(8);
      this.view.setFloat64(this.offset, v, true);
      this.offset += 8;
    }
    u64(v) {
      this.ensure(8);
      this.view.setBigUint64(this.offset, v, true);
      this.offset += 8;
    }
    /** Intern string; returns index. */
    str(value) {
      const existing = this.stringIndex.get(value);
      if (existing !== void 0) return existing;
      const idx = this.strings.length;
      this.strings.push(value);
      this.stringIndex.set(value, idx);
      return idx;
    }
    bytesSoFar() {
      return this.buf.subarray(0, this.offset);
    }
    /** Diagnostic only — frame-protocol.md decision-log entry, 2026-08-13 "48KB first-frame". */
    debugStrings() {
      return this.strings;
    }
    takeStringTableBytes() {
      const enc = this.textEncoder;
      let size = 4;
      const encoded = [];
      for (let i = 0; i < this.strings.length; i++) {
        const b = enc.encode(this.strings[i]);
        encoded.push(b);
        size += 4 + b.length;
      }
      const out = new Uint8Array(size);
      const view = new DataView(out.buffer);
      let o = 0;
      view.setUint32(o, this.strings.length, true);
      o += 4;
      for (let i = 0; i < encoded.length; i++) {
        const b = encoded[i];
        view.setUint32(o, b.length, true);
        o += 4;
        out.set(b, o);
        o += b.length;
      }
      return out;
    }
  };
  function assemblePart(args) {
    const headerSize = 2 + 1 + 1 + 4 + 4 + 2 + 2 + 8;
    const out = new Uint8Array(headerSize + args.stringTable.length + args.opsBody.length);
    const view = new DataView(out.buffer);
    let o = 0;
    view.setUint16(o, 20560, true);
    o += 2;
    out[o++] = args.version & 255;
    out[o++] = args.flags & 255;
    view.setUint32(o, args.generation >>> 0, true);
    o += 4;
    view.setUint32(o, args.sequence >>> 0, true);
    o += 4;
    view.setUint16(o, args.partIndex, true);
    o += 2;
    view.setUint16(o, args.partCount, true);
    o += 2;
    view.setBigUint64(o, args.preTableHash, true);
    o += 8;
    out.set(args.stringTable, o);
    o += args.stringTable.length;
    out.set(args.opsBody, o);
    return out;
  }

  // browser/mirror/projection/virtual/frame/binaryFrameEncoder.ts
  var LOCAL_STR_BIT = 2147483648;
  var DEBUG_FIRST_FRAME_BYTES = false;
  var DEFAULT_MAX_FRAME_BYTES = 1 << 20;
  var BinaryFrameEncoder = class {
    maxFrameBytes;
    scratch = new BinaryWriter();
    constructor(opts = {}) {
      this.maxFrameBytes = opts.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    }
    encode(frame) {
      if (frame.ops.length === 0) return [];
      const single = this.encodeOpsPart(frame, frame.ops, 0, 1);
      if (single.length <= this.maxFrameBytes) return [single];
      const partsOps = [];
      let current = [];
      for (let i = 0; i < frame.ops.length; i++) {
        const trial = [...current, frame.ops[i]];
        const trialBytes = this.encodeOpsPart(frame, trial, 0, 1);
        if (trialBytes.length > this.maxFrameBytes && current.length > 0) {
          partsOps.push(current);
          current = [frame.ops[i]];
        } else {
          current = trial;
        }
      }
      if (current.length > 0) partsOps.push(current);
      const partCount = Math.max(1, partsOps.length);
      const out = [];
      for (let i = 0; i < partsOps.length; i++) {
        out.push(this.encodeOpsPart(frame, partsOps[i], i, partCount));
      }
      return out;
    }
    encodeOpsPart(frame, ops, partIndex, partCount) {
      const w = this.scratch;
      w.reset();
      w.u32(ops.length);
      for (let i = 0; i < ops.length; i++) this.writeOp(w, ops[i]);
      const flags = frame.flags.resync ? 2 : 0;
      const opsBody = w.bytesSoFar().slice();
      const stringTable = w.takeStringTableBytes();
      if (DEBUG_FIRST_FRAME_BYTES && frame.sequence === 1) {
        const strings = w.debugStrings();
        const record = {
          ops: ops.length,
          opsBodyBytes: opsBody.length,
          stringTableBytes: stringTable.length,
          stringCount: strings.length,
          top10ByLen: [...strings].sort((a, b) => b.length - a.length).slice(0, 10).map((s) => ({ len: s.length, preview: s.slice(0, 60) }))
        };
        globalThis.__speculumDiag ??= [];
        globalThis.__speculumDiag.push(record);
      }
      return assemblePart({
        version: frame.version,
        flags,
        generation: frame.generation,
        sequence: frame.sequence,
        partIndex,
        partCount,
        preTableHash: frame.preTableHash,
        stringTable,
        opsBody
      });
    }
    writeStrRef(w, value) {
      w.u32((w.str(value) | LOCAL_STR_BIT) >>> 0);
    }
    writeAttrs(w, attrs) {
      w.u16(attrs.length);
      for (let i = 0; i < attrs.length; i++) {
        this.writeStrRef(w, attrs[i].name);
        this.writeStrRef(w, attrs[i].value);
      }
    }
    writeOp(w, op) {
      switch (op.op) {
        case 1 /* Check */:
          return this.writeCheck(w, op);
        case 2 /* EpochReset */:
          return this.writeEpochReset(w, op);
        case 3 /* StrDef */:
          return this.writeStrDef(w, op);
        case 32 /* NodeNew */:
          return this.writeNodeNew(w, op);
        case 33 /* NodeDrop */:
          return this.writeNodeDrop(w, op);
        case 64 /* Insert */:
          return this.writeInsert(w, op);
        case 65 /* Remove */:
          return this.writeRemove(w, op);
        case 96 /* AttrSet */:
          return this.writeAttrSet(w, op);
        case 97 /* AttrDel */:
          return this.writeAttrDel(w, op);
        case 98 /* TextSet */:
          return this.writeTextSet(w, op);
        default:
          throw new Error(`BinaryFrameEncoder: unsupported op ${String(op.op)}`);
      }
    }
    /** §4.1 — `scope u8, lo u32, hi u32, hash u64`. Fixed-width, no varints (P5). */
    writeCheck(w, op) {
      w.u8(1 /* Check */);
      w.u8(op.scope);
      w.u32(op.lo);
      w.u32(op.hi);
      w.u64(op.hash);
    }
    writeEpochReset(w, op) {
      w.u8(2 /* EpochReset */);
      w.u32(op.generation);
    }
    /** Persistent `STR_DEF` bytes are raw (this instruction IS the definition), never interned. */
    writeStrDef(w, op) {
      w.u8(3 /* StrDef */);
      w.u32(op.strId);
      w.utf8Raw(op.value);
    }
    writeNodeNew(w, op) {
      w.u8(32 /* NodeNew */);
      w.u32(op.id);
      w.u8(op.kind);
      if (op.kind === 1 /* Element */) {
        this.writeStrRef(w, op.name);
        this.writeAttrs(w, op.attrs);
        return;
      }
      if (op.kind === 6 /* Doctype */) {
        this.writeStrRef(w, op.name);
        return;
      }
      this.writeStrRef(w, op.value);
    }
    /** §4.2 — `count: u16, ids: u32[]`; roots only, descendants derived independently on both sides. */
    writeNodeDrop(w, op) {
      w.u8(33 /* NodeDrop */);
      w.u16(op.ids.length);
      for (let i = 0; i < op.ids.length; i++) w.u32(op.ids[i]);
    }
    writeInsert(w, op) {
      w.u8(64 /* Insert */);
      w.u32(op.parent);
      w.u32(op.before);
      w.u16(op.ids.length);
      for (let i = 0; i < op.ids.length; i++) w.u32(op.ids[i]);
    }
    writeRemove(w, op) {
      w.u8(65 /* Remove */);
      w.u32(op.parent);
      w.u16(op.ids.length);
      for (let i = 0; i < op.ids.length; i++) w.u32(op.ids[i]);
    }
    writeAttrSet(w, op) {
      w.u8(96 /* AttrSet */);
      w.u32(op.node);
      this.writeAttrs(w, op.attrs);
    }
    writeAttrDel(w, op) {
      w.u8(97 /* AttrDel */);
      w.u32(op.node);
      w.u16(op.names.length);
      for (let i = 0; i < op.names.length; i++) this.writeStrRef(w, op.names[i]);
    }
    writeTextSet(w, op) {
      w.u8(98 /* TextSet */);
      w.u32(op.node);
      this.writeStrRef(w, op.value);
    }
  };

  // browser/mirror/projection/virtual/frame/frameEmitter.ts
  var IDLE_SWEEP_INTERVAL_TICKS = 30;
  var FrameEmitter = class {
    clock;
    buffer;
    builder;
    encoder;
    transport;
    domNodes;
    telemetry;
    sequence = 0;
    idleTicks = 0;
    pendingFrame = null;
    pendingParts = null;
    pendingPartIndex = 0;
    pendingRecords = null;
    pendingResyncBuild = null;
    constructor(opts) {
      this.clock = opts.clock;
      this.buffer = opts.buffer;
      this.builder = opts.builder;
      this.encoder = opts.encoder;
      this.transport = opts.transport;
      this.domNodes = opts.domNodes;
      this.telemetry = opts.telemetry ?? null;
    }
    start() {
      this.clock.start(() => this.onBoundary());
    }
    stop() {
      this.clock.stop();
    }
    get currentSequence() {
      return this.sequence;
    }
    /**
     * Sends a frame built outside the ordinary clock-driven path — bootstrap's `resyncVirtual`
     * (frame-protocol.md §5.1/§5.8), before `start()` has ever run. Retries a deferred transport
     * with a short async spin rather than `onBoundary`'s defer-until-next-tick, because there is no
     * clock ticking yet to drive that retry. Sets `this.sequence` on success so the first
     * clock-driven frame continues numbering from here, not from 0.
     */
    async sendInitial(frame) {
      const parts = this.encoder.encode(frame);
      if (parts.length === 0) return;
      for (let i = 0; i < parts.length; i++) {
        const bytes = parts[i];
        let result = this.transport.send(bytes);
        let spins = 0;
        while (result === "deferred" && spins < 50) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          result = this.transport.send(bytes);
          spins += 1;
        }
      }
      let totalBytes = 0;
      for (let i = 0; i < parts.length; i++) totalBytes += parts[i].length;
      this.telemetry?.recordFrameEmitted({
        generation: frame.generation,
        sequence: frame.sequence,
        opCount: frame.ops.length,
        partCount: parts.length,
        bytes: totalBytes,
        tableSize: this.domNodes.size,
        buildMs: 0,
        encodeMs: 0
      });
      this.sequence = frame.sequence;
    }
    /**
     * Stage 4 (frame-protocol-production-completeness) — client-initiated resync, frame-protocol.md
     * §5.8 step 1, "Halt": queues `build` to run at the next tick boundary *instead of* the ordinary
     * mutation-buffer-driven build, and returns immediately — the caller (`bootstrap.ts`'s
     * `PlaneChannel.Control` handler) never awaits this, matching §5.8's "no `await` between any
     * step" atomicity requirement for whichever synchronous DOM/map read `build` itself performs.
     *
     * No separate pause/resume primitive on `clock`/`buffer` exists or is needed: `emitResyncFrame`
     * is itself fully synchronous, and this method's caller only ever runs between ticks (JS
     * run-to-completion), so there is no way for an ordinary `onBoundary()` build to interleave with
     * it regardless. "Halt" reduces to *which* build `onBoundary()` runs at its next boundary — the
     * mutation buffer is simply not drained that tick, so nothing buffered is lost or double-counted
     * (§5.8 step 1: "the MutationObserver keeps recording ... nothing is lost, it simply waits").
     *
     * If a previously-built frame is still mid-send (`pendingParts` non-null, transport backpressure
     * — §5.3), the resync build is stashed and only serviced once that frame's own parts finish
     * draining (`trySendPending`'s own completion falls through to the next `onBoundary()`, which
     * checks this field first) — this never interleaves one frame's parts with another's on the wire.
     */
    requestResync(build) {
      this.pendingResyncBuild = build;
    }
    onBoundary() {
      if (this.pendingParts !== null && this.pendingFrame !== null) {
        this.trySendPending();
        return;
      }
      if (this.pendingResyncBuild !== null) {
        const build = this.pendingResyncBuild;
        this.pendingResyncBuild = null;
        this.idleTicks = 0;
        this.builder.takeBuildStats?.();
        const frame2 = build(this.sequence + 1);
        const parts2 = this.encoder.encode(frame2);
        if (parts2.length === 0) return;
        this.pendingFrame = frame2;
        this.pendingParts = parts2;
        this.pendingPartIndex = 0;
        this.pendingRecords = null;
        this.trySendPending();
        return;
      }
      const hasWork = this.buffer.hasWork();
      if (!hasWork) {
        this.idleTicks += 1;
        if (this.idleTicks < IDLE_SWEEP_INTERVAL_TICKS) return;
      }
      this.idleTicks = 0;
      const records = hasWork ? this.buffer.drain() : [];
      const nextSequence = this.sequence + 1;
      const frame = this.builder.build(records, {
        generation: this.domNodes.generation,
        sequence: nextSequence
      });
      const unconsumed = this.builder.takeUnconsumedRecords?.();
      if (unconsumed && unconsumed.length > 0) this.buffer.reclaim(unconsumed);
      if (frame === null) return;
      const parts = this.encoder.encode(frame);
      if (parts.length === 0) return;
      this.pendingFrame = frame;
      this.pendingParts = parts;
      this.pendingPartIndex = 0;
      this.pendingRecords = null;
      this.trySendPending();
    }
    trySendPending() {
      const parts = this.pendingParts;
      const frame = this.pendingFrame;
      if (parts === null || frame === null) return;
      while (this.pendingPartIndex < parts.length) {
        const bytes = parts[this.pendingPartIndex];
        const result = this.transport.send(bytes);
        if (result === "deferred") {
          this.telemetry?.recordTransportDeferred({
            generation: frame.generation,
            sequence: frame.sequence,
            pendingParts: parts.length - this.pendingPartIndex
          });
          return;
        }
        this.pendingPartIndex += 1;
      }
      let totalBytes = 0;
      for (let i = 0; i < parts.length; i++) totalBytes += parts[i].length;
      const stats = this.builder.takeBuildStats?.() ?? null;
      this.telemetry?.recordFrameEmitted({
        generation: frame.generation,
        sequence: frame.sequence,
        opCount: frame.ops.length,
        partCount: parts.length,
        bytes: totalBytes,
        tableSize: this.domNodes.size,
        buildMs: stats?.buildMs ?? 0,
        encodeMs: 0
      });
      this.sequence = frame.sequence;
      this.pendingFrame = null;
      this.pendingParts = null;
      this.pendingPartIndex = 0;
      this.pendingRecords = null;
    }
  };

  // browser/mirror/projection/models/limits.ts
  var MAX_STR_BYTES = 1 << 20;
  var MAX_DIRTY_NODES = 2e4;
  var NODE_DROP_AGE_SEQUENCES = 20;
  var MAX_NODE_DROPS_PER_SWEEP = 500;

  // browser/mirror/projection/models/replicatedTableApply.ts
  function applyOpToTable(table, op) {
    switch (op.op) {
      case 1 /* Check */:
        return;
      case 2 /* EpochReset */:
        table.reset();
        return;
      case 3 /* StrDef */:
        return;
      case 32 /* NodeNew */:
        if (op.kind === 1 /* Element */) table.createElementRow(op.id, op.name, op.attrs);
        else if (op.kind === 6 /* Doctype */) table.createLeafRow(op.id, op.kind, op.name);
        else table.createLeafRow(op.id, op.kind, op.value);
        return;
      case 33 /* NodeDrop */:
        for (let i = 0; i < op.ids.length; i++) table.dropSubtree(op.ids[i]);
        return;
      case 64 /* Insert */:
        table.insertBatch(op.parent, op.before, op.ids);
        return;
      case 65 /* Remove */:
        table.removeBatch(op.parent, op.ids);
        return;
      case 96 /* AttrSet */:
        table.setAttrs(op.node, op.attrs);
        return;
      case 97 /* AttrDel */:
        table.delAttrs(op.node, op.names);
        return;
      case 98 /* TextSet */:
        table.setValue(op.node, op.value);
        return;
      default:
        return;
    }
  }
  function applyOpsToTable(table, ops) {
    for (let i = 0; i < ops.length; i++) applyOpToTable(table, ops[i]);
  }

  // browser/mirror/projection/virtual/frame/domNodeDescribe.ts
  function nodeKindOf(node) {
    switch (node.nodeType) {
      case Node.ELEMENT_NODE:
        return 1 /* Element */;
      case Node.TEXT_NODE:
        return 2 /* Text */;
      case Node.COMMENT_NODE:
        return 3 /* Comment */;
      case Node.DOCUMENT_TYPE_NODE:
        return 6 /* Doctype */;
      default:
        return null;
    }
  }
  function readAttrs(el) {
    const attrs = el.attributes;
    const out = new Array(attrs.length);
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      out[i] = { name: attr.name, value: attr.value };
    }
    return out;
  }
  function describeNodeNew(id, kind, node) {
    if (kind === 1 /* Element */) {
      const el = node;
      return { op: 32 /* NodeNew */, id, kind, name: el.tagName.toLowerCase(), attrs: readAttrs(el) };
    }
    if (kind === 6 /* Doctype */) {
      return { op: 32 /* NodeNew */, id, kind, name: node.name || "html" };
    }
    return { op: 32 /* NodeNew */, id, kind, value: node.textContent ?? "" };
  }

  // browser/mirror/projection/virtual/frame/resync.ts
  function emitResyncFrame(domNodes, table, generation, sequence) {
    const ops = [];
    for (const [id, node] of domNodes.liveEntries()) {
      if (id === DOCUMENT_ID) continue;
      if (!node.isConnected) {
        domNodes.release(node);
        continue;
      }
      const kind = nodeKindOf(node);
      if (kind === null) continue;
      ops.push(describeNodeNew(id, kind, node));
    }
    for (const [id, node] of domNodes.liveEntries()) {
      const children = node.childNodes;
      if (children.length === 0) continue;
      const ids = [];
      for (const child of children) {
        const childId = domNodes.keyOf(child);
        if (childId === NONE_DOM_NODE_KEY) continue;
        ids.push(childId);
      }
      if (ids.length > 0) ops.push({ op: 64 /* Insert */, parent: id, before: INSERT_AT_END, ids });
    }
    table.reset();
    table.setSequence(sequence);
    applyOpsToTable(table, ops);
    ops.push({ op: 1 /* Check */, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: table.tableHash });
    return createFrame({ generation, sequence, ops, resync: true, preTableHash: 0n });
  }
  function resyncVirtual(domNodes, table, sequence) {
    const generation = domNodes.generation;
    domNodes.resetIdentity();
    domNodes.bind(document, DOCUMENT_ID);
    allocateConnectedSubtree(document, domNodes);
    return emitResyncFrame(domNodes, table, generation, sequence);
  }
  function allocateConnectedSubtree(root, domNodes) {
    const children = root.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (nodeKindOf(child) !== null) domNodes.allocate(child);
      allocateConnectedSubtree(child, domNodes);
    }
  }

  // browser/mirror/projection/virtual/frame/tableFrameBuilder.ts
  var EMPTY_OP_COUNTS = {};
  var TableFrameBuilder = class {
    domNodes;
    table;
    collectOpCounts;
    nodeDropAgeSequences;
    maxNodeDropsPerSweep;
    lastStats = null;
    pendingUnconsumed = null;
    // Reused across ticks (`.clear()`ed at the top of `build()`) instead of allocated fresh every
    // tick — at a sustained frame rate this is 5 fewer heap allocations per tick, directly the GC
    // pressure identified in the 2026-08-13 CPU profile behind the buildMs p95/max spikes.
    visited = /* @__PURE__ */ new Set();
    createdThisTick = /* @__PURE__ */ new Set();
    /** node -> the parent it was removed from, captured before any deferred decision (§5.6). */
    removedThisTick = /* @__PURE__ */ new Map();
    attrDirty = /* @__PURE__ */ new Map();
    textDirty = /* @__PURE__ */ new Set();
    constructor(opts) {
      this.domNodes = opts.domNodes;
      this.table = opts.table;
      this.collectOpCounts = opts.collectOpCounts ?? false;
      this.nodeDropAgeSequences = opts.nodeDropAgeSequences ?? NODE_DROP_AGE_SEQUENCES;
      this.maxNodeDropsPerSweep = opts.maxNodeDropsPerSweep ?? MAX_NODE_DROPS_PER_SWEEP;
    }
    takeBuildStats() {
      const s = this.lastStats;
      this.lastStats = null;
      return s;
    }
    /** §8 `MAX_DIRTY_NODES` — records left over when this tick's visited-set cap forced an early stop. */
    takeUnconsumedRecords() {
      const r = this.pendingUnconsumed;
      this.pendingUnconsumed = null;
      return r;
    }
    /**
     * `records` may legitimately be empty — `frameEmitter.ts` also calls this on a periodic,
     * mutation-independent cadence purely so `emitNodeDropSweep` below gets a chance to run during
     * an otherwise-idle session (a detached row does not need *new* mutations to become GC-eligible,
     * only time/`sequence` to pass — §1.6).
     */
    build(records, ctx) {
      const start = performance.now();
      const preTableHash = this.table.tableHash;
      const ops = [];
      this.pendingUnconsumed = null;
      if (records.length > 0) {
        this.visited.clear();
        this.createdThisTick.clear();
        this.removedThisTick.clear();
        this.attrDirty.clear();
        this.textDirty.clear();
        let consumedThrough = records.length;
        for (let i = 0; i < records.length; i++) {
          const record = records[i];
          if (record.type === "childList") {
            this.walkChildList(record, ops);
            if (this.visited.size >= MAX_DIRTY_NODES) {
              consumedThrough = i + 1;
              break;
            }
          } else if (record.type === "attributes") {
            const name = record.attributeName;
            if (name === null) continue;
            let set = this.attrDirty.get(record.target);
            if (set === void 0) {
              set = /* @__PURE__ */ new Set();
              this.attrDirty.set(record.target, set);
            }
            set.add(name);
          } else if (record.type === "characterData") {
            this.textDirty.add(record.target);
          }
        }
        if (consumedThrough < records.length) {
          this.pendingUnconsumed = records.slice(consumedThrough);
        }
        this.emitDeferredRemoves(ops);
        this.emitAttrPatches(ops);
        this.emitTextPatches(ops);
      }
      this.table.setSequence(ctx.sequence);
      applyOpsToTable(this.table, ops);
      const dropOpIndex = ops.length;
      this.emitNodeDropSweep(ops, ctx.sequence);
      if (ops.length > dropOpIndex) applyOpsToTable(this.table, ops.slice(dropOpIndex));
      if (ops.length === 0) return null;
      let opCounts = EMPTY_OP_COUNTS;
      if (this.collectOpCounts) {
        opCounts = {};
        for (let i = 0; i < ops.length; i++) {
          const name = opCodeName(ops[i].op);
          opCounts[name] = (opCounts[name] ?? 0) + 1;
        }
      }
      this.lastStats = { opCounts, buildMs: performance.now() - start };
      return createFrame({ generation: ctx.generation, sequence: ctx.sequence, ops, preTableHash });
    }
    /**
     * OPEN-2 deferred-age GC (§1.6, §5.6): sweep the table's own detached-subtree-root candidates
     * (independent of whatever this tick's `MutationRecord`s were about — a row can go idle
     * without anything mutating it further) and, for whatever the sweep selects, release the
     * matching `DomNodeTable` identity entry too — the whole point of the sweep is bounding *this*
     * producer-side map's growth, not just the wire-visible table's.
     *
     * Releases the *whole* subtree (root + every descendant, via `ReplicatedTable.subtreeIds` —
     * the same discovery walk `dropSubtree` itself uses, queried read-only here before the table
     * effect runs), not just the swept root id: `collectDroppableIds` only ever returns detached
     * roots (§4.2 — descendants are never listed on the wire on their own), so releasing only the
     * root left every descendant's `DomNodeTable` entry stale. A live page-JS reference that later
     * reinserts such a descendant would have found `domNodes.keyOf()` still resolving to its old,
     * by-then-already-dropped id — treating it as "already indexed, just move" instead of
     * re-describing it as new content, silently corrupting `ReplicatedTable` with a bogus
     * fallback row (`replicatedTable.ts`'s `linkAfter`) instead of a clean re-`NODE_NEW` (found by
     * inspection, 2026-08-14, chasing whether subtree resurrection is handled naturally).
     */
    emitNodeDropSweep(ops, sequence) {
      const rootIds = this.table.collectDroppableIds(sequence, this.nodeDropAgeSequences, this.maxNodeDropsPerSweep);
      if (rootIds.length === 0) return;
      for (let i = 0; i < rootIds.length; i++) {
        const subtreeIds = this.table.subtreeIds(rootIds[i]);
        for (let j = 0; j < subtreeIds.length; j++) {
          const node = this.domNodes.get(subtreeIds[j]);
          if (node !== void 0) this.domNodes.release(node);
        }
      }
      ops.push({ op: 33 /* NodeDrop */, ids: rootIds });
    }
    walkChildList(record, ops) {
      const parent = record.target;
      for (let i = 0; i < record.removedNodes.length; i++) {
        const node = record.removedNodes[i];
        if (!this.removedThisTick.has(node)) this.removedThisTick.set(node, parent);
      }
      const parentId = this.domNodes.keyOf(parent);
      if (parentId === NONE_DOM_NODE_KEY) return;
      this.walkSiblingRun(record.addedNodes, parentId, ops);
    }
    /**
     * §5.5 — reuse-or-create for one run of siblings under `parentId`: either a
     * `MutationRecord.addedNodes` (added together in one structural op) or a freshly-created
     * node's own `childNodes` (never observed as its own `MutationRecord` — §5.1, a subtree
     * built off-DOM then attached in one shot is invisible to the observer while detached).
     *
     * Batches each *contiguous* stretch of siblings into one `INSERT` instead of one `INSERT`
     * (and one `resolvedBefore` anchor walk) per node — contiguity is verified live via
     * `.nextSibling` right before extending a batch, never assumed from input order (which,
     * for `addedNodes`, is a snapshot a later mutation this same tick could have broken): a
     * false negative here only costs a missed batching opportunity, never correctness.
     *
     * Found empirically 2026-08-13 (`prepend-stress.html`, a block-prepend fixture — the
     * "load older messages" / virtualized-list-reorder shape): the old one-`resolvedBefore`-
     * per-node walk was O(batch²) for a single large sibling block and measured as 34% of
     * total producer CPU at a 1600-node batch. This makes it O(batch) — one anchor lookup per
     * contiguous run, not per node.
     */
    walkSiblingRun(siblings, parentId, ops) {
      const n = siblings.length;
      let i = 0;
      while (i < n) {
        const node = siblings[i];
        if (this.visited.has(node)) {
          i += 1;
          continue;
        }
        this.visited.add(node);
        const before = this.resolvedBefore(node);
        const batchIds = [];
        const firstId = this.prepareChild(node, ops);
        if (firstId !== NONE_DOM_NODE_KEY) batchIds.push(firstId);
        let prev = node;
        let j = i + 1;
        while (j < n) {
          const next = siblings[j];
          if (this.visited.has(next) || prev.nextSibling !== next) break;
          this.visited.add(next);
          const id = this.prepareChild(next, ops);
          if (id !== NONE_DOM_NODE_KEY) batchIds.push(id);
          prev = next;
          j += 1;
        }
        if (batchIds.length > 0) ops.push({ op: 64 /* Insert */, parent: parentId, before, ids: batchIds });
        i = j;
      }
    }
    /**
     * Reuse-or-create a single node already known to belong in the caller's current `INSERT`
     * batch — `NODE_NEW` (+ its own children's ops, recursively) on the way down; the caller
     * emits the batch's `INSERT` on the way up, once, after every sibling in the run returns.
     * `NONE_DOM_NODE_KEY` means "not part of the DOM-only v0 surface" (`nodeKindOf`) — the
     * caller drops it from the batch rather than inserting a placeholder id.
     */
    prepareChild(node, ops) {
      const existingId = this.domNodes.keyOf(node);
      if (existingId !== NONE_DOM_NODE_KEY) return existingId;
      const kind = nodeKindOf(node);
      if (kind === null) return NONE_DOM_NODE_KEY;
      const id = this.domNodes.allocate(node);
      this.createdThisTick.add(node);
      ops.push(describeNodeNew(id, kind, node));
      this.walkSiblingRun(node.childNodes, id, ops);
      return id;
    }
    /**
     * Nearest live next-sibling that already has a row (existing before this tick, or already
     * inserted earlier this tick). `INSERT.before` must reference a row that already exists, so
     * walking forward past not-yet-processed new siblings and inserting each one before this
     * stable anchor (left to right) reproduces live DOM order without ever forward-referencing
     * an id that doesn't exist yet.
     */
    resolvedBefore(node) {
      let cur = node.nextSibling;
      while (cur !== null) {
        const id = this.domNodes.keyOf(cur);
        if (id !== NONE_DOM_NODE_KEY) return id;
        cur = cur.nextSibling;
      }
      return INSERT_AT_END;
    }
    /** §5.6 — a node removed and not re-inserted anywhere this tick is a true detach. */
    emitDeferredRemoves(ops) {
      for (const [node, oldParent] of this.removedThisTick) {
        if (this.visited.has(node)) continue;
        const id = this.domNodes.keyOf(node);
        if (id === NONE_DOM_NODE_KEY) continue;
        const oldParentId = this.domNodes.keyOf(oldParent);
        if (oldParentId === NONE_DOM_NODE_KEY) continue;
        ops.push({ op: 65 /* Remove */, parent: oldParentId, ids: [id] });
      }
    }
    emitAttrPatches(ops) {
      for (const [node, names] of this.attrDirty) {
        if (this.createdThisTick.has(node)) continue;
        if (!(node instanceof Element)) continue;
        const id = this.domNodes.keyOf(node);
        if (id === NONE_DOM_NODE_KEY || !node.isConnected) continue;
        const setAttrs = [];
        const delNames = [];
        for (const name of names) {
          const value = node.getAttribute(name);
          if (value === null) delNames.push(name);
          else setAttrs.push({ name, value });
        }
        if (setAttrs.length > 0) ops.push({ op: 96 /* AttrSet */, node: id, attrs: setAttrs });
        if (delNames.length > 0) ops.push({ op: 97 /* AttrDel */, node: id, names: delNames });
      }
    }
    emitTextPatches(ops) {
      for (const node of this.textDirty) {
        if (this.createdThisTick.has(node)) continue;
        const id = this.domNodes.keyOf(node);
        if (id === NONE_DOM_NODE_KEY || !node.isConnected) continue;
        ops.push({ op: 98 /* TextSet */, node: id, value: node.textContent ?? "" });
      }
    }
  };

  // browser/mirror/projection/plane/envelope.ts
  var PLANE_MAGIC = 20563;
  var PLANE_VERSION = 1;
  var PLANE_HEADER_SIZE = 5;
  function encodePlaneEnvelope(channel, payload, flags = 0) {
    const out = new Uint8Array(PLANE_HEADER_SIZE + payload.length);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setUint16(0, PLANE_MAGIC, true);
    out[2] = PLANE_VERSION;
    out[3] = channel & 255;
    out[4] = flags & 255;
    out.set(payload, PLANE_HEADER_SIZE);
    return out;
  }
  function decodePlaneEnvelope(message) {
    if (message.length < PLANE_HEADER_SIZE) return null;
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    if (view.getUint16(0, true) !== PLANE_MAGIC) return null;
    if (message[2] !== PLANE_VERSION) return null;
    const channel = message[3];
    const flags = message[4];
    return {
      channel,
      flags,
      payload: message.subarray(PLANE_HEADER_SIZE)
    };
  }

  // browser/mirror/projection/virtual/telemetry/projectionTelemetry.ts
  var ProjectionTelemetry = class {
    config;
    dataPlane;
    now;
    textEncoder = new TextEncoder();
    framesEmitted = 0;
    opsEmitted = 0;
    partsAccepted = 0;
    bytesAccepted = 0;
    deferredCount = 0;
    lastSequence = 0;
    buildMsSum = 0;
    encodeMsSum = 0;
    aggregateTimer = null;
    constructor(opts) {
      this.config = opts.config;
      this.dataPlane = opts.dataPlane;
      this.now = opts.now ?? (() => performance.now());
    }
    start() {
      if (!this.config.enabled || !this.config.aggregate) return;
      if (this.aggregateTimer !== null) return;
      this.aggregateTimer = setInterval(() => this.pushAggregate(), this.config.aggregateIntervalMs);
    }
    stop() {
      if (this.aggregateTimer !== null) {
        clearInterval(this.aggregateTimer);
        this.aggregateTimer = null;
      }
    }
    recordFrameEmitted(info) {
      if (!this.config.enabled) return;
      this.framesEmitted += 1;
      this.opsEmitted += info.opCount;
      this.partsAccepted += info.partCount;
      this.bytesAccepted += info.bytes;
      this.lastSequence = info.sequence;
      this.buildMsSum += info.buildMs;
      this.encodeMsSum += info.encodeMs;
      if (!this.config.frameEmitted) return;
      this.push({
        v: 1,
        kind: "frameEmitted",
        t: this.now(),
        generation: info.generation,
        sequence: info.sequence,
        opCount: info.opCount,
        partCount: info.partCount,
        bytes: info.bytes,
        tableSize: info.tableSize,
        buildMs: info.buildMs,
        encodeMs: info.encodeMs
      });
    }
    recordTransportDeferred(info) {
      if (!this.config.enabled) return;
      this.deferredCount += 1;
      if (!this.config.transportDeferred) return;
      this.push({
        v: 1,
        kind: "transportDeferred",
        t: this.now(),
        generation: info.generation,
        sequence: info.sequence,
        pendingParts: info.pendingParts
      });
    }
    recordClockStalled(info) {
      if (!this.config.enabled || !this.config.clock) return;
      this.push({
        v: 1,
        kind: "clockStalled",
        t: this.now(),
        sinceLastTickMs: info.sinceLastTickMs,
        rateHz: info.rateHz
      });
    }
    recordRateChanged(info) {
      if (!this.config.enabled || !this.config.clock) return;
      this.push({
        v: 1,
        kind: "rateChanged",
        t: this.now(),
        fromHz: info.fromHz,
        toHz: info.toHz,
        reason: info.reason
      });
    }
    pushAggregate() {
      if (!this.config.enabled || !this.config.aggregate) return;
      this.push({
        v: 1,
        kind: "aggregate",
        t: this.now(),
        framesEmitted: this.framesEmitted,
        opsEmitted: this.opsEmitted,
        partsAccepted: this.partsAccepted,
        bytesAccepted: this.bytesAccepted,
        deferredCount: this.deferredCount,
        lastSequence: this.lastSequence,
        avgBuildMs: this.framesEmitted > 0 ? this.buildMsSum / this.framesEmitted : 0,
        avgEncodeMs: this.framesEmitted > 0 ? this.encodeMsSum / this.framesEmitted : 0
      });
    }
    push(message) {
      const plane = this.dataPlane;
      if (plane === null || !plane.isOpen) return;
      const bytes = this.textEncoder.encode(JSON.stringify(message));
      void plane.send(3 /* Telemetry */, bytes);
    }
  };

  // browser/mirror/projection/virtual/transport/consoleFrameTransport.ts
  function hexPreview(bytes, max) {
    const n = Math.min(bytes.length, max);
    const parts = [];
    for (let i = 0; i < n; i++) {
      parts.push(bytes[i].toString(16).padStart(2, "0"));
    }
    const suffix = bytes.length > max ? ` \u2026(+${bytes.length - max})` : "";
    return parts.join(" ") + suffix;
  }
  var ConsoleFrameTransport = class {
    label;
    previewBytes;
    previewMaxBytes;
    sendCount = 0;
    lastPayload = null;
    constructor(opts = {}) {
      this.label = opts.label ?? "[FrameTransport]";
      this.previewBytes = opts.previewBytes ?? true;
      this.previewMaxBytes = opts.previewMaxBytes ?? 32;
    }
    get sends() {
      return this.sendCount;
    }
    /** Most recent payload (copy). */
    get lastBytes() {
      return this.lastPayload === null ? null : this.lastPayload.slice();
    }
    send(bytes) {
      this.sendCount += 1;
      this.lastPayload = bytes.slice();
      if (this.previewBytes) {
        console.log(
          `${this.label} send #${this.sendCount} len=${bytes.length}`,
          hexPreview(bytes, this.previewMaxBytes)
        );
      } else {
        console.log(`${this.label} send #${this.sendCount} len=${bytes.length}`);
      }
      return "accepted";
    }
  };

  // browser/mirror/projection/virtual/transport/loopbackDataPlane.ts
  var DEFAULT_WATERMARK = 256 * 1024;
  var LoopbackDataPlane = class {
    socket = null;
    url = null;
    watermark;
    handler = null;
    constructor(opts = {}) {
      this.watermark = opts.bufferedAmountWatermark ?? DEFAULT_WATERMARK;
    }
    get destinationUrl() {
      return this.url;
    }
    get isOpen() {
      return this.socket?.readyState === WebSocket.OPEN;
    }
    open(url) {
      this.close();
      this.url = url;
      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      socket.addEventListener("message", (ev) => this.onSocketMessage(ev));
      this.socket = socket;
    }
    /** Resolves when the underlying WebSocket is OPEN. */
    whenOpen(timeoutMs = 15e3) {
      if (this.isOpen) return Promise.resolve();
      const socket = this.socket;
      if (socket === null) {
        return Promise.reject(new Error("LoopbackDataPlane.whenOpen: not opened"));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("LoopbackDataPlane.whenOpen: timeout"));
        }, timeoutMs);
        socket.addEventListener(
          "open",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
        socket.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(new Error("LoopbackDataPlane.whenOpen: error"));
          },
          { once: true }
        );
      });
    }
    close() {
      const socket = this.socket;
      this.socket = null;
      if (socket === null) return;
      try {
        socket.close();
      } catch {
      }
    }
    setHandler(handler) {
      this.handler = handler;
    }
    send(channel, payload) {
      const socket = this.socket;
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return "deferred";
      }
      if (socket.bufferedAmount > this.watermark) {
        return "deferred";
      }
      socket.send(encodePlaneEnvelope(channel, payload));
      return "accepted";
    }
    onSocketMessage(ev) {
      if (this.handler === null) return;
      const data = ev.data;
      let bytes;
      if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else if (ArrayBuffer.isView(data)) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } else {
        return;
      }
      const env = decodePlaneEnvelope(bytes);
      if (env === null) return;
      this.handler(env.channel, env.payload);
    }
  };

  // browser/mirror/projection/virtual/transport/planeFrameTransport.ts
  var PlaneFrameTransport = class {
    constructor(plane) {
      this.plane = plane;
    }
    send(bytes) {
      return this.plane.send(1 /* Frame */, bytes);
    }
  };

  // browser/mirror/projection/virtual/transport/loopbackFrameTransport.ts
  var LoopbackFrameTransport = class {
    plane;
    frames;
    constructor(opts = {}) {
      this.plane = new LoopbackDataPlane(opts);
      this.frames = new PlaneFrameTransport(this.plane);
    }
    /** Underlying mux — register Control / Telemetry handlers here later. */
    get dataPlane() {
      return this.plane;
    }
    get destinationUrl() {
      return this.plane.destinationUrl;
    }
    get isOpen() {
      return this.plane.isOpen;
    }
    open(url) {
      this.plane.open(url);
    }
    whenOpen(timeoutMs) {
      return this.plane.whenOpen(timeoutMs);
    }
    close() {
      this.plane.close();
    }
    send(bytes) {
      return this.frames.send(bytes);
    }
  };

  // browser/mirror/projection/virtual/transport/nullFrameTransport.ts
  var NullFrameTransport = class {
    send(_bytes) {
      return "accepted";
    }
  };

  // browser/mirror/projection/virtual/bootstrap.ts
  document.currentScript?.remove();
  void (async () => {
    if (globalThis.__speculumProjection) return;
    const config = readProjectionConfig();
    const domNodes = new DomNodeTable();
    domNodes.bind(document, DOCUMENT_ID);
    domNodes.setGeneration(config.generation);
    const table = new ReplicatedTable();
    const mutationBuffer = new MutationBuffer();
    const domMutationObserver = new DomMutationObserver({ buffer: mutationBuffer });
    const frameBuilder = new TableFrameBuilder({ domNodes, table });
    const encoder = new BinaryFrameEncoder({ maxFrameBytes: config.maxFrameBytes });
    let frameTransport;
    let dataPlane = null;
    let loopback = null;
    if (config.transport === "console") {
      frameTransport = new ConsoleFrameTransport();
    } else if (config.transport === "discard") {
      frameTransport = new NullFrameTransport();
    } else {
      loopback = new LoopbackFrameTransport({
        bufferedAmountWatermark: config.bufferedAmountWatermark
      });
      loopback.open(config.dataPlaneUrl);
      frameTransport = loopback;
      dataPlane = loopback.dataPlane;
    }
    const telemetry = new ProjectionTelemetry({
      config: config.telemetry,
      dataPlane
    });
    const frameClock = new TimerFrameClock({
      frameRateHz: config.frameRateHz,
      onStall: (info) => {
        telemetry.recordClockStalled({
          sinceLastTickMs: info.sinceLastTickMs,
          rateHz: frameClock.rateHz
        });
      },
      onRateChanged: (info) => telemetry.recordRateChanged(info)
    });
    domMutationObserver.start();
    if (loopback) {
      try {
        await loopback.whenOpen();
      } catch (err) {
        console.error("[speculumProjection] data plane open failed", err);
      }
    }
    const frameEmitter = new FrameEmitter({
      clock: frameClock,
      buffer: mutationBuffer,
      builder: frameBuilder,
      encoder,
      transport: frameTransport,
      domNodes,
      telemetry
    });
    if (loopback) {
      loopback.dataPlane.setHandler((channel, payload) => {
        if (channel !== 2 /* Control */) return;
        let msg;
        try {
          msg = JSON.parse(new TextDecoder().decode(payload));
        } catch {
          return;
        }
        if (typeof msg !== "object" || msg === null) return;
        const req = msg;
        if (req.type !== "requestResync") return;
        console.log(
          "[speculumProjection] resync requested \u2014 reason=%s clientGeneration=%s clientSequence=%s",
          String(req.reason),
          String(req.generation),
          String(req.sequence)
        );
        frameEmitter.requestResync((seq) => emitResyncFrame(domNodes, table, domNodes.generation, seq));
      });
    }
    const resyncFrame = resyncVirtual(domNodes, table, frameEmitter.currentSequence + 1);
    if (config.generation > 1) {
      resyncFrame.ops.unshift({ op: 2 /* EpochReset */, generation: config.generation });
    }
    mutationBuffer.drain();
    await frameEmitter.sendInitial(resyncFrame);
    frameEmitter.start();
    telemetry.start();
    globalThis.__speculumProjection = {
      version: 1,
      domNodes,
      table,
      frameClock,
      mutationBuffer,
      domMutationObserver,
      frameBuilder,
      frameEmitter,
      frameTransport,
      telemetry
    };
  })();
})();
