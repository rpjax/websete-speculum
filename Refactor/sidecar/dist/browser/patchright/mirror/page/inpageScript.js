"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGE_PROJECTION_V2_PAGE_SCRIPT = void 0;
/**
 * In-page producer bootstrap for the redesigned PageProjection engine (§5.1–5.3).
 * Injected into Virtual Chromium; identity is off-DOM (WeakMap) — never writes
 * speculum-anchor / speculum-last-mutation-sequence into the site's DOM (PP-ID-1).
 *
 * Live cutover: PatchrightBrowserSession installs this alongside (then instead of)
 * PAGE_PROJECTION_PAGE_SCRIPT once binary channel wiring is complete.
 *
 * Sensor coverage (§5.1–5.3, §5.10):
 * - Dom: MutationObserver + the §5.2.1 state-sensor event list, armed on the
 *   main document, every shadow root (open, or closed via the patched
 *   `attachShadow`) and every same-origin iframe's `contentDocument`.
 * - Cssom: prototype hooks on `CSSStyleSheet`/`CSSStyleDeclaration` plus
 *   `adoptedStyleSheets` setter interception and `<style>`/`<link>` lifecycle
 *   tracking, sharing the Dom uint32 id space via the same `allocate()`.
 * - Shadow DOM is published flattened (PP-F-3): a host's F children are the
 *   shadow root's rendered content with `<slot>` replaced by its assigned
 *   nodes (or its default content when nothing is slotted).
 *
 * Known realm boundary (not a W4 item): `page.addInitScript` re-runs this
 * whole bootstrap inside every same-origin iframe's own realm too, so the
 * Cssom prototype hooks above are patched on *that* realm's own
 * `CSSStyleSheet.prototype` etc., not this (top) realm's. Structural DOM
 * (MutationObserver), scroll and the state-sensor events reach into a pierced
 * iframe fine — those are plain DOM API calls, unaffected by realm — and are
 * armed by `bindIframeInterior` below. Style/link *elements* inside a pierced
 * iframe are also covered (their lifecycle rides the same MutationObserver).
 * What is NOT covered: a script running inside that iframe calling a Cssom
 * API (`sheet.insertRule(...)`, `shadowRoot.adoptedStyleSheets = [...]`, a
 * rule's `style.setProperty(...)`) directly — that resolves against the
 * iframe's own prototypes, which this top-realm patch never touches. Cross-
 * origin iframes and closed shadow roots created before this script installs
 * remain W4 (need a shared CDP session).
 */
exports.PAGE_PROJECTION_V2_PAGE_SCRIPT = String.raw `
(() => {
  if (window.__speculumPageProjectionV2) return window.__speculumPageProjectionV2;

  const forward = new WeakMap();
  const reverse = new Map();
  let nextId = 1;
  let generation = 1;
  // Document-realm epoch — minted once per script install; soft nav keeps the same realm/token (PP-NAV-2).
  const epochId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : ('e' + Math.random().toString(36).slice(2) + Date.now().toString(36));

  function allocate(node) {
    if (!node) return 0;
    let id = forward.get(node);
    if (id) return id;
    id = nextId++;
    forward.set(node, id);
    reverse.set(id, new WeakRef(node));
    return id;
  }

  function resolve(id) {
    const ref = reverse.get(id);
    if (!ref) return null;
    const n = ref.deref();
    if (!n) {
      reverse.delete(id);
      return null;
    }
    return n;
  }

  function bumpGeneration() {
    generation += 1;
    reverse.clear();
    nextId = 1;
    return generation;
  }

  const PLACEHOLDERS = new Set([
    'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'BASE', 'OBJECT', 'EMBED', 'APPLET',
  ]);

  const dirty = {
    newIds: new Set(),
    dirtyParents: new Set(),
    attrDirty: new Set(),
    textDirty: new Set(),
    stateDirty: new Set(),
    scrollDirty: new Map(),
    detached: new Set(),
  };

  // ---------------------------------------------------------------- §5.2.2 shadow-DOM piercing (PP-F-3)

  const shadowRoots = new WeakMap(); // host element -> ShadowRoot (open, or closed via our own attachShadow patch).
  const shadowClosedHosts = new WeakSet();
  const knownShadowRoots = new Set();

  function flattenSlotAssigned(slot) {
    const assigned = typeof slot.assignedNodes === 'function' ? slot.assignedNodes({ flatten: true }) : [];
    return assigned.length > 0 ? assigned : Array.prototype.slice.call(slot.childNodes);
  }

  /** The *rendered* children of n: shadow-flattened when it hosts a shadow root, its own childNodes otherwise. */
  function childNodesFor(n) {
    const root = shadowRoots.get(n);
    if (!root) return n.childNodes;
    const out = [];
    Array.prototype.forEach.call(root.childNodes, (child) => {
      if (child.nodeType === 1 && child.tagName === 'SLOT') {
        flattenSlotAssigned(child).forEach((c) => out.push(c));
      } else {
        out.push(child);
      }
    });
    return out;
  }

  function scanExistingShadowRoots(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.shadowRoot && !shadowRoots.has(el)) {
        shadowRoots.set(el, el.shadowRoot);
        knownShadowRoots.add(el.shadowRoot);
        armRoot(el.shadowRoot);
        scanExistingShadowRoots(el.shadowRoot);
      }
    }
  }

  const origAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = origAttachShadow.call(this, init);
    shadowRoots.set(this, root);
    knownShadowRoots.add(root);
    if (init && init.mode === 'closed') shadowClosedHosts.add(this);
    armRoot(root);
    return root;
  };

  /**
   * CDP closed-shadow adopt (PP-F-4) — Runtime.callFunctionOn hands us the host
   * element and its closed ShadowRoot object. Register them in the WeakMaps so
   * snapshotDocument / MutationObserver pierce them like attachShadow hooks.
   */
  function adoptClosedShadow(host, shadow) {
    if (!host || !shadow) return false;
    shadowRoots.set(host, shadow);
    knownShadowRoots.add(shadow);
    shadowClosedHosts.add(host);
    armRoot(shadow);
    allocate(host);
    scanExistingShadowRoots(shadow);
    scanExistingIframes(shadow);
    return true;
  }

  // ---------------------------------------------------------------- §5.2.2 same-origin iframe piercing

  const iframeDocHost = new WeakMap(); // pierced iframe's contentDocument -> the <iframe> element that hosts it.
  const knownIframeDocs = new Set();

  function bindIframeInterior(iframeEl) {
    let doc = null;
    try { doc = iframeEl.contentDocument; } catch (_) { doc = null; }
    if (!doc) return; // cross-origin — liveAttach CDP pierce injects a satellite script into the child frame.
    iframeDocHost.set(doc, iframeEl);
    knownIframeDocs.add(doc);
    armRoot(doc);
    scanExistingShadowRoots(doc);
    scanExistingIframes(doc);
  }

  function scanExistingIframes(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const frames = root.querySelectorAll('iframe');
    for (let i = 0; i < frames.length; i++) bindIframeInterior(frames[i]);
  }

  document.addEventListener(
    'load',
    (e) => {
      const t = e.target;
      if (t && t.nodeType === 1 && t.tagName === 'IFRAME') bindIframeInterior(t);
    },
    true,
  );

  // ---------------------------------------------------------------- §5.2.1 node state sensors

  const STATE_SENSOR_EVENTS = [
    'input', 'change', 'toggle', 'close', 'play', 'pause', 'volumechange', 'timeupdate', 'seeked',
  ];

  function markStateDirty(el) {
    if (!el) return;
    const id = allocate(el);
    dirty.stateDirty.add(id);
  }

  function bindStateSensors(root) {
    STATE_SENSOR_EVENTS.forEach((type) => {
      root.addEventListener(
        type,
        (e) => {
          const t = e.target;
          if (t && t.nodeType === 1) markStateDirty(t);
        },
        true,
      );
    });
  }

  function computeStateFor(n) {
    const tag = n.tagName;
    const state = {};
    if (tag === 'INPUT') {
      if (n.type === 'checkbox' || n.type === 'radio') state.inputChecked = n.checked ? 'true' : 'false';
      else state.inputValue = n.value;
    } else if (tag === 'TEXTAREA') {
      state.inputValue = n.value;
    } else if (tag === 'SELECT') {
      state.inputValue = n.value;
    } else if (tag === 'OPTION') {
      state.optionSelected = n.selected ? 'true' : 'false';
    } else if (tag === 'DIALOG') {
      let modal = false;
      try { modal = n.open && n.matches(':modal'); } catch (_) { modal = false; }
      state.dialogModal = modal ? 'true' : 'false';
    } else if (tag === 'VIDEO' || tag === 'AUDIO') {
      state.mediaPaused = n.paused ? 'true' : 'false';
      state.mediaCurrentTime = String(n.currentTime || 0);
      state.mediaMuted = n.muted ? 'true' : 'false';
      state.mediaVolume = String(n.volume);
    }
    if (n.hasAttribute && n.hasAttribute('popover')) {
      let open = false;
      try { open = n.matches(':popover-open'); } catch (_) { open = false; }
      state.popoverOpen = open ? 'true' : 'false';
    }
    if (typeof n.checkValidity === 'function' && n.validationMessage) {
      state.customValidity = n.validationMessage;
    }
    return Object.keys(state).length > 0 ? state : undefined;
  }

  // ---------------------------------------------------------------- scroll dirty (VIEWPORT_SCROLL_TARGET = 0)

  function bindScrollSensor(root) {
    root.addEventListener(
      'scroll',
      (e) => {
        const t = e.target;
        if (t === document || t === (root.ownerDocument || root)) {
          const doc = t.nodeType === 9 ? t : document;
          const win = doc.defaultView;
          if (!win) return;
          // A pierced same-origin iframe's own viewport scroll is not THE page viewport —
          // id 0 is reserved for the top document (PP-F §5.3.2). Key it to the iframe
          // element's own id and fold it in as a plain element scroll instead, so it
          // never collides with (or overwrites) the outer scrollViewport sample.
          const iframeHost = iframeDocHost.get(doc);
          if (iframeHost) dirty.scrollDirty.set(allocate(iframeHost), { x: win.scrollX, y: win.scrollY });
          else dirty.scrollDirty.set(0, { x: win.scrollX, y: win.scrollY });
        } else if (t && t.nodeType === 1) {
          dirty.scrollDirty.set(allocate(t), { x: t.scrollLeft, y: t.scrollTop });
        }
      },
      true,
    );
  }

  // ---------------------------------------------------------------- §5.10 Cssom sensors

  const cssomDelta = [];
  const cssomKnownRules = new Map(); // sheetId -> Map<ruleId, CSSRule>, for diffing on replace/delete.
  const sheetOwnerHost = new WeakMap(); // constructed/element sheet -> pierce-host element (absent => main scope).
  const sheetAdoptionRefs = new Map(); // sheetId -> number of *.adoptedStyleSheets arrays currently holding it.
  const elementSheetRef = new WeakMap(); // <style>/<link> element -> its CSSStyleSheet, for removal lookups.

  function sheetScopeFor(sheet) {
    const host = sheetOwnerHost.get(sheet);
    return host ? { kind: 'pierceHost', hostId: allocate(host) } : { kind: 'main' };
  }

  /** The styleSheets list a pierce-scoped host's sheet lives in — its shadow root's, or its contentDocument's. */
  function pierceScopeStyleSheetList(ownerHost) {
    const shadowRoot = shadowRoots.get(ownerHost);
    if (shadowRoot) return shadowRoot.styleSheets;
    let doc = null;
    try { doc = ownerHost && ownerHost.contentDocument; } catch (_) { doc = null; }
    return doc ? doc.styleSheets : null;
  }

  function elementSheetIndex(sheet, ownerHost) {
    const list = ownerHost ? pierceScopeStyleSheetList(ownerHost) : document.styleSheets;
    if (!list) return 0;
    const idx = Array.prototype.indexOf.call(list, sheet);
    return idx >= 0 ? idx : list.length;
  }

  function registerSheet(sheet, ownerHost) {
    const sheetId = allocate(sheet);
    if (ownerHost) sheetOwnerHost.set(sheet, ownerHost);
    const ruleMap = new Map();
    const rules = [];
    try {
      for (let i = 0; i < sheet.cssRules.length; i++) {
        const rule = sheet.cssRules[i];
        const ruleId = allocate(rule);
        ruleMap.set(ruleId, rule);
        rules.push({ id: ruleId, cssText: rule.cssText });
      }
    } catch (_) {
      // Cross-origin (non-CORS) external stylesheet — cssRules throws. Publish header-only.
      // TODO(W4): CDP CSS.getStyleSheetText for cross-origin rule bodies.
    }
    cssomKnownRules.set(sheetId, ruleMap);
    return { id: sheetId, scope: sheetScopeFor(sheet), rules };
  }

  function ensureSheetKnown(sheet, ownerHost, indexHint) {
    const sheetId = allocate(sheet);
    if (cssomKnownRules.has(sheetId)) {
      if (ownerHost && !sheetOwnerHost.has(sheet)) sheetOwnerHost.set(sheet, ownerHost);
      return { sheetId, isNew: false };
    }
    const descriptor = registerSheet(sheet, ownerHost);
    const index = typeof indexHint === 'number' ? indexHint : elementSheetIndex(sheet, ownerHost);
    cssomDelta.push({ op: 'addSheet', sheetId, index, sheet: descriptor });
    return { sheetId, isNew: true };
  }

  function adjustAdoptionRef(sheetId, delta) {
    const next = (sheetAdoptionRefs.get(sheetId) || 0) + delta;
    if (next <= 0) {
      sheetAdoptionRefs.delete(sheetId);
      return 0;
    }
    sheetAdoptionRefs.set(sheetId, next);
    return next;
  }

  function collectAllSheetsInOrder() {
    const out = [];
    Array.prototype.forEach.call(document.styleSheets, (sheet) => out.push({ sheet, ownerHost: undefined }));
    Array.prototype.forEach.call(document.adoptedStyleSheets || [], (sheet) => out.push({ sheet, ownerHost: undefined }));
    knownShadowRoots.forEach((root) => {
      Array.prototype.forEach.call(root.styleSheets || [], (sheet) => out.push({ sheet, ownerHost: root.host }));
      Array.prototype.forEach.call(root.adoptedStyleSheets || [], (sheet) => out.push({ sheet, ownerHost: root.host }));
    });
    // Same-origin iframes flatten into the parent tree (T13/PP-F-3), so their sheets need
    // C7 pierceHost scoping to the iframe element too, exactly like a shadow root's.
    knownIframeDocs.forEach((doc) => {
      const host = iframeDocHost.get(doc);
      Array.prototype.forEach.call(doc.styleSheets || [], (sheet) => out.push({ sheet, ownerHost: host }));
      Array.prototype.forEach.call(doc.adoptedStyleSheets || [], (sheet) => out.push({ sheet, ownerHost: host }));
    });
    return out;
  }

  /** Full fresh install — used by snapshotCssom() (establish) only; live deltas ride cssomDelta. */
  function snapshotCssomSheets() {
    cssomDelta.length = 0;
    cssomKnownRules.clear();
    return collectAllSheetsInOrder().map((entry) => registerSheet(entry.sheet, entry.ownerHost));
  }

  // -- insertRule / deleteRule ------------------------------------------------------------------

  const origInsertRule = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function (ruleText, index) {
    const at = typeof index === 'number' ? index : this.cssRules.length;
    const result = origInsertRule.call(this, ruleText, at);
    const known = ensureSheetKnown(this, sheetOwnerHost.get(this));
    if (!known.isNew) {
      const rule = this.cssRules[result];
      if (rule) {
        const ruleId = allocate(rule);
        const ruleMap = cssomKnownRules.get(known.sheetId);
        if (ruleMap) ruleMap.set(ruleId, rule);
        cssomDelta.push({ op: 'addRule', sheetId: known.sheetId, ruleId, index: result, rule: { id: ruleId, cssText: rule.cssText } });
      }
    }
    return result;
  };

  const origDeleteRule = CSSStyleSheet.prototype.deleteRule;
  CSSStyleSheet.prototype.deleteRule = function (index) {
    const known = ensureSheetKnown(this, sheetOwnerHost.get(this));
    const rule = this.cssRules[index];
    const ruleId = rule ? allocate(rule) : 0;
    origDeleteRule.call(this, index);
    if (ruleId && !known.isNew) {
      const ruleMap = cssomKnownRules.get(known.sheetId);
      if (ruleMap) ruleMap.delete(ruleId);
      cssomDelta.push({ op: 'removeRule', sheetId: known.sheetId, ruleId });
    }
  };

  // -- replaceSync / replace (constructable stylesheets) ----------------------------------------

  function onSheetReplaced(sheet) {
    const known = ensureSheetKnown(sheet, sheetOwnerHost.get(sheet));
    if (known.isNew) return; // freshly registered — already reflects the post-replace content.
    const ruleMap = cssomKnownRules.get(known.sheetId) || new Map();
    ruleMap.forEach((_rule, ruleId) => cssomDelta.push({ op: 'removeRule', sheetId: known.sheetId, ruleId }));
    ruleMap.clear();
    try {
      for (let i = 0; i < sheet.cssRules.length; i++) {
        const rule = sheet.cssRules[i];
        const ruleId = allocate(rule);
        ruleMap.set(ruleId, rule);
        cssomDelta.push({ op: 'addRule', sheetId: known.sheetId, ruleId, index: i, rule: { id: ruleId, cssText: rule.cssText } });
      }
    } catch (_) {}
    cssomKnownRules.set(known.sheetId, ruleMap);
  }

  if (typeof CSSStyleSheet.prototype.replaceSync === 'function') {
    const origReplaceSync = CSSStyleSheet.prototype.replaceSync;
    CSSStyleSheet.prototype.replaceSync = function (text) {
      const r = origReplaceSync.call(this, text);
      onSheetReplaced(this);
      return r;
    };
  }
  if (typeof CSSStyleSheet.prototype.replace === 'function') {
    const origReplace = CSSStyleSheet.prototype.replace;
    CSSStyleSheet.prototype.replace = function (text) {
      return origReplace.call(this, text).then((sheet) => {
        onSheetReplaced(sheet);
        return sheet;
      });
    };
  }

  // -- CSSStyleDeclaration (a rule's own style block; inline element style rides attrDirty instead) --

  function notifyStylePatched(styleDecl) {
    const rule = styleDecl.parentRule;
    if (!rule) return; // inline element style — the attribute MutationObserver already covers this.
    const ruleId = allocate(rule);
    cssomDelta.push({ op: 'patchRule', ruleId, cssText: rule.cssText });
  }

  const origSetProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
    const r = origSetProperty.call(this, name, value, priority);
    notifyStylePatched(this);
    return r;
  };
  const origRemoveProperty = CSSStyleDeclaration.prototype.removeProperty;
  CSSStyleDeclaration.prototype.removeProperty = function (name) {
    const r = origRemoveProperty.call(this, name);
    notifyStylePatched(this);
    return r;
  };
  const cssTextDescriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'cssText');
  if (cssTextDescriptor && cssTextDescriptor.set) {
    Object.defineProperty(CSSStyleDeclaration.prototype, 'cssText', {
      configurable: true,
      enumerable: cssTextDescriptor.enumerable,
      get: cssTextDescriptor.get,
      set(value) {
        cssTextDescriptor.set.call(this, value);
        notifyStylePatched(this);
      },
    });
  }

  // -- adoptedStyleSheets (Document + ShadowRoot) ------------------------------------------------

  function hookAdoptedStyleSheets(proto, hostResolver) {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'adoptedStyleSheets');
    if (!desc || !desc.set || !desc.get) return;
    const previous = new WeakMap();
    Object.defineProperty(proto, 'adoptedStyleSheets', {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(sheets) {
        desc.set.call(this, sheets);
        const host = hostResolver(this);
        const before = previous.get(this) || new Set();
        const after = new Set();
        let index = 0;
        Array.prototype.forEach.call(sheets, (sheet) => {
          const known = ensureSheetKnown(sheet, host, index);
          after.add(known.sheetId);
          if (!before.has(known.sheetId)) adjustAdoptionRef(known.sheetId, 1);
          index += 1;
        });
        before.forEach((id) => {
          if (after.has(id)) return;
          if (adjustAdoptionRef(id, -1) === 0) {
            cssomDelta.push({ op: 'removeSheet', sheetId: id });
            cssomKnownRules.delete(id);
          }
        });
        previous.set(this, after);
      },
    });
  }
  try { hookAdoptedStyleSheets(Document.prototype, () => undefined); } catch (_) {}
  try { hookAdoptedStyleSheets(ShadowRoot.prototype, (root) => root.host); } catch (_) {}

  // -- <style> / <link rel=stylesheet> element lifecycle -----------------------------------------

  /**
   * The nearest flattening boundary's host element for C7 scope enforcement — a shadow
   * root's host, or the pierced iframe element whose contentDocument owns el. Doubly-
   * nested piercing (a shadow root inside a pierced iframe, or vice versa) only scopes
   * to the innermost boundary — the wire's CssomScope carries one hostId, not a chain.
   */
  function pierceHostFor(el) {
    const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
    if (root && root.host) return root.host;
    const doc = el.ownerDocument;
    return doc && iframeDocHost.has(doc) ? iframeDocHost.get(doc) : undefined;
  }

  function isStylesheetLink(el) {
    return el.tagName === 'LINK' && (el.rel || '').toLowerCase().split(/\s+/).indexOf('stylesheet') !== -1;
  }

  function onStyleElementReady(styleEl) {
    const sheet = styleEl.sheet;
    if (!sheet) {
      styleEl.addEventListener('load', () => onStyleElementReady(styleEl), { once: true });
      return;
    }
    elementSheetRef.set(styleEl, sheet);
    ensureSheetKnown(sheet, pierceHostFor(styleEl));
  }

  function armLinkLoad(linkEl) {
    const notify = () => {
      const sheet = linkEl.sheet;
      if (!sheet) return; // load failed, or cross-origin without CORS — cssRules stays inaccessible (TODO W4).
      elementSheetRef.set(linkEl, sheet);
      ensureSheetKnown(sheet, pierceHostFor(linkEl));
    };
    if (linkEl.sheet) notify();
    else linkEl.addEventListener('load', notify, { once: true });
  }

  function handleStyleLinkAdded(n) {
    if (!n || n.nodeType !== 1) return;
    if (n.tagName === 'STYLE') onStyleElementReady(n);
    else if (isStylesheetLink(n)) armLinkLoad(n);
    if (typeof n.querySelectorAll === 'function') {
      n.querySelectorAll('style').forEach(onStyleElementReady);
      n.querySelectorAll('link').forEach((l) => { if (isStylesheetLink(l)) armLinkLoad(l); });
    }
  }

  function handleStyleLinkRemoved(n) {
    if (!n || n.nodeType !== 1) return;
    const removeOne = (el) => {
      const sheet = elementSheetRef.get(el);
      if (!sheet) return;
      elementSheetRef.delete(el);
      const sheetId = allocate(sheet);
      cssomKnownRules.delete(sheetId);
      cssomDelta.push({ op: 'removeSheet', sheetId });
    };
    if (n.tagName === 'STYLE' || n.tagName === 'LINK') removeOne(n);
    if (typeof n.querySelectorAll === 'function') {
      n.querySelectorAll('style, link').forEach((el) => {
        if (el.tagName === 'STYLE' || isStylesheetLink(el)) removeOne(el);
      });
    }
  }

  // ---------------------------------------------------------------- shared discard + MutationObserver

  function nodeParent(n) {
    if (!n) return null;
    if (n.parentNode) return n.parentNode;
    if (n.host) return n.host; // ShadowRoot -> its host element.
    return null;
  }

  function discardNonPublished(target) {
    if (!target || target.nodeType !== 1) return false;
    const tag = target.tagName;
    if (tag === 'STYLE' || tag === 'LINK') return true;
    let p = nodeParent(target);
    while (p) {
      if (p.nodeType === 1 && PLACEHOLDERS.has(p.tagName) && p.tagName !== 'IFRAME') return true;
      p = nodeParent(p);
    }
    return false;
  }

  function containerElementFor(t) {
    if (t.nodeType === 1) return t;
    if (t.host) return t.host; // ShadowRoot's direct children flatten onto the host in F.
    if (t.nodeType === 9) return t.documentElement; // Document (a pierced iframe's own root).
    return t.parentElement || null;
  }

  const DEFAULT_MO_INIT = { subtree: true, childList: true, attributes: true, characterData: true };

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        r.addedNodes.forEach(handleStyleLinkAdded);
        r.removedNodes.forEach(handleStyleLinkRemoved);
      }
      const t = r.target;
      if (discardNonPublished(t)) continue;
      if (r.type === 'childList') {
        const parent = containerElementFor(t);
        if (!parent) continue;
        const pid = allocate(parent);
        dirty.dirtyParents.add(pid);
        r.addedNodes.forEach((n) => {
          if (discardNonPublished(n)) return;
          dirty.newIds.add(allocate(n));
        });
        r.removedNodes.forEach((n) => {
          const id = forward.get(n);
          if (id) dirty.detached.add(id);
        });
      } else if (r.type === 'attributes') {
        if (t.nodeType === 1) dirty.attrDirty.add(allocate(t));
      } else if (r.type === 'characterData') {
        dirty.textDirty.add(allocate(t));
      }
    }
  });

  function armRoot(root) {
    mo.observe(root, DEFAULT_MO_INIT);
    bindStateSensors(root);
    bindScrollSensor(root);
  }

  armRoot(document);
  scanExistingShadowRoots(document);
  scanExistingIframes(document);

  // ---------------------------------------------------------------- §5.2.6 document-level state

  function currentDocumentState() {
    const meta = document.querySelector('meta[name="viewport"]');
    return {
      title: document.title || '',
      documentElementLang: document.documentElement.getAttribute('lang'),
      documentElementDir: document.documentElement.getAttribute('dir'),
      viewportMetaContent: meta ? meta.getAttribute('content') : null,
    };
  }

  function documentStateChanged(a, b) {
    if (!a) return true;
    return (
      a.title !== b.title
      || a.documentElementLang !== b.documentElementLang
      || a.documentElementDir !== b.documentElementDir
      || a.viewportMetaContent !== b.viewportMetaContent
    );
  }

  let lastDocumentState = null;

  // ---------------------------------------------------------------- unthrottled frame clock (§5.3.4 — no rAF)

  let rateHz = 60;
  let timer = null;
  const listeners = new Set();

  function tick() {
    const nextState = currentDocumentState();
    const documentStatePayload = documentStateChanged(lastDocumentState, nextState) ? nextState : null;
    if (documentStatePayload) lastDocumentState = nextState;

    const cssomPayload = cssomDelta.length > 0 ? cssomDelta.slice() : null;
    if (cssomPayload) cssomDelta.length = 0;

    const scrollDirtyPayload = [];
    dirty.scrollDirty.forEach((sample, id) => scrollDirtyPayload.push([id, sample.x, sample.y]));

    listeners.forEach((fn) => {
      try {
        fn({
          generation,
          dirty: {
            newIds: [...dirty.newIds],
            dirtyParents: [...dirty.dirtyParents],
            attrDirty: [...dirty.attrDirty],
            textDirty: [...dirty.textDirty],
            stateDirty: [...dirty.stateDirty],
            scrollDirty: scrollDirtyPayload,
            detached: [...dirty.detached],
          },
          cssom: cssomPayload,
          documentState: documentStatePayload,
        });
      } catch (_) {}
    });
    dirty.newIds.clear();
    dirty.dirtyParents.clear();
    dirty.attrDirty.clear();
    dirty.textDirty.clear();
    dirty.stateDirty.clear();
    dirty.scrollDirty.clear();
    dirty.detached.clear();
  }

  function startClock(hz) {
    rateHz = hz || rateHz;
    if (timer) clearInterval(timer);
    timer = setInterval(tick, Math.max(1, Math.floor(1000 / rateHz)));
  }

  startClock(60);

  const api = {
    allocate,
    resolve,
    bumpGeneration,
    getEpochId: () => epochId,
    adoptClosedShadow,
    onFrame(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setRateHz(hz) {
      startClock(hz);
    },
    getRateHz: () => rateHz,
    getGeneration: () => generation,
    /** Dual-run / O2: structural walk without writing anchors into the live DOM. */
    snapshotIds(root) {
      const out = [];
      const walk = (n) => {
        if (!n) return;
        const id = allocate(n);
        if (n.nodeType === 1) {
          out.push({ kind: 'element', id, tag: n.tagName.toLowerCase() });
          for (const c of n.childNodes) walk(c);
        } else if (n.nodeType === 3) {
          out.push({ kind: 'text', id, value: n.nodeValue || '' });
        } else if (n.nodeType === 8) {
          out.push({ kind: 'comment', id, value: n.nodeValue || '' });
        }
      };
      walk(root || document.documentElement);
      return out;
    },
    /**
     * Live-attach establish/re-sync source: full raw tree (attrs + children +
     * shadow/state), STYLE/LINK excluded (cssom plane owns those). Shadow
     * hosts publish their flattened rendered children (PP-F-3); same-origin
     * iframes publish their contentDocument's html element as their one child.
     */
    snapshotDocument() {
      function buildRaw(n) {
        if (!n) return null;
        if (n.nodeType === 1) {
          const tag = n.tagName;
          if (tag === 'STYLE' || tag === 'LINK') return null;
          const id = allocate(n);
          const attrs = [];
          for (let i = 0; i < n.attributes.length; i++) {
            const a = n.attributes[i];
            attrs.push([a.name, a.value]);
          }
          const children = [];
          if (tag === 'IFRAME') {
            let innerDoc = null;
            try { innerDoc = n.contentDocument; } catch (_) { innerDoc = null; }
            if (innerDoc && innerDoc.documentElement) {
              const built = buildRaw(innerDoc.documentElement);
              if (built) children.push(built);
            }
            // else: cross-origin / not yet navigated — liveAttach CDP pierce merges interior under this id.
          } else if (!PLACEHOLDERS.has(tag)) {
            const kids = childNodesFor(n);
            for (let i = 0; i < kids.length; i++) {
              const built = buildRaw(kids[i]);
              if (built) children.push(built);
            }
          }
          const out = { kind: 'element', id, tag: tag.toLowerCase(), attrs, children };
          if (tag === 'IFRAME' && children.length === 0) out.xo = true;
          const root = shadowRoots.get(n);
          if (root) {
            out.shadowRoot = true;
            out.shadowClosed = shadowClosedHosts.has(n);
          }
          const state = computeStateFor(n);
          if (state) out.state = state;
          return out;
        }
        if (n.nodeType === 3) return { kind: 'text', id: allocate(n), value: n.nodeValue || '' };
        if (n.nodeType === 8) return { kind: 'comment', id: allocate(n), value: n.nodeValue || '' };
        return null;
      }
      return buildRaw(document.documentElement);
    },
    /** §5.10 full fresh install for establish — array order is the cascade order (main sheets, then per shadow root). */
    snapshotCssom() {
      return snapshotCssomSheets();
    },
    /** §5.2.6 — read directly (not tick-debounced) so establish always carries the current truth. */
    snapshotDocumentState() {
      return currentDocumentState();
    },
  };

  window.__speculumPageProjectionV2 = api;
  return api;
})();
`;
//# sourceMappingURL=inpageScript.js.map