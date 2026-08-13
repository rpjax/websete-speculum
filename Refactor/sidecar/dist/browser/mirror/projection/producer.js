"use strict";
(() => {
  // browser/mirror/projection/producer/clock/timerFrameClock.ts
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
    }
    stop() {
      this.running = false;
      this.clearTimer();
    }
    setRateHz(hz) {
      if (hz <= 0 || hz === this.currentRateHz) return;
      this.currentRateHz = hz;
      if (!this.running) return;
      this.clearTimer();
      this.nextDeadlineMs = this.nowFn() + this.periodMs();
      this.arm();
    }
    setHidden(hidden) {
      this.hidden = hidden;
      if (hidden) this.setRateHz(this.opts.hiddenRateHz ?? DEFAULTS.hiddenRateHz);
      else this.setRateHz(this.topRateHz);
    }
    degrade() {
      if (this.hidden) return;
      const ladder = this.opts.rateLadder ?? FRAME_RATE_LADDER;
      const idx = ladder.indexOf(this.currentRateHz);
      const nextIdx = idx === -1 ? 0 : Math.min(idx + 1, ladder.length - 1);
      this.setRateHz(ladder[nextIdx]);
    }
    recoverStep() {
      if (this.hidden) return false;
      const now = this.nowFn();
      const recoverMs = this.opts.rateRecoverMs ?? DEFAULTS.rateRecoverMs;
      if (now - this.lastRecoverAtMs < recoverMs) return false;
      const ladder = this.opts.rateLadder ?? FRAME_RATE_LADDER;
      const idx = ladder.indexOf(this.currentRateHz);
      if (idx <= 0) return false;
      this.setRateHz(ladder[idx - 1]);
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

  // browser/mirror/projection/models/domNodeKey.ts
  var NONE_DOM_NODE_KEY = 0;

  // browser/mirror/projection/models/dirtySets.ts
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
  function dirtySetsHaveWork(sets) {
    return sets.newKeys.size > 0 || sets.dirtyParents.size > 0 || sets.attrDirty.size > 0 || sets.textDirty.size > 0 || sets.stateDirty.size > 0 || sets.scrollDirty.size > 0 || sets.detached.size > 0;
  }

  // browser/mirror/projection/producer/dom/domMutationAccumulator.ts
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

  // browser/mirror/projection/producer/dom/domNodeTable.ts
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

  // browser/mirror/projection/producer/dom/domMutationObserver.ts
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

  // browser/mirror/projection/producer/frame/binaryFrameEncoder.ts
  var BinaryFrameEncoder = class {
    encode(_frame) {
      return new Uint8Array(0);
    }
  };

  // browser/mirror/projection/producer/frame/frameEmitter.ts
  var FrameEmitter = class {
    clock;
    accumulator;
    builder;
    encoder;
    transport;
    domNodes;
    sequence = 0;
    pendingFrame = null;
    pendingBytes = null;
    constructor(opts) {
      this.clock = opts.clock;
      this.accumulator = opts.accumulator;
      this.builder = opts.builder;
      this.encoder = opts.encoder;
      this.transport = opts.transport;
      this.domNodes = opts.domNodes;
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
    onBoundary() {
      if (this.pendingBytes !== null && this.pendingFrame !== null) {
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
      const bytes = this.encoder.encode(frame);
      this.pendingFrame = frame;
      this.pendingBytes = bytes;
      this.trySendPending();
    }
    trySendPending() {
      const bytes = this.pendingBytes;
      const frame = this.pendingFrame;
      if (bytes === null || frame === null) return;
      const result = this.transport.send(bytes);
      if (result === "deferred") return;
      this.sequence = frame.sequence;
      this.pendingFrame = null;
      this.pendingBytes = null;
      this.accumulator.clearFrozen();
    }
  };

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

  // browser/mirror/projection/producer/frame/netEffectFrameBuilder.ts
  var NetEffectFrameBuilder = class {
    build(frozen, ctx) {
      if (!dirtySetsHaveWork(frozen)) return null;
      void ctx;
      void createLiveFrame;
      return null;
    }
  };

  // browser/mirror/projection/producer/transport/loopbackFrameTransport.ts
  var DEFAULT_WATERMARK = 256 * 1024;
  var LoopbackFrameTransport = class {
    socket = null;
    url = null;
    watermark;
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
      this.socket = socket;
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
    send(bytes) {
      const socket = this.socket;
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return "deferred";
      }
      if (socket.bufferedAmount > this.watermark) {
        return "deferred";
      }
      socket.send(bytes);
      return "accepted";
    }
  };

  // browser/mirror/projection/producer/bootstrap.ts
  (() => {
    if (globalThis.__speculumProjection) return;
    const domNodes = new DomNodeTable();
    const frameClock = new TimerFrameClock();
    const domMutationAccumulator = new DomMutationAccumulator();
    const domMutationObserver = new DomMutationObserver({
      domNodes,
      accumulator: domMutationAccumulator
    });
    const frameBuilder = new NetEffectFrameBuilder();
    const frameTransport = new LoopbackFrameTransport();
    const transport = frameTransport;
    const frameEmitter = new FrameEmitter({
      clock: frameClock,
      accumulator: domMutationAccumulator,
      builder: frameBuilder,
      encoder: new BinaryFrameEncoder(),
      transport,
      domNodes
    });
    domMutationObserver.start();
    frameEmitter.start();
    globalThis.__speculumProjection = {
      version: 1,
      domNodes,
      frameClock,
      domMutationAccumulator,
      domMutationObserver,
      frameBuilder,
      frameEmitter,
      frameTransport
    };
  })();
})();
