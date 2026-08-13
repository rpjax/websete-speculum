"use strict";
(() => {
  // browser/mirror/projection/client/opcodes.ts
  var PageProjectionOp = {
    establishBegin: 1,
    establishChunk: 2,
    establishEnd: 3,
    childList: 4,
    patch: 5,
    scrollViewport: 6,
    scrollElement: 7,
    cssomInstall: 8,
    cssomSheetList: 9,
    cssomRuleList: 10,
    cssomPatch: 11,
    /** §5.2.6 — title/lang/dir/meta[viewport]. Rides in the `dom` plane despite sorting after the Cssom codes. */
    documentState: 12
  };
  var PAGE_PROJECTION_MAGIC = 20560;
  var PAGE_PROJECTION_VERSION = 1;
  var PageProjectionFrameFlag = {
    Establish: 1,
    Resync: 2
  };
  var PageProjectionNodeKind = {
    Element: 1,
    Text: 2,
    Comment: 3
  };
  var PageProjectionChildListMode = {
    Full: 0,
    Append: 1
  };
  var PageProjectionChildRefKind = {
    Existing: 0,
    Fresh: 1
  };
  var PageProjectionCssomScope = {
    Main: 0,
    PierceHost: 1
  };

  // browser/mirror/projection/client/decode.ts
  var textDecoder = new TextDecoder("utf-8");
  var ByteReader = class {
    view;
    bytes;
    offset = 0;
    constructor(bytes) {
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    get remaining() {
      return this.bytes.byteLength - this.offset;
    }
    u8() {
      const v = this.view.getUint8(this.offset);
      this.offset += 1;
      return v;
    }
    u16() {
      const v = this.view.getUint16(this.offset, true);
      this.offset += 2;
      return v;
    }
    u32() {
      const v = this.view.getUint32(this.offset, true);
      this.offset += 4;
      return v;
    }
    i32() {
      const v = this.view.getInt32(this.offset, true);
      this.offset += 4;
      return v;
    }
    bytes_(len) {
      const v = this.bytes.subarray(this.offset, this.offset + len);
      this.offset += len;
      return v;
    }
    utf8(len) {
      return textDecoder.decode(this.bytes_(len));
    }
  };
  function decodeFramePart(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    try {
      const r = new ByteReader(bytes);
      if (r.remaining < 20) return malformed("frame shorter than the fixed header");
      if (r.u16() !== PAGE_PROJECTION_MAGIC) return malformed("bad magic");
      const version = r.u8();
      if (version !== PAGE_PROJECTION_VERSION) {
        return { ok: false, reason: "unknown_version", message: `unsupported wire version ${version}` };
      }
      const flags = r.u8();
      const generation = r.u32();
      const sequence = r.u32();
      const partIndex = r.u16();
      const partCount = r.u16();
      const strCount = r.u32();
      const strings = new Array(strCount);
      for (let i = 0; i < strCount; i++) strings[i] = r.utf8(r.u32());
      const opCount = r.u32();
      const ops = new Array(opCount);
      for (let i = 0; i < opCount; i++) {
        const opCode = r.u8();
        const op = decodeOp(opCode, r, strings);
        if (!op) return malformed(`unknown opcode ${opCode}`);
        ops[i] = op;
      }
      return {
        ok: true,
        part: {
          version,
          establish: (flags & PageProjectionFrameFlag.Establish) !== 0,
          resync: (flags & PageProjectionFrameFlag.Resync) !== 0,
          generation,
          sequence,
          partIndex,
          partCount,
          ops
        }
      };
    } catch (err) {
      return malformed(err instanceof Error ? err.message : String(err));
    }
  }
  function malformed(message) {
    return { ok: false, reason: "malformed", message };
  }
  function decodeOp(opCode, r, strings) {
    switch (opCode) {
      case PageProjectionOp.establishBegin: {
        const generation = r.u32();
        const viewportWidth = r.u32();
        const viewportHeight = r.u32();
        const scrollX = r.i32();
        const scrollY = r.i32();
        const count = r.u32();
        const scrollElements = new Array(count);
        for (let i = 0; i < count; i++) scrollElements[i] = { id: r.u32(), scrollTop: r.i32(), scrollLeft: r.i32() };
        return { op: "establishBegin", generation, viewportWidth, viewportHeight, scrollX, scrollY, scrollElements };
      }
      case PageProjectionOp.establishChunk:
        return { op: "establishChunk", html: r.utf8(r.u32()) };
      case PageProjectionOp.establishEnd:
        return { op: "establishEnd", nodeCount: r.u32(), checksum: r.u32() };
      case PageProjectionOp.childList: {
        const parent = r.u32();
        const mode = r.u8() === PageProjectionChildListMode.Append ? "append" : "full";
        const count = r.u32();
        const children = new Array(count);
        for (let i = 0; i < count; i++) {
          children[i] = r.u8() === PageProjectionChildRefKind.Fresh ? { kind: "fresh", node: decodeNode(r, strings) } : { kind: "existing", id: r.u32() };
        }
        return { op: "childList", parent, mode, children };
      }
      case PageProjectionOp.patch:
        return { op: "patch", node: r.u32(), snapshot: decodePatchSnapshot(r, strings) };
      case PageProjectionOp.scrollViewport:
        return { op: "scrollViewport", scrollX: r.i32(), scrollY: r.i32() };
      case PageProjectionOp.scrollElement:
        return { op: "scrollElement", node: r.u32(), scrollTop: r.i32(), scrollLeft: r.i32() };
      case PageProjectionOp.cssomInstall:
        return { op: "cssomInstall", sheets: decodeList(r, strings, decodeSheet) };
      case PageProjectionOp.cssomSheetList:
        return { op: "cssomSheetList", removed: decodeIds(r), added: decodeIndexed(r, strings, decodeSheet, "sheet") };
      case PageProjectionOp.cssomRuleList: {
        const sheet = r.u32();
        return { op: "cssomRuleList", sheet, removed: decodeIds(r), added: decodeIndexed(r, strings, decodeRule, "rule") };
      }
      case PageProjectionOp.cssomPatch:
        return { op: "cssomPatch", rule: r.u32(), cssText: strings[r.u32()] ?? "" };
      case PageProjectionOp.documentState: {
        const title = strings[r.u32()] ?? "";
        const lang = decodeNullableString(r, strings);
        const dir = decodeNullableString(r, strings);
        const viewportContent = decodeNullableString(r, strings);
        return { op: "documentState", title, lang, dir, viewportContent };
      }
      default:
        return null;
    }
  }
  function decodeNullableString(r, strings) {
    return r.u8() === 0 ? null : strings[r.u32()] ?? "";
  }
  function decodeNode(r, strings) {
    const kind = r.u8();
    const id = r.u32();
    if (kind === PageProjectionNodeKind.Text) return { id, kind: "text", value: strings[r.u32()] ?? "" };
    if (kind === PageProjectionNodeKind.Comment) return { id, kind: "comment", value: strings[r.u32()] ?? "" };
    const tag = strings[r.u32()] ?? "";
    const attrs = decodeAttrs(r, strings);
    const childCount = r.u32();
    const children = new Array(childCount);
    for (let i = 0; i < childCount; i++) children[i] = decodeNode(r, strings);
    return { id, kind: "element", tag, attrs, children };
  }
  function decodePatchSnapshot(r, strings) {
    const kind = r.u8();
    if (kind === PageProjectionNodeKind.Text) return { kind: "text", value: strings[r.u32()] ?? "" };
    if (kind === PageProjectionNodeKind.Comment) return { kind: "comment", value: strings[r.u32()] ?? "" };
    return { kind: "element", tag: strings[r.u32()] ?? "", attrs: decodeAttrs(r, strings) };
  }
  function decodeAttrs(r, strings) {
    const count = r.u16();
    const attrs = {};
    for (let i = 0; i < count; i++) attrs[strings[r.u32()] ?? ""] = strings[r.u32()] ?? "";
    return attrs;
  }
  function decodeSheet(r, strings) {
    const id = r.u32();
    const scopeByte = r.u8();
    const hostAnchorRaw = r.u32();
    return {
      id,
      scope: scopeByte === PageProjectionCssomScope.PierceHost ? "pierceHost" : "main",
      hostAnchor: hostAnchorRaw === 0 ? null : hostAnchorRaw,
      rules: decodeList(r, strings, decodeRule)
    };
  }
  function decodeRule(r, strings) {
    return { id: r.u32(), cssText: strings[r.u32()] ?? "" };
  }
  function decodeIds(r) {
    const count = r.u32();
    const ids = new Array(count);
    for (let i = 0; i < count; i++) ids[i] = r.u32();
    return ids;
  }
  function decodeList(r, strings, one) {
    const count = r.u32();
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = one(r, strings);
    return out;
  }
  function decodeIndexed(r, strings, one, key) {
    const count = r.u32();
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      const index = r.u32();
      out[i] = { index, [key]: one(r, strings) };
    }
    return out;
  }
  var FramePartAssembler = class {
    pending = /* @__PURE__ */ new Map();
    ingest(part) {
      if (part.partCount <= 1) return assemble(part, [part]);
      const key = `${part.generation}:${part.sequence}`;
      let slot = this.pending.get(key);
      if (!slot || slot.parts.length !== part.partCount) {
        slot = { parts: new Array(part.partCount), received: 0 };
        this.pending.set(key, slot);
      }
      if (!slot.parts[part.partIndex]) slot.received += 1;
      slot.parts[part.partIndex] = part;
      if (part.partIndex !== part.partCount - 1) return null;
      this.pending.delete(key);
      if (slot.received !== part.partCount) return "missing_part";
      return assemble(part, slot.parts);
    }
    /** Drops every in-flight partial assembly (desync / generation bump). */
    reset() {
      this.pending.clear();
    }
  };
  function assemble(last, parts) {
    const ops = [];
    for (const part of parts) ops.push(...part.ops);
    return { version: last.version, establish: last.establish, resync: last.resync, generation: last.generation, sequence: last.sequence, ops };
  }

  // browser/mirror/projection/client/applyDom.ts
  var DOM_OP_NAMES = /* @__PURE__ */ new Set(["childList", "patch", "scrollViewport", "scrollElement"]);
  var DomFrameApplier = class {
    queued = [];
    raf = null;
    doc;
    registry;
    options;
    constructor(doc, registry, options = {}) {
      this.doc = doc;
      this.registry = registry;
      this.options = options;
    }
    enqueue(frame) {
      this.queued.push(frame);
      if (this.raf != null) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = null;
        this.flush();
      });
    }
    flush() {
      if (this.raf != null) {
        cancelAnimationFrame(this.raf);
        this.raf = null;
      }
      const batch = this.queued.sort((a, b) => a.sequence - b.sequence);
      this.queued = [];
      if (batch.length === 0) return;
      const start = performance.now();
      let lastSequence = 0;
      for (const frame of batch) {
        lastSequence = frame.sequence;
        this.applyFrame(frame);
      }
      const duration = performance.now() - start;
      const budget = this.options.applyBudgetMs ?? 4;
      if (duration > budget) this.options.onOverrun?.(duration, lastSequence);
    }
    reset() {
      if (this.raf != null) {
        cancelAnimationFrame(this.raf);
        this.raf = null;
      }
      this.queued = [];
    }
    applyFrame(frame) {
      const notes = {
        appendOntoNonEmptyCount: 0,
        childLists: [],
        patches: 0,
        scrolls: 0
      };
      const domOps = frame.ops.filter((op) => DOM_OP_NAMES.has(op.op));
      if (domOps.length > 0) {
        const resolved = resolveDomOps(domOps, this.registry);
        if (!resolved.ok) {
          this.options.onDesync?.({ reason: "address_miss", op: resolved.op, id: resolved.id });
          return;
        }
        applyResolvedOps(this.doc, this.registry, resolved.ops, notes);
      }
      const documentStateOp = frame.ops.find((op) => op.op === "documentState");
      if (documentStateOp) applyDocumentState(this.doc, documentStateOp);
      this.options.onApplied?.(frame, notes);
    }
  };
  function resolveDomOps(ops, registry) {
    const resolved = [];
    for (const op of ops) {
      if (op.op === "childList") {
        const parent = registry.get(op.parent);
        if (!(parent instanceof Element) && parent?.nodeType !== 1) {
          return { ok: false, op: op.op, id: op.parent };
        }
        if (!parent || parent.nodeType !== 1) return { ok: false, op: op.op, id: op.parent };
        const children = [];
        for (const ref of op.children) {
          if (ref.kind === "fresh") {
            children.push({ kind: "fresh", node: ref.node });
            continue;
          }
          const node = registry.get(ref.id);
          if (!node) return { ok: false, op: op.op, id: ref.id };
          children.push({ kind: "existing", node });
        }
        resolved.push({
          op: "childList",
          parent,
          mode: op.mode,
          children
        });
      } else if (op.op === "patch") {
        const target = registry.get(op.node);
        if (!target) return { ok: false, op: op.op, id: op.node };
        resolved.push({ op: "patch", target, snapshot: op.snapshot });
      } else if (op.op === "scrollViewport") {
        resolved.push({ op: "scrollViewport", scrollX: op.scrollX, scrollY: op.scrollY });
      } else if (op.op === "scrollElement") {
        const target = registry.get(op.node);
        if (!target || target.nodeType !== 1) return { ok: false, op: op.op, id: op.node };
        resolved.push({
          op: "scrollElement",
          target,
          scrollTop: op.scrollTop,
          scrollLeft: op.scrollLeft
        });
      }
    }
    return { ok: true, ops: resolved };
  }
  function applyResolvedOps(doc, registry, ops, notes) {
    for (const op of ops) {
      if (op.op === "childList") applyChildList(doc, registry, op, notes);
      else if (op.op === "patch") {
        notes.patches += 1;
        applyPatch(op.target, op.snapshot);
      } else if (op.op === "scrollViewport") {
        notes.scrolls += 1;
        doc.defaultView?.scrollTo(op.scrollX, op.scrollY);
      } else {
        notes.scrolls += 1;
        const el = op.target;
        el.scrollTop = op.scrollTop;
        el.scrollLeft = op.scrollLeft;
      }
    }
  }
  function applyChildList(doc, registry, op, notes) {
    const parentChildCountBefore = op.parent.childNodes.length;
    let nExisting = 0;
    let nFresh = 0;
    for (const c of op.children) {
      if (c.kind === "existing") nExisting += 1;
      else nFresh += 1;
    }
    const appendOntoNonEmpty = op.mode === "append" && parentChildCountBefore > 0 && op.children.length > 0;
    if (appendOntoNonEmpty) notes.appendOntoNonEmptyCount += 1;
    if (notes.childLists.length < 32) {
      notes.childLists.push({
        parent: registry.idOf(op.parent) ?? 0,
        mode: op.mode,
        nExisting,
        nFresh,
        parentChildCountBefore,
        appendOntoNonEmpty
      });
    }
    const wanted = op.children.map(
      (c) => c.kind === "existing" ? c.node : materialize(doc, registry, c.node)
    );
    if (op.mode === "append") {
      for (const node of wanted) op.parent.appendChild(node);
      return;
    }
    const wantedSet = new Set(wanted);
    for (const child of Array.from(op.parent.childNodes)) {
      if (wantedSet.has(child)) continue;
      registry.unregisterSubtree(child);
      child.parentNode?.removeChild(child);
    }
    let cursor = op.parent.firstChild;
    for (const node of wanted) {
      if (cursor === node) {
        cursor = node.nextSibling;
        continue;
      }
      op.parent.insertBefore(node, cursor);
    }
  }
  function applyPatch(target, snapshot) {
    if (snapshot.kind === "text" || snapshot.kind === "comment") {
      target.textContent = snapshot.value ?? "";
      return;
    }
    if (target.nodeType !== 1) return;
    applyElementSnapshot(target, snapshot.attrs ?? {});
  }
  function materialize(doc, registry, node) {
    if (node.kind === "text") {
      const n = doc.createTextNode(node.value ?? "");
      registry.register(node.id, n);
      return n;
    }
    if (node.kind === "comment") {
      const n = doc.createComment(node.value ?? "");
      registry.register(node.id, n);
      return n;
    }
    const tag = node.tag ?? "div";
    const el = tag === "svg" || tag.startsWith("svg:") ? doc.createElementNS("http://www.w3.org/2000/svg", tag) : doc.createElement(tag);
    registry.register(node.id, el);
    applyElementSnapshot(el, node.attrs ?? {});
    for (const child of node.children ?? []) el.appendChild(materialize(doc, registry, child));
    return el;
  }
  function applyElementSnapshot(el, attrs) {
    for (const name of Array.from(el.getAttributeNames())) {
      if (!(name in attrs)) el.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(attrs)) {
      try {
        el.setAttribute(name, value);
      } catch {
      }
    }
    applyNodeState(el, attrs);
  }
  function applyNodeState(el, attrs) {
    const value = attrs["speculum-input-value"];
    if (value != null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      if (el.value !== value) el.value = value;
    } else if (value != null && el instanceof HTMLSelectElement) {
      el.value = value;
    }
    const checked = attrs["speculum-input-checked"];
    if (checked != null && el instanceof HTMLInputElement) el.checked = checked === "true";
    const selected = attrs["speculum-option-selected"];
    if (selected != null && el instanceof HTMLOptionElement) el.selected = selected === "true";
    if (el instanceof HTMLDialogElement) {
      const modal = attrs["speculum-dialog-modal"];
      if (modal === "true" && !el.open) el.showModal();
      else if (modal !== "true" && el.open) el.close();
    }
  }
  function applyDocumentState(doc, op) {
    doc.title = op.title;
    const html = doc.documentElement;
    if (html) {
      if (op.lang !== null) html.setAttribute("lang", op.lang);
      else html.removeAttribute("lang");
      if (op.dir !== null) html.setAttribute("dir", op.dir);
      else html.removeAttribute("dir");
    }
    const existing = doc.querySelector('meta[name="viewport"]');
    if (op.viewportContent === null) {
      existing?.remove();
      return;
    }
    const meta = existing ?? doc.createElement("meta");
    if (!existing) {
      meta.setAttribute("name", "viewport");
      (doc.head ?? doc.documentElement)?.appendChild(meta);
    }
    meta.setAttribute("content", op.viewportContent);
  }

  // browser/mirror/projection/client/registry.ts
  var PageProjectionRegistry = class {
    nodesById = /* @__PURE__ */ new Map();
    idsByNode = /* @__PURE__ */ new WeakMap();
    /** Registers (or re-registers) one node under `id`. O(1). */
    register(id, node) {
      if (id <= 0) return;
      const existing = this.nodesById.get(id);
      if (existing && existing !== node) this.idsByNode.delete(existing);
      this.nodesById.set(id, node);
      this.idsByNode.set(node, id);
    }
    /** Resolves an id to its live node, or `undefined` on a miss (§5.7.1 desync trigger). */
    get(id) {
      return this.nodesById.get(id);
    }
    /** Reverse lookup — input intents address by id via this map (§5.11.1). */
    idOf(node) {
      return this.idsByNode.get(node);
    }
    /** Nearest registered id walking up from `node` (element ancestors only). */
    idOfNearest(node) {
      let cur = node;
      while (cur) {
        const id = this.idsByNode.get(cur);
        if (id != null) return id;
        cur = cur.parentNode;
      }
      return void 0;
    }
    /** Removes exactly one id, without touching its node's descendants. */
    unregister(id) {
      const node = this.nodesById.get(id);
      if (!node) return;
      this.nodesById.delete(id);
      this.idsByNode.delete(node);
    }
    /**
     * Unregisters `root` and every descendant carrying a registered id (§5.9.1:
     * "unregister on removal including all descendants"). Cost is proportional to
     * the removed subtree, never the whole registry.
     */
    unregisterSubtree(root) {
      const stack = [root];
      while (stack.length > 0) {
        const node = stack.pop();
        const id = this.idsByNode.get(node);
        if (id != null) {
          this.nodesById.delete(id);
          this.idsByNode.delete(node);
        }
        for (const child of Array.from(node.childNodes)) stack.push(child);
      }
    }
    /** Total registered ids — soak-test bound check (`PP-ID-4`). */
    get size() {
      return this.nodesById.size;
    }
    /** Drops every entry (double-buffer epoch boundary, §5.8.5). */
    clear() {
      this.nodesById.clear();
    }
    /**
     * Walks a parsed establish document exactly once:
     * - registers every element carrying `speculum-anchor` (§5.1.7)
     * - returns `nodeCount`/`checksum` matching sidecar `computeEstablishChecksum`
     *   (FNV-1a over the preorder **element** tag stream for anchored nodes only)
     *   so `establishEnd` verification can succeed (§5.6.4, §5.7.1).
     */
    buildFromDocument(root) {
      let hash = FNV_OFFSET_BASIS;
      let count = 0;
      const addTag = (tag) => {
        count += 1;
        for (let i = 0; i < tag.length; i++) {
          hash ^= tag.charCodeAt(i);
          hash = Math.imul(hash, FNV_PRIME);
        }
        hash ^= count & 255;
        hash = Math.imul(hash, FNV_PRIME);
      };
      const walk = (node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node;
          if (el.hasAttribute("data-pp-cssom-id")) {
            return;
          }
          const id = readAnchorId(el);
          if (id != null) {
            addTag(el.tagName.toLowerCase());
            this.register(id, el);
          }
          for (const child of Array.from(el.childNodes)) walk(child);
        }
      };
      if (root && root.nodeType === Node.ELEMENT_NODE) walk(root);
      else if (root && root.nodeType === Node.DOCUMENT_NODE) {
        const de = root.documentElement;
        if (de) walk(de);
      }
      return { nodeCount: count, checksum: hash >>> 0 };
    }
  };
  function readAnchorId(el) {
    const raw = el.getAttribute("speculum-anchor");
    if (!raw) return null;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
  var FNV_OFFSET_BASIS = 2166136261;
  var FNV_PRIME = 16777619;

  // browser/mirror/projection/client/surface.ts
  function createSurfaceHost(container, opts = {
    width: 1280,
    height: 720
  }) {
    const swapTimeoutMs = opts.swapTimeoutMs ?? 1500;
    container.style.position = "relative";
    container.style.width = `${opts.width}px`;
    container.style.height = `${opts.height}px`;
    container.style.overflow = "hidden";
    container.replaceChildren();
    const makeFrame = (title) => {
      const iframe = document.createElement("iframe");
      iframe.title = title;
      iframe.sandbox.add("allow-same-origin");
      iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;visibility:hidden";
      container.appendChild(iframe);
      return iframe;
    };
    const frameA = makeFrame("Projected surface (A)");
    const frameB = makeFrame("Projected surface (B)");
    let active = null;
    const frameOf = (slot) => slot === "a" ? frameA : frameB;
    return {
      getActiveDocument: () => {
        if (!active) return null;
        return frameOf(active).contentDocument;
      },
      isArmed: () => active !== null,
      beginBuild: () => {
        const standby = active === "a" ? "b" : "a";
        const frame = frameOf(standby);
        return buildInto(frame, swapTimeoutMs, () => {
          frameOf(standby).style.visibility = "visible";
          if (active) frameOf(active).style.visibility = "hidden";
          active = standby;
        });
      }
    };
  }
  function buildInto(frame, swapTimeoutMs, doSwap) {
    const initial = frame.contentDocument;
    if (!initial) throw new Error("surface: no contentDocument");
    initial.open();
    const currentDoc = () => {
      const doc = frame.contentDocument;
      if (!doc) throw new Error("surface: lost contentDocument");
      return doc;
    };
    let cancelled = false;
    let swapped = false;
    let establishEnded = false;
    let cssomReady = false;
    let timeoutId = null;
    let resolveSwap = () => {
    };
    const swapPromise = new Promise((resolve) => {
      resolveSwap = resolve;
    });
    function clearForceTimer() {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    }
    function armForceTimer() {
      if (timeoutId != null || swapped || cancelled) return;
      if (!(establishEnded && cssomReady)) return;
      timeoutId = window.setTimeout(() => attemptSwap(true), swapTimeoutMs);
    }
    function attemptSwap(force) {
      if (swapped || cancelled) return;
      const doc = currentDoc();
      if (!(establishEnded && cssomReady)) return;
      if (!force) {
        const body = doc.body;
        if (!body) return;
        const rect = body.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return;
      }
      swapped = true;
      clearForceTimer();
      doSwap();
      resolveSwap(doc);
    }
    cssomReady = true;
    return {
      get document() {
        return currentDoc();
      },
      writeChunk(html) {
        if (cancelled || establishEnded) return;
        currentDoc().write(html);
        attemptSwap(false);
      },
      markEstablishEnd() {
        if (cancelled) return;
        if (!establishEnded) {
          establishEnded = true;
          try {
            currentDoc().close();
          } catch {
          }
        }
        armForceTimer();
        attemptSwap(false);
      },
      markCssomReady() {
        if (cancelled) return;
        cssomReady = true;
        armForceTimer();
        attemptSwap(false);
      },
      swap: () => swapPromise,
      cancel() {
        cancelled = true;
        clearForceTimer();
      }
    };
  }

  // browser/mirror/projection/models/telemetry.ts
  function desyncPhase(errorCode) {
    switch (errorCode) {
      case "malformed":
      case "unknown_version":
        return "decode";
      case "missing_part":
        return "assemble";
      case "establish_checksum":
        return "establish";
      case "sequence_gap":
        return "sequence";
      case "generation_mismatch":
        return "generation";
      default:
        return "apply";
    }
  }
  function isRepeatedConcat(value) {
    const t = value.trim();
    if (t.length < 4) return false;
    if (t.length % 2 !== 0) return false;
    const mid = t.length / 2;
    return t.slice(0, mid) === t.slice(mid);
  }

  // browser/mirror/projection/client/parityFingerprint.ts
  function captureParityFingerprint(doc, registry) {
    const title = doc.title ?? "";
    const h1 = doc.querySelector("h1")?.textContent ?? "";
    const tags = [...doc.body?.children ?? []].slice(0, 24).map((el) => el.tagName.toLowerCase());
    return {
      registrySize: registry.size,
      title,
      h1,
      bodyChildTags: tags.join(","),
      anchorCount: doc.querySelectorAll("[speculum-anchor]").length,
      scriptCount: doc.querySelectorAll("script").length,
      pCount: doc.querySelectorAll("p").length,
      htmlLen: doc.documentElement?.outerHTML.length ?? 0,
      duplicateTitle: isRepeatedConcat(title),
      duplicateH1: isRepeatedConcat(h1)
    };
  }

  // browser/mirror/projection/client/labProjectionClient.ts
  var LabProjectionClient = class {
    surface;
    assembler = new FramePartAssembler();
    onTelemetry;
    onArmed;
    onDesyncCb;
    lastSequence = -1;
    generation = 0;
    armed = false;
    build = null;
    buildRegistry = null;
    liveRegistry = null;
    liveApplier = null;
    pendingBegin = null;
    pendingDocumentState = null;
    constructor(opts) {
      this.surface = createSurfaceHost(opts.surfaceHost, {
        width: opts.width ?? 1280,
        height: opts.height ?? 720
      });
      this.onTelemetry = opts.onTelemetry;
      this.onArmed = opts.onArmed;
      this.onDesyncCb = opts.onDesync;
    }
    get isArmed() {
      return this.armed;
    }
    ingest(bytes) {
      const decoded = decodeFramePart(bytes);
      if (!decoded.ok) {
        this.desync(decoded.reason, { message: decoded.message });
        return;
      }
      const assembled = this.assembler.ingest(decoded.part);
      if (assembled === "missing_part") {
        this.desync("missing_part");
        return;
      }
      if (assembled === null) return;
      this.applyAssembled(assembled);
    }
    applyAssembled(frame) {
      if (frame.establish) {
        this.applyEstablish(frame);
        return;
      }
      if (!this.armed || !this.liveApplier || !this.liveRegistry) {
        this.desync("not_armed");
        return;
      }
      if (frame.generation !== this.generation) {
        this.desync("generation_mismatch", { message: `got ${frame.generation} have ${this.generation}` });
        return;
      }
      if (frame.sequence !== this.lastSequence + 1) {
        this.desync("sequence_gap", { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
        return;
      }
      this.lastSequence = frame.sequence;
      this.liveApplier.enqueue(frame);
    }
    applyEstablish(frame) {
      if (!this.build) {
        this.build = this.surface.beginBuild();
        this.buildRegistry = new PageProjectionRegistry();
        this.pendingBegin = null;
        this.pendingDocumentState = null;
      }
      for (const op of frame.ops) {
        if (op.op === "establishBegin") {
          this.generation = op.generation;
          this.pendingBegin = op;
        } else if (op.op === "establishChunk") {
          this.build?.writeChunk(op.html);
        } else if (op.op === "documentState") {
          this.pendingDocumentState = op;
          if (this.build?.document.documentElement) {
            applyDocumentState(this.build.document, op);
          }
        } else if (op.op === "establishEnd") {
          this.finishEstablish(op);
        }
      }
    }
    finishEstablish(op) {
      const build = this.build;
      const registry = this.buildRegistry;
      if (!build || !registry) return;
      build.markEstablishEnd();
      build.markCssomReady();
      if (this.pendingDocumentState && build.document.documentElement) {
        applyDocumentState(build.document, this.pendingDocumentState);
      }
      const verified = registry.buildFromDocument(build.document);
      if (verified.nodeCount !== op.nodeCount || verified.checksum !== op.checksum) {
        this.reportApply({
          ok: false,
          establish: true,
          sequence: 0,
          reason: "checksum_mismatch",
          nodeCount: verified.nodeCount,
          checksum: op.checksum,
          registrySize: registry.size
        });
        this.emitFingerprint(build.document, registry, 0, true);
        this.desync("establish_checksum", {
          message: `got nodeCount=${verified.nodeCount} checksum=${verified.checksum} want ${op.nodeCount}/${op.checksum}`
        });
        build.cancel();
        this.build = null;
        this.buildRegistry = null;
        return;
      }
      void build.swap().then((doc) => {
        this.liveRegistry = registry;
        this.liveApplier = new DomFrameApplier(doc, registry, {
          onDesync: (info) => {
            this.reportApply({
              ok: false,
              establish: false,
              sequence: this.lastSequence,
              reason: info.reason,
              registrySize: registry.size
            });
            this.desync(info.reason, { op: info.op, id: info.id });
          },
          onApplied: (f, notes) => {
            this.reportApply({
              ok: true,
              establish: false,
              sequence: f.sequence,
              registrySize: registry.size,
              appendOntoNonEmptyCount: notes.appendOntoNonEmptyCount
            });
            this.emitFingerprint(doc, registry, f.sequence, false);
            this.emitApplyNotes(f.sequence, notes);
          },
          onOverrun: (durationMs, lastSequence) => {
            this.onTelemetry?.({
              v: 1,
              kind: "applyOverrun",
              t: performance.now(),
              generation: this.generation,
              sequence: lastSequence,
              durationMs,
              budgetMs: 4
            });
          }
        });
        if (this.pendingBegin) {
          doc.defaultView?.scrollTo(this.pendingBegin.scrollX, this.pendingBegin.scrollY);
        }
        this.lastSequence = 0;
        this.armed = true;
        this.build = null;
        this.buildRegistry = null;
        this.reportApply({
          ok: true,
          establish: true,
          sequence: 0,
          nodeCount: verified.nodeCount,
          checksum: verified.checksum,
          registrySize: registry.size
        });
        this.emitFingerprint(doc, registry, 0, true);
        this.onArmed?.();
      });
    }
    emitApplyNotes(sequence, notes) {
      if (notes.appendOntoNonEmptyCount === 0 && notes.childLists.length === 0) return;
      this.onTelemetry?.({
        v: 1,
        kind: "applyDecision",
        t: performance.now(),
        generation: this.generation,
        sequence,
        appendOntoNonEmptyCount: notes.appendOntoNonEmptyCount,
        childLists: notes.childLists,
        patches: notes.patches,
        scrolls: notes.scrolls
      });
    }
    emitFingerprint(doc, registry, sequence, establish) {
      const fp = captureParityFingerprint(doc, registry);
      this.onTelemetry?.({
        v: 1,
        kind: "parityFingerprint",
        t: performance.now(),
        generation: this.generation,
        sequence,
        establish,
        ...fp
      });
    }
    reportApply(info) {
      this.onTelemetry?.({
        v: 1,
        kind: "applyResult",
        t: performance.now(),
        generation: this.generation,
        sequence: info.sequence,
        ok: info.ok,
        establish: info.establish,
        reason: info.reason,
        nodeCount: info.nodeCount,
        checksum: info.checksum,
        registrySize: info.registrySize,
        appendOntoNonEmptyCount: info.appendOntoNonEmptyCount
      });
    }
    desync(reason, extra) {
      this.onTelemetry?.({
        v: 1,
        kind: "desynced",
        t: performance.now(),
        generation: this.generation,
        sequence: extra?.gotSequence ?? this.lastSequence,
        errorCode: reason,
        phase: desyncPhase(reason),
        expectedSequence: extra?.expectedSequence,
        op: extra?.op,
        id: extra?.id,
        message: extra?.message
      });
      this.armed = false;
      this.assembler.reset();
      this.liveApplier?.reset();
      this.onDesyncCb?.(reason);
    }
  };

  // browser/mirror/projection/lab/client/main.ts
  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} missing`);
    return el;
  }
  function logActivity(text, kind = "info") {
    const log = $("activity");
    const line = document.createElement("div");
    line.dataset.kind = kind;
    line.textContent = `${(/* @__PURE__ */ new Date()).toISOString().slice(11, 23)} ${text}`;
    log.prepend(line);
    while (log.childElementCount > 400) log.lastChild?.remove();
  }
  function setStatus(text) {
    $("status").textContent = text;
  }
  function defaultFixtureUrl() {
    return `${location.origin}/fixtures/demo.html`;
  }
  function readConfigFromUi() {
    return {
      enabled: $("telEnabled").checked,
      frameEmitted: $("telFrameEmitted").checked,
      transportDeferred: $("telDeferred").checked,
      aggregate: $("telAggregate").checked,
      establish: $("telEstablish").checked,
      builderStats: $("telBuilder").checked,
      applyResult: $("telApply").checked,
      desync: $("telDesync").checked,
      applyOverrun: $("telOverrun").checked,
      clock: $("telClock").checked,
      handoff: $("telHandoff").checked,
      frameDecision: $("telDecision").checked,
      parityFingerprint: $("telParity").checked,
      encoder: $("telEncoder").checked,
      aggregateIntervalMs: Number($("telAggMs").value) || 2e3
    };
  }
  function clientKindEnabled(kind) {
    if (kind === "desynced") return $("telDesync").checked;
    if (kind === "applyOverrun") return $("telOverrun").checked;
    if (kind === "parityFingerprint") return $("telParity").checked;
    if (kind === "applyDecision") return $("telDecision").checked;
    if (kind === "applyResult") return $("telApply").checked;
    return true;
  }
  function bootLabClient() {
    const urlInput = $("url");
    urlInput.value = defaultFixtureUrl();
    let ws = null;
    let frames = 0;
    let applyOk = 0;
    let desyncCount = 0;
    let lastSeq = -1;
    let armed = false;
    const metrics = {
      frames: 0,
      establish: "\u2014",
      gen: "\u2014",
      seq: "\u2014",
      applyOk: 0
    };
    const projection = new LabProjectionClient({
      surfaceHost: $("surfaceHost"),
      onArmed: () => {
        armed = true;
        metrics.establish = "armed";
        $("streamEstablish").textContent = "armed";
        setStatus("armed \u2014 live apply");
        logActivity("surface armed", "applyResult");
      },
      onDesync: (reason) => {
        armed = false;
        desyncCount += 1;
        $("streamDesync").textContent = String(desyncCount);
        setStatus(`desync: ${reason}`);
        logActivity(`desync ${reason}`, "desynced");
      },
      onTelemetry: (msg) => {
        const kind = String(msg.kind ?? "applyResult");
        const send = clientKindEnabled(kind);
        if (kind === "desynced" || msg.ok === false) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "clientTelemetry", message: msg }));
          }
        } else if (send && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "clientTelemetry", message: msg }));
        }
        if (msg.ok === true) applyOk += 1;
        metrics.applyOk = applyOk;
        $("streamApply").textContent = String(applyOk);
        if (kind === "parityFingerprint") {
          $("streamDupH1").textContent = msg.duplicateH1 === true ? "YES" : "no";
        }
        if (kind === "applyDecision" && typeof msg.appendOntoNonEmptyCount === "number") {
          $("streamAppendEmpty").textContent = String(msg.appendOntoNonEmptyCount);
        }
        if (kind === "frameDecision" && typeof msg.appendFromEmptyCount === "number") {
          $("streamAppendEmpty").textContent = String(msg.appendFromEmptyCount);
        }
        logActivity(
          `${kind} ok=${String(msg.ok ?? "-")} seq=${String(msg.sequence ?? "-")} ${msg.reason ? msg.reason : ""}${msg.duplicateH1 === true ? " DUP_H1" : ""}${typeof msg.appendFromEmptyCount === "number" ? ` append\u2205=${msg.appendFromEmptyCount}` : ""}${typeof msg.appendOntoNonEmptyCount === "number" ? ` onto=${msg.appendOntoNonEmptyCount}` : ""}`,
          kind
        );
      }
    });
    const connectBtn = $("connect");
    const startBtn = $("start");
    const stopBtn = $("stop");
    function setConnected(on) {
      connectBtn.disabled = on;
      startBtn.disabled = !on;
      stopBtn.disabled = !on;
    }
    function showTab(name) {
      for (const id of ["panelStream", "panelActivity", "panelConfig"]) {
        $(id).hidden = id !== `panel${name}`;
      }
      for (const btn of document.querySelectorAll("[data-tab]")) {
        btn.classList.toggle("active", btn.dataset.tab === name);
      }
    }
    for (const btn of document.querySelectorAll("[data-tab]")) {
      btn.addEventListener("click", () => showTab(btn.dataset.tab ?? "Stream"));
    }
    showTab("Stream");
    connectBtn.addEventListener("click", () => {
      if (ws !== null) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/lab/session`);
      ws.binaryType = "arraybuffer";
      setStatus("connecting\u2026");
      ws.addEventListener("open", () => {
        setConnected(true);
        setStatus("connected \u2014 press Start");
        logActivity("session WS open");
      });
      ws.addEventListener("close", () => {
        ws = null;
        setConnected(false);
        setStatus("disconnected");
        logActivity("session WS closed");
      });
      ws.addEventListener("message", (ev) => {
        if (typeof ev.data !== "string") {
          frames += 1;
          metrics.frames = frames;
          $("streamFrames").textContent = String(frames);
          projection.ingest(new Uint8Array(ev.data));
          return;
        }
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          logActivity(`bad control: ${ev.data.slice(0, 80)}`);
          return;
        }
        if (msg.type === "hello") {
          logActivity(`hello session=${msg.sessionId ?? "?"}`);
          return;
        }
        if (msg.type === "ready") {
          setStatus(`Virtual ready \u2014 ${msg.url ?? ""}`);
          logActivity(`ready dataPlane=${msg.dataPlaneUrl ?? ""}`);
          return;
        }
        if (msg.type === "stats") {
          $("hostStats").textContent = `host frames=${msg.frames ?? 0} bytes=${msg.bytes ?? 0} gen=${msg.generation ?? "-"} seq=${msg.sequence ?? "-"} tel=${msg.telemetryMessages ?? 0}`;
          if (msg.sequence != null) {
            lastSeq = msg.sequence;
            metrics.seq = String(msg.sequence);
            $("streamSeq").textContent = String(msg.sequence);
          }
          if (msg.generation != null) {
            metrics.gen = String(msg.generation);
            $("streamGen").textContent = String(msg.generation);
          }
          return;
        }
        if (msg.type === "telemetry") {
          const tel = msg.message;
          const kind = tel?.kind ?? "?";
          logActivity(`telemetry ${kind} ${JSON.stringify(tel).slice(0, 120)}`, kind);
          if (kind === "establishCompleted") {
            if (!armed) {
              metrics.establish = "completed";
              $("streamEstablish").textContent = "completed";
            }
          }
          if (kind === "frameEmitted" && tel?.sequence != null) {
            $("streamSeq").textContent = String(tel.sequence);
          }
          if (kind === "frameDecision" && tel?.appendFromEmptyCount != null) {
            $("streamAppendEmpty").textContent = String(tel.appendFromEmptyCount);
          }
          if (kind === "parityFingerprint") {
            $("streamDupH1").textContent = tel?.duplicateH1 === true ? "YES" : "no";
          }
          return;
        }
        if (msg.type === "error") {
          setStatus(`error: ${typeof msg.message === "string" ? msg.message : "?"}`);
          logActivity(`error ${typeof msg.message === "string" ? msg.message : "?"}`);
          return;
        }
        logActivity(`control ${msg.type}`);
      });
    });
    startBtn.addEventListener("click", () => {
      if (ws === null || ws.readyState !== WebSocket.OPEN) return;
      frames = 0;
      applyOk = 0;
      desyncCount = 0;
      armed = false;
      $("streamDesync").textContent = "0";
      $("streamAppendEmpty").textContent = "0";
      $("streamDupH1").textContent = "\u2014";
      ws.send(
        JSON.stringify({
          type: "start",
          url: urlInput.value.trim(),
          telemetry: readConfigFromUi(),
          frameRateHz: Number($("cfgFrameRate").value) || 60
        })
      );
      setStatus("starting Virtual\u2026");
    });
    stopBtn.addEventListener("click", () => {
      if (ws === null || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "stop" }));
    });
    setConnected(false);
    setStatus("idle");
    void armed;
    void lastSeq;
  }
  bootLabClient();
})();
