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
    [98 /* TextSet */]: "textSet",
    [99 /* PropSet */]: "propSet",
    [160 /* SheetNew */]: "sheetNew",
    [161 /* SheetDrop */]: "sheetDrop",
    [162 /* SheetOrder */]: "sheetOrder",
    [163 /* RuleNew */]: "ruleNew",
    [164 /* RuleDrop */]: "ruleDrop",
    [165 /* RuleSet */]: "ruleSet"
  };
  function opCodeName(code) {
    return NAMES[code] ?? `unknown(${code})`;
  }

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
    cssomPoll: false,
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
    "clock",
    "cssomPoll"
  ];
  function emptyCssomPollStats() {
    return {
      source: "idle",
      sequence: 0,
      pollMs: 0,
      identityWalkMs: 0,
      cssTextSerializeMs: 0,
      readableSheetCount: 0,
      unreadableSheetCount: 0,
      topLevelRulesVisited: 0,
      topLevelRulesSerialized: 0,
      styleTagTextUnchangedSheets: 0,
      rulesAppeared: 0,
      rulesDisappeared: 0,
      rulesTextChangedInPlace: 0,
      sheetsWithRuleListChanged: 0,
      sheetsAborted: 0,
      slotsSkipped: 0,
      idleSlices: 0,
      opCount: 0,
      opSheetNew: 0,
      opSheetDrop: 0,
      opSheetOrder: 0,
      opRuleNew: 0,
      opRuleDrop: 0,
      opRuleSet: 0
    };
  }
  function countCssomOps(ops) {
    let opSheetNew = 0;
    let opSheetDrop = 0;
    let opSheetOrder = 0;
    let opRuleNew = 0;
    let opRuleDrop = 0;
    let opRuleSet = 0;
    for (let i = 0; i < ops.length; i++) {
      switch (ops[i].op) {
        case 160 /* SheetNew */:
          opSheetNew += 1;
          break;
        case 161 /* SheetDrop */:
          opSheetDrop += 1;
          break;
        case 162 /* SheetOrder */:
          opSheetOrder += 1;
          break;
        case 163 /* RuleNew */:
          opRuleNew += 1;
          break;
        case 164 /* RuleDrop */:
          opRuleDrop += 1;
          break;
        case 165 /* RuleSet */:
          opRuleSet += 1;
          break;
        default:
          break;
      }
    }
    return {
      opCount: opSheetNew + opSheetDrop + opSheetOrder + opRuleNew + opRuleDrop + opRuleSet,
      opSheetNew,
      opSheetDrop,
      opSheetOrder,
      opRuleNew,
      opRuleDrop,
      opRuleSet
    };
  }
  function stampCssomPoll(stats, patch) {
    return { ...stats, ...patch };
  }

  // browser/mirror/projection/virtual/config/projectionConfig.ts
  var PROJECTION_CONFIG_GLOBAL = "__SPECULUM_PROJECTION__";
  var DEFAULTS2 = {
    transport: "loopback",
    frameRateHz: 60,
    bufferedAmountWatermark: 256 * 1024,
    maxFrameBytes: 1 << 20,
    cssomPollHz: 0
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
  function asNonNegativeNumber(value, fallback, label) {
    if (value === void 0 || value === null) return fallback;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`ProjectionConfig.${label} must be >= 0 (got ${String(value)})`);
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
      generation: asPositiveNumber(bag.generation, 1, "generation"),
      cssomPollHz: asNonNegativeNumber(bag.cssomPollHz, DEFAULTS2.cssomPollHz, "cssomPollHz")
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
    extra = /* @__PURE__ */ new Map();
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
      this.unobserveAllRoots();
    }
    observeRoot(root) {
      if (root === this.root || this.extra.has(root)) return;
      const observer = new MutationObserver((records) => this.buffer.push(records));
      observer.observe(root, OBSERVE_OPTIONS);
      this.extra.set(root, observer);
    }
    unobserveRoot(root) {
      const observer = this.extra.get(root);
      if (observer === void 0) return;
      observer.disconnect();
      this.extra.delete(root);
    }
    unobserveAllRoots() {
      for (const observer of this.extra.values()) observer.disconnect();
      this.extra.clear();
    }
    /** Observe every `ShadowRoot` currently in the identity map; drop observers whose root is gone. */
    syncObservedShadowRoots(domNodes) {
      const live = /* @__PURE__ */ new Set();
      for (const [, node] of domNodes.liveEntries()) {
        if (node instanceof ShadowRoot) {
          live.add(node);
          this.observeRoot(node);
        }
      }
      for (const root of this.extra.keys()) {
        if (!live.has(root)) this.unobserveRoot(root);
      }
    }
    /**
     * Pull records the browser has queued but not yet delivered to the callback (MO delivery is a
     * microtask). Must run immediately before every buffer drain / snapshot — otherwise the table
     * is built from stale delivered records while live DOM already includes those mutations.
     */
    takePendingIntoBuffer() {
      this.takeOne(this.observer);
      for (const observer of this.extra.values()) this.takeOne(observer);
    }
    /** Test hook: feed records without a live MutationObserver. */
    ingestForTest(records) {
      this.buffer.push(records);
    }
    takeOne(observer) {
      if (observer === null) return;
      const pending = observer.takeRecords();
      if (pending.length > 0) this.buffer.push(pending);
    }
  };

  // browser/mirror/projection/models/domNodeKey.ts
  var NONE_DOM_NODE_KEY = 0;

  // browser/mirror/projection/virtual/dom/domNodeTable.ts
  var DomNodeTable = class {
    byNode = /* @__PURE__ */ new WeakMap();
    byKey = /* @__PURE__ */ new Map();
    finalizers;
    /** §1.2: 0 = none, 1 = Document (via {@link bind}), 2… minted monotonically. */
    nextKey = 2;
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
     * (`V4ProjectionBrowserSession`) already knows this navigation is (via `ProjectionConfig.generation`),
     * so a `rebuildAndResync` frame — and every ordinary tick after it — carries the right number for
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
      const key = this.mint();
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
    /**
     * Next session id (DOM or CSSOM). Never returns 0 or 1.
     * CSSOM WeakMaps call this so Sheet/Rule ids share the DOM counter (§1.1).
     */
    mint() {
      if (this.nextKey > 4294967295) throw new Error("DomNodeTable: id space exhausted");
      const key = this.nextKey;
      this.nextKey += 1;
      return key;
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
     * frame-protocol.md §5.8 rebuild identity (`rebuildAndResync`) — clears the map so it can be
     * rebuilt from a live walk. Unlike `bumpGeneration()`, this does NOT advance `generation`:
     * `resync` is a same-generation wholesale replace, not `EPOCH_RESET`. `nextKey` is left
     * untouched, so freshly (re)allocated ids never collide with ids issued before the reset.
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

  // browser/mirror/projection/models/frame.ts
  var FRAME_WIRE_VERSION = 2;
  var DOCUMENT_ID = 1;
  var INSERT_AT_END = 0;
  var SHADOW_MODE_OPEN = 0;
  var SHADOW_INIT_DELEGATES_FOCUS = 1;
  var SHADOW_INIT_CLONABLE = 2;
  var SHADOW_INIT_SERIALIZABLE = 4;
  var CHECK_SCOPE_TABLE = 0;
  var CSSOM_SCOPE_MAIN = 0;
  var CSSOM_SCOPE_PIERCE_HOST = 1;
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
  function spliceCssomBeforeCheck(ops, cssom) {
    if (cssom.length === 0) return ops;
    const last = ops[ops.length - 1];
    if (last !== void 0 && last.op === 1 /* Check */) {
      return [...ops.slice(0, -1), ...cssom, last];
    }
    return [...ops, ...cssom];
  }

  // browser/mirror/projection/models/elementNs.ts
  var ELEMENT_NS_HTML = "http://www.w3.org/1999/xhtml";
  var ELEMENT_NS_SVG = "http://www.w3.org/2000/svg";
  var ELEMENT_NS_MATHML = "http://www.w3.org/1998/Math/MathML";
  function classifyElementNs(namespaceURI) {
    if (namespaceURI === null) return { ns: 3 /* None */ };
    if (namespaceURI === ELEMENT_NS_HTML) return { ns: 0 /* Html */ };
    if (namespaceURI === ELEMENT_NS_SVG) return { ns: 1 /* Svg */ };
    if (namespaceURI === ELEMENT_NS_MATHML) return { ns: 2 /* Mathml */ };
    return { ns: 4 /* Custom */, uri: namespaceURI };
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
  function hashProp(propId, value) {
    if (typeof value === "boolean") return h64Str(`\0P${propId}B${value ? "1" : "0"}`);
    if (typeof value === "number") return h64Str(`\0P${propId}F${value}`);
    return h64Str(`\0P${propId}S${value}`);
  }
  function hashNs(ns, uri) {
    if (ns === 4 /* Custom */) return h64Str(`\0U${uri ?? ""}`);
    return h64Bytes(Uint8Array.of(0, 83, ns & 255));
  }
  function hashShadowInit(mode, initFlags) {
    return h64Bytes(Uint8Array.of(0, 72, mode & 255, initFlags & 255));
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
    /** ELEMENT rows only — id -> propId -> that prop's contentHash contribution. */
    propHashes = /* @__PURE__ */ new Map();
    /** ELEMENT rows only — last PROP_SET scalar (delta compare on the producer). */
    propValues = /* @__PURE__ */ new Map();
    /** Derived, non-hashed: id -> the id currently linked immediately after it under the same parent. */
    nextSiblingOf = /* @__PURE__ */ new Map();
    /** Derived, non-hashed: parentId -> the id currently linked last under that parent (0 = none). */
    lastChildOf = /* @__PURE__ */ new Map();
    /** Host ELEMENT id → owned `SHADOW_ROOT` id. Not hashed; not a light-chain link. */
    shadowRootByHost = /* @__PURE__ */ new Map();
    /** Reverse of `shadowRootByHost` so `dropRow` of the root clears the host index. */
    hostOfShadowRoot = /* @__PURE__ */ new Map();
    tracker = new TableHashTracker();
    /** Stamped onto every row `setRow` touches until changed again — one frame, one `lms` (§4 preamble). */
    currentSequence = 0;
    get tableHash() {
      return this.tracker.value;
    }
    /**
     * Call once per frame before applying its ops (producer: `tableFrameBuilder.ts` / `domResync.ts`;
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
    /**
     * Child ids of `parent` in sibling order (first → last). Walks the derived `lastChildOf` +
     * hashed `prevSibling` chain then reverses — O(children), not hashed. Lab O2 local oracle
     * (`tableLiveOracle.ts`) compares this to live `childNodes`; do not expose `nextSiblingOf`.
     */
    orderedChildIds(parent) {
      const backwards = [];
      const seen = /* @__PURE__ */ new Set();
      let child = this.lastChildOf.get(parent) ?? NONE;
      while (child !== NONE) {
        if (seen.has(child)) break;
        seen.add(child);
        backwards.push(child);
        const row = this.rows.get(child);
        child = row?.prevSibling ?? NONE;
      }
      backwards.reverse();
      return backwards;
    }
    /** Rows with hashed `parent` — O(table). Lab O2 uses this to detect a broken `lastChildOf` walk. */
    lastChildId(parent) {
      return this.lastChildOf.get(parent) ?? NONE;
    }
    countAttachedChildren(parent) {
      let n = 0;
      for (const row of this.rows.values()) {
        if (row.parent === parent && row.kind !== 7 /* ShadowRoot */) n += 1;
      }
      return n;
    }
    /** Owned `SHADOW_ROOT` id of `host`, or 0. */
    shadowRootOf(host) {
      return this.shadowRootByHost.get(host) ?? NONE;
    }
    /** Every stored row id (excludes implicit Document `1`). */
    forEachRow(fn) {
      for (const [id, row] of this.rows) fn(id, row);
    }
    /** Drops every row and derived index — `EPOCH_RESET` (§4.1) and resync's wholesale replace (§5.8). */
    reset() {
      this.rows.clear();
      this.attrHashes.clear();
      this.propHashes.clear();
      this.propValues.clear();
      this.nextSiblingOf.clear();
      this.lastChildOf.clear();
      this.shadowRootByHost.clear();
      this.hostOfShadowRoot.clear();
      this.tracker.clear();
    }
    // ---- NODE_NEW (§4.2) — always creates a detached row (parent=0, prevSibling=0). ----
    /**
     * `ns` defaults to html for existing unit callers (API convenience). Decode never
     * invents a default — the wire `u8` is required.
     */
    createElementRow(id, tagName, attrs, ns = 0 /* Html */, uri) {
      const attrMap = /* @__PURE__ */ new Map();
      let sum = addMod64(hashName(tagName), hashNs(ns, uri));
      for (let i = 0; i < attrs.length; i++) {
        const { name, value } = attrs[i];
        const h = hashAttr(name, value);
        attrMap.set(name, h);
        sum = addMod64(sum, h);
      }
      this.attrHashes.set(id, attrMap);
      this.propHashes.set(id, /* @__PURE__ */ new Map());
      this.propValues.set(id, /* @__PURE__ */ new Map());
      this.setRow(id, 1 /* Element */, NONE, NONE, sum);
    }
    /** TEXT/COMMENT (`value`) or DOCTYPE (`name`) — both a single content-carrying string field. */
    createLeafRow(id, kind, contentField) {
      this.setRow(id, kind, NONE, NONE, hashValue(contentField));
    }
    /**
     * `SHADOW_ROOT` — `parent = host` immediately, not linked into the host's light chain.
     * `prevSibling` stays 0.
     */
    createShadowRootRow(id, host, mode, initFlags) {
      this.setRow(id, 7 /* ShadowRoot */, host, NONE, hashShadowInit(mode, initFlags));
      this.shadowRootByHost.set(host, id);
      this.hostOfShadowRoot.set(id, host);
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
    setProp(id, propId, value) {
      const row = this.rows.get(id);
      if (row === void 0) return;
      const hashMap = this.propHashes.get(id) ?? /* @__PURE__ */ new Map();
      const valueMap = this.propValues.get(id) ?? /* @__PURE__ */ new Map();
      let sum = row.contentHash;
      const old = hashMap.get(propId);
      if (old !== void 0) sum = subMod64(sum, old);
      const h = hashProp(propId, value);
      hashMap.set(propId, h);
      valueMap.set(propId, value);
      this.propHashes.set(id, hashMap);
      this.propValues.set(id, valueMap);
      this.setRow(id, row.kind, row.parent, row.prevSibling, addMod64(sum, h));
    }
    getProp(id, propId) {
      return this.propValues.get(id)?.get(propId);
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
      if (before !== NONE) {
        this.relinkPrevSibling(before, prev);
        if (prev !== NONE) this.nextSiblingOf.set(prev, before);
      } else {
        this.lastChildOf.set(parent, prev);
      }
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
      const owned = this.shadowRootByHost.get(id);
      if (owned !== void 0) this.hostOfShadowRoot.delete(owned);
      this.shadowRootByHost.delete(id);
      const host = this.hostOfShadowRoot.get(id);
      if (host !== void 0) this.shadowRootByHost.delete(host);
      this.hostOfShadowRoot.delete(id);
      this.rows.delete(id);
      this.attrHashes.delete(id);
      this.propHashes.delete(id);
      this.propValues.delete(id);
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
      const seen = /* @__PURE__ */ new Set();
      let child = this.lastChildOf.get(id) ?? NONE;
      while (child !== NONE) {
        if (seen.has(child)) break;
        seen.add(child);
        this.collectSubtreeIds(child, out);
        const row = this.rows.get(child);
        child = row?.prevSibling ?? NONE;
      }
      const shadow = this.shadowRootByHost.get(id);
      if (shadow !== void 0 && shadow !== id) this.collectSubtreeIds(shadow, out);
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
        if (row.prevSibling !== NONE) this.nextSiblingOf.delete(row.prevSibling);
      }
    }
  };

  // browser/mirror/projection/models/propSet.ts
  var PROP_ID_VALUE = 1;
  var PROP_ID_CHECKED = 2;
  var PROP_ID_SELECTED = 3;
  var PROP_ID_DIALOG_MODAL = 4;
  var PROP_ID_POPOVER_OPEN = 5;
  var PROP_ID_MEDIA_PAUSED = 6;
  var PROP_ID_MEDIA_TIME = 7;
  var PROP_ID_MEDIA_MUTED = 8;
  var PROP_ID_MEDIA_VOLUME = 9;
  var PROP_ID_CUSTOM_VALIDITY = 10;
  function propValueKind(propId) {
    switch (propId) {
      case PROP_ID_VALUE:
      case PROP_ID_CUSTOM_VALIDITY:
        return "str";
      case PROP_ID_CHECKED:
      case PROP_ID_SELECTED:
      case PROP_ID_DIALOG_MODAL:
      case PROP_ID_POPOVER_OPEN:
      case PROP_ID_MEDIA_PAUSED:
      case PROP_ID_MEDIA_MUTED:
        return "bool";
      case PROP_ID_MEDIA_TIME:
      case PROP_ID_MEDIA_VOLUME:
        return "f32";
      default:
        return null;
    }
  }
  function propScalarsEqual(a, b) {
    return a === b;
  }

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
    f32(v) {
      this.ensure(4);
      this.view.setFloat32(this.offset, v, true);
      this.offset += 4;
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
        case 99 /* PropSet */:
          return this.writePropSet(w, op);
        case 160 /* SheetNew */:
          return this.writeSheetNew(w, op);
        case 161 /* SheetDrop */:
          return this.writeSheetDrop(w, op);
        case 162 /* SheetOrder */:
          return this.writeSheetOrder(w, op);
        case 163 /* RuleNew */:
          return this.writeRuleNew(w, op);
        case 164 /* RuleDrop */:
          return this.writeRuleDrop(w, op);
        case 165 /* RuleSet */:
          return this.writeRuleSet(w, op);
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
        w.u8(op.ns);
        if (op.ns === 4 /* Custom */) {
          const uri = op.uri ?? "";
          if (uri.length === 0) {
            throw new Error("NODE_NEW custom ns requires a non-empty uri (frame-protocol.md \xA74.2)");
          }
          this.writeStrRef(w, uri);
        }
        this.writeStrRef(w, op.name);
        this.writeAttrs(w, op.attrs);
        return;
      }
      if (op.kind === 6 /* Doctype */) {
        this.writeStrRef(w, op.name);
        return;
      }
      if (op.kind === 7 /* ShadowRoot */) {
        w.u32(op.host);
        w.u8(op.mode);
        w.u8(op.initFlags);
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
    writePropSet(w, op) {
      w.u8(99 /* PropSet */);
      w.u32(op.node);
      w.u8(op.propId);
      const kind = propValueKind(op.propId);
      if (kind === "str") {
        this.writeStrRef(w, String(op.value));
        return;
      }
      if (kind === "bool") {
        w.u8(op.value ? 1 : 0);
        return;
      }
      if (kind === "f32") {
        w.f32(typeof op.value === "number" ? op.value : 0);
        return;
      }
      throw new Error(`PROP_SET propId ${op.propId} is not defined (frame-protocol.md \xA74.4)`);
    }
    writeIdList(w, ids) {
      w.u16(ids.length);
      for (let i = 0; i < ids.length; i++) w.u32(ids[i]);
    }
    /** §4.6 — `id u32, scope u8, hostNode u32, before u32`. */
    writeSheetNew(w, op) {
      w.u8(160 /* SheetNew */);
      w.u32(op.id);
      w.u8(op.scope);
      w.u32(op.hostNode);
      w.u32(op.before);
    }
    writeSheetDrop(w, op) {
      w.u8(161 /* SheetDrop */);
      this.writeIdList(w, op.ids);
    }
    writeSheetOrder(w, op) {
      w.u8(162 /* SheetOrder */);
      this.writeIdList(w, op.ids);
    }
    writeRuleNew(w, op) {
      w.u8(163 /* RuleNew */);
      w.u32(op.sheet);
      w.u32(op.id);
      w.u32(op.before);
      this.writeStrRef(w, op.text);
    }
    writeRuleDrop(w, op) {
      w.u8(164 /* RuleDrop */);
      w.u32(op.sheet);
      this.writeIdList(w, op.ids);
    }
    writeRuleSet(w, op) {
      w.u8(165 /* RuleSet */);
      w.u32(op.id);
      this.writeStrRef(w, op.text);
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
        if (op.kind === 1 /* Element */) table.createElementRow(op.id, op.name, op.attrs, op.ns, op.uri);
        else if (op.kind === 6 /* Doctype */) table.createLeafRow(op.id, op.kind, op.name);
        else if (op.kind === 7 /* ShadowRoot */) table.createShadowRootRow(op.id, op.host, op.mode, op.initFlags);
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
      case 99 /* PropSet */:
        table.setProp(op.node, op.propId, op.value);
        return;
      case 160 /* SheetNew */: {
        const parent = op.hostNode === 0 ? DOCUMENT_ID : op.hostNode;
        if (!table.has(op.id)) table.createLeafRow(op.id, 4 /* Sheet */, "");
        table.insertBatch(parent, op.before, [op.id]);
        return;
      }
      case 161 /* SheetDrop */:
        for (let i = 0; i < op.ids.length; i++) {
          const id = op.ids[i];
          const row = table.getRow(id);
          if (row !== void 0 && row.parent !== 0) table.removeBatch(row.parent, [id]);
          table.dropSubtree(id);
        }
        return;
      case 162 /* SheetOrder */:
        if (op.ids.length === 0) return;
        {
          const first = table.getRow(op.ids[0]);
          const parent = first === void 0 || first.parent === 0 ? DOCUMENT_ID : first.parent;
          table.removeBatch(parent, op.ids);
          table.insertBatch(parent, 0, op.ids);
        }
        return;
      case 163 /* RuleNew */:
        if (!table.has(op.id)) table.createLeafRow(op.id, 5 /* Rule */, op.text);
        else table.setValue(op.id, op.text);
        table.insertBatch(op.sheet, op.before, [op.id]);
        return;
      case 164 /* RuleDrop */:
        for (let i = 0; i < op.ids.length; i++) {
          const id = op.ids[i];
          const row = table.getRow(id);
          if (row !== void 0 && row.parent !== 0) table.removeBatch(row.parent, [id]);
          table.dropSubtree(id);
        }
        return;
      case 165 /* RuleSet */:
        table.setValue(op.id, op.text);
        return;
      default:
        return;
    }
  }
  function applyOpsToTable(table, ops) {
    for (let i = 0; i < ops.length; i++) applyOpToTable(table, ops[i]);
  }

  // browser/mirror/projection/virtual/frame/frameEmitter.ts
  var IDLE_SWEEP_INTERVAL_TICKS = 30;
  var FrameEmitter = class {
    clock;
    buffer;
    builder;
    encoder;
    transport;
    census;
    telemetry;
    pullPendingMutations;
    takePendingCssom;
    table;
    sequence = 0;
    idleTicks = 0;
    pendingFrame = null;
    pendingParts = null;
    pendingPartIndex = 0;
    pendingRecords = null;
    pendingResyncBuild = null;
    /** Ops of the last frame that fully left the transport (PP-FR-1 probe). */
    lastEmittedOps = [];
    constructor(opts) {
      this.clock = opts.clock;
      this.buffer = opts.buffer;
      this.builder = opts.builder;
      this.encoder = opts.encoder;
      this.transport = opts.transport;
      this.census = opts.census;
      this.telemetry = opts.telemetry ?? null;
      this.pullPendingMutations = opts.pullPendingMutations ?? null;
      this.takePendingCssom = opts.takePendingCssom ?? null;
      this.table = opts.table ?? null;
    }
    start() {
      this.clock.start(() => this.onBoundary());
    }
    stop() {
      this.clock.stop();
    }
    /**
     * Drain one boundary. Returns the ops of the frame emitted this call, or `[]` when idle
     * (no sequence advance) — so PP-FR-1 probes never inspect a prior tick's NODE_NEWs.
     */
    flushNow() {
      const seq0 = this.sequence;
      this.onBoundary();
      if (this.sequence === seq0) return [];
      return this.lastEmittedOps;
    }
    get currentSequence() {
      return this.sequence;
    }
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
      const snap = this.census();
      this.telemetry?.recordFrameEmitted({
        generation: frame.generation,
        sequence: frame.sequence,
        opCount: frame.ops.length,
        partCount: parts.length,
        bytes: totalBytes,
        tableSize: snap.tableSize,
        identitySize: snap.identitySize,
        buildMs: 0,
        encodeMs: 0
      });
      this.lastEmittedOps = frame.ops;
      this.sequence = frame.sequence;
    }
    requestResync(build) {
      this.pendingResyncBuild = build;
    }
    onBoundary() {
      this.pullPendingMutations?.();
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
      const cssom = this.takePendingCssom?.() ?? null;
      const cssomOps = cssom?.ops ?? [];
      const hasDomWork = this.buffer.hasWork();
      if (!hasDomWork && cssomOps.length === 0) {
        this.idleTicks += 1;
        if (this.idleTicks < IDLE_SWEEP_INTERVAL_TICKS) {
          if (cssom !== null) {
            this.telemetry?.recordCssomPoll(stampCssomPoll(cssom.stats, { sequence: 0 }));
          }
          return;
        }
      }
      this.idleTicks = 0;
      const records = hasDomWork ? this.buffer.drain() : [];
      const nextSequence = this.sequence + 1;
      if (cssom !== null) {
        this.telemetry?.recordCssomPoll(stampCssomPoll(cssom.stats, { sequence: nextSequence }));
      }
      const snap = this.census();
      const preTableHash = this.table?.tableHash ?? 0n;
      const built = this.builder.build(records, {
        generation: snap.generation,
        sequence: nextSequence
      });
      const unconsumed = this.builder.takeUnconsumedRecords?.();
      if (unconsumed && unconsumed.length > 0) this.buffer.reclaim(unconsumed);
      let ops = built?.ops ?? [];
      ops = spliceCssomBeforeCheck(ops, cssomOps);
      if (cssomOps.length > 0 && this.table !== null) {
        applyOpsToTable(this.table, cssomOps);
      }
      const last = ops[ops.length - 1];
      if (last !== void 0 && last.op === 1 /* Check */ && this.table !== null) {
        last.hash = this.table.tableHash;
      }
      if (ops.length === 0) return;
      const frame = built === null ? createFrame({
        generation: snap.generation,
        sequence: nextSequence,
        ops,
        preTableHash
      }) : { ...built, ops };
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
      const snap = this.census();
      this.telemetry?.recordFrameEmitted({
        generation: frame.generation,
        sequence: frame.sequence,
        opCount: frame.ops.length,
        partCount: parts.length,
        bytes: totalBytes,
        tableSize: stats?.tableSize ?? snap.tableSize,
        identitySize: stats?.identitySize ?? snap.identitySize,
        buildMs: stats?.buildMs ?? 0,
        encodeMs: 0
      });
      this.lastEmittedOps = frame.ops;
      this.sequence = frame.sequence;
      this.pendingFrame = null;
      this.pendingParts = null;
      this.pendingPartIndex = 0;
      this.pendingRecords = null;
    }
  };

  // browser/mirror/projection/virtual/dom/shadowAdmit.ts
  function admissibleShadowRoot(el) {
    const sr = el.shadowRoot;
    if (sr == null) return null;
    if (sr.mode !== "open") return null;
    if (sr.slotAssignment === "manual") return null;
    return sr;
  }
  function shadowInitFlags(sr) {
    let flags = 0;
    if (sr.delegatesFocus) flags |= SHADOW_INIT_DELEGATES_FOCUS;
    const extra = sr;
    if (extra.clonable === true) flags |= SHADOW_INIT_CLONABLE;
    if (extra.serializable === true) flags |= SHADOW_INIT_SERIALIZABLE;
    return flags;
  }
  function collectAdmittedShadowRoots(root) {
    const out = [];
    const visit = (node) => {
      if (node instanceof Element) {
        const sr = admissibleShadowRoot(node);
        if (sr !== null) {
          out.push(sr);
          visit(sr);
        }
      }
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) visit(children[i]);
    };
    visit(root);
    return out;
  }

  // browser/mirror/projection/virtual/dom/domNodeDescribe.ts
  function nodeKindOf(node) {
    if (node instanceof ShadowRoot) return 7 /* ShadowRoot */;
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
  function describeNodeNew(id, kind, node, hostId) {
    if (kind === 7 /* ShadowRoot */) {
      const sr = node;
      return {
        op: 32 /* NodeNew */,
        id,
        kind: 7 /* ShadowRoot */,
        host: hostId ?? 0,
        mode: SHADOW_MODE_OPEN,
        initFlags: shadowInitFlags(sr)
      };
    }
    if (kind === 1 /* Element */) {
      const el = node;
      const classified = classifyElementNs(el.namespaceURI);
      return {
        op: 32 /* NodeNew */,
        id,
        kind,
        ns: classified.ns,
        name: el.tagName.toLowerCase(),
        attrs: readAttrs(el),
        ...classified.ns === 4 /* Custom */ ? { uri: classified.uri } : {}
      };
    }
    if (kind === 6 /* Doctype */) {
      return { op: 32 /* NodeNew */, id, kind, name: node.name || "html" };
    }
    return { op: 32 /* NodeNew */, id, kind, value: node.textContent ?? "" };
  }

  // browser/mirror/projection/virtual/dom/domResync.ts
  function rebuildDomIdentity(domNodes, root = document) {
    domNodes.resetIdentity();
    domNodes.bind(root, DOCUMENT_ID);
    allocateConnectedSubtree(root, domNodes);
  }
  function describeDomResync(domNodes, formIndex) {
    const ops = [];
    formIndex.rebuild(domNodes);
    for (const [id, node] of domNodes.liveEntries()) {
      if (id === DOCUMENT_ID) continue;
      if (!node.isConnected) {
        domNodes.release(node);
        continue;
      }
      const kind = nodeKindOf(node);
      if (kind === null) continue;
      if (kind === 7 /* ShadowRoot */) {
        const hostId = domNodes.keyOf(node.host);
        if (hostId === NONE_DOM_NODE_KEY) continue;
        ops.push(describeNodeNew(id, kind, node, hostId));
        continue;
      }
      ops.push(describeNodeNew(id, kind, node));
    }
    for (const [id, node] of domNodes.liveEntries()) {
      if (node instanceof ShadowRoot) {
        pushChildInsert(ops, id, node.childNodes, domNodes);
        continue;
      }
      const children = node.childNodes;
      if (children.length === 0) continue;
      pushChildInsert(ops, id, children, domNodes);
    }
    return ops;
  }
  function pushChildInsert(ops, parent, children, domNodes) {
    const ids = [];
    for (const child of children) {
      const childId = domNodes.keyOf(child);
      if (childId === NONE_DOM_NODE_KEY) continue;
      ids.push(childId);
    }
    if (ids.length > 0) ops.push({ op: 64 /* Insert */, parent, before: INSERT_AT_END, ids });
  }
  function allocateConnectedSubtree(root, domNodes) {
    const children = root.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (nodeKindOf(child) !== null) domNodes.allocate(child);
      allocateConnectedSubtree(child, domNodes);
    }
    if (root instanceof Element) {
      const sr = admissibleShadowRoot(root);
      if (sr !== null) {
        domNodes.allocate(sr);
        allocateConnectedSubtree(sr, domNodes);
      }
    }
  }

  // browser/mirror/projection/virtual/resync.ts
  function emitResyncFrame(planes, sequence) {
    const { domNodes, table, cssom, formIndex } = planes;
    const generation = domNodes.generation;
    const domOps = describeDomResync(domNodes, formIndex);
    const cssomScan = cssom.blockingScan();
    table.reset();
    table.setSequence(sequence);
    applyOpsToTable(table, domOps);
    const propOps = formIndex.sample(domNodes, table);
    if (propOps.length > 0) applyOpsToTable(table, propOps);
    if (cssomScan.ops.length > 0) applyOpsToTable(table, cssomScan.ops);
    const ops = spliceCssomBeforeCheck(
      [
        ...domOps,
        ...propOps,
        { op: 1 /* Check */, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: table.tableHash }
      ],
      cssomScan.ops
    );
    return {
      frame: createFrame({ generation, sequence, ops, resync: true, preTableHash: 0n }),
      cssom: stampCssomPoll(cssomScan.stats, { source: "resync", sequence })
    };
  }
  function rebuildAndResync(planes, sequence) {
    rebuildDomIdentity(planes.domNodes);
    return emitResyncFrame(planes, sequence);
  }

  // browser/mirror/projection/models/tableDigest.ts
  function digestReplicatedTable(table) {
    return { rowCount: table.size, tableHash: table.tableHash.toString() };
  }

  // browser/mirror/projection/models/tableLiveOracle.ts
  var MAX_DIVERGENCES = 50;
  var NONE2 = 0;
  function isSkippedKind(kind) {
    return kind === 4 /* Sheet */ || kind === 5 /* Rule */ || kind === 7 /* ShadowRoot */;
  }
  function orderedDomChildIds(table, parent) {
    const all = table.orderedChildIds(parent);
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const id = all[i];
      const row = table.getRow(id);
      if (row !== void 0 && isSkippedKind(row.kind)) continue;
      out.push(id);
    }
    return out;
  }
  function idsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  function compareTableToLiveOrder(table, liveChildren) {
    const divergences = [];
    let count = 0;
    const record = (path, kind, details) => {
      count += 1;
      if (divergences.length < MAX_DIVERGENCES) divergences.push({ path, kind, details });
    };
    const liveIds = /* @__PURE__ */ new Set();
    for (const kids of liveChildren.values()) {
      for (let i = 0; i < kids.length; i++) liveIds.add(kids[i]);
    }
    const parents = /* @__PURE__ */ new Set([DOCUMENT_ID]);
    for (const parent of liveChildren.keys()) parents.add(parent);
    for (const parent of parents) {
      const tableOrder = orderedDomChildIds(table, parent);
      const liveOrder = liveChildren.get(parent) ?? [];
      if (!idsEqual(tableOrder, liveOrder)) {
        const hashed = table.countAttachedChildren(parent);
        const lastWalk = tableOrder.length > 0 ? tableOrder[tableOrder.length - 1] : 0;
        const lastRow = lastWalk !== 0 ? table.getRow(lastWalk) : void 0;
        record(
          `#${parent}`,
          "child_order_mismatch",
          `walkLen=${tableOrder.length} hashedAttached=${hashed} liveLen=${liveOrder.length} tableHead=[${tableOrder.slice(0, 8).join(",")}] liveHead=[${liveOrder.slice(0, 8).join(",")}] lastWalk=#${lastWalk} lastRow=${lastRow ? `parent=${lastRow.parent} prev=${lastRow.prevSibling}` : "missing"}`
        );
      }
    }
    for (const id of liveIds) {
      const row = table.getRow(id);
      if (row === void 0) {
        record(`#${id}`, "missing_in_table", "connected mapped id has no table row");
      } else if (row.parent === NONE2) {
        record(`#${id}`, "detached_but_connected", "table parent=0 but id appears in live child order");
      }
    }
    table.forEachRow((id, row) => {
      if (row.parent === NONE2) return;
      if (isSkippedKind(row.kind)) return;
      const parentIsLive = row.parent === DOCUMENT_ID || liveIds.has(row.parent) || liveChildren.has(row.parent);
      if (!parentIsLive) return;
      if (!liveIds.has(id)) {
        record(`#${id}`, "extra_attached_in_table", `attached under ${row.parent} but absent from live walk`);
      }
    });
    return { kind: "table_live", identical: count === 0, divergenceCount: count, divergences };
  }

  // browser/mirror/projection/virtual/dom/tableLiveOracle.ts
  function compareTableToLiveDom(table, domNodes, root) {
    const liveChildren = /* @__PURE__ */ new Map();
    const visit = (node, id) => {
      const kids = [];
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (nodeKindOf(child) === null) continue;
        const childId = domNodes.keyOf(child);
        if (childId === NONE_DOM_NODE_KEY) continue;
        kids.push(childId);
        visit(child, childId);
      }
      if (node instanceof Element) {
        const sr = admissibleShadowRoot(node);
        if (sr !== null) {
          const rootId = domNodes.keyOf(sr);
          if (rootId !== NONE_DOM_NODE_KEY) visit(sr, rootId);
        }
      }
      liveChildren.set(id, kids);
    };
    visit(root, DOCUMENT_ID);
    const result = compareTableToLiveOrder(table, liveChildren);
    if (result.identical) return result;
    return {
      ...result,
      divergences: result.divergences.map((d) => {
        if (d.kind !== "extra_attached_in_table" && d.kind !== "missing_in_table" && d.kind !== "detached_but_connected") {
          return d;
        }
        const id = Number(d.path.slice(1));
        const node = Number.isFinite(id) ? domNodes.get(id) : void 0;
        if (node === void 0) return { ...d, details: `${d.details}; identity=missing` };
        return {
          ...d,
          details: `${d.details}; nodeType=${node.nodeType} name=${node.nodeName} connected=${node.isConnected} parent=${node.parentNode?.nodeName ?? "null"}`
        };
      })
    };
  }

  // browser/mirror/projection/models/cssomTableLiveOracle.ts
  var MAX_DIVERGENCES2 = 50;
  function idsEqual2(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  function orderedKindChildIds(table, parent, kind) {
    const all = table.orderedChildIds(parent);
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const id = all[i];
      const row = table.getRow(id);
      if (row !== void 0 && row.kind === kind) out.push(id);
    }
    return out;
  }
  function emptyCssomTableLiveOracleResult() {
    return { kind: "cssom_table_live", identical: true, divergenceCount: 0, divergences: [] };
  }
  function compareTableToLiveCssom(table, liveSheets) {
    const divergences = [];
    let count = 0;
    const record = (path, kind, details) => {
      count += 1;
      if (divergences.length < MAX_DIVERGENCES2) divergences.push({ path, kind, details });
    };
    const byParent = /* @__PURE__ */ new Map();
    for (const live of liveSheets) {
      const parent = live.hostNode ?? DOCUMENT_ID;
      const key = parent === 0 ? DOCUMENT_ID : parent;
      let group = byParent.get(key);
      if (group === void 0) {
        group = [];
        byParent.set(key, group);
      }
      group.push(live);
    }
    const tableParents = /* @__PURE__ */ new Set([DOCUMENT_ID, ...byParent.keys()]);
    table.forEachRow((_id, row) => {
      if (row.kind === 4 /* Sheet */) {
        tableParents.add(row.parent === 0 ? DOCUMENT_ID : row.parent);
      }
    });
    for (const parent of tableParents) {
      const tableSheets = orderedKindChildIds(table, parent, 4 /* Sheet */);
      const liveGroup = byParent.get(parent) ?? [];
      const liveSheetIds = liveGroup.map((s) => s.id);
      if (!idsEqual2(tableSheets, liveSheetIds)) {
        record(
          parent === DOCUMENT_ID ? "#sheets" : `#${parent}/sheets`,
          "sheet_order_mismatch",
          `table=[${tableSheets.slice(0, 8).join(",")}] live=[${liveSheetIds.slice(0, 8).join(",")}]`
        );
      }
      const liveSheetSet = new Set(liveSheetIds);
      for (const id of tableSheets) {
        if (!liveSheetSet.has(id)) record(`#${id}`, "extra_in_table", "Sheet row not in live readable list");
      }
      for (const live of liveGroup) {
        if (table.getRow(live.id) === void 0) {
          record(`#${live.id}`, "missing_in_table", "live readable sheet has no table row");
          continue;
        }
        const tableRules = orderedKindChildIds(table, live.id, 5 /* Rule */);
        if (!idsEqual2(tableRules, live.ruleIds)) {
          record(
            `#${live.id}`,
            "rule_order_mismatch",
            `table=[${tableRules.slice(0, 8).join(",")}] live=[${live.ruleIds.slice(0, 8).join(",")}]`
          );
        }
        const n = Math.min(tableRules.length, live.ruleIds.length, live.ruleHashes.length);
        for (let i = 0; i < n; i++) {
          const rid = live.ruleIds[i];
          if (tableRules[i] !== rid) continue;
          const row = table.getRow(rid);
          if (row === void 0) {
            record(`#${rid}`, "missing_in_table", "live rule has no table row");
            continue;
          }
          if (row.contentHash !== live.ruleHashes[i]) {
            record(`#${rid}`, "rule_content_mismatch", `sheet=#${live.id} contentHash diverged`);
          }
        }
        for (const rid of live.ruleIds) {
          if (table.getRow(rid) === void 0) record(`#${rid}`, "missing_in_table", "live rule has no table row");
        }
        for (const rid of tableRules) {
          if (!live.ruleIds.includes(rid)) record(`#${rid}`, "extra_in_table", `Rule row not in live cssRules of sheet #${live.id}`);
        }
      }
    }
    return { kind: "cssom_table_live", identical: count === 0, divergenceCount: count, divergences };
  }

  // browser/mirror/projection/virtual/cssom/cssomSheetList.ts
  function pushAdopted(out, adopted, hostNode) {
    if (!adopted) return;
    for (let i = 0; i < adopted.length; i++) {
      const s = adopted[i];
      if (!s || s.ownerNode) continue;
      out.push({ sheet: s, hostNode });
    }
  }
  function collectCssomPlaneSheets(doc, hostIdOf) {
    const out = [];
    pushAdopted(out, doc.adoptedStyleSheets, 0);
    if (hostIdOf === void 0) return out;
    const roots = collectAdmittedShadowRoots(doc);
    for (let i = 0; i < roots.length; i++) {
      const sr = roots[i];
      const hostId = hostIdOf(sr.host);
      if (!hostId) continue;
      pushAdopted(out, sr.adoptedStyleSheets, hostId);
    }
    return out;
  }

  // browser/mirror/projection/virtual/cssom/cssomTableLiveOracle.ts
  function compareTableToLiveCssomDom(table, ids, doc = document, hostIdOf) {
    if (ids === null) return emptyCssomTableLiveOracleResult();
    const liveSheets = [];
    for (const listed of collectCssomPlaneSheets(doc, hostIdOf)) {
      const list = tryCssRules(listed.sheet);
      if (list === null) continue;
      const sheetId = ids.peekSheet(listed.sheet);
      if (sheetId === void 0) continue;
      const ruleIds = [];
      const ruleHashes = [];
      for (let i = 0; i < list.length; i++) {
        const rule = list.item(i);
        if (rule === null) continue;
        const rid = ids.peekRule(rule);
        if (rid === void 0) continue;
        let text = "";
        try {
          text = rule.cssText;
        } catch {
          continue;
        }
        ruleIds.push(rid);
        ruleHashes.push(hashValue(text));
      }
      liveSheets.push({ id: sheetId, hostNode: listed.hostNode, ruleIds, ruleHashes });
    }
    return compareTableToLiveCssom(table, liveSheets);
  }
  function tryCssRules(sheet) {
    try {
      return sheet.cssRules;
    } catch {
      return null;
    }
  }

  // browser/mirror/projection/virtual/dom/formPropIndex.ts
  var SKIP_INPUT_TYPES = /* @__PURE__ */ new Set(["file", "button", "submit", "reset", "image"]);
  function classifyFormControl(node) {
    if (!(node instanceof Element)) return null;
    const tag = node.tagName;
    if (tag === "TEXTAREA") {
      return { propId: PROP_ID_VALUE, value: node.value };
    }
    if (tag === "OPTION") {
      return { propId: PROP_ID_SELECTED, value: node.selected };
    }
    if (tag !== "INPUT") return null;
    const type = (node.type || "text").toLowerCase();
    if (SKIP_INPUT_TYPES.has(type)) return null;
    if (type === "checkbox" || type === "radio") {
      return { propId: PROP_ID_CHECKED, value: node.checked };
    }
    return { propId: PROP_ID_VALUE, value: node.value };
  }
  function isFormIndexCandidate(node) {
    return classifyFormControl(node) !== null;
  }
  var FormPropIndex = class {
    nodes = /* @__PURE__ */ new Set();
    addIfIndexed(node) {
      if (isFormIndexCandidate(node)) this.nodes.add(node);
    }
    remove(node) {
      this.nodes.delete(node);
    }
    clear() {
      this.nodes.clear();
    }
    rebuild(domNodes) {
      this.nodes.clear();
      for (const [, node] of domNodes.liveEntries()) this.addIfIndexed(node);
    }
    /** Emit PROP_SET when live ≠ table.props. Drops disconnected nodes from the index. */
    sample(domNodes, table) {
      const ops = [];
      for (const node of [...this.nodes]) {
        if (!node.isConnected) {
          this.nodes.delete(node);
          continue;
        }
        const classified = classifyFormControl(node);
        if (classified === null) continue;
        const id = domNodes.keyOf(node);
        if (id === NONE_DOM_NODE_KEY) continue;
        if (propScalarsEqual(table.getProp(id, classified.propId), classified.value)) continue;
        ops.push({
          op: 99 /* PropSet */,
          node: id,
          propId: classified.propId,
          value: classified.value
        });
      }
      return ops;
    }
  };
  function snapshotFormControls(doc) {
    const out = [];
    const nodes = doc.querySelectorAll("input, textarea, option");
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const classified = classifyFormControl(el);
      if (classified === null) continue;
      const key = formControlKey(el);
      if (key === null) continue;
      const snap = { key };
      if (classified.propId === PROP_ID_VALUE) snap.value = String(classified.value);
      else if (classified.propId === PROP_ID_CHECKED) snap.checked = Boolean(classified.value);
      else snap.selected = Boolean(classified.value);
      out.push(snap);
    }
    out.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    return out;
  }
  function formControlKey(el) {
    if (el.id) return el.id;
    if (el.tagName === "OPTION") {
      const select = el.closest("select");
      const selectId = select?.id || "";
      const value = el.value;
      if (!selectId && !value) return null;
      return `option:${selectId}:${value}`;
    }
    return null;
  }

  // browser/mirror/projection/virtual/snapshot.ts
  function probeNodeNewConnected(ops, domNodes) {
    const disconnectedIds = [];
    let checked = 0;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.op !== 32 /* NodeNew */) continue;
      checked += 1;
      const node = domNodes.get(op.id);
      if (node === void 0 || !node.isConnected) disconnectedIds.push(op.id);
    }
    return { ok: disconnectedIds.length === 0, checked, disconnectedIds };
  }
  function sheetCssText(sheet) {
    try {
      const parts = [];
      for (let i = 0; i < sheet.cssRules.length; i++) {
        const r = sheet.cssRules.item(i);
        if (r) parts.push(r.cssText);
      }
      return parts.join("\n");
    } catch {
      return "";
    }
  }
  function probeCssomPaintBoundary(doc) {
    const authorEl = doc.getElementById("author-probe");
    const adoptedEl = doc.getElementById("adopted-probe");
    if (!authorEl || !adoptedEl) return null;
    const view = doc.defaultView;
    const authorColor = view ? view.getComputedStyle(authorEl).color : "";
    const adoptedColor = view ? view.getComputedStyle(adoptedEl).color : "";
    const adopted = doc.adoptedStyleSheets ? Array.from(doc.adoptedStyleSheets) : [];
    const styleEls = Array.from(doc.querySelectorAll("style"));
    const authorTexts = /* @__PURE__ */ new Set();
    for (let i = 0; i < styleEls.length; i++) {
      const el = styleEls[i];
      const sheet = el.sheet;
      if (sheet) authorTexts.add(sheetCssText(sheet));
      else if (el.textContent) authorTexts.add(el.textContent);
    }
    let doublePaint = false;
    for (let i = 0; i < adopted.length; i++) {
      const s = adopted[i];
      if (s.ownerNode) doublePaint = true;
      const text = sheetCssText(s);
      if (text.length > 0 && authorTexts.has(text)) doublePaint = true;
    }
    return {
      authorColor,
      adoptedColor,
      adoptedCount: adopted.length,
      styleSheetCount: doc.styleSheets.length,
      styleElCount: styleEls.length,
      doublePaint
    };
  }
  function takeSnapshot(planes, opts = {}) {
    const mode = opts.cssom ?? "none";
    let cssom = null;
    let lastOps = [];
    if (mode === "none") {
      planes.cssom.halt();
      lastOps = planes.flushDom();
    } else if (mode === "committed") {
      lastOps = planes.flushDom();
    } else {
      const scan = planes.cssom.blockingScan(true);
      cssom = stampCssomPoll(scan.stats, { source: "snapshotScan" });
      lastOps = planes.flushDom();
      cssom = stampCssomPoll(cssom, { sequence: planes.currentSequence() });
    }
    const o2 = compareTableToLiveDom(planes.table, planes.domNodes, document);
    const cssomO2 = mode === "none" ? null : compareTableToLiveCssomDom(
      planes.table,
      planes.cssomIds,
      document,
      (host) => planes.domNodes.keyOf(host)
    );
    return {
      generation: planes.domNodes.generation,
      sequence: planes.currentSequence(),
      o2,
      table: digestReplicatedTable(planes.table),
      cssom,
      cssomO2,
      nodeNewConnected: probeNodeNewConnected(lastOps, planes.domNodes),
      cascade: probeCssomPaintBoundary(document),
      formProps: snapshotFormControls(document)
    };
  }

  // browser/mirror/projection/virtual/dom/tableFrameBuilder.ts
  var EMPTY_OP_COUNTS = {};
  var TableFrameBuilder = class {
    domNodes;
    table;
    formIndex;
    collectOpCounts;
    nodeDropAgeSequences;
    maxNodeDropsPerSweep;
    observeShadowRoot;
    unobserveShadowRoot;
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
      this.formIndex = opts.formIndex;
      this.collectOpCounts = opts.collectOpCounts ?? false;
      this.nodeDropAgeSequences = opts.nodeDropAgeSequences ?? NODE_DROP_AGE_SEQUENCES;
      this.maxNodeDropsPerSweep = opts.maxNodeDropsPerSweep ?? MAX_NODE_DROPS_PER_SWEEP;
      this.observeShadowRoot = opts.observeShadowRoot;
      this.unobserveShadowRoot = opts.unobserveShadowRoot;
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
      this.visited.clear();
      this.createdThisTick.clear();
      this.removedThisTick.clear();
      this.attrDirty.clear();
      this.textDirty.clear();
      if (records.length > 0) {
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
      this.discoverShadowRoots(ops);
      this.table.setSequence(ctx.sequence);
      applyOpsToTable(this.table, ops);
      const dropOpIndex = ops.length;
      this.emitNodeDropSweep(ops, ctx.sequence);
      if (ops.length > dropOpIndex) applyOpsToTable(this.table, ops.slice(dropOpIndex));
      const propOps = this.formIndex.sample(this.domNodes, this.table);
      if (propOps.length > 0) {
        ops.push(...propOps);
        applyOpsToTable(this.table, propOps);
      }
      if (ops.length === 0) return null;
      let opCounts = EMPTY_OP_COUNTS;
      if (this.collectOpCounts) {
        opCounts = {};
        for (let i = 0; i < ops.length; i++) {
          const name = opCodeName(ops[i].op);
          opCounts[name] = (opCounts[name] ?? 0) + 1;
        }
      }
      this.lastStats = {
        opCounts,
        buildMs: performance.now() - start,
        tableSize: this.table.size,
        identitySize: this.domNodes.size
      };
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
          if (node !== void 0) {
            if (node instanceof ShadowRoot) this.unobserveShadowRoot?.(node);
            this.formIndex.remove(node);
            this.domNodes.release(node);
          }
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
        if (!node.isConnected || this.visited.has(node)) {
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
          if (!next.isConnected || this.visited.has(next) || prev.nextSibling !== next) break;
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
      if (!node.isConnected) return NONE_DOM_NODE_KEY;
      const existingId = this.domNodes.keyOf(node);
      if (existingId !== NONE_DOM_NODE_KEY) return existingId;
      const kind = nodeKindOf(node);
      if (kind === null) return NONE_DOM_NODE_KEY;
      const id = this.domNodes.allocate(node);
      this.createdThisTick.add(node);
      this.formIndex.addIfIndexed(node);
      ops.push(describeNodeNew(id, kind, node));
      this.walkSiblingRun(node.childNodes, id, ops);
      if (kind === 1 /* Element */) this.admitShadowIfAny(node, id, ops);
      return id;
    }
    /**
     * `attachShadow` is not a mutation record. Each tick, connected ELEMENTs that do not yet own
     * a `SHADOW_ROOT` row are read via `.shadowRoot` ([shadow.md](shadow.md)).
     */
    discoverShadowRoots(ops) {
      for (const [id, node] of this.domNodes.liveEntries()) {
        if (!(node instanceof Element) || !node.isConnected) continue;
        this.admitShadowIfAny(node, id, ops);
      }
    }
    admitShadowIfAny(el, hostId, ops) {
      if (this.table.shadowRootOf(hostId) !== 0) return;
      const sr = admissibleShadowRoot(el);
      if (sr === null) return;
      const existing = this.domNodes.keyOf(sr);
      if (existing !== NONE_DOM_NODE_KEY) {
        this.observeShadowRoot?.(sr);
        return;
      }
      const rootId = this.domNodes.allocate(sr);
      this.createdThisTick.add(sr);
      ops.push(describeNodeNew(rootId, 7 /* ShadowRoot */, sr, hostId));
      this.observeShadowRoot?.(sr);
      this.walkSiblingRun(sr.childNodes, rootId, ops);
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
    /**
     * §5.6 / PP-FR-1 — true detach vs move vs ephemeral, decided at drain against live DOM:
     * still `isConnected` → move (its `INSERT` already unlinked it); never had an id → ephemeral
     * (never sent); had an id and ended detached → `REMOVE`. `visited` is not a move proof.
     */
    emitDeferredRemoves(ops) {
      for (const [node, oldParent] of this.removedThisTick) {
        if (node.isConnected) continue;
        const id = this.domNodes.keyOf(node);
        if (id === NONE_DOM_NODE_KEY) continue;
        this.formIndex.remove(node);
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

  // browser/mirror/projection/virtual/cssom/cssomIds.ts
  var ID_SPACE_MAX = 4294967295;
  function standaloneMintState() {
    return { next: 2 };
  }
  var CssomIds = class {
    mint;
    sheets = /* @__PURE__ */ new WeakMap();
    rules = /* @__PURE__ */ new WeakMap();
    constructor(mint) {
      if (mint !== void 0) {
        this.mint = mint;
        return;
      }
      const state = standaloneMintState();
      this.mint = () => {
        if (state.next > ID_SPACE_MAX) throw new Error("CssomIds: id space exhausted");
        const id = state.next;
        state.next += 1;
        return id;
      };
    }
    idOfSheet(sheet) {
      const existing = this.sheets.get(sheet);
      if (existing !== void 0) return existing;
      const id = this.mint();
      this.sheets.set(sheet, id);
      return id;
    }
    idOfRule(rule) {
      const existing = this.rules.get(rule);
      if (existing !== void 0) return existing;
      const id = this.mint();
      this.rules.set(rule, id);
      return id;
    }
    peekSheet(sheet) {
      return this.sheets.get(sheet);
    }
    peekRule(rule) {
      return this.rules.get(rule);
    }
    /** Drop+new of a still-live object (grouping rule content change) — next `idOfRule` allocates. */
    forgetRule(rule) {
      this.rules.delete(rule);
    }
  };

  // browser/mirror/projection/virtual/cssom/cssomReconcile.ts
  function diffRules(prev, next) {
    const prevHash = /* @__PURE__ */ new Map();
    for (const r of prev) prevHash.set(r.key, r.contentHash);
    const nextKeys = /* @__PURE__ */ new Set();
    for (const r of next) nextKeys.add(r.key);
    let rulesDisappeared = 0;
    for (const r of prev) {
      if (!nextKeys.has(r.key)) rulesDisappeared += 1;
    }
    let rulesAppeared = 0;
    let rulesTextChangedInPlace = 0;
    for (const r of next) {
      const old = prevHash.get(r.key);
      if (old === void 0) rulesAppeared += 1;
      else if (old !== r.contentHash) rulesTextChangedInPlace += 1;
    }
    let ruleListChanged = prev.length !== next.length;
    if (!ruleListChanged) {
      for (let i = 0; i < prev.length; i++) {
        if (prev[i].key !== next[i].key) {
          ruleListChanged = true;
          break;
        }
      }
    }
    return { ruleListChanged, rulesAppeared, rulesDisappeared, rulesTextChangedInPlace };
  }

  // browser/mirror/projection/virtual/cssom/fnv32.ts
  var OFFSET = 2166136261;
  var PRIME = 16777619;
  function fnv1a32(text) {
    let h = OFFSET;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, PRIME) >>> 0;
    }
    return h >>> 0;
  }

  // browser/mirror/projection/models/cssomRuleSet.ts
  function ruleAcceptsInPlaceSet(rule) {
    return rule.constructor.name === "CSSStyleRule";
  }

  // browser/mirror/projection/virtual/cssom/cssomOps.ts
  function emitResyncCssomOps(ids, sheets) {
    const ops = [];
    const idsByHost = /* @__PURE__ */ new Map();
    for (let i = 0; i < sheets.length; i++) {
      const rec = sheets[i];
      const hostNode = rec.hostNode ?? 0;
      const sheetId = ids.idOfSheet(rec.sheet);
      let group = idsByHost.get(hostNode);
      if (group === void 0) {
        group = [];
        idsByHost.set(hostNode, group);
      }
      group.push(sheetId);
      ops.push({
        op: 160 /* SheetNew */,
        id: sheetId,
        scope: hostNode === 0 ? CSSOM_SCOPE_MAIN : CSSOM_SCOPE_PIERCE_HOST,
        hostNode,
        before: INSERT_AT_END
      });
      for (let r = 0; r < rec.snaps.length; r++) {
        const snap = rec.snaps[r];
        const text = rec.texts.get(snap.key) ?? "";
        ops.push({
          op: 163 /* RuleNew */,
          sheet: sheetId,
          id: ids.idOfRule(snap.key),
          before: INSERT_AT_END,
          text
        });
      }
    }
    for (const group of idsByHost.values()) {
      if (group.length > 1) ops.push({ op: 162 /* SheetOrder */, ids: group });
    }
    return ops;
  }
  function emitLiveCssomOps(ids, prevSheets, nextSheets, prevSnaps) {
    const ops = [];
    const prevSet = new Set(prevSheets.map((s) => s.sheet));
    const nextSet = new Set(nextSheets.map((s) => s.sheet));
    const dropped = [];
    for (const rec of prevSheets) {
      if (nextSet.has(rec.sheet)) continue;
      const id = ids.peekSheet(rec.sheet);
      if (id !== void 0) dropped.push(id);
    }
    if (dropped.length > 0) ops.push({ op: 161 /* SheetDrop */, ids: dropped });
    const nextByHost = /* @__PURE__ */ new Map();
    for (let i = 0; i < nextSheets.length; i++) {
      const rec = nextSheets[i];
      const hostNode = rec.hostNode ?? 0;
      const sheetId = ids.idOfSheet(rec.sheet);
      let group = nextByHost.get(hostNode);
      if (group === void 0) {
        group = [];
        nextByHost.set(hostNode, group);
      }
      group.push(sheetId);
      if (rec.skipOps) continue;
      if (!prevSet.has(rec.sheet)) {
        ops.push({
          op: 160 /* SheetNew */,
          id: sheetId,
          scope: hostNode === 0 ? CSSOM_SCOPE_MAIN : CSSOM_SCOPE_PIERCE_HOST,
          hostNode,
          before: INSERT_AT_END
        });
      }
      ops.push(...emitRuleDelta(ids, sheetId, prevSnaps.get(rec.sheet) ?? [], rec));
    }
    const prevByHost = /* @__PURE__ */ new Map();
    for (const rec of prevSheets) {
      const id = ids.peekSheet(rec.sheet);
      if (id === void 0) continue;
      let group = prevByHost.get(rec.hostNode);
      if (group === void 0) {
        group = [];
        prevByHost.set(rec.hostNode, group);
      }
      group.push(id);
    }
    const hosts = /* @__PURE__ */ new Set([...nextByHost.keys(), ...prevByHost.keys()]);
    for (const host of hosts) {
      const nextIds = nextByHost.get(host) ?? [];
      const prevIds = prevByHost.get(host) ?? [];
      if (nextIds.length > 0 && !sameIdOrder(prevIds, nextIds)) {
        ops.push({ op: 162 /* SheetOrder */, ids: nextIds });
      }
    }
    return ops;
  }
  function emitRuleDelta(ids, sheetId, prev, rec) {
    const ops = [];
    const prevKeys = new Set(prev.map((s) => s.key));
    const nextKeys = new Set(rec.snaps.map((s) => s.key));
    const prevHash = /* @__PURE__ */ new Map();
    for (const row of prev) prevHash.set(row.key, row.contentHash);
    const replaceKeys = /* @__PURE__ */ new Set();
    for (let i = 0; i < rec.snaps.length; i++) {
      const snap = rec.snaps[i];
      if (!prevKeys.has(snap.key)) continue;
      if (prevHash.get(snap.key) === snap.contentHash) continue;
      if (ruleAcceptsInPlaceSet(snap.key)) continue;
      replaceKeys.add(snap.key);
    }
    const dropIds = [];
    for (const row of prev) {
      if (nextKeys.has(row.key) && !replaceKeys.has(row.key)) continue;
      const id = ids.peekRule(row.key);
      if (id !== void 0) dropIds.push(id);
      ids.forgetRule(row.key);
    }
    if (dropIds.length > 0) ops.push({ op: 164 /* RuleDrop */, sheet: sheetId, ids: dropIds });
    for (let i = 0; i < rec.snaps.length; i++) {
      const snap = rec.snaps[i];
      const text = rec.texts.get(snap.key) ?? "";
      let before = INSERT_AT_END;
      for (let j = i + 1; j < rec.snaps.length; j++) {
        const nextId = ids.peekRule(rec.snaps[j].key);
        if (nextId === void 0) continue;
        before = nextId;
        break;
      }
      if (!prevKeys.has(snap.key) || replaceKeys.has(snap.key)) {
        ops.push({
          op: 163 /* RuleNew */,
          sheet: sheetId,
          id: ids.idOfRule(snap.key),
          before,
          text
        });
        continue;
      }
      const old = prevHash.get(snap.key);
      if (old !== snap.contentHash) {
        ops.push({ op: 165 /* RuleSet */, id: ids.idOfRule(snap.key), text });
      }
    }
    return ops;
  }
  function sameIdOrder(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // browser/mirror/projection/virtual/cssom/cssomWalk.ts
  var MASS_ABORT_STALE_FRACTION = 0.9;
  var MASS_ABORT_LENGTH_LO = 0.1;
  var MASS_ABORT_LENGTH_HI = 2;
  function copyRuleRefs(list) {
    const refs = [];
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const rule = list.item(i);
      if (rule !== null) refs.push(rule);
    }
    return refs;
  }
  function liveRuleList(list) {
    return copyRuleRefs(list);
  }
  function isRuleSlotLive(rule, sheet, liveRefs) {
    const parent = rule.parentStyleSheet;
    if (parent != null && parent !== sheet) return false;
    for (let i = 0; i < liveRefs.length; i++) {
      if (liveRefs[i] === rule) return true;
    }
    return false;
  }
  function shouldAbortSheet(copyLen, staleCount, liveLen) {
    if (copyLen <= 0) return liveLen > 0 && liveLen > MASS_ABORT_LENGTH_HI;
    if (staleCount / copyLen >= MASS_ABORT_STALE_FRACTION) return true;
    if (liveLen < copyLen * MASS_ABORT_LENGTH_LO) return true;
    if (liveLen > copyLen * MASS_ABORT_LENGTH_HI) return true;
    return false;
  }

  // browser/mirror/projection/virtual/cssom/cssomPoller.ts
  var CssomPoller = class {
    lastRules = /* @__PURE__ */ new WeakMap();
    lastStyleTagTextHash = /* @__PURE__ */ new WeakMap();
    ids;
    lastSheetOrder = [];
    hostIdOf;
    constructor(ids, hostIdOf) {
      this.ids = ids ?? new CssomIds();
      this.hostIdOf = hostIdOf;
    }
    classifySheets(doc = document) {
      const readable = [];
      let unreadableSheetCount = 0;
      for (const listed of collectCssomPlaneSheets(doc, this.hostIdOf)) {
        const list = tryCssRules2(listed.sheet);
        if (list === null) unreadableSheetCount += 1;
        else readable.push({ sheet: listed.sheet, rules: list, hostNode: listed.hostNode });
      }
      return { readable, unreadableSheetCount };
    }
    /** Phase A — refs only. */
    beginSheetWalk(sheet, list) {
      const t0 = performance.now();
      const copyRefs = copyRuleRefs(list);
      return {
        sheet,
        copyRefs,
        copyLength: list.length,
        cursor: 0,
        hashed: [],
        texts: /* @__PURE__ */ new Map(),
        staleSlots: 0,
        identityWalkMs: performance.now() - t0,
        cssTextSerializeMs: 0,
        aborted: false
      };
    }
    /**
     * Phase B batch. Returns false when the sheet walk is finished (hashed or aborted).
     */
    hashSheetBatch(walk, timeRemaining, floorMs) {
      const list = tryCssRules2(walk.sheet);
      const live = list ? liveRuleList(list) : [];
      const liveLen = list ? list.length : 0;
      while (walk.cursor < walk.copyRefs.length && timeRemaining() > floorMs) {
        const rule = walk.copyRefs[walk.cursor];
        walk.cursor += 1;
        if (!isRuleSlotLive(rule, walk.sheet, live)) {
          walk.staleSlots += 1;
          if (shouldAbortSheet(walk.copyLength, walk.staleSlots, liveLen)) {
            walk.aborted = true;
            walk.hashed = [];
            walk.texts.clear();
            return false;
          }
          continue;
        }
        const t0 = performance.now();
        let text = "";
        try {
          text = rule.cssText;
        } catch {
          walk.staleSlots += 1;
          walk.cssTextSerializeMs += performance.now() - t0;
          continue;
        }
        walk.texts.set(rule, text);
        walk.hashed.push({ key: rule, contentHash: fnv1a32(text) });
        walk.cssTextSerializeMs += performance.now() - t0;
      }
      if (walk.cursor < walk.copyRefs.length) return true;
      if (shouldAbortSheet(walk.copyLength, walk.staleSlots, liveLen)) {
        walk.aborted = true;
        walk.hashed = [];
        walk.texts.clear();
      }
      return false;
    }
    finishSheetWalk(walk) {
      if (walk.aborted) {
        return {
          snap: [],
          identityWalkMs: walk.identityWalkMs,
          cssTextSerializeMs: walk.cssTextSerializeMs,
          topLevelRulesVisited: walk.copyLength,
          topLevelRulesSerialized: 0,
          styleTagTextUnchanged: false,
          rulesAppeared: 0,
          rulesDisappeared: 0,
          rulesTextChangedInPlace: 0,
          ruleListChanged: false,
          aborted: true,
          slotsSkipped: walk.staleSlots
        };
      }
      const list = tryCssRules2(walk.sheet);
      const live = list ? liveRuleList(list) : [];
      const hashByKey = new Map(walk.hashed.map((s) => [s.key, s]));
      const committed = [];
      const texts = /* @__PURE__ */ new Map();
      for (const rule of live) {
        const row = hashByKey.get(rule);
        if (row === void 0) continue;
        committed.push(row);
        const t = walk.texts.get(rule);
        if (t !== void 0) texts.set(rule, t);
      }
      walk.hashed = committed;
      walk.texts = texts;
      const prev = this.lastRules.get(walk.sheet) ?? [];
      const delta = diffRules(prev, committed);
      const styleTagHash = styleElementTextHash(walk.sheet);
      let styleTagTextUnchanged = false;
      if (styleTagHash !== null) {
        styleTagTextUnchanged = this.lastStyleTagTextHash.get(walk.sheet) === styleTagHash;
      }
      return {
        snap: committed,
        identityWalkMs: walk.identityWalkMs,
        cssTextSerializeMs: walk.cssTextSerializeMs,
        topLevelRulesVisited: walk.copyLength,
        topLevelRulesSerialized: committed.length,
        styleTagTextUnchanged,
        rulesAppeared: delta.rulesAppeared,
        rulesDisappeared: delta.rulesDisappeared,
        rulesTextChangedInPlace: delta.rulesTextChangedInPlace,
        ruleListChanged: delta.ruleListChanged,
        aborted: false,
        slotsSkipped: walk.staleSlots
      };
    }
    commitSheet(sheet, snap) {
      this.lastRules.set(sheet, snap);
      const hash = styleElementTextHash(sheet);
      if (hash !== null) this.lastStyleTagTextHash.set(sheet, hash);
    }
    /** Whole-pass commit: lastRules + live/resync ops. Skips aborted pieces. */
    commitPass(readable, pieces, textsBySheet, mode) {
      const nextOrder = [];
      const hashed = [];
      for (let i = 0; i < readable.length; i++) {
        const rec = readable[i];
        const piece = pieces[i];
        if (!piece || piece.aborted) {
          nextOrder.push({
            sheet: rec.sheet,
            hostNode: rec.hostNode,
            snaps: this.lastRules.get(rec.sheet) ?? [],
            texts: /* @__PURE__ */ new Map(),
            skipOps: true
          });
          continue;
        }
        const committed = {
          sheet: rec.sheet,
          hostNode: rec.hostNode,
          snaps: piece.snap,
          texts: textsBySheet.get(rec.sheet) ?? /* @__PURE__ */ new Map()
        };
        nextOrder.push(committed);
        hashed.push(committed);
      }
      const ops = mode === "resync" ? emitResyncCssomOps(this.ids, hashed) : emitLiveCssomOps(this.ids, this.lastSheetOrder, nextOrder, this.lastRules);
      for (const c of hashed) this.commitSheet(c.sheet, c.snaps);
      this.lastSheetOrder = nextOrder.map((c) => ({ sheet: c.sheet, hostNode: c.hostNode }));
      return ops;
    }
    /**
     * Blocking A+B (resync / snapshot scan). Commits non-aborted sheets then snapshot ops.
     */
    poll(doc = document, mode = "resync") {
      const t0 = performance.now();
      const { readable, unreadableSheetCount } = this.classifySheets(doc);
      const pieces = [];
      const textsBySheet = /* @__PURE__ */ new WeakMap();
      for (const { sheet, rules } of readable) {
        const walk = this.beginSheetWalk(sheet, rules);
        this.hashSheetBatch(walk, () => 1e9, 0);
        const piece = this.finishSheetWalk(walk);
        pieces.push(piece);
        if (!piece.aborted) textsBySheet.set(sheet, walk.texts);
      }
      const ops = this.commitPass(
        readable,
        pieces,
        textsBySheet,
        mode
      );
      return {
        stats: foldSheetPieces(unreadableSheetCount, pieces, performance.now() - t0, {
          source: mode === "resync" ? "resync" : "idle",
          idleSlices: 0,
          ops
        }),
        ops
      };
    }
  };
  function foldSheetPieces(unreadableSheetCount, pieces, pollMs, extra) {
    let identityWalkMs = 0;
    let cssTextSerializeMs = 0;
    let topLevelRulesVisited = 0;
    let topLevelRulesSerialized = 0;
    let styleTagTextUnchangedSheets = 0;
    let rulesAppeared = 0;
    let rulesDisappeared = 0;
    let rulesTextChangedInPlace = 0;
    let sheetsWithRuleListChanged = 0;
    let readable = 0;
    let sheetsAborted = 0;
    let slotsSkipped = 0;
    for (const p of pieces) {
      identityWalkMs += p.identityWalkMs;
      cssTextSerializeMs += p.cssTextSerializeMs;
      topLevelRulesVisited += p.topLevelRulesVisited;
      topLevelRulesSerialized += p.topLevelRulesSerialized;
      slotsSkipped += p.slotsSkipped;
      if (p.aborted) {
        sheetsAborted += 1;
        continue;
      }
      readable += 1;
      if (p.styleTagTextUnchanged) styleTagTextUnchangedSheets += 1;
      rulesAppeared += p.rulesAppeared;
      rulesDisappeared += p.rulesDisappeared;
      rulesTextChangedInPlace += p.rulesTextChangedInPlace;
      if (p.ruleListChanged) sheetsWithRuleListChanged += 1;
    }
    return stampCssomPoll(emptyCssomPollStats(), {
      source: extra.source,
      sequence: extra.sequence ?? 0,
      pollMs,
      identityWalkMs,
      cssTextSerializeMs,
      readableSheetCount: readable,
      unreadableSheetCount,
      topLevelRulesVisited,
      topLevelRulesSerialized,
      styleTagTextUnchangedSheets,
      rulesAppeared,
      rulesDisappeared,
      rulesTextChangedInPlace,
      sheetsWithRuleListChanged,
      sheetsAborted,
      slotsSkipped,
      idleSlices: extra.idleSlices,
      ...countCssomOps(extra.ops)
    });
  }
  function tryCssRules2(sheet) {
    try {
      return sheet.cssRules;
    } catch {
      return null;
    }
  }
  function styleElementTextHash(sheet) {
    const node = sheet.ownerNode;
    if (node === null || node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node;
    if (el.localName !== "style") return null;
    return fnv1a32(el.textContent ?? "");
  }

  // browser/mirror/projection/virtual/cssom/cssomIdleScheduler.ts
  var SLICE_FLOOR_MS = 1;
  var CssomIdleScheduler = class {
    enabled = true;
    poller;
    minIntervalMs;
    doc;
    now;
    running = false;
    ricId = null;
    timerId = null;
    pending = null;
    pass = null;
    nextPassAfter = 0;
    constructor(opts) {
      this.poller = opts.poller;
      this.minIntervalMs = opts.minIntervalMs;
      this.doc = opts.document ?? document;
      this.now = opts.now ?? (() => performance.now());
    }
    start() {
      if (this.running) return;
      this.running = true;
      this.nextPassAfter = 0;
      this.scheduleIdle();
    }
    halt() {
      this.stop();
    }
    stop() {
      this.running = false;
      this.cancelScheduled();
      this.pass = null;
      this.pending = null;
    }
    blockingScan(stashForEmit = false) {
      this.cancelScheduled();
      this.pass = null;
      this.pending = null;
      const result = this.poller.poll(this.doc, stashForEmit ? "live" : "resync");
      const stamped = {
        ops: result.ops,
        stats: stampCssomPoll(result.stats, { source: stashForEmit ? "snapshotScan" : "resync" })
      };
      if (stashForEmit) this.pending = stamped;
      if (this.running) this.scheduleIdle();
      return stamped;
    }
    /** Drain one completed pass for the frame pipe. Null if idle work is still in flight. */
    takePending() {
      const pending = this.pending;
      this.pending = null;
      if (pending !== null && this.running) this.scheduleIdle();
      return pending;
    }
    scheduleIdle() {
      if (!this.running) return;
      if (this.pending !== null) return;
      this.cancelScheduled();
      const wait = Math.max(0, this.nextPassAfter - this.now());
      const go = () => {
        this.timerId = null;
        this.armRic();
      };
      if (wait > 0) {
        this.timerId = setTimeout(go, wait);
        return;
      }
      this.armRic();
    }
    armRic() {
      if (!this.running) return;
      const ric = globalThis.requestIdleCallback;
      if (typeof ric === "function") {
        this.ricId = ric((deadline) => this.onIdle(deadline), { timeout: this.minIntervalMs });
        return;
      }
      this.timerId = setTimeout(() => {
        this.onIdle({ timeRemaining: () => 8 });
      }, 0);
    }
    cancelScheduled() {
      if (this.ricId !== null && typeof globalThis.cancelIdleCallback === "function") {
        globalThis.cancelIdleCallback(this.ricId);
      }
      this.ricId = null;
      if (this.timerId !== null) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
    }
    onIdle(deadline) {
      this.ricId = null;
      if (!this.running || this.pending !== null) return;
      if (this.pass === null) {
        const classified = this.poller.classifySheets(this.doc);
        this.pass = {
          startedAt: this.now(),
          unreadableSheetCount: classified.unreadableSheetCount,
          readable: classified.readable,
          index: 0,
          walk: null,
          pieces: [],
          textsBySheet: /* @__PURE__ */ new WeakMap(),
          idleSlices: 0
        };
      }
      const pass = this.pass;
      pass.idleSlices += 1;
      while (deadline.timeRemaining() > SLICE_FLOOR_MS) {
        if (pass.walk === null) {
          if (pass.index >= pass.readable.length) break;
          const { sheet, rules } = pass.readable[pass.index];
          pass.walk = this.poller.beginSheetWalk(sheet, rules);
        }
        const more = this.poller.hashSheetBatch(pass.walk, () => deadline.timeRemaining(), SLICE_FLOOR_MS);
        if (more) {
          this.armRic();
          return;
        }
        const piece = this.poller.finishSheetWalk(pass.walk);
        pass.pieces.push(piece);
        if (!piece.aborted) pass.textsBySheet.set(pass.walk.sheet, pass.walk.texts);
        pass.walk = null;
        pass.index += 1;
      }
      if (pass.index < pass.readable.length || pass.walk !== null) {
        this.armRic();
        return;
      }
      const ops = this.poller.commitPass(pass.readable, pass.pieces, pass.textsBySheet, "live");
      this.pending = {
        ops,
        stats: foldSheetPieces(
          pass.unreadableSheetCount,
          pass.pieces,
          this.now() - pass.startedAt,
          { source: "idle", idleSlices: pass.idleSlices, ops }
        )
      };
      this.pass = null;
      this.nextPassAfter = this.now() + this.minIntervalMs;
    }
  };

  // browser/mirror/projection/virtual/cssom/cssomPlane.ts
  function disabledCssomPlane() {
    return {
      enabled: false,
      start() {
      },
      halt() {
      },
      takePending() {
        return null;
      },
      blockingScan(_stashForEmit) {
        return { ops: [], stats: emptyCssomPollStats() };
      }
    };
  }

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
        identitySize: info.identitySize,
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
    recordCssomPoll(info) {
      if (!this.config.enabled || !this.config.cssomPoll) return;
      this.push({
        v: 1,
        kind: "cssomPoll",
        t: this.now(),
        ...info
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
    const formIndex = new FormPropIndex();
    const mutationBuffer = new MutationBuffer();
    const domMutationObserver = new DomMutationObserver({ buffer: mutationBuffer });
    const frameBuilder = new TableFrameBuilder({
      domNodes,
      table,
      formIndex,
      observeShadowRoot: (root) => domMutationObserver.observeRoot(root),
      unobserveShadowRoot: (root) => domMutationObserver.unobserveRoot(root)
    });
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
    const cssomPoller = config.cssomPollHz > 0 ? new CssomPoller(new CssomIds(() => domNodes.mint()), (host) => {
      const id = domNodes.keyOf(host);
      return id;
    }) : null;
    const cssom = cssomPoller !== null ? new CssomIdleScheduler({
      poller: cssomPoller,
      minIntervalMs: 1e3 / config.cssomPollHz
    }) : disabledCssomPlane();
    const resyncPlanes = { domNodes, table, cssom, formIndex };
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
      census: () => ({
        generation: domNodes.generation,
        tableSize: table.size,
        identitySize: domNodes.size
      }),
      telemetry,
      pullPendingMutations: () => domMutationObserver.takePendingIntoBuffer(),
      takePendingCssom: () => cssom.takePending(),
      table
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
        frameEmitter.requestResync((seq) => {
          const { frame, cssom: cssomStats } = emitResyncFrame(resyncPlanes, seq);
          telemetry.recordCssomPoll(cssomStats);
          return frame;
        });
      });
    }
    const { frame: resyncFrame, cssom: cssomResyncStats } = rebuildAndResync(
      resyncPlanes,
      frameEmitter.currentSequence + 1
    );
    telemetry.recordCssomPoll(cssomResyncStats);
    if (config.generation > 1) {
      resyncFrame.ops.unshift({ op: 2 /* EpochReset */, generation: config.generation });
    }
    domMutationObserver.takePendingIntoBuffer();
    mutationBuffer.drain();
    await frameEmitter.sendInitial(resyncFrame);
    domMutationObserver.syncObservedShadowRoots(domNodes);
    frameEmitter.start();
    telemetry.start();
    cssom.start();
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
      telemetry,
      cssomPoller,
      compareTableToLiveDom: () => compareTableToLiveDom(table, domNodes, document),
      haltWorld: () => {
        frameEmitter.stop();
        cssom.halt();
        domMutationObserver.unobserveAllRoots();
      },
      resumeWorld: () => {
        frameEmitter.start();
        cssom.start();
        domMutationObserver.syncObservedShadowRoots(domNodes);
      },
      flushFrame: () => {
        frameEmitter.flushNow();
        return { generation: domNodes.generation, sequence: frameEmitter.currentSequence };
      },
      flushAndSnapshot: (opts) => {
        const snapped = takeSnapshot(
          {
            domNodes,
            table,
            cssom,
            cssomIds: cssomPoller?.ids ?? null,
            currentSequence: () => frameEmitter.currentSequence,
            flushDom: () => frameEmitter.flushNow(),
            recordCssomPoll: (stats) => telemetry.recordCssomPoll(stats)
          },
          { cssom: opts?.cssom ?? "none" }
        );
        frameEmitter.stop();
        cssom.halt();
        return snapped;
      }
    };
  })();
})();
