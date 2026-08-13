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
  var CHILD_LIST_FACT_CAP = 32;
  var DEFAULT_TELEMETRY_CONFIG = {
    enabled: false,
    frameEmitted: true,
    transportDeferred: true,
    aggregate: true,
    establish: true,
    builderStats: true,
    applyResult: true,
    desync: true,
    applyOverrun: true,
    clock: true,
    frameDecision: false,
    parityFingerprint: false,
    encoder: false,
    handoff: true,
    aggregateIntervalMs: 1e4
  };
  var TELEMETRY_BOOL_CAPS = [
    "enabled",
    "frameEmitted",
    "transportDeferred",
    "aggregate",
    "establish",
    "builderStats",
    "applyResult",
    "desync",
    "applyOverrun",
    "clock",
    "frameDecision",
    "parityFingerprint",
    "encoder",
    "handoff"
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
    if (value === "console" || value === "loopback") return value;
    throw new Error(`ProjectionConfig.transport must be "console" | "loopback" (got ${String(value)})`);
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
      telemetry: Object.freeze(resolveTelemetry(bag.telemetry))
    };
    cached = Object.freeze(resolved);
    return cached;
  }

  // browser/mirror/projection/models/domNodeKey.ts
  var NONE_DOM_NODE_KEY = 0;

  // browser/mirror/projection/virtual/models/dirtySets.ts
  var VIEWPORT_SCROLL_KEY = NONE_DOM_NODE_KEY;
  function createDirtySets() {
    return {
      newKeys: /* @__PURE__ */ new Set(),
      dirtyParents: /* @__PURE__ */ new Set(),
      attrDirty: /* @__PURE__ */ new Set(),
      textDirty: /* @__PURE__ */ new Set(),
      stateDirty: /* @__PURE__ */ new Set(),
      scrollDirty: /* @__PURE__ */ new Map(),
      detached: /* @__PURE__ */ new Set()
    };
  }
  function clearDirtySets(sets) {
    sets.newKeys.clear();
    sets.dirtyParents.clear();
    sets.attrDirty.clear();
    sets.textDirty.clear();
    sets.stateDirty.clear();
    sets.scrollDirty.clear();
    sets.detached.clear();
  }
  function dirtyCard(sets) {
    return {
      newKeys: sets.newKeys.size,
      dirtyParents: sets.dirtyParents.size,
      attrDirty: sets.attrDirty.size,
      textDirty: sets.textDirty.size,
      stateDirty: sets.stateDirty.size,
      scrollDirty: sets.scrollDirty.size,
      detached: sets.detached.size
    };
  }
  function dirtySetsHaveWork(sets) {
    return sets.newKeys.size > 0 || sets.dirtyParents.size > 0 || sets.attrDirty.size > 0 || sets.textDirty.size > 0 || sets.stateDirty.size > 0 || sets.scrollDirty.size > 0 || sets.detached.size > 0;
  }

  // browser/mirror/projection/virtual/dom/domMutationAccumulator.ts
  var DomMutationAccumulator = class {
    active = createDirtySets();
    frozen = createDirtySets();
    getActive() {
      return this.active;
    }
    getFrozen() {
      return this.frozen;
    }
    hasActiveWork() {
      return dirtySetsHaveWork(this.active);
    }
    hasFrozenWork() {
      return dirtySetsHaveWork(this.frozen);
    }
    swap() {
      const previousActive = this.active;
      this.active = this.frozen;
      clearDirtySets(this.active);
      this.frozen = previousActive;
      return this.frozen;
    }
    clearFrozen() {
      clearDirtySets(this.frozen);
    }
    reclaimFrozen() {
      const from = this.frozen;
      const to = this.active;
      for (const key of from.newKeys) to.newKeys.add(key);
      for (const key of from.dirtyParents) to.dirtyParents.add(key);
      for (const key of from.attrDirty) to.attrDirty.add(key);
      for (const key of from.textDirty) to.textDirty.add(key);
      for (const key of from.stateDirty) to.stateDirty.add(key);
      for (const key of from.detached) to.detached.add(key);
      for (const [key, sample] of from.scrollDirty) to.scrollDirty.set(key, sample);
      clearDirtySets(this.frozen);
    }
    markNew(key) {
      if (key === NONE_DOM_NODE_KEY) return;
      this.active.newKeys.add(key);
    }
    markDirtyParent(key) {
      if (key === NONE_DOM_NODE_KEY) return;
      this.active.dirtyParents.add(key);
    }
    markAttr(key) {
      if (key === NONE_DOM_NODE_KEY) return;
      this.active.attrDirty.add(key);
    }
    markText(key) {
      if (key === NONE_DOM_NODE_KEY) return;
      this.active.textDirty.add(key);
    }
    markState(key) {
      if (key === NONE_DOM_NODE_KEY) return;
      this.active.stateDirty.add(key);
    }
    markDetached(key) {
      if (key === NONE_DOM_NODE_KEY) return;
      this.active.detached.add(key);
    }
    markScroll(key, sample) {
      this.active.scrollDirty.set(key, sample);
    }
  };

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
  };

  // browser/mirror/projection/virtual/dom/domMutationObserver.ts
  var OBSERVE_OPTIONS = {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true
  };
  var DomMutationObserver = class {
    domNodes;
    accumulator;
    root;
    isPublishable;
    observer = null;
    constructor(opts) {
      this.domNodes = opts.domNodes;
      this.accumulator = opts.accumulator;
      this.root = opts.root ?? document;
      this.isPublishable = opts.isPublishable ?? (() => true);
    }
    start() {
      this.stop();
      this.observer = new MutationObserver((records) => this.onRecords(records));
      this.observer.observe(this.root, OBSERVE_OPTIONS);
    }
    stop() {
      this.observer?.disconnect();
      this.observer = null;
    }
    ingestForTest(records) {
      this.onRecords(records);
    }
    onRecords(records) {
      for (let i = 0; i < records.length; i++) {
        this.markRecord(records[i]);
      }
    }
    markRecord(record) {
      const target = record.target;
      if (!this.isPublishable(target)) return;
      if (record.type === "childList") {
        this.markChildList(record);
        return;
      }
      const key = this.domNodes.keyOf(target);
      if (key === NONE_DOM_NODE_KEY) return;
      if (record.type === "attributes") this.accumulator.markAttr(key);
      else if (record.type === "characterData") this.accumulator.markText(key);
    }
    markChildList(record) {
      const parent = record.target;
      let parentKey = this.domNodes.keyOf(parent);
      if (parentKey === NONE_DOM_NODE_KEY) {
        if (!this.isPublishable(parent)) return;
        parentKey = this.domNodes.allocate(parent);
        this.accumulator.markNew(parentKey);
      }
      this.accumulator.markDirtyParent(parentKey);
      const added = record.addedNodes;
      for (let i = 0; i < added.length; i++) {
        const node = added[i];
        if (!this.isPublishable(node)) continue;
        const key = this.domNodes.allocate(node);
        this.accumulator.markNew(key);
      }
      const removed = record.removedNodes;
      for (let i = 0; i < removed.length; i++) {
        const node = removed[i];
        const key = this.domNodes.keyOf(node);
        if (key === NONE_DOM_NODE_KEY) continue;
        this.accumulator.markDetached(key);
      }
    }
  };

  // browser/mirror/projection/models/opcodes.ts
  var NAMES = {
    [1 /* EstablishBegin */]: "establishBegin",
    [2 /* EstablishChunk */]: "establishChunk",
    [3 /* EstablishEnd */]: "establishEnd",
    [4 /* ChildList */]: "childList",
    [5 /* Patch */]: "patch",
    [6 /* ScrollViewport */]: "scrollViewport",
    [7 /* ScrollElement */]: "scrollElement",
    [8 /* CssomInstall */]: "cssomInstall",
    [9 /* CssomSheetList */]: "cssomSheetList",
    [10 /* CssomRuleList */]: "cssomRuleList",
    [11 /* CssomPatch */]: "cssomPatch",
    [12 /* DocumentState */]: "documentState"
  };
  function opCodeName(code) {
    return NAMES[code] ?? `unknown(${code})`;
  }

  // browser/mirror/projection/models/frame.ts
  var FRAME_WIRE_VERSION = 1;
  function createLiveFrame(args) {
    return {
      version: FRAME_WIRE_VERSION,
      flags: { establish: false, resync: false },
      generation: args.generation,
      sequence: args.sequence,
      ops: args.ops
    };
  }
  function createEstablishFrame(args) {
    return {
      version: FRAME_WIRE_VERSION,
      flags: { establish: true, resync: args.resync ?? false },
      generation: args.generation,
      sequence: args.sequence,
      ops: args.ops
    };
  }

  // browser/mirror/projection/virtual/frame/fVisible.ts
  var PLACEHOLDER_TAGS = /* @__PURE__ */ new Set([
    "script",
    "noscript",
    "template",
    "iframe",
    "base",
    "object",
    "embed",
    "applet"
  ]);
  var DENY_ATTR = /* @__PURE__ */ new Set(["integrity"]);
  function isPlaceholderTag(tag) {
    return PLACEHOLDER_TAGS.has(tag.toLowerCase());
  }
  function isFVisibleNode(node) {
    const t = node.nodeType;
    return t === Node.ELEMENT_NODE || t === Node.TEXT_NODE || t === Node.COMMENT_NODE;
  }
  function isPublishableNode(node) {
    return isFVisibleNode(node);
  }
  function listFVisibleChildren(parent) {
    const out = [];
    if (parent.nodeType === Node.ELEMENT_NODE) {
      const tag = parent.tagName.toLowerCase();
      if (isPlaceholderTag(tag)) return out;
    }
    const kids = parent.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (isFVisibleNode(n)) out.push(n);
    }
    return out;
  }
  function isDeniedAttr(name, value) {
    const lower = name.toLowerCase();
    if (lower.startsWith("on")) return true;
    if (DENY_ATTR.has(lower)) return true;
    if (value.trimStart().toLowerCase().startsWith("javascript:")) return true;
    return false;
  }
  function snapshotAttrs(el) {
    const out = [];
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (isDeniedAttr(a.name, a.value)) continue;
      out.push({ name: a.name, value: a.value });
    }
    return out;
  }
  function snapshotNodeFlat(key, node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;
      return {
        kind: "element",
        key,
        tag: el.tagName.toLowerCase(),
        attrs: snapshotAttrs(el)
      };
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return { kind: "text", key, value: node.data };
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      return { kind: "comment", key, value: node.data };
    }
    return null;
  }
  function snapshotNodeSubtree(key, node, domNodes, onKey) {
    onKey?.(key);
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;
      const children = [];
      const kids = listFVisibleChildren(el);
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        const childKey = domNodes.allocate(child);
        const snap = snapshotNodeSubtree(childKey, child, domNodes, onKey);
        if (snap !== null) children.push(snap);
      }
      return {
        kind: "element",
        key,
        tag: el.tagName.toLowerCase(),
        attrs: snapshotAttrs(el),
        children
      };
    }
    return snapshotNodeFlat(key, node);
  }
  function documentOrderCompare(a, b) {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }
  function escapeAttr(value) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeText(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // browser/mirror/projection/virtual/establish/establishDom.ts
  var FNV_OFFSET_BASIS = 2166136261;
  var FNV_PRIME = 16777619;
  var DEFAULT_CHUNK_BYTES = 64 * 1024;
  function buildEstablishDomFrame(opts) {
    const domNodes = opts.domNodes;
    const generation = opts.generation;
    const sequence = opts.sequence ?? 0;
    const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    const root = document.documentElement;
    if (!root) {
      throw new Error("establishDom: document.documentElement missing");
    }
    let hash = FNV_OFFSET_BASIS;
    let nodeCount = 0;
    const publishedKeys = [];
    const childLists = [];
    const addTag = (tag) => {
      nodeCount += 1;
      for (let i = 0; i < tag.length; i++) {
        hash ^= tag.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME);
      }
      hash ^= nodeCount & 255;
      hash = Math.imul(hash, FNV_PRIME);
    };
    const noteKey = (key) => {
      publishedKeys.push(key);
    };
    const serializeNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        domNodes.allocate(node);
        return escapeText(node.data);
      }
      if (node.nodeType === Node.COMMENT_NODE) {
        domNodes.allocate(node);
        return `<!--${node.data}-->`;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node;
      const tag = el.tagName.toLowerCase();
      const key = domNodes.allocate(el);
      noteKey(key);
      addTag(tag);
      const attrs = snapshotAttrs(el);
      let attrStr = ` speculum-anchor="${key}"`;
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i];
        if (a.name.toLowerCase() === "speculum-anchor") continue;
        attrStr += ` ${a.name}="${escapeAttr(a.value)}"`;
      }
      if (isPlaceholderTag(tag)) {
        childLists.push([key, []]);
        return `<${tag}${attrStr}></${tag}>`;
      }
      if (tag === "img" || tag === "br" || tag === "hr" || tag === "input" || tag === "meta" || tag === "link" || tag === "area" || tag === "col" || tag === "embed" || tag === "source" || tag === "track" || tag === "wbr") {
        childLists.push([key, []]);
        return `<${tag}${attrStr}>`;
      }
      const kids2 = listFVisibleChildren(el);
      const childKeys = [];
      let inner2 = "";
      for (let i = 0; i < kids2.length; i++) {
        const child = kids2[i];
        childKeys.push(domNodes.allocate(child));
        inner2 += serializeNode(child);
      }
      childLists.push([key, childKeys]);
      return `<${tag}${attrStr}>${inner2}</${tag}>`;
    };
    const htmlKey = domNodes.allocate(root);
    noteKey(htmlKey);
    addTag("html");
    const htmlAttrs = snapshotAttrs(root);
    let htmlAttrStr = ` speculum-anchor="${htmlKey}"`;
    for (let i = 0; i < htmlAttrs.length; i++) {
      const a = htmlAttrs[i];
      if (a.name.toLowerCase() === "speculum-anchor") continue;
      htmlAttrStr += ` ${a.name}="${escapeAttr(a.value)}"`;
    }
    const kids = listFVisibleChildren(root);
    const htmlChildKeys = [];
    let inner = "";
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      htmlChildKeys.push(domNodes.allocate(child));
      inner += serializeNode(child);
    }
    childLists.push([htmlKey, htmlChildKeys]);
    const full = `<!DOCTYPE html><html${htmlAttrStr}>${inner}</html>`;
    const chunks = [];
    for (let i = 0; i < full.length; i += chunkBytes) {
      chunks.push(full.slice(i, i + chunkBytes));
    }
    if (chunks.length === 0) chunks.push(full);
    const viewport = window.visualViewport;
    const viewportWidth = Math.round(viewport?.width ?? window.innerWidth);
    const viewportHeight = Math.round(viewport?.height ?? window.innerHeight);
    const ops = [
      {
        op: 1 /* EstablishBegin */,
        generation,
        viewportWidth,
        viewportHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scrollElements: []
      }
    ];
    const title = document.title ?? "";
    const lang = root.getAttribute("lang");
    const dir = root.getAttribute("dir");
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    ops.push({
      op: 12 /* DocumentState */,
      title,
      lang,
      dir,
      viewportContent: viewportMeta?.getAttribute("content") ?? null
    });
    for (let i = 0; i < chunks.length; i++) {
      ops.push({ op: 2 /* EstablishChunk */, html: chunks[i] });
    }
    const checksum = hash >>> 0;
    ops.push({
      op: 3 /* EstablishEnd */,
      nodeCount,
      checksum
    });
    return {
      frame: createEstablishFrame({ generation, sequence, ops }),
      nodeCount,
      checksum,
      publishedKeys,
      childLists
    };
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
    f64(v) {
      this.ensure(8);
      this.view.setFloat64(this.offset, v, true);
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
    const headerSize = 2 + 1 + 1 + 4 + 4 + 2 + 2;
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
    out.set(args.stringTable, o);
    o += args.stringTable.length;
    out.set(args.opsBody, o);
    return out;
  }

  // browser/mirror/projection/virtual/frame/binaryFrameEncoder.ts
  var NODE_KIND_ELEMENT = 1;
  var NODE_KIND_TEXT = 2;
  var NODE_KIND_COMMENT = 3;
  var CHILD_EXISTING = 0;
  var CHILD_FRESH = 1;
  var MODE_FULL = 0;
  var MODE_APPEND = 1;
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
      for (let i = 0; i < ops.length; i++) {
        this.writeOp(w, ops[i]);
      }
      const flags = (frame.flags.establish ? 1 : 0) | (frame.flags.resync ? 2 : 0);
      return assemblePart({
        version: frame.version,
        flags,
        generation: frame.generation,
        sequence: frame.sequence,
        partIndex,
        partCount,
        stringTable: w.takeStringTableBytes(),
        opsBody: w.bytesSoFar().slice()
      });
    }
    writeOp(w, op) {
      switch (op.op) {
        case 1 /* EstablishBegin */:
          this.writeEstablishBegin(w, op);
          return;
        case 2 /* EstablishChunk */:
          this.writeEstablishChunk(w, op);
          return;
        case 3 /* EstablishEnd */:
          this.writeEstablishEnd(w, op);
          return;
        case 12 /* DocumentState */:
          this.writeDocumentState(w, op);
          return;
        case 4 /* ChildList */:
          this.writeChildList(w, op);
          return;
        case 5 /* Patch */:
          this.writePatch(w, op);
          return;
        case 6 /* ScrollViewport */:
          this.writeScrollViewport(w, op);
          return;
        case 7 /* ScrollElement */:
          this.writeScrollElement(w, op);
          return;
        default:
          throw new Error(`BinaryFrameEncoder: unsupported op ${String(op.op)}`);
      }
    }
    writeEstablishBegin(w, op) {
      w.u8(1 /* EstablishBegin */);
      w.u32(op.generation);
      w.u32(op.viewportWidth);
      w.u32(op.viewportHeight);
      w.i32(Math.trunc(op.scrollX));
      w.i32(Math.trunc(op.scrollY));
      w.u32(op.scrollElements.length);
      for (let i = 0; i < op.scrollElements.length; i++) {
        const s = op.scrollElements[i];
        w.u32(s.node);
        w.i32(Math.trunc(s.scrollTop));
        w.i32(Math.trunc(s.scrollLeft));
      }
    }
    writeEstablishChunk(w, op) {
      w.u8(2 /* EstablishChunk */);
      w.utf8Raw(op.html);
    }
    writeEstablishEnd(w, op) {
      w.u8(3 /* EstablishEnd */);
      w.u32(op.nodeCount);
      w.u32(op.checksum >>> 0);
    }
    writeDocumentState(w, op) {
      w.u8(12 /* DocumentState */);
      w.u32(w.str(op.title));
      this.writeNullableString(w, op.lang);
      this.writeNullableString(w, op.dir);
      this.writeNullableString(w, op.viewportContent);
    }
    writeNullableString(w, value) {
      if (value === null) {
        w.u8(0);
        return;
      }
      w.u8(1);
      w.u32(w.str(value));
    }
    writeChildList(w, op) {
      w.u8(4 /* ChildList */);
      w.u32(op.parent);
      w.u8(op.mode === "append" ? MODE_APPEND : MODE_FULL);
      w.u32(op.children.length);
      for (let i = 0; i < op.children.length; i++) {
        const ref = op.children[i];
        if (ref.kind === "existing") {
          w.u8(CHILD_EXISTING);
          w.u32(ref.key);
        } else {
          w.u8(CHILD_FRESH);
          const snap = op.freshSnapshots?.get(ref.key);
          if (snap === void 0) {
            throw new Error(`BinaryFrameEncoder: missing fresh snapshot for key ${ref.key}`);
          }
          this.writeNode(w, snap);
        }
      }
    }
    writePatch(w, op) {
      w.u8(5 /* Patch */);
      w.u32(op.node);
      this.writePatchSnapshot(w, op.snapshot);
    }
    writePatchSnapshot(w, snap) {
      if (snap.kind === "element") {
        w.u8(NODE_KIND_ELEMENT);
        w.u32(w.str(snap.tag));
        w.u16(snap.attrs.length);
        for (let i = 0; i < snap.attrs.length; i++) {
          const a = snap.attrs[i];
          w.u32(w.str(a.name));
          w.u32(w.str(a.value));
        }
        return;
      }
      if (snap.kind === "text") {
        w.u8(NODE_KIND_TEXT);
        w.u32(w.str(snap.value));
        return;
      }
      w.u8(NODE_KIND_COMMENT);
      w.u32(w.str(snap.value));
    }
    writeScrollViewport(w, op) {
      w.u8(6 /* ScrollViewport */);
      w.i32(Math.trunc(op.scrollX));
      w.i32(Math.trunc(op.scrollY));
    }
    writeScrollElement(w, op) {
      w.u8(7 /* ScrollElement */);
      w.u32(op.node);
      w.i32(Math.trunc(op.scrollTop));
      w.i32(Math.trunc(op.scrollLeft));
    }
    writeNode(w, snap) {
      if (snap.kind === "element") {
        w.u8(NODE_KIND_ELEMENT);
        w.u32(snap.key);
        w.u32(w.str(snap.tag));
        w.u16(snap.attrs.length);
        for (let i = 0; i < snap.attrs.length; i++) {
          const a = snap.attrs[i];
          w.u32(w.str(a.name));
          w.u32(w.str(a.value));
        }
        const children = snap.children ?? [];
        w.u32(children.length);
        for (let i = 0; i < children.length; i++) {
          this.writeNode(w, children[i]);
        }
        return;
      }
      if (snap.kind === "text") {
        w.u8(NODE_KIND_TEXT);
        w.u32(snap.key);
        w.u32(w.str(snap.value));
        return;
      }
      w.u8(NODE_KIND_COMMENT);
      w.u32(snap.key);
      w.u32(w.str(snap.value));
    }
  };

  // browser/mirror/projection/virtual/frame/frameEmitter.ts
  var FrameEmitter = class {
    clock;
    accumulator;
    builder;
    encoder;
    transport;
    domNodes;
    telemetry;
    sequence = 0;
    pendingFrame = null;
    pendingParts = null;
    pendingPartIndex = 0;
    constructor(opts) {
      this.clock = opts.clock;
      this.accumulator = opts.accumulator;
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
    /** After establish frame (typically sequence 0), live continues from here. */
    setCurrentSequence(sequence) {
      this.sequence = sequence;
    }
    onBoundary() {
      if (this.pendingParts !== null && this.pendingFrame !== null) {
        this.trySendPending();
        return;
      }
      if (!this.accumulator.hasActiveWork()) return;
      const frozen = this.accumulator.swap();
      const nextSequence = this.sequence + 1;
      const frame = this.builder.build(frozen, {
        generation: this.domNodes.generation,
        sequence: nextSequence
      });
      if (frame === null) {
        this.accumulator.reclaimFrozen();
        return;
      }
      if (frame.ops.length === 0) {
        this.accumulator.clearFrozen();
        return;
      }
      const parts = this.encoder.encode(frame);
      if (parts.length === 0) {
        this.accumulator.reclaimFrozen();
        return;
      }
      this.pendingFrame = frame;
      this.pendingParts = parts;
      this.pendingPartIndex = 0;
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
      this.telemetry?.recordFrameEmitted({
        generation: frame.generation,
        sequence: frame.sequence,
        opCount: frame.ops.length,
        partCount: parts.length,
        bytes: totalBytes
      });
      const buildStats = this.builder.takeBuildStats?.() ?? null;
      if (buildStats !== null) {
        this.telemetry?.recordBuilderStats({
          generation: frame.generation,
          sequence: frame.sequence,
          ephemeralPruned: buildStats.ephemeralPruned,
          absorbed: buildStats.absorbed,
          orphaned: buildStats.orphaned,
          opCounts: buildStats.opCounts
        });
        this.telemetry?.recordFrameDecision({
          generation: frame.generation,
          sequence: frame.sequence,
          publishedCount: buildStats.publishedCount,
          lastChildListsParents: buildStats.lastChildListsParents,
          lastChildListsEmpty: buildStats.lastChildListsEmpty,
          dirtyIn: buildStats.dirtyIn,
          dirtyOut: buildStats.dirtyOut,
          ephemeralPruned: buildStats.ephemeralPruned,
          absorbed: buildStats.absorbed,
          orphaned: buildStats.orphaned,
          childLists: buildStats.childLists,
          childListsOmitted: buildStats.childListsOmitted,
          patches: buildStats.patches,
          scrolls: buildStats.scrolls,
          appendFromEmptyCount: buildStats.appendFromEmptyCount
        });
      }
      this.telemetry?.recordEncoder({
        generation: frame.generation,
        sequence: frame.sequence,
        partCount: parts.length,
        bytes: totalBytes,
        maxFrameBytes: this.encoder.maxFrameBytes ?? 1 << 20
      });
      this.sequence = frame.sequence;
      this.pendingFrame = null;
      this.pendingParts = null;
      this.pendingPartIndex = 0;
      this.accumulator.clearFrozen();
    }
  };

  // browser/mirror/projection/virtual/frame/netEffectFrameBuilder.ts
  function removeKeyFromSets(sets, key) {
    sets.newKeys.delete(key);
    sets.dirtyParents.delete(key);
    sets.attrDirty.delete(key);
    sets.textDirty.delete(key);
    sets.stateDirty.delete(key);
    sets.detached.delete(key);
    sets.scrollDirty.delete(key);
  }
  function cloneDirtySets(src) {
    return {
      newKeys: new Set(src.newKeys),
      dirtyParents: new Set(src.dirtyParents),
      attrDirty: new Set(src.attrDirty),
      textDirty: new Set(src.textDirty),
      stateDirty: new Set(src.stateDirty),
      scrollDirty: new Map(src.scrollDirty),
      detached: new Set(src.detached)
    };
  }
  function isSuffixAppend(prev, next) {
    if (prev.length === 0) return false;
    if (next.length <= prev.length) return false;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== next[i]) return false;
    }
    return true;
  }
  var NetEffectFrameBuilder = class {
    domNodes;
    /** Keys successfully published on the wire (this generation). */
    published = /* @__PURE__ */ new Set();
    /** Last FULL/APPEND-resolved child key list per parent. */
    lastChildLists = /* @__PURE__ */ new Map();
    lastStats = null;
    lastChildListFacts = [];
    constructor(opts) {
      this.domNodes = opts.domNodes;
    }
    /** Test / generation bump. */
    clearPublishState() {
      this.published.clear();
      this.lastChildLists.clear();
    }
    takeBuildStats() {
      const s = this.lastStats;
      this.lastStats = null;
      return s;
    }
    publishState() {
      return {
        publishedCount: this.published.size,
        lastChildListsParents: this.lastChildLists.size
      };
    }
    /** Seed ids already published by establish. */
    seedPublished(keys) {
      for (const key of keys) this.published.add(key);
    }
    /** Seed last FULL child lists from the establish walk (handoff). */
    seedChildLists(lists) {
      for (const [parent, children] of lists) {
        this.lastChildLists.set(parent, children.slice());
      }
    }
    build(frozen, ctx) {
      if (!dirtySetsHaveWork(frozen)) return null;
      const dirtyIn = dirtyCard(frozen);
      const work = cloneDirtySets(frozen);
      const ephemeralPruned = this.pruneEphemerals(work);
      const absorbed = this.absorbDescendants(work);
      const orphaned = this.pruneOrphans(work);
      if (!dirtySetsHaveWork(work)) return null;
      const dirtyOut = dirtyCard(work);
      const lastChildListsEmpty = this.lastChildLists.size === 0;
      const ops = [];
      const freshlyEmitted = /* @__PURE__ */ new Set();
      this.lastChildListFacts = [];
      this.emitChildLists(work, ops, freshlyEmitted);
      this.emitPatches(work, ops, freshlyEmitted);
      this.emitScrolls(work, ops);
      if (ops.length === 0) return null;
      for (const key of freshlyEmitted) this.published.add(key);
      const opCounts = {};
      for (const op of ops) {
        const name = opCodeName(op.op);
        opCounts[name] = (opCounts[name] ?? 0) + 1;
      }
      const allFacts = this.lastChildListFacts;
      const childLists = allFacts.slice(0, CHILD_LIST_FACT_CAP);
      let appendFromEmptyCount = 0;
      for (let i = 0; i < allFacts.length; i++) {
        if (allFacts[i].appendFromEmpty) appendFromEmptyCount += 1;
      }
      this.lastStats = {
        ephemeralPruned,
        absorbed,
        orphaned,
        opCounts,
        publishedCount: this.published.size,
        lastChildListsParents: this.lastChildLists.size,
        lastChildListsEmpty,
        dirtyIn,
        dirtyOut,
        childLists,
        childListsOmitted: Math.max(0, allFacts.length - childLists.length),
        patches: opCounts.patch ?? 0,
        scrolls: (opCounts.scrollViewport ?? 0) + (opCounts.scrollElement ?? 0),
        appendFromEmptyCount
      };
      return createLiveFrame({
        generation: ctx.generation,
        sequence: ctx.sequence,
        ops
      });
    }
    pruneEphemerals(work) {
      const doomed = [];
      for (const key of work.newKeys) {
        const node = this.domNodes.get(key);
        if (node === void 0 || !node.isConnected) doomed.push(key);
      }
      for (const key of doomed) removeKeyFromSets(work, key);
      return doomed.length;
    }
    nearestKeyedAncestor(node) {
      let cur = node.parentNode;
      while (cur !== null) {
        const key = this.domNodes.keyOf(cur);
        if (key !== NONE_DOM_NODE_KEY) return key;
        cur = cur.parentNode;
      }
      return NONE_DOM_NODE_KEY;
    }
    absorbDescendants(work) {
      let removed = 0;
      const candidates = /* @__PURE__ */ new Set([
        ...work.newKeys,
        ...work.attrDirty,
        ...work.textDirty,
        ...work.stateDirty,
        ...work.dirtyParents,
        ...work.detached
      ]);
      for (const [k] of work.scrollDirty) {
        if (k !== VIEWPORT_SCROLL_KEY) candidates.add(k);
      }
      for (const key of candidates) {
        if (work.newKeys.has(key) && this.isTopLevelNew(key, work)) continue;
        const node = this.domNodes.get(key);
        if (node === void 0) continue;
        const anc = this.nearestKeyedAncestor(node);
        if (anc === NONE_DOM_NODE_KEY) continue;
        if (!work.newKeys.has(anc)) continue;
        removeKeyFromSets(work, key);
        removed += 1;
      }
      return removed;
    }
    /** True if no ancestor is also in newKeys. */
    isTopLevelNew(key, work) {
      const node = this.domNodes.get(key);
      if (node === void 0) return true;
      let cur = node.parentNode;
      while (cur !== null) {
        const anc = this.domNodes.keyOf(cur);
        if (anc !== NONE_DOM_NODE_KEY && work.newKeys.has(anc)) return false;
        cur = cur.parentNode;
      }
      return true;
    }
    pruneOrphans(work) {
      if (work.detached.size === 0) return 0;
      let removed = 0;
      const candidates = /* @__PURE__ */ new Set([
        ...work.newKeys,
        ...work.attrDirty,
        ...work.textDirty,
        ...work.stateDirty,
        ...work.dirtyParents
      ]);
      for (const [k] of work.scrollDirty) {
        if (k !== VIEWPORT_SCROLL_KEY) candidates.add(k);
      }
      for (const key of candidates) {
        if (work.detached.has(key)) continue;
        const node = this.domNodes.get(key);
        if (node === void 0) {
          removeKeyFromSets(work, key);
          removed += 1;
          continue;
        }
        if (this.hasDetachedAncestor(node, work.detached)) {
          removeKeyFromSets(work, key);
          removed += 1;
        }
      }
      return removed;
    }
    hasDetachedAncestor(node, detached) {
      let cur = node.parentNode;
      while (cur !== null) {
        const key = this.domNodes.keyOf(cur);
        if (key !== NONE_DOM_NODE_KEY && detached.has(key)) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    emitChildLists(work, ops, freshlyEmitted) {
      const parents = [...work.dirtyParents];
      parents.sort((a, b) => {
        const na = this.domNodes.get(a);
        const nb = this.domNodes.get(b);
        if (na === void 0 || nb === void 0) return a - b;
        return documentOrderCompare(na, nb);
      });
      for (const parentKey of parents) {
        const parent = this.domNodes.get(parentKey);
        if (parent === void 0) continue;
        const childNodes = listFVisibleChildren(parent);
        const childKeys = [];
        for (let i = 0; i < childNodes.length; i++) {
          childKeys.push(this.domNodes.allocate(childNodes[i]));
        }
        const prev = this.lastChildLists.get(parentKey) ?? [];
        let mode = "full";
        let emitKeys = childKeys;
        if (isSuffixAppend(prev, childKeys)) {
          mode = "append";
          emitKeys = childKeys.slice(prev.length);
        }
        const freshSnapshots = /* @__PURE__ */ new Map();
        const children = [];
        let nExisting = 0;
        let nFresh = 0;
        for (let i = 0; i < emitKeys.length; i++) {
          const key = emitKeys[i];
          const wasPublished = this.published.has(key) && !work.newKeys.has(key);
          if (wasPublished) {
            children.push({ kind: "existing", key });
            freshlyEmitted.add(key);
            nExisting += 1;
          } else {
            children.push({ kind: "fresh", key });
            nFresh += 1;
            const node = this.domNodes.get(key);
            if (node !== void 0) {
              const snap = snapshotNodeSubtree(
                key,
                node,
                this.domNodes,
                (k) => freshlyEmitted.add(k)
              );
              if (snap !== null) freshSnapshots.set(key, snap);
            }
            freshlyEmitted.add(key);
          }
        }
        ops.push({
          op: 4 /* ChildList */,
          parent: parentKey,
          mode,
          children,
          freshSnapshots: freshSnapshots.size > 0 ? freshSnapshots : void 0
        });
        this.lastChildLists.set(parentKey, childKeys.slice());
        freshlyEmitted.add(parentKey);
        this.lastChildListFacts.push({
          parent: parentKey,
          mode,
          childCount: children.length,
          nExisting,
          nFresh,
          prevCount: prev.length,
          appendFromEmpty: mode === "append" && prev.length === 0 && children.length > 0
        });
      }
    }
    emitPatches(work, ops, freshlyEmitted) {
      const patchKeys = /* @__PURE__ */ new Set([
        ...work.attrDirty,
        ...work.textDirty,
        ...work.stateDirty
      ]);
      for (const key of patchKeys) {
        if (work.newKeys.has(key) && !this.published.has(key)) {
          continue;
        }
        const node = this.domNodes.get(key);
        if (node === void 0 || !node.isConnected) continue;
        const snap = snapshotNodeFlat(key, node);
        if (snap === null) continue;
        ops.push({ op: 5 /* Patch */, node: key, snapshot: snap });
        freshlyEmitted.add(key);
      }
    }
    emitScrolls(work, ops) {
      for (const [key, sample] of work.scrollDirty) {
        if (key === VIEWPORT_SCROLL_KEY) continue;
        ops.push({
          op: 7 /* ScrollElement */,
          node: key,
          scrollTop: sample.y,
          scrollLeft: sample.x
        });
      }
      const viewport = work.scrollDirty.get(VIEWPORT_SCROLL_KEY);
      if (viewport !== void 0) {
        ops.push({
          op: 6 /* ScrollViewport */,
          scrollX: viewport.x,
          scrollY: viewport.y
        });
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
    partsAccepted = 0;
    bytesAccepted = 0;
    deferredCount = 0;
    lastSequence = 0;
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
    recordEstablishStarted(generation) {
      if (!this.config.enabled || !this.config.establish) return;
      this.push({
        v: 1,
        kind: "establishStarted",
        t: this.now(),
        generation
      });
    }
    recordEstablishCompleted(info) {
      if (!this.config.enabled || !this.config.establish) return;
      this.push({
        v: 1,
        kind: "establishCompleted",
        t: this.now(),
        generation: info.generation,
        nodeCount: info.nodeCount,
        checksum: info.checksum,
        bytes: info.bytes,
        tableSize: info.tableSize
      });
    }
    recordEstablishFailed(generation, message) {
      if (!this.config.enabled || !this.config.establish) return;
      this.push({
        v: 1,
        kind: "establishFailed",
        t: this.now(),
        generation,
        message
      });
    }
    recordHandoff(info) {
      if (!this.config.enabled || !this.config.handoff) return;
      this.push({
        v: 1,
        kind: "handoff",
        t: this.now(),
        generation: info.generation,
        publishedCount: info.publishedCount,
        tableSize: info.tableSize,
        lastChildListsSeeded: info.lastChildListsSeeded,
        lastChildListsParents: info.lastChildListsParents
      });
    }
    recordBuilderStats(info) {
      if (!this.config.enabled || !this.config.builderStats) return;
      this.push({
        v: 1,
        kind: "builderStats",
        t: this.now(),
        generation: info.generation,
        sequence: info.sequence,
        ephemeralPruned: info.ephemeralPruned,
        absorbed: info.absorbed,
        orphaned: info.orphaned,
        opCounts: info.opCounts
      });
    }
    recordFrameDecision(info) {
      if (!this.config.enabled || !this.config.frameDecision) return;
      this.push({
        v: 1,
        kind: "frameDecision",
        t: this.now(),
        generation: info.generation,
        sequence: info.sequence,
        publishedCount: info.publishedCount,
        lastChildListsParents: info.lastChildListsParents,
        lastChildListsEmpty: info.lastChildListsEmpty,
        dirtyIn: info.dirtyIn,
        dirtyOut: info.dirtyOut,
        ephemeralPruned: info.ephemeralPruned,
        absorbed: info.absorbed,
        orphaned: info.orphaned,
        childLists: info.childLists,
        childListsOmitted: info.childListsOmitted,
        patches: info.patches,
        scrolls: info.scrolls,
        appendFromEmptyCount: info.appendFromEmptyCount
      });
    }
    recordEncoder(info) {
      if (!this.config.enabled || !this.config.encoder) return;
      this.push({
        v: 1,
        kind: "encoder",
        t: this.now(),
        generation: info.generation,
        sequence: info.sequence,
        partCount: info.partCount,
        bytes: info.bytes,
        maxFrameBytes: info.maxFrameBytes,
        split: info.partCount > 1
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
    recordFrameEmitted(info) {
      if (!this.config.enabled) return;
      this.framesEmitted += 1;
      this.partsAccepted += info.partCount;
      this.bytesAccepted += info.bytes;
      this.lastSequence = info.sequence;
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
        establish: info.establish
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
    pushAggregate() {
      if (!this.config.enabled || !this.config.aggregate) return;
      this.push({
        v: 1,
        kind: "aggregate",
        t: this.now(),
        framesEmitted: this.framesEmitted,
        partsAccepted: this.partsAccepted,
        bytesAccepted: this.bytesAccepted,
        deferredCount: this.deferredCount,
        lastSequence: this.lastSequence
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

  // browser/mirror/projection/virtual/dom/stateSensors.ts
  function attachStateSensors(opts) {
    const root = opts.root ?? document;
    const mark = (target) => {
      if (!(target instanceof Node)) return;
      const key = opts.domNodes.keyOf(target);
      if (key === NONE_DOM_NODE_KEY) return;
      opts.accumulator.markState(key);
    };
    const onInput = (ev) => mark(ev.target);
    const onChange = (ev) => mark(ev.target);
    const onToggle = (ev) => mark(ev.target);
    const onClose = (ev) => mark(ev.target);
    root.addEventListener("input", onInput, true);
    root.addEventListener("change", onChange, true);
    root.addEventListener("toggle", onToggle, true);
    root.addEventListener("close", onClose, true);
    return () => {
      root.removeEventListener("input", onInput, true);
      root.removeEventListener("change", onChange, true);
      root.removeEventListener("toggle", onToggle, true);
      root.removeEventListener("close", onClose, true);
    };
  }

  // browser/mirror/projection/virtual/dom/scrollSensors.ts
  function attachScrollSensors(opts) {
    const onScroll = (ev) => {
      const target = ev.target;
      if (target === document || target === document.documentElement || target === document.body) {
        opts.accumulator.markScroll(VIEWPORT_SCROLL_KEY, {
          x: window.scrollX,
          y: window.scrollY
        });
        return;
      }
      if (!(target instanceof Element)) return;
      const key = opts.domNodes.keyOf(target);
      if (key === NONE_DOM_NODE_KEY) return;
      const el = target;
      opts.accumulator.markScroll(key, { x: el.scrollLeft, y: el.scrollTop });
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }

  // browser/mirror/projection/virtual/bootstrap.ts
  void (async () => {
    if (globalThis.__speculumProjection) return;
    const config = readProjectionConfig();
    const domNodes = new DomNodeTable();
    const domMutationAccumulator = new DomMutationAccumulator();
    const domMutationObserver = new DomMutationObserver({
      domNodes,
      accumulator: domMutationAccumulator,
      isPublishable: isPublishableNode
    });
    const frameBuilder = new NetEffectFrameBuilder({ domNodes });
    const encoder = new BinaryFrameEncoder({ maxFrameBytes: config.maxFrameBytes });
    let frameTransport;
    let dataPlane = null;
    let loopback = null;
    if (config.transport === "console") {
      frameTransport = new ConsoleFrameTransport();
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
    attachStateSensors({ domNodes, accumulator: domMutationAccumulator });
    attachScrollSensors({ domNodes, accumulator: domMutationAccumulator });
    if (loopback) {
      try {
        await loopback.whenOpen();
      } catch (err) {
        console.error("[speculumProjection] data plane open failed", err);
      }
    }
    telemetry.recordEstablishStarted(domNodes.generation);
    let establishOk = false;
    try {
      const established = buildEstablishDomFrame({
        domNodes,
        generation: domNodes.generation,
        sequence: 0
      });
      frameBuilder.seedPublished(established.publishedKeys);
      frameBuilder.seedChildLists(established.childLists);
      const parts = encoder.encode(established.frame);
      for (let i = 0; i < parts.length; i++) {
        let result = frameTransport.send(parts[i]);
        let spins = 0;
        while (result === "deferred" && spins < 50) {
          await new Promise((r) => setTimeout(r, 20));
          result = frameTransport.send(parts[i]);
          spins += 1;
        }
      }
      const bytes = parts.reduce((n, p) => n + p.length, 0);
      establishOk = true;
      telemetry.recordEstablishCompleted({
        generation: established.frame.generation,
        nodeCount: established.nodeCount,
        checksum: established.checksum,
        bytes,
        tableSize: domNodes.size
      });
      telemetry.recordFrameEmitted({
        generation: established.frame.generation,
        sequence: established.frame.sequence,
        opCount: established.frame.ops.length,
        partCount: parts.length,
        bytes,
        establish: true
      });
      telemetry.recordEncoder({
        generation: established.frame.generation,
        sequence: established.frame.sequence,
        partCount: parts.length,
        bytes,
        maxFrameBytes: encoder.maxFrameBytes
      });
      const publish = frameBuilder.publishState();
      telemetry.recordHandoff({
        generation: established.frame.generation,
        publishedCount: publish.publishedCount,
        tableSize: domNodes.size,
        lastChildListsSeeded: publish.lastChildListsParents > 0,
        lastChildListsParents: publish.lastChildListsParents
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[speculumProjection] establish failed", err);
      telemetry.recordEstablishFailed(domNodes.generation, message);
    }
    const frameEmitter = new FrameEmitter({
      clock: frameClock,
      accumulator: domMutationAccumulator,
      builder: frameBuilder,
      encoder,
      transport: frameTransport,
      domNodes,
      telemetry
    });
    if (establishOk) frameEmitter.setCurrentSequence(0);
    frameEmitter.start();
    telemetry.start();
    globalThis.__speculumProjection = {
      version: 1,
      domNodes,
      frameClock,
      domMutationAccumulator,
      domMutationObserver,
      frameBuilder,
      frameEmitter,
      frameTransport,
      telemetry
    };
  })();
})();
