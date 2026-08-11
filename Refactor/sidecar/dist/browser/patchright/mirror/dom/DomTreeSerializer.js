"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGE_PROJECTION_PAGE_SCRIPT = exports.ATTR_DENY = void 0;
exports.encodeDomBody = encodeDomBody;
exports.decodeDomBody = decodeDomBody;
const ATTR_DENY = new Set([
    'onclick',
    'ondblclick',
    'onmousedown',
    'onmouseup',
    'onmouseover',
    'onmouseout',
    'onmousemove',
    'onmouseenter',
    'onmouseleave',
    'onkeydown',
    'onkeyup',
    'onkeypress',
    'oninput',
    'onchange',
    'onsubmit',
    'onfocus',
    'onblur',
    'onload',
    'onerror',
    'onscroll',
    'ontouchstart',
    'ontouchend',
    'ontouchmove',
    'onpointerdown',
    'onpointerup',
    'onpointermove',
]);
exports.ATTR_DENY = ATTR_DENY;
function encodeDomBody(payload) {
    return Buffer.from(JSON.stringify(payload ?? {}), 'utf8');
}
function decodeDomBody(bytes) {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
}
/**
 * Virtual page script: Anchorer + LMS stamper + per-MutationRecord Dom emitter
 * + Cssom write-path hooks. Installed via addInitScript / evaluate.
 *
 * One MutationRecord = one emit (no time coalesce). The sidecar owns the
 * official `sequence`; the page stamps a local counter so LMS rides inside F
 * and the sidecar rewrites it after allocating the real sequence.
 */
exports.PAGE_PROJECTION_PAGE_SCRIPT = `
(() => {
  // T4: one live emitter on the top-level Document. Same-origin iframes are
  // pierced via the parent's registerRoot. Cross-origin iframes install a
  // pierce satellite (Chromium-control) when sidecar sets __speculumPierceHostAnchor.
  const pierceHostAnchor = typeof window.__speculumPierceHostAnchor === 'string'
    ? window.__speculumPierceHostAnchor
    : null;
  const isTop = (() => { try { return window === window.top; } catch (_) { return false; } })();
  if (!isTop && !pierceHostAnchor) return;
  if (isTop) {
    if (window.__speculumDomInstalled) return;
    window.__speculumDomInstalled = true;
  } else if (window.__speculumDomPierceInstalled === pierceHostAnchor) {
    return;
  } else {
    window.__speculumDomPierceInstalled = pierceHostAnchor;
  }

  const PLACEHOLDER = new Set(['SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'BASE', 'OBJECT', 'EMBED', 'APPLET']);
  // iframe is a placeholder host tag (T13) but stays addressable for pierce children.
  const ATTR_DENY = new Set(${JSON.stringify([...ATTR_DENY])});
  const ANCHOR_ATTR = 'speculum-anchor';
  const LMS_ATTR = 'speculum-last-mutation-sequence';
  const IGNORED_ATTRS = new Set([ANCHOR_ATTR, LMS_ATTR]);

  let generation = 1;
  /** Per-Document identity — init() runs once per real Document (D4 evidence). */
  const documentEpoch = 'e' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  /** Local LMS counter — sidecar rewrites payload LMS with the official sequence. */
  let localSequence = 0;
  const anchorToNode = new Map();
  const observedRoots = new Set();
  /** Closed shadow roots (attachShadow mode=closed) — not on element.shadowRoot. */
  const closedShadows = new WeakMap();
  /** iframe element → currently registered contentDocument (G-B swap). */
  const iframeDocs = new WeakMap();
  let observer = null;

  const sheetIds = new WeakMap();
  const ruleIds = new WeakMap();
  const sheetRuleIds = new WeakMap();
  let cssomIdSeq = 0;
  let knownSheets = [];
  const publishedSheets = new Set();
  /**
   * Wire identity ledger — only claim selectors the Projected has received.
   * Prevents address_miss from remove/patch of mute-window / reminted anchors.
   */
  const publishedAnchors = new Set();
  /** published anchor → parent element anchor (null = document root / pierce host). */
  const publishedParent = new Map();
  /** Detached remint: emit remove(a) before the next live Dom emit. */
  const pendingRetires = [];
  /** False until Cssom install publishes — syncSheets stays quiet (C4 race). */
  let cssomLive = false;
  /** False until Dom document + Cssom install are on the wire (T10.3 → T10.4). */
  let liveEmit = false;

  let viewportEcho = null;
  const elementEcho = new Map();

  // ---------------------------------------------------------------- emit

  /**
   * XO pierce: Document has no frameElement — synthetic F host so selectors
   * address the flattened tree under the pierceHostAnchor attr query (T7).
   */
  const PIERCE_HOST = pierceHostAnchor
    ? { __speculumPierceHost: true, nodeType: 1, tagName: 'IFRAME' }
    : null;

  function pierceHostQuery() {
    return pierceHostAnchor
      ? '[' + ANCHOR_ATTR + '="' + escapeAnchor(pierceHostAnchor) + '"]'
      : null;
  }

  // Establish/swap remounts stay on the sidecar MapPierce path (G-B).
  // Live Dom ops emit T4 atoms with pierce-host-relative selectors (T4/T7).
  function publishPierceSnapshot() {
    if (!pierceHostAnchor) return;
    try {
      anchorAll(document.documentElement);
      ensureDocumentRootAnchors(document);
      const root = mapNode(document.documentElement);
      markPublishedMapped(root, pierceHostAnchor);
      if (typeof window.__speculumDomChromiumIframePublish === 'function') {
        window.__speculumDomChromiumIframePublish(pierceHostAnchor, root, null);
      }
    } catch (_) {}
  }

  function markPublishedMapped(node, parentAnchor) {
    if (!node || typeof node !== 'object') return;
    const tag = node.tag;
    if (tag === '#text' || tag === '#comment') return;
    const a = node.anchor || (node.attrs && node.attrs[ANCHOR_ATTR]);
    if (a) {
      publishedAnchors.add(a);
      publishedParent.set(a, parentAnchor == null ? null : parentAnchor);
    }
    const kids = node.children;
    if (!kids || !kids.length) return;
    for (let i = 0; i < kids.length; i++) markPublishedMapped(kids[i], a || parentAnchor);
  }

  function resetPublishedFromMapped(root) {
    publishedAnchors.clear();
    publishedParent.clear();
    pendingRetires.length = 0;
    markPublishedMapped(root, pierceHostAnchor || null);
  }

  function parentQueryForPublished(anchor) {
    const parentA = publishedParent.get(anchor);
    if (parentA == null) {
      if (pierceHostAnchor) return pierceHostQuery();
      try {
        const html = document.documentElement;
        const q = html ? anchorQuery(html) : null;
        // Retiring under html when parent was unknown — body/html still resolve.
        return q;
      } catch (_) {
        return null;
      }
    }
    return '[' + ANCHOR_ATTR + '="' + escapeAnchor(parentA) + '"]';
  }

  /**
   * Drop a published identity and every descendant claimed under publishedParent.
   * SoftNav SPA wipes remove an ancestor once on the wire; Projected drops the
   * whole subtree. Without transitive unpublish the ledger still claims orphans
   * → later childList address_miss (matchCount=0) under the same generation.
   */
  function unpublishPublishedSubtree(rootAnchor) {
    if (!rootAnchor) return;
    const drop = new Set();
    function collect(a) {
      if (!a || drop.has(a)) return;
      drop.add(a);
      for (const [child, parent] of publishedParent) {
        if (parent === a) collect(child);
      }
    }
    collect(rootAnchor);
    for (const a of drop) {
      publishedAnchors.delete(a);
      publishedParent.delete(a);
      anchorToNode.delete(a);
      const pendingAt = pendingRetires.indexOf(a);
      if (pendingAt >= 0) pendingRetires.splice(pendingAt, 1);
    }
  }

  function flushPendingRetires() {
    while (pendingRetires.length) {
      const a = pendingRetires.shift();
      if (!a || !publishedAnchors.has(a)) continue;
      const parentQuery = parentQueryForPublished(a);
      const query = '[' + ANCHOR_ATTR + '="' + escapeAnchor(a) + '"]';
      // Wire remove is only for \`a\`; Projected drops descendants with it.
      unpublishPublishedSubtree(a);
      if (!parentQuery) continue;
      if (!liveEmit) continue;
      if (typeof window.__speculumDomEmit !== 'function') continue;
      try {
        window.__speculumDomEmit({
          generation,
          plane: 'dom',
          operation: 'childList',
          payload: {
            selector: { kind: 'element', query: parentQuery },
            removed: [{ selector: { kind: 'element', query } }],
            added: [],
          },
        });
      } catch (_) {}
    }
  }

  function scheduleRetirePublishedAnchor(a) {
    if (!a || !publishedAnchors.has(a)) return;
    if (pendingRetires.indexOf(a) >= 0) return;
    pendingRetires.push(a);
  }

  /**
   * SoftNav moves/detaches can leave published identities whose nodes are gone from
   * the live tree while Projected already dropped them via an ancestor remove.
   * Retire those before building childList hosts.
   */
  function sweepDisconnectedPublished() {
    const stale = [];
    for (const a of publishedAnchors) {
      const n = anchorToNode.get(a);
      if (!n || !n.isConnected) stale.push(a);
    }
    for (const a of stale) scheduleRetirePublishedAnchor(a);
    if (stale.length) flushPendingRetires();
  }

  /**
   * Every element on the light-DOM path to the documentElement must still be a
   * published identity — otherwise Projected likely dropped the branch via an
   * ancestor wipe while this node stayed connected under an unpublished wrapper.
   */
  function publishedAncestorPathOk(el) {
    let n = el;
    while (n && n.nodeType === 1) {
      if (n.__speculumPierceHost) return true;
      const a = n.getAttribute && n.getAttribute(ANCHOR_ATTR);
      if (!a || !publishedAnchors.has(a)) return false;
      if (n === document.documentElement) return true;
      n = n.parentElement;
    }
    return false;
  }

  /** Extract published anchor from a T7 element selector query. */
  function publishedAnchorFromQuery(query) {
    if (!query || typeof query !== 'string') return null;
    const m = query.match(new RegExp(ANCHOR_ATTR + '="([^"]+)"'));
    return m ? m[1] : null;
  }

  /**
   * DOM/F walk: unpublish every published identity under el (ledger gaps when a
   * never-published wrapper is removed but descendants were on the wire).
   */
  function unpublishPublishedUnderElement(el) {
    if (!el || el.nodeType !== 1) return;
    const a = el.getAttribute && el.getAttribute(ANCHOR_ATTR);
    if (a && publishedAnchors.has(a)) {
      unpublishPublishedSubtree(a);
      return;
    }
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 1) unpublishPublishedUnderElement(kids[i]);
    }
    try {
      const shadow = pierceShadowRoot(el);
      if (shadow) {
        const sk = shadow.childNodes;
        for (let i = 0; i < sk.length; i++) {
          if (sk[i].nodeType === 1) unpublishPublishedUnderElement(sk[i]);
        }
      }
    } catch (_) {}
  }

  /** Wire emit after caller flushed retires and validated published selectors. */
  function emitWire(plane, operation, payload) {
    if (pierceHostAnchor && plane === 'dom' && operation === 'scrollViewport') return;
    if (!liveEmit) return;
    if (typeof window.__speculumDomEmit !== 'function') return;
    try {
      window.__speculumDomEmit({ generation, plane, operation, payload });
    } catch (_) {}
  }

  function emit(plane, operation, payload) {
    flushPendingRetires();
    emitWire(plane, operation, payload);
  }

  /** Allocate a local sequence and stamp LMS on touched nodes before F runs. */
  function beginDiff(touched) {
    localSequence += 1;
    const seq = String(localSequence);
    for (const node of touched) {
      if (!node) continue;
      const el = node.nodeType === 1 ? node : fParentElement(node);
      if (!el || el.nodeType !== 1 || el.__speculumPierceHost) continue;
      try { el.setAttribute(LMS_ATTR, seq); } catch (_) {}
    }
  }

  // -------------------------------------------------------------- anchors

  /** Monotonic + entropy — same-ms batches must never collide (BZ4). */
  let anchorSeq = 0;
  function mintAnchor() {
    anchorSeq += 1;
    return 'a' + anchorSeq.toString(36) + 'x' + Math.random().toString(36).slice(2, 10);
  }

  function ensureAnchor(el) {
    if (!el || el.nodeType !== 1) return null;
    let a = el.getAttribute(ANCHOR_ATTR);
    if (a) {
      const mapped = anchorToNode.get(a);
      // Google (and others) clone nodes and copy speculum-anchor — remint on collision.
      // T7: any other connected owner of this anchor (map or live DOM) forces remint (BZ4).
      let collision = mapped && mapped !== el;
      if (!collision && typeof document !== 'undefined' && document.querySelectorAll) {
        try {
          const hits = document.querySelectorAll('[' + ANCHOR_ATTR + '="' + escapeAnchor(a) + '"]');
          for (let i = 0; i < hits.length; i++) {
            if (hits[i] !== el && hits[i].isConnected) {
              collision = true;
              break;
            }
          }
        } catch (_) {}
      }
      if (collision) {
        if (mapped && mapped !== el && !mapped.isConnected && publishedAnchors.has(a)) {
          // Projected still owns the old anchor until wire remove — retire then mint for the clone.
          scheduleRetirePublishedAnchor(a);
        } else if (mapped && mapped !== el && mapped.isConnected && publishedAnchors.has(a)) {
          // Two connected nodes claimed the same published anchor — remint the newcomer.
          // Old node keeps the published identity.
        } else if (!mapped && publishedAnchors.has(a)) {
          scheduleRetirePublishedAnchor(a);
        }
        if (mapped && mapped !== el) anchorToNode.delete(a);
        a = mintAnchor();
        try { el.setAttribute(ANCHOR_ATTR, a); } catch (_) { return null; }
      }
    } else {
      a = mintAnchor();
      try { el.setAttribute(ANCHOR_ATTR, a); } catch (_) { return null; }
    }
    anchorToNode.set(a, el);
    return a;
  }

  /** html/head/body must always carry unique anchors — Projected stand-ins resolve by them (T7). */
  function ensureDocumentRootAnchors(doc) {
    const d = doc || document;
    try {
      if (d.documentElement) ensureAnchor(d.documentElement);
      if (d.head) ensureAnchor(d.head);
      if (d.body) ensureAnchor(d.body);
    } catch (_) {}
  }

  /**
   * After a full walk, force unique connected anchors (T7). Some sites clone subtrees
   * faster than per-node ensureAnchor collision checks during MO bursts (BZ4).
   * Seeds \`seen\` with other connected mapped anchors so a cloned subtree remints
   * against the rest of the document — not only within itself.
   */
  function remintDuplicateConnectedAnchors(root) {
    if (!root) return;
    const seen = new Set();
    for (const [a, n] of anchorToNode) {
      if (!a || !n || n === root) continue;
      try {
        if (!n.isConnected) continue;
        if (typeof root.contains === 'function' && root.contains(n)) continue;
      } catch (_) {
        continue;
      }
      seen.add(a);
    }
    function walk(node) {
      if (!node || node.nodeType !== 1) return;
      let a = node.getAttribute(ANCHOR_ATTR);
      if (a) {
        if (seen.has(a)) {
          // Newcomer remints. If this node still owns the published map entry,
          // retire that wire identity before abandoning it (ledger + childList).
          if (publishedAnchors.has(a) && anchorToNode.get(a) === node) {
            scheduleRetirePublishedAnchor(a);
          } else if (anchorToNode.get(a) === node) {
            anchorToNode.delete(a);
          }
          a = mintAnchor();
          try { node.setAttribute(ANCHOR_ATTR, a); } catch (_) { return; }
          anchorToNode.set(a, node);
          seen.add(a);
        } else {
          seen.add(a);
          anchorToNode.set(a, node);
        }
      }
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
      try {
        const shadow = pierceShadowRoot(node);
        if (shadow) {
          const sk = shadow.childNodes;
          for (let i = 0; i < sk.length; i++) walk(sk[i]);
        }
      } catch (_) {}
    }
    walk(root);
  }

  function pierceShadowRoot(el) {
    if (!el || el.nodeType !== 1) return null;
    try {
      if (el.shadowRoot) return el.shadowRoot;
    } catch (_) {}
    return closedShadows.get(el) || null;
  }

  function anchorAll(root) {
    if (!root) return;
    if (root.nodeType !== 1) return;
    // Stamp all attr-capable nodes before emit (T4) — including placeholder hosts.
    ensureAnchor(root);
    const kids = root.childNodes;
    for (let i = 0; i < kids.length; i++) anchorAll(kids[i]);
    try {
      const shadow = pierceShadowRoot(root);
      if (shadow) {
        if (closedShadows.has(root)) {
          root.setAttribute('speculum-shadow-root', 'true');
          root.setAttribute('speculum-shadow-closed', 'true');
        } else {
          root.setAttribute('speculum-shadow-root', 'true');
        }
        const shadowKids = shadow.childNodes;
        for (let i = 0; i < shadowKids.length; i++) anchorAll(shadowKids[i]);
        registerRoot(shadow);
      }
    } catch (_) {}
    if (root.tagName === 'IFRAME') {
      bindIframePierce(root);
    }
  }

  /** Pierce iframe: register contentDocument; rebind on load (T3 G-B / C7). */
  function bindIframePierce(iframe) {
    if (!iframe || iframe.__speculumIframeBound) return;
    iframe.__speculumIframeBound = true;
    try {
      iframe.addEventListener('load', () => {
        try { rebindIframeDocument(iframe); } catch (_) {}
      });
    } catch (_) {}
    try { rebindIframeDocument(iframe); } catch (_) {}
  }

  function rebindIframeDocument(iframe) {
    let doc = null;
    const previous = iframeDocs.get(iframe) || null;
    try {
      doc = iframe.contentDocument;
    } catch (_) {
      // Cross-origin / SecurityError — tear down prior same-origin pierce if any.
      if (previous) {
        unregisterRoot(previous);
        syncSheets();
        iframeDocs.delete(iframe);
        emitIframeHostReplace(iframe, null, true);
      }
      iframe.__speculumPiercePending = true;
      if (iframe.__speculumChromiumPierce) {
        iframe.__speculumChromiumPierce = false;
        iframe.__speculumChromiumPierceRoot = null;
        iframe.__speculumChromiumPublished = false;
        try {
          const a = iframe.getAttribute(ANCHOR_ATTR) || ensureAnchor(iframe);
          if (a && typeof window.__speculumDomChromiumIframeTeardown === 'function') {
            window.__speculumDomChromiumIframeTeardown(a);
          }
        } catch (_) {}
      }
      requestChromiumIframePierce(iframe);
      return;
    }
    if (previous && previous === doc) return;

    if (previous) {
      unregisterRoot(previous);
      // Teardown pierce CSSOM for the old document first (C7).
      syncSheets();
    }

    if (!doc || !doc.documentElement) {
      iframeDocs.delete(iframe);
      // Host had a projected pierce child — remove it (do not invent childAt:0 on empty).
      if (previous) emitIframeHostReplace(iframe, null, true);
      else iframe.__speculumPiercePending = true;
      // contentDocument null often means cross-origin — Chromium-control pierce (T7).
      requestChromiumIframePierce(iframe);
      return;
    }

    const hadPierce = !!iframe.__speculumHadPierceDoc;
    const pending = !!iframe.__speculumPiercePending;
    iframe.setAttribute('speculum-iframe', 'true');
    iframe.__speculumChromiumPierce = false;
    try { delete iframe.__speculumChromiumPierceRoot; } catch (_) { iframe.__speculumChromiumPierceRoot = null; }
    iframe.__speculumChromiumPublished = false;
    anchorAll(doc.documentElement);
    registerRoot(doc);
    iframeDocs.set(iframe, doc);
    iframe.__speculumHadPierceDoc = true;
    iframe.__speculumPiercePending = false;
    // Dom host replace before registering new pierce sheets (C7 natural path).
    // First pierce covered by document/mapNode; empty→content needs add-only publish.
    const removeExisting = !!previous;
    if (previous || hadPierce || pending) {
      emitIframeHostReplace(iframe, doc.documentElement, removeExisting);
    }
    syncSheets();
  }

  /** Ask sidecar to pierce this iframe via frame Chromium control (T7 XO). */
  function requestChromiumIframePierce(iframe) {
    try {
      const anchor = ensureAnchor(iframe);
      if (!anchor || typeof window.__speculumDomRequestChromiumIframePierce !== 'function') return;
      window.__speculumDomRequestChromiumIframePierce(anchor);
    } catch (_) {}
  }

  /**
   * Apply a pre-mapped F tree from Chromium-control frame evaluate (XO pierce).
   * When \`silent\` is true, only updates host cache/attrs and returns the
   * childList meta so the sidecar can emit Dom then Cssom in C7 order.
   */
  window.__speculumDomApplyChromiumIframePierce = (anchor, root, silent) => {
    if (!anchor || !root || typeof root !== 'object') return null;
    const host = window.__speculumDomResolve(anchor);
    if (!host || host.nodeType !== 1) return null;
    const previous = iframeDocs.get(host) || null;
    if (previous) {
      unregisterRoot(previous);
      syncSheets();
      iframeDocs.delete(host);
    }
    host.setAttribute('speculum-iframe', 'true');
    host.__speculumHadPierceDoc = true;
    host.__speculumPiercePending = false;
    host.__speculumChromiumPierce = true;
    // Cache mapped F tree — contentDocument is unreachable for XO (mapNode/F).
    host.__speculumChromiumPierceRoot = root;
    const removeExisting = !!previous || !!host.__speculumChromiumPublished;
    host.__speculumChromiumPublished = true;
    const selector = selectorForElement(host);
    if (!selector) return null;
    if (silent) return { selector, removeExisting };
    emitIframeHostReplaceNode(host, root, removeExisting);
    return { selector, removeExisting };
  };

  /**
   * Same-generation host childList: replace pierced tree.
   * @param removeExisting only when the projected host still has a pierce child
   *   (never emit childAt:0 remove against an empty host — ACID miss → desync).
   */
  function emitIframeHostReplace(iframe, newRootEl, removeExisting) {
    let node = null;
    if (newRootEl && isMappableElement(newRootEl)) node = mapNode(newRootEl);
    emitIframeHostReplaceNode(iframe, node, removeExisting);
  }

  function emitIframeHostReplaceNode(iframe, node, removeExisting) {
    const selector = selectorForElement(iframe);
    if (!selector) return;
    beginDiff([iframe]);
    const removed = [];
    if (removeExisting) {
      removed.push({ selector: { kind: 'childAt', query: selector.query, index: 0 } });
    }
    const added = [];
    if (node) added.push({ index: 0, node });
    if (!removed.length && !added.length) return;
    emit('dom', 'childList', { selector, removed, added });
    if (node) {
      const hostA = iframe.getAttribute(ANCHOR_ATTR);
      markPublishedMapped(node, hostA || null);
    }
  }

  // ------------------------------------------------------------ F mapping

  function isPlaceholderTag(tag) {
    return PLACEHOLDER.has(tag) || tag === 'IFRAME';
  }

  function isMappableElement(node) {
    if (!node) return false;
    if (node.__speculumPierceHost) return true;
    if (node.nodeType !== 1) return false;
    // CSP <meta> stays in F (T13 structural 1:1); attrs are neutralized in attrsOf.
    return true;
  }

  function isDeniedAttr(name) {
    if (!name) return true;
    const n = name.toLowerCase();
    if (ATTR_DENY.has(n)) return true;
    if (n.startsWith('on')) return true;
    return false;
  }

  function controlAttrs(el, out) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (el.type === 'checkbox' || el.type === 'radio') {
        out['speculum-input-checked'] = el.checked ? 'true' : 'false';
      } else if (el.type !== 'file') {
        out['speculum-input-value'] = el.value != null ? String(el.value) : '';
      }
    }
    if (tag === 'OPTION') {
      out['speculum-option-selected'] = el.selected ? 'true' : 'false';
    }
    if (tag === 'SELECT' && !el.multiple) {
      out['speculum-input-value'] = el.value != null ? String(el.value) : '';
    }
    if (tag === 'CANVAS') {
      out['speculum-canvas-placeholder'] = 'true';
    }
  }

  /** WHATWG srcset: URL keeps commas until whitespace (Cloudinary f_avif,q_auto). */
  function parseSrcsetAttr(input) {
    const candidates = [];
    let pos = 0;
    const len = input.length;
    function isSp(c) {
      return c === ' ' || c === '\\t' || c === '\\n' || c === '\\r' || c === '\\f';
    }
    while (pos < len) {
      while (pos < len && (input[pos] === ',' || isSp(input[pos]))) pos++;
      if (pos >= len) break;
      const urlStart = pos;
      while (pos < len && !isSp(input[pos])) pos++;
      let url = input.slice(urlStart, pos);
      if (url.charAt(url.length - 1) === ',') {
        url = url.replace(/,+$/, '');
        if (url) candidates.push({ url: url, descriptor: '' });
        continue;
      }
      while (pos < len && isSp(input[pos])) pos++;
      const descParts = [];
      let current = '';
      let state = 'in';
      while (pos < len) {
        const c = input[pos];
        if (state === 'in') {
          if (isSp(c)) {
            if (current) { descParts.push(current); current = ''; state = 'after'; }
            pos++;
          } else if (c === ',') {
            if (current) descParts.push(current);
            current = '';
            pos++;
            break;
          } else if (c === '(') {
            current += c; state = 'parens'; pos++;
          } else {
            current += c; pos++;
          }
        } else if (state === 'parens') {
          current += c;
          if (c === ')') state = 'in';
          pos++;
        } else if (isSp(c)) {
          pos++;
        } else {
          state = 'in';
        }
      }
      if (current) descParts.push(current);
      if (url) candidates.push({ url: url, descriptor: descParts.join(' ') });
    }
    return candidates;
  }

  function mapSrcsetAttr(input, mapUrl) {
    return parseSrcsetAttr(input).map((c) => {
      const u = mapUrl(c.url);
      return c.descriptor ? (u + ' ' + c.descriptor) : u;
    }).join(', ');
  }

  function attrsOf(el) {
    const out = {};
    for (const a of el.attributes) {
      if (isDeniedAttr(a.name)) continue;
      let v = a.value;
      if ((a.name === 'href' || a.name === 'src' || a.name === 'xlink:href' || a.name === 'poster' || a.name === 'action' || a.name === 'formaction') && /^\\s*javascript:/i.test(v)) continue;
      if (a.name === 'href' || a.name === 'src' || a.name === 'xlink:href' || a.name === 'poster' || a.name === 'action' || a.name === 'formaction' || a.name === 'data-src') {
        try { v = new URL(v, document.baseURI).href; } catch (_) {}
      }
      if (a.name === 'srcset' || a.name === 'imagesrcset') {
        v = mapSrcsetAttr(v, (u) => {
          try { return new URL(u, document.baseURI).href; } catch (_) { return u; }
        });
      }
      out[a.name] = v;
    }
    delete out.integrity;
    // Neutralize CSP meta so Projected never adopts Virtual CSP (slot kept for T13).
    if (el.tagName === 'META') {
      const httpEquiv = (out['http-equiv'] || '').toLowerCase();
      if (httpEquiv === 'content-security-policy') {
        delete out['http-equiv'];
        delete out.content;
        out['speculum-projected-tag'] = 'meta';
      }
    }
    controlAttrs(el, out);
    ensureAnchor(el);
    out[ANCHOR_ATTR] = el.getAttribute(ANCHOR_ATTR);
    if (el.shadowRoot || closedShadows.has(el)) {
      out['speculum-shadow-root'] = 'true';
      if (closedShadows.has(el)) out['speculum-shadow-closed'] = 'true';
    }
    if (el.tagName === 'IFRAME' && el.hasAttribute('speculum-iframe')) {
      out['speculum-iframe'] = 'true';
    }
    return out;
  }

  function childNodesOf(owner, override) {
    if (override && override.owner === owner) return override.nodes;
    return Array.prototype.slice.call(owner.childNodes);
  }

  /**
   * F-visible child space of an element: light children, then flattened shadow
   * children, then the pierced iframe document. Adjacent text nodes collapse
   * into one run so the index space matches the projected tree exactly.
   */
  function fChildEntries(el, override) {
    const out = [];
    // XO synthetic pierce host: single F child = documentElement (flattened iframe).
    if (el && el.__speculumPierceHost) {
      if (isMappableElement(document.documentElement)) {
        out.push({ type: 'element', el: document.documentElement });
      }
      return out;
    }
    // Placeholder non-iframe tags publish empty interior (T13).
    if (PLACEHOLDER.has(el.tagName)) return out;
    // C5: STYLE/LINK are Dom structural shells only — rule bodies live on Cssom.
    if (el.tagName === 'STYLE' || el.tagName === 'LINK') return out;
    // An iframe host publishes only its pierced document — never light fallback
    // content — so this space stays identical to what mapNode emits.
    if (el.tagName === 'IFRAME') {
      try {
        const doc = el.contentDocument;
        if (doc && isMappableElement(doc.documentElement)) {
          out.push({ type: 'element', el: doc.documentElement });
        }
      } catch (_) {}
      // XO Chromium pierce: live nodes unreachable; mapNode injects cached F root.
      return out;
    }
    const pushList = (owner) => {
      let run = null;
      for (const c of childNodesOf(owner, override)) {
        if (c.nodeType === 3) {
          if (run) {
            run.text += (c.textContent || '');
            run.nodes.push(c);
          } else {
            run = { type: 'text', text: c.textContent || '', nodes: [c] };
            out.push(run);
          }
          continue;
        }
        if (c.nodeType === 8) {
          run = null;
          out.push({ type: 'comment', text: c.textContent || '', node: c });
          continue;
        }
        if (isMappableElement(c)) {
          run = null;
          out.push({ type: 'element', el: c });
        }
      }
    };
    pushList(el);
    try {
      const shadow = pierceShadowRoot(el);
      if (shadow) pushList(shadow);
    } catch (_) {}
    return out;
  }

  /** Element head of an F node: safe host tag + role for placeholders (T13). */
  function mapElementHead(el) {
    const originalTag = el.tagName.toLowerCase();
    const anchor = ensureAnchor(el);
    const attrs = attrsOf(el);
    const placeholder = isPlaceholderTag(el.tagName);
    if (placeholder) {
      attrs['speculum-projected-tag'] = originalTag;
      if (el.tagName === 'IFRAME') attrs['speculum-iframe'] = 'true';
    }
    return {
      anchor: anchor || undefined,
      tag: placeholder ? 'div' : originalTag,
      attrs,
    };
  }

  /**
   * Remint colliding anchors inside a pre-mapped (XO pierce) object tree so the
   * flattened parent document never publishes duplicate identities (T7/BZ4).
   */
  function dedupeMappedObject(node, seen) {
    if (!node || typeof node !== 'object') return node;
    const tag = node.tag;
    if (tag === '#text' || tag === '#comment') return node;
    const out = {
      tag: node.tag,
      text: node.text,
      children: undefined,
      anchor: node.anchor,
      attrs: node.attrs ? Object.assign({}, node.attrs) : undefined,
    };
    let a = out.anchor || (out.attrs && out.attrs[ANCHOR_ATTR]);
    if (a) {
      if (seen.has(a)) {
        a = mintAnchor();
      }
      seen.add(a);
      out.anchor = a;
      if (!out.attrs) out.attrs = {};
      out.attrs[ANCHOR_ATTR] = a;
    }
    if (node.children && node.children.length) {
      out.children = [];
      for (let i = 0; i < node.children.length; i++) {
        out.children.push(dedupeMappedObject(node.children[i], seen));
      }
    }
    return out;
  }

  function claimMappedAnchor(el, mapped, seen) {
    let a = mapped.anchor || (mapped.attrs && mapped.attrs[ANCHOR_ATTR]);
    if (!a) return;
    if (seen.has(a)) {
      a = mintAnchor();
      try { el.setAttribute(ANCHOR_ATTR, a); } catch (_) {}
      anchorToNode.set(a, el);
      mapped.anchor = a;
      if (!mapped.attrs) mapped.attrs = {};
      mapped.attrs[ANCHOR_ATTR] = a;
    }
    seen.add(a);
  }

  function mapNode(node, seen) {
    if (!node) return null;
    if (node.nodeType === 3) return { tag: '#text', text: node.textContent || '' };
    if (node.nodeType === 8) return { tag: '#comment', text: node.textContent || '' };
    if (!isMappableElement(node)) return null;
    const scope = seen || new Set();
    const el = node;
    const mapped = mapElementHead(el);
    claimMappedAnchor(el, mapped, scope);
    // Chromium XO iframe pierce: use last published F subtree when contentDocument is unreachable.
    if (el.tagName === 'IFRAME' && el.__speculumChromiumPierceRoot) {
      let sameOrigin = false;
      try { sameOrigin = !!el.contentDocument; } catch (_) { sameOrigin = false; }
      if (!sameOrigin) {
        mapped.children = [dedupeMappedObject(el.__speculumChromiumPierceRoot, scope)];
        return mapped;
      }
    }
    const children = [];
    for (const entry of fChildEntries(el, null)) {
      if (entry.type === 'text') {
        children.push({ tag: '#text', text: entry.text });
        continue;
      }
      if (entry.type === 'comment') {
        children.push({ tag: '#comment', text: entry.text });
        continue;
      }
      const child = mapNode(entry.el, scope);
      if (child) children.push(child);
    }
    if (children.length) mapped.children = children;
    return mapped;
  }

  /** Patch snapshots carry no children (T6). */
  function mapNodeShallow(el) {
    if (!isMappableElement(el)) return null;
    return mapElementHead(el);
  }

  // ------------------------------------------------------- selector writer

  function escapeAnchor(value) {
    try {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    } catch (_) {}
    return String(value).replace(/["\\\\]/g, '\\\\$&');
  }

  function anchorQuery(el) {
    if (!el || el.nodeType !== 1 || !el.getAttribute) return null;
    const a = el.getAttribute(ANCHOR_ATTR);
    return a ? '[' + ANCHOR_ATTR + '="' + escapeAnchor(a) + '"]' : null;
  }

  function isUniqueQuery(node, query) {
    // Pierce-host queries are unique in the projected flattened tree (T7).
    if (pierceHostAnchor && query && query.indexOf(pierceHostAnchor) >= 0) return true;
    try {
      const root = node && node.getRootNode ? node.getRootNode() : document;
      const scope = root && root.querySelectorAll ? root : document;
      return scope.querySelectorAll(query).length === 1;
    } catch (_) {
      return false;
    }
  }

  /** F parent of any node — shadow root maps to its host, document to its frame. */
  function fParentElement(node) {
    if (!node) return null;
    if (node.__speculumPierceHost) return null;
    const p = node.parentNode;
    if (!p) return null;
    return fHostElement(p);
  }

  /** Element whose F child space owns \`owner\`'s child list. */
  function fHostElement(owner) {
    if (!owner) return null;
    if (owner.__speculumPierceHost) return owner;
    if (owner.nodeType === 1) return isMappableElement(owner) ? owner : null;
    if (owner.nodeType === 11 && owner.host) {
      return isMappableElement(owner.host) ? owner.host : null;
    }
    if (owner.nodeType === 9) {
      try {
        const frame = owner.defaultView && owner.defaultView.frameElement;
        if (frame && isMappableElement(frame)) return frame;
      } catch (_) {}
      // XO satellite: Document's F parent is the host iframe (synthetic).
      if (PIERCE_HOST) return PIERCE_HOST;
      return null;
    }
    return null;
  }

  /** 1-based position among F-visible element siblings (\`:nth-child\` space). */
  function nthChildIndex(parentEl, el) {
    let n = 0;
    for (const entry of fChildEntries(parentEl, null)) {
      if (entry.type !== 'element') continue;
      n += 1;
      if (entry.el === el) return n;
    }
    return 0;
  }

  /**
   * Speculum-only addressing: unique \`[speculum-anchor]\`, else nearest stamped
   * ancestor plus positional steps. Never page id / class / data-*.
   * Never emit bare html/body/head tag roots — Projected uses stand-ins (T7).
   */
  function queryFor(el) {
    if (el && el.__speculumPierceHost) return pierceHostQuery();
    const own = anchorQuery(el);
    if (own && isUniqueQuery(el, own)) return own;
    const steps = [];
    let cur = el;
    for (let depth = 0; depth < 64; depth++) {
      const parent = fParentElement(cur);
      if (!parent) {
        // Document root without a unique ancestral anchor — refuse tag-root paths
        // (html/body/head) that cannot resolve on the Projected stand-in tree (T7).
        return null;
      }
      if (parent.__speculumPierceHost) {
        const n = nthChildIndex(parent, cur);
        if (!n) return null;
        steps.unshift(':nth-child(' + n + ')');
        const pq = pierceHostQuery();
        return pq ? pq + ' > ' + steps.join(' > ') : null;
      }
      const n = nthChildIndex(parent, cur);
      if (!n) return null;
      steps.unshift(':nth-child(' + n + ')');
      const pq = anchorQuery(parent);
      if (pq && isUniqueQuery(parent, pq)) return pq + ' > ' + steps.join(' > ');
      cur = parent;
    }
    return null;
  }

  function selectorForElement(el) {
    if (el && el.__speculumPierceHost) {
      const query = pierceHostQuery();
      return query ? { kind: 'element', query } : null;
    }
    if (!isMappableElement(el)) return null;
    ensureAnchor(el);
    const query = queryFor(el);
    return query ? { kind: 'element', query } : null;
  }

  /** Detached removed elements resolve on the projected pre-op tree by anchor. */
  function detachedSelectorForElement(el) {
    const query = anchorQuery(el);
    return query ? { kind: 'element', query } : null;
  }

  // ------------------------------------------------------------ Dom emitters

  /** Child list as it was before the record (adds pulled, removes put back). */
  function preOpChildNodes(record) {
    const owner = record.target;
    const added = new Set(Array.prototype.slice.call(record.addedNodes));
    const list = Array.prototype.slice.call(owner.childNodes).filter((n) => !added.has(n));
    const removed = Array.prototype.slice.call(record.removedNodes);
    if (!removed.length) return list;
    let at = list.length;
    if (record.previousSibling) {
      const i = list.indexOf(record.previousSibling);
      at = i >= 0 ? i + 1 : list.length;
    } else if (record.nextSibling) {
      const i = list.indexOf(record.nextSibling);
      at = i >= 0 ? i : 0;
    } else {
      at = 0;
    }
    list.splice(at, 0, ...removed);
    return list;
  }

  function emitChildList(record) {
    // SoftNav clone storms schedule retires; flush before claiming the host so we
    // never build a childList against an identity about to leave the ledger.
    sweepDisconnectedPublished();
    flushPendingRetires();
    const host = fHostElement(record.target);
    if (!host) return;
    if (!host.isConnected) return;
    if (!host.__speculumPierceHost) {
      const ha = host.getAttribute && host.getAttribute(ANCHOR_ATTR);
      if (!ha || !publishedAnchors.has(ha)) return;
    }
    const selector = selectorForElement(host);
    if (!selector) return;

    const removedSet = new Set(Array.prototype.slice.call(record.removedNodes));
    const addedSet = new Set(Array.prototype.slice.call(record.addedNodes));
    const pre = fChildEntries(host, { owner: record.target, nodes: preOpChildNodes(record) });
    const post = fChildEntries(host, null);

    const preRuns = [];
    const preRunOf = new Map();
    pre.forEach((entry, index) => {
      if (entry.type !== 'text') return;
      preRuns[index] = entry;
      for (const n of entry.nodes) preRunOf.set(n, index);
    });

    const removedRuns = new Set();
    const removedElements = [];
    const removedCommentIndexes = [];
    pre.forEach((entry, index) => {
      if (entry.type === 'element') {
        if (removedSet.has(entry.el)) removedElements.push(entry.el);
        return;
      }
      if (entry.type === 'comment') {
        if (removedSet.has(entry.node)) removedCommentIndexes.push(index);
        return;
      }
      if (entry.nodes.every((n) => removedSet.has(n))) removedRuns.add(index);
    });

    // A collapsed text run whose membership changed (split, merge or partial
    // removal) is republished whole: the F index space must stay identical to
    // the projected one, and the client never normalizes text itself.
    const pendingAdds = [];
    post.forEach((entry, index) => {
      if (entry.type === 'element') {
        if (addedSet.has(entry.el)) pendingAdds.push({ index, entry });
        return;
      }
      if (entry.type === 'comment') {
        if (addedSet.has(entry.node)) pendingAdds.push({ index, entry });
        return;
      }
      const sourceRuns = new Set();
      let fresh = false;
      for (const n of entry.nodes) {
        const from = addedSet.has(n) ? undefined : preRunOf.get(n);
        if (from === undefined) fresh = true;
        else sourceRuns.add(from);
      }
      let dirty = fresh || sourceRuns.size !== 1;
      if (!dirty) {
        const only = sourceRuns.values().next().value;
        const source = preRuns[only];
        dirty = !source || source.nodes.length !== entry.nodes.length;
      }
      if (!dirty) return;
      for (const from of sourceRuns) removedRuns.add(from);
      pendingAdds.push({ index, entry });
    });

    if (!removedElements.length && !removedRuns.size && !removedCommentIndexes.length && !pendingAdds.length) return;

    // Pierce host teardown → drop observed roots + scoped CSSOM (C7).
    let pierceRemoved = false;
    for (const el of removedElements) {
      if (el.tagName === 'IFRAME') {
        const doc = iframeDocs.get(el);
        if (doc) {
          unregisterRoot(doc);
          iframeDocs.delete(el);
          pierceRemoved = true;
        }
        if (el.__speculumChromiumPierce) {
          el.__speculumChromiumPierce = false;
          el.__speculumChromiumPierceRoot = null;
          el.__speculumChromiumPublished = false;
          pierceRemoved = true;
          try {
            const a = el.getAttribute(ANCHOR_ATTR);
            if (a && typeof window.__speculumDomChromiumIframeTeardown === 'function') {
              window.__speculumDomChromiumIframeTeardown(a);
            }
          } catch (_) {}
        }
      }
      const shadow = pierceShadowRoot(el);
      if (shadow && observedRoots.has(shadow)) {
        unregisterRoot(shadow);
        pierceRemoved = true;
      }
    }

    // LMS is stamped before F so it rides inside every added snapshot (T4/D7).
    const touchedNodes = [host];
    for (const p of pendingAdds) {
      if (p.entry.type === 'element') touchedNodes.push(p.entry.el);
    }
    beginDiff(touchedNodes);

    const removed = [];
    for (const el of removedElements) {
      const a = el.getAttribute && el.getAttribute(ANCHOR_ATTR);
      if (a && publishedAnchors.has(a)) {
        const sel = detachedSelectorForElement(el);
        if (sel) {
          removed.push({ selector: sel });
          // Free subtree before mapNode(adds) — SoftNav ancestor wipe must not leave
          // descendant anchors claimed (address_miss / resync cascade).
          unpublishPublishedSubtree(a);
        }
      }
      // Always DOM/F-walk: publishedParent can miss reparented / never-linked kids
      // that Projected still drops with this remove (ledger gap → phase=parent miss).
      unpublishPublishedUnderElement(el);
    }
    for (const index of Array.from(removedRuns).sort((a, b) => a - b)) {
      removed.push({ selector: { kind: 'childAt', query: selector.query, index } });
    }
    for (const index of removedCommentIndexes.sort((a, b) => a - b)) {
      removed.push({ selector: { kind: 'childAt', query: selector.query, index } });
    }

    const added = [];
    for (const p of pendingAdds) {
      if (p.entry.type === 'text') {
        added.push({ index: p.index, node: { tag: '#text', text: p.entry.text } });
        continue;
      }
      if (p.entry.type === 'comment') {
        added.push({ index: p.index, node: { tag: '#comment', text: p.entry.text } });
        continue;
      }
      const el = p.entry.el;
      // Establish/takeRecords races can re-signal childList for nodes already in the
      // document baseline. Re-adding the same published identity → Projected dups (BZ4).
      const existingA = el.getAttribute && el.getAttribute(ANCHOR_ATTR);
      if (
        existingA
        && publishedAnchors.has(existingA)
        && anchorToNode.get(existingA) === el
      ) {
        continue;
      }
      remintDuplicateConnectedAnchors(el);
      const node = mapNode(el);
      if (node) added.push({ index: p.index, node });
    }
    if (!removed.length && !added.length) return;
    const publishWire = liveEmit;
    // Remint/retire during mapNode(adds) may have unpublished the host — flush and
    // re-validate before wire emit (closes phase=parent address_miss SoftNav race).
    flushPendingRetires();
    if (!host.__speculumPierceHost) {
      const hostANow = host.getAttribute && host.getAttribute(ANCHOR_ATTR);
      const selA = publishedAnchorFromQuery(selector && selector.query);
      if (!hostANow || !publishedAnchors.has(hostANow)) return;
      if (selA && (!publishedAnchors.has(selA) || selA !== hostANow)) return;
      // Live T7: Projected resolves the same qSA — never emit against a detached or
      // colliding host (SoftNav clone / ancestor wipe residual).
      if (!host.isConnected) return;
      if (!publishedAncestorPathOk(host)) return;
      try {
        const hits = document.querySelectorAll(selector.query);
        if (!hits || hits.length !== 1 || hits[0] !== host) return;
      } catch (_) {
        return;
      }
    }
    emitWire('dom', 'childList', { selector, removed, added });
    if (!publishWire) {
      if (pierceRemoved) syncSheets();
      return;
    }
    const hostA = host.getAttribute && host.getAttribute(ANCHOR_ATTR);
    for (const entry of added) {
      if (entry.node) markPublishedMapped(entry.node, hostA || null);
    }
    if (pierceRemoved) syncSheets();
  }

  function emitElementPatch(el) {
    if (!el || !el.isConnected || !isMappableElement(el)) return;
    flushPendingRetires();
    const a = el.getAttribute && el.getAttribute(ANCHOR_ATTR);
    // Patches for never-published identities invent address_miss on the client.
    if (!a || !publishedAnchors.has(a)) {
      // Still mint/stamp for future map, but do not claim on the wire yet.
      if (!a) ensureAnchor(el);
      return;
    }
    const selector = selectorForElement(el);
    if (!selector) return;
    // LMS is stamped before F so it rides inside the snapshot (T4/D7).
    beginDiff([el]);
    const node = mapNodeShallow(el);
    if (!node) return;
    flushPendingRetires();
    const aNow = el.getAttribute && el.getAttribute(ANCHOR_ATTR);
    const selA = publishedAnchorFromQuery(selector.query);
    if (!aNow || !publishedAnchors.has(aNow)) return;
    if (selA && (!publishedAnchors.has(selA) || selA !== aNow)) return;
    emitWire('dom', 'patch', { selector, node });
  }

  function emitTextPatch(textNode) {
    const parent = fParentElement(textNode);
    if (!parent) return;
    flushPendingRetires();
    const parentA = parent.getAttribute && parent.getAttribute(ANCHOR_ATTR);
    if (!parentA || !publishedAnchors.has(parentA)) return;
    const parentSelector = selectorForElement(parent);
    if (!parentSelector) return;
    const entries = fChildEntries(parent, null);
    let index = -1;
    let text = '';
    let tag = '#text';
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type === 'comment' && entry.node === textNode) {
        index = i;
        text = entry.text;
        tag = '#comment';
        break;
      }
      if (entry.type !== 'text' || entry.nodes.indexOf(textNode) < 0) continue;
      index = i;
      text = entry.text;
      break;
    }
    if (index < 0) return;
    beginDiff([parent]);
    flushPendingRetires();
    const parentANow = parent.getAttribute && parent.getAttribute(ANCHOR_ATTR);
    if (!parentANow || !publishedAnchors.has(parentANow)) return;
    emitWire('dom', 'patch', {
      selector: { kind: 'childAt', query: parentSelector.query, index },
      node: { tag, text },
    });
  }

  // -------------------------------------------------------------- observers

  function touchesStyleOwner(record) {
    if (record.type === 'attributes') {
      const tag = record.target && record.target.tagName;
      return tag === 'LINK' || tag === 'STYLE';
    }
    if (record.type !== 'childList') return false;
    const lists = [record.addedNodes, record.removedNodes];
    for (const list of lists) {
      for (const n of list) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'LINK' || n.tagName === 'STYLE') return true;
      }
    }
    return false;
  }

  function watchSheetArrival(record) {
    if (record.type !== 'childList') return;
    for (const n of record.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName !== 'LINK' && n.tagName !== 'STYLE') continue;
      armStylesheetNode(n);
    }
  }

  function armStylesheetNode(n) {
    if (!n || n.nodeType !== 1) return;
    try {
      n.addEventListener('load', () => syncSheets(), { once: true });
      n.addEventListener('error', () => syncSheets(), { once: true });
    } catch (_) {}
  }

  /** C4: arm load/error on sheets already in the Document before MO sees them. */
  function armExistingStylesheetNodes() {
    try {
      const nodes = document.querySelectorAll('link[rel~="stylesheet"],link[rel="stylesheet"],style');
      for (let i = 0; i < nodes.length; i++) armStylesheetNode(nodes[i]);
    } catch (_) {}
  }

  function onMutations(records) {
    // Stamp anchors before any emit logic (T4 invariant).
    for (const m of records) {
      if (m.type !== 'childList') continue;
      m.addedNodes.forEach((n) => {
        if (n.nodeType === 1) {
          anchorAll(n);
          remintDuplicateConnectedAnchors(n);
        }
      });
    }
    let styleTouched = false;
    for (const m of records) {
      if (m.type === 'attributes' && IGNORED_ATTRS.has(m.attributeName)) {
        const el = m.target;
        if (m.attributeName === ANCHOR_ATTR && el && el.nodeType === 1 && !el.getAttribute(ANCHOR_ATTR)) {
          ensureAnchor(el);
        }
        continue;
      }
      if (touchesStyleOwner(m)) styleTouched = true;
      watchSheetArrival(m);
      if (m.type === 'childList') {
        emitChildList(m);
        continue;
      }
      if (m.type === 'attributes') {
        emitElementPatch(m.target);
        continue;
      }
      if (m.type === 'characterData') {
        emitTextPatch(m.target);
      }
    }
    if (styleTouched) syncSheets();
  }

  function observeRoot(root) {
    if (!root || !observer) return;
    try {
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
        attributeOldValue: false,
      });
    } catch (_) {}
  }

  function registerRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);
    observeRoot(root.nodeType === 9 ? root.documentElement || root : root);
    installSensors(root);
    // Same-origin pierce documents need CSSOM write hooks in their realm (C5/C7).
    if (root.nodeType === 9) {
      try {
        const view = root.defaultView;
        if (view && view !== window) {
          installCssomHooksForWindow(view);
          installAdoptedStyleSheetsHookForWindow(view);
        }
      } catch (_) {}
    }
  }

  function unregisterRoot(root) {
    if (!root || !observedRoots.has(root)) return;
    observedRoots.delete(root);
    // MutationObserver cannot unobserve a single root; reconnect excluding it.
    if (observer) {
      try { observer.disconnect(); } catch (_) {}
      for (const r of observedRoots) {
        observeRoot(r.nodeType === 9 ? r.documentElement || r : r);
      }
    }
  }

  // ---------------------------------------------------------------- sensors

  function onScroll(ev) {
    const target = ev.target;
    // Document / window scroll — use the scrolled realm's window, not the
    // emitter's outer window (SO iframe pierce otherwise reports top scroll).
    const isDocOrWindow = !target || target.nodeType === 9 || target === window;
    if (isDocOrWindow) {
      let win = window;
      try {
        if (target && target.nodeType === 9 && target.defaultView) win = target.defaultView;
        else if (target === window) win = window;
        else if (ev && ev.view) win = ev.view;
      } catch (_) {}
      const x = win.scrollX || 0;
      const y = win.scrollY || 0;
      let isTopView = true;
      try { isTopView = win === window.top; } catch (_) { isTopView = win === window; }

      // Nested pierce document (SO or XO): map to scrollElement on scrollingElement.
      if (pierceHostAnchor || !isTopView) {
        let se = null;
        try {
          se = (win.document && (win.document.scrollingElement || win.document.documentElement)) || null;
        } catch (_) {}
        if (!se || se.nodeType !== 1) return;
        const anchor = ensureAnchor(se);
        const top = se.scrollTop || y;
        const left = se.scrollLeft || x;
        const echo = anchor ? elementEcho.get(anchor) : null;
        if (echo && echo.top === top && echo.left === left) {
          elementEcho.delete(anchor);
          try {
            if (typeof window.__speculumDomScrollEchoHit === 'function') {
              window.__speculumDomScrollEchoHit({ kind: 'element', anchor, scrollTop: top, scrollLeft: left });
            }
          } catch (_) {}
          return;
        }
        if (anchor) elementEcho.delete(anchor);
        const selector = selectorForElement(se);
        if (!selector) return;
        beginDiff([se]);
        emit('dom', 'scrollElement', { selector, scrollTop: top, scrollLeft: left });
        return;
      }

      if (viewportEcho && viewportEcho.x === x && viewportEcho.y === y) {
        viewportEcho = null;
        try {
          if (typeof window.__speculumDomScrollEchoHit === 'function') {
            window.__speculumDomScrollEchoHit({ kind: 'viewport', scrollX: x, scrollY: y });
          }
        } catch (_) {}
        return;
      }
      viewportEcho = null;
      beginDiff([]);
      emit('dom', 'scrollViewport', { scrollX: x, scrollY: y });
      return;
    }
    if (target.nodeType !== 1) return;
    const anchor = ensureAnchor(target);
    const top = target.scrollTop || 0;
    const left = target.scrollLeft || 0;
    const echo = anchor ? elementEcho.get(anchor) : null;
    if (echo && echo.top === top && echo.left === left) {
      elementEcho.delete(anchor);
      try {
        if (typeof window.__speculumDomScrollEchoHit === 'function') {
          window.__speculumDomScrollEchoHit({ kind: 'element', anchor, scrollTop: top, scrollLeft: left });
        }
      } catch (_) {}
      return;
    }
    if (anchor) elementEcho.delete(anchor);
    const selector = selectorForElement(target);
    if (!selector) return;
    beginDiff([target]);
    emit('dom', 'scrollElement', { selector, scrollTop: top, scrollLeft: left });
  }

  function onFormSensor(ev) {
    const target = ev.target;
    if (!target || target.nodeType !== 1) return;
    const tag = target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && tag !== 'OPTION') return;
    emitElementPatch(target);
  }

  function installSensors(root) {
    try {
      root.addEventListener('scroll', onScroll, true);
      root.addEventListener('input', onFormSensor, true);
      root.addEventListener('change', onFormSensor, true);
    } catch (_) {}
  }

  // ------------------------------------------------------------ Cssom plane

  function mintCssomId(prefix) {
    cssomIdSeq += 1;
    return prefix + cssomIdSeq.toString(36);
  }

  function ensureSheetId(sheet) {
    let id = sheetIds.get(sheet);
    if (!id) {
      id = mintCssomId('s');
      sheetIds.set(sheet, id);
    }
    return id;
  }

  function ensureRuleId(rule) {
    let id = ruleIds.get(rule);
    if (!id) {
      id = mintCssomId('r');
      ruleIds.set(rule, id);
    }
    return id;
  }

  function ruleCssText(rule) {
    try { return rule.cssText || ''; } catch (_) { return ''; }
  }

  function rulesOf(sheet) {
    let list = null;
    try { list = sheet.cssRules; } catch (_) { return null; }
    if (!list) return null;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const rule = list[i];
      out.push({ id: ensureRuleId(rule), cssText: ruleCssText(rule) });
    }
    return out;
  }

  /** Absolute href for a sheet when cssRules are unreadable (CORS). */
  function sheetHref(sheet) {
    try {
      if (sheet.href) return String(sheet.href);
    } catch (_) {}
    try {
      const node = sheet.ownerNode;
      if (node && node.nodeType === 1 && String(node.tagName).toUpperCase() === 'LINK') {
        const raw = node.href || node.getAttribute('href') || '';
        if (!raw) return null;
        try { return new URL(raw, document.baseURI).href; } catch (_) { return String(raw); }
      }
    } catch (_) {}
    return null;
  }

  /**
   * C6.5 seed when cssRules throws: inline <style> text is still readable.
   * External sheets return [] + href for sidecar asset-cache seed.
   */
  function seedRulesFromOwner(sheet) {
    try {
      const node = sheet.ownerNode;
      if (node && node.nodeType === 1 && String(node.tagName).toUpperCase() === 'STYLE') {
        const text = String(node.textContent || '');
        if (!text.trim()) return [];
        return [{ id: 'seed:' + ensureSheetId(sheet), cssText: text }];
      }
    } catch (_) {}
    return [];
  }

  function scopeForRoot(root) {
    // XO pierce satellite: entire frame is scoped to the host iframe anchor (C7).
    if (pierceHostAnchor) return { kind: 'pierceHost', hostAnchor: pierceHostAnchor };
    if (!root || root === document) return { kind: 'main' };
    const host = fHostElement(root);
    if (!host) return { kind: 'main' };
    const anchor = ensureAnchor(host);
    return anchor ? { kind: 'pierceHost', hostAnchor: anchor } : { kind: 'main' };
  }

  function collectSheetObjects() {
    const out = [];
    const seen = new Set();
    const roots = [document];
    for (const root of observedRoots) {
      if (root !== document) roots.push(root);
    }
    for (const root of roots) {
      const scope = scopeForRoot(root);
      const lists = [];
      try { if (root.styleSheets) lists.push(root.styleSheets); } catch (_) {}
      try { if (root.adoptedStyleSheets) lists.push(root.adoptedStyleSheets); } catch (_) {}
      for (const list of lists) {
        for (let i = 0; i < list.length; i++) {
          const sheet = list[i];
          if (!sheet || seen.has(sheet)) continue;
          // Include CORS-blocked sheets — C6.5 seeds rule text via asset cache.
          seen.add(sheet);
          out.push({ sheet, scope });
        }
      }
    }
    return out;
  }

  function sheetWire(entry) {
    let rules = rulesOf(entry.sheet);
    let href = null;
    if (!rules) {
      rules = seedRulesFromOwner(entry.sheet);
      if (!rules.length) href = sheetHref(entry.sheet);
    }
    sheetRuleIds.set(entry.sheet, rules.map((r) => r.id));
    const wire = { id: entry.id, scope: entry.scope, rules };
    if (href) wire.href = href;
    return wire;
  }

  function refreshKnownSheets() {
    const current = collectSheetObjects().map((e) => ({
      sheet: e.sheet,
      scope: e.scope,
      id: ensureSheetId(e.sheet),
    }));
    const previous = knownSheets;
    knownSheets = current;
    return { current, previous };
  }

  function syncSheets() {
    // C4: until epoch install publishes, only refresh identity — never emit sheetList
    // (load events during waitStylesheetsReady must not race ahead of install).
    if (!cssomLive) {
      refreshKnownSheets();
      return;
    }
    const { current, previous } = refreshKnownSheets();
    const previousIds = new Set(previous.map((e) => e.id));
    const currentIds = new Set(current.map((e) => e.id));
    const removed = [];
    for (const e of previous) {
      if (currentIds.has(e.id)) continue;
      publishedSheets.delete(e.id);
      removed.push({ selector: { kind: 'sheet', id: e.id } });
    }
    const added = [];
    current.forEach((e, index) => {
      if (previousIds.has(e.id)) return;
      publishedSheets.add(e.id);
      added.push({ index, sheet: sheetWire(e) });
    });
    if (!removed.length && !added.length) return;
    beginDiff([]);
    emit('cssom', 'sheetList', { removed, added });
  }

  function resyncSheetRules(sheet) {
    const id = sheetIds.get(sheet);
    if (!id || !publishedSheets.has(id)) return;
    const current = rulesOf(sheet);
    if (!current) return;
    const previous = sheetRuleIds.get(sheet) || [];
    const previousIds = new Set(previous);
    const currentIds = new Set(current.map((r) => r.id));
    const removed = [];
    for (const prevId of previous) {
      if (!currentIds.has(prevId)) removed.push({ selector: { kind: 'rule', id: prevId } });
    }
    const added = [];
    current.forEach((rule, index) => {
      if (previousIds.has(rule.id)) return;
      added.push({ index, rule });
    });
    sheetRuleIds.set(sheet, current.map((r) => r.id));
    if (!removed.length && !added.length) return;
    beginDiff([]);
    emit('cssom', 'ruleList', { selector: { kind: 'sheet', id }, removed, added });
  }

  function emitRulePatch(rule) {
    if (!rule) return;
    const id = ruleIds.get(rule);
    if (!id) return;
    beginDiff([]);
    emit('cssom', 'patch', { selector: { kind: 'rule', id }, rule: { id, cssText: ruleCssText(rule) } });
  }

  function installCssomHooks() {
    installCssomHooksForWindow(window);
  }

  function installCssomHooksForWindow(win) {
    if (!win) return;
    const proto = win.CSSStyleSheet && win.CSSStyleSheet.prototype;
    if (!proto || proto.__speculumCssomHooked) return;
    proto.__speculumCssomHooked = true;
    const wrap = (name) => {
      const orig = proto[name];
      if (typeof orig !== 'function') return;
      proto[name] = function (...args) {
        const result = orig.apply(this, args);
        try { resyncSheetRules(this); } catch (_) {}
        return result;
      };
    };
    wrap('insertRule');
    wrap('deleteRule');
    if (proto.replaceSync) wrap('replaceSync');
    if (proto.replace) wrap('replace');

    const declProto = win.CSSStyleDeclaration && win.CSSStyleDeclaration.prototype;
    if (declProto && !declProto.__speculumCssomHooked) {
      declProto.__speculumCssomHooked = true;
      for (const name of ['setProperty', 'removeProperty']) {
        const orig = declProto[name];
        if (typeof orig !== 'function') continue;
        declProto[name] = function (...args) {
          const result = orig.apply(this, args);
          try { if (this.parentRule) emitRulePatch(this.parentRule); } catch (_) {}
          return result;
        };
      }
      const cssTextDesc = Object.getOwnPropertyDescriptor(declProto, 'cssText');
      if (cssTextDesc && cssTextDesc.set) {
        Object.defineProperty(declProto, 'cssText', {
          configurable: true,
          enumerable: cssTextDesc.enumerable,
          get: cssTextDesc.get,
          set: function (value) {
            cssTextDesc.set.call(this, value);
            try { if (this.parentRule) emitRulePatch(this.parentRule); } catch (_) {}
          },
        });
      }
    }

    const ruleProto = win.CSSStyleRule && win.CSSStyleRule.prototype;
    if (ruleProto && !ruleProto.__speculumCssomHooked) {
      ruleProto.__speculumCssomHooked = true;
      const selDesc = Object.getOwnPropertyDescriptor(ruleProto, 'selectorText');
      if (selDesc && selDesc.set) {
        Object.defineProperty(ruleProto, 'selectorText', {
          configurable: true,
          enumerable: selDesc.enumerable,
          get: selDesc.get,
          set: function (value) {
            selDesc.set.call(this, value);
            try { emitRulePatch(this); } catch (_) {}
          },
        });
      }
    }
  }

  /** C5: adoptedStyleSheets assign → sheetList (Document + ShadowRoot). */
  function installAdoptedStyleSheetsHook() {
    installAdoptedStyleSheetsHookForWindow(window);
  }

  function installAdoptedStyleSheetsHookForWindow(win) {
    if (!win) return;
    const targets = [win.Document && win.Document.prototype].filter(Boolean);
    if (win.ShadowRoot) targets.push(win.ShadowRoot.prototype);
    for (const proto of targets) {
      if (!proto || proto.__speculumAdoptedHooked) continue;
      const desc = Object.getOwnPropertyDescriptor(proto, 'adoptedStyleSheets');
      if (!desc || !desc.set) continue;
      proto.__speculumAdoptedHooked = true;
      Object.defineProperty(proto, 'adoptedStyleSheets', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (value) {
          desc.set.call(this, value);
          try { syncSheets(); } catch (_) {}
        },
      });
    }
  }

  /** T7: pierce closed (and late open) shadows created via attachShadow. */
  function installAttachShadowHook() {
    const proto = window.Element && window.Element.prototype;
    if (!proto || proto.__speculumAttachShadowHooked) return;
    const orig = proto.attachShadow;
    if (typeof orig !== 'function') return;
    proto.__speculumAttachShadowHooked = true;
    proto.attachShadow = function (init) {
      const root = orig.call(this, init);
      try {
        const closed = init && init.mode === 'closed';
        if (closed) {
          closedShadows.set(this, root);
          this.setAttribute('speculum-shadow-root', 'true');
          this.setAttribute('speculum-shadow-closed', 'true');
        } else {
          this.setAttribute('speculum-shadow-root', 'true');
        }
        ensureAnchor(this);
        const kids = root.childNodes;
        for (let i = 0; i < kids.length; i++) anchorAll(kids[i]);
        registerRoot(root);
        syncSheets();
        emitElementPatch(this);
      } catch (_) {}
      return root;
    };
  }

  // ------------------------------------------------------------------ boot

  function init() {
    observer = new MutationObserver(onMutations);
    installAttachShadowHook();
    installAdoptedStyleSheetsHook();
    anchorAll(document.documentElement);
    ensureDocumentRootAnchors(document);
    observeRoot(document.documentElement);
    observedRoots.add(document);
    installSensors(document);
    installCssomHooks();
    // C4: discover sheets already present; do not emit sheetList before install
    // (refreshKnownSheets only — install/mapCssom owns the establish snapshot).
    armExistingStylesheetNodes();
    refreshKnownSheets();
  }

  if (pierceHostAnchor) {
    // Chromium-control XO pierce satellite (T7/C7): map + MO remount under host;
    // Cssom emits with pierceHost scope via the shared emit binding.
    init();
    window.__speculumDomMapPierceRoot = () => {
      try {
        if (observer && typeof observer.takeRecords === 'function') observer.takeRecords();
      } catch (_) {}
      anchorAll(document.documentElement);
      remintDuplicateConnectedAnchors(document.documentElement);
      const root = mapNode(document.documentElement);
      resetPublishedFromMapped(root);
      return root;
    };
    window.__speculumDomMapPierceCssom = () => {
      const { current } = refreshKnownSheets();
      return current.map((entry) => {
        publishedSheets.add(entry.id);
        return sheetWire(entry);
      });
    };
    window.__speculumDomAdoptClosedShadow = (host, shadow, publish) => {
      if (!host || host.nodeType !== 1 || !shadow) return false;
      if (closedShadows.has(host)) return false;
      try {
        const lightCount = fChildEntries(host, null).length;
        closedShadows.set(host, shadow);
        host.setAttribute('speculum-shadow-root', 'true');
        host.setAttribute('speculum-shadow-closed', 'true');
        ensureAnchor(host);
        const kids = shadow.childNodes;
        for (let i = 0; i < kids.length; i++) anchorAll(kids[i]);
        registerRoot(shadow);
        if (!publish || !host.isConnected) return true;
        emitElementPatch(host);
        const selector = selectorForElement(host);
        if (!selector) return true;
        const entries = fChildEntries(host, null);
        const added = [];
        for (let i = lightCount; i < entries.length; i++) {
          const entry = entries[i];
          if (entry.type === 'text') {
            added.push({ index: i, node: { tag: '#text', text: entry.text } });
          } else if (entry.type === 'comment') {
            added.push({ index: i, node: { tag: '#comment', text: entry.text } });
          } else if (entry.type === 'element') {
            const node = mapNode(entry.el);
            if (node) added.push({ index: i, node });
          }
        }
        if (added.length) {
          beginDiff([host]);
          emit('dom', 'childList', { selector, removed: [], added });
          const hostA = host.getAttribute(ANCHOR_ATTR);
          for (const entry of added) {
            if (entry.node) markPublishedMapped(entry.node, hostA || null);
          }
        }
        return true;
      } catch (_) {
        return false;
      }
    };
    // Scroll echo notes must live in the same realm as the scroller (pierce docs).
    window.__speculumDomNoteScrollEcho = (note) => {
      if (!note) return;
      if (note.viewport) {
        viewportEcho = { x: Number(note.viewport.x) || 0, y: Number(note.viewport.y) || 0 };
      }
      if (note.element && note.element.anchor) {
        elementEcho.set(note.element.anchor, {
          top: Number(note.element.top) || 0,
          left: Number(note.element.left) || 0,
        });
      }
    };
    /**
     * No-op scrollTo leave no scroll event — consume mark when already at noted
     * position (same equality filter as onScroll). Optional ScrollEchoHit.
     */
    window.__speculumDomConsumeScrollEchoIfAt = (note) => {
      if (!note) return false;
      if (note.viewport) {
        const x = window.scrollX || 0;
        const y = window.scrollY || 0;
        if (viewportEcho && viewportEcho.x === x && viewportEcho.y === y) {
          viewportEcho = null;
          try {
            if (typeof window.__speculumDomScrollEchoHit === 'function') {
              window.__speculumDomScrollEchoHit({ kind: 'viewport', scrollX: x, scrollY: y });
            }
          } catch (_) {}
          return true;
        }
        return false;
      }
      if (note.element && note.element.anchor) {
        const anchor = note.element.anchor;
        const echo = elementEcho.get(anchor);
        if (!echo) return false;
        let el = null;
        try {
          el = typeof window.__speculumDomResolve === 'function'
            ? window.__speculumDomResolve(anchor)
            : null;
        } catch (_) {}
        if (!el || el.nodeType !== 1) return false;
        const top = el.scrollTop || 0;
        const left = el.scrollLeft || 0;
        if (echo.top === top && echo.left === left) {
          elementEcho.delete(anchor);
          try {
            if (typeof window.__speculumDomScrollEchoHit === 'function') {
              window.__speculumDomScrollEchoHit({
                kind: 'element',
                anchor,
                scrollTop: top,
                scrollLeft: left,
              });
            }
          } catch (_) {}
          return true;
        }
        return false;
      }
      return false;
    };
    window.__speculumDomResolve = (anchor) => {
      if (!anchor) return null;
      const n = anchorToNode.get(anchor);
      if (n && n.isConnected) return n;
      const query = '[' + ANCHOR_ATTR + '="' + escapeAnchor(anchor) + '"]';
      try {
        const el = document.querySelector(query);
        if (el) {
          anchorToNode.set(anchor, el);
          return el;
        }
      } catch (_) {}
      for (const root of observedRoots) {
        try {
          const el = root.querySelector && root.querySelector(query);
          if (el) {
            anchorToNode.set(anchor, el);
            return el;
          }
        } catch (_) {}
      }
      return null;
    };
    // Initial snapshot is pulled by the sidecar after evaluate (avoids double publish).
    return;
  }

  init();

  // D4 evidence of Document replacement: init() runs once per real Document,
  // so a changed epoch id means a new Document (SPA soft nav keeps it).
  window.__speculumDomEpochId = () => documentEpoch;
  /** Test/effect probe: wire identity ledger membership after SoftNav wipes. */
  window.__speculumDomPublishedHas = (a) => publishedAnchors.has(String(a || ''));
  /** Test/effect probe: schedule a published-identity retire (SoftNav race fixtures). */
  window.__speculumDomScheduleRetire = (a) => scheduleRetirePublishedAnchor(String(a || ''));
  /**
   * Test/effect probe: drop one identity from the ledger without transitive wipe —
   * models SoftNav gaps where a never-published wrapper still has published kids.
   */
  window.__speculumDomForgetPublished = (a) => {
    const id = String(a || '');
    if (!id) return;
    publishedAnchors.delete(id);
    publishedParent.delete(id);
    anchorToNode.delete(id);
    const pendingAt = pendingRetires.indexOf(id);
    if (pendingAt >= 0) pendingRetires.splice(pendingAt, 1);
  };
  /**
   * C4 — wait until pending stylesheet links have load/error (bounded).
   * Refreshes knownSheets quietly; install/resync then maps a full snapshot.
   */
  window.__speculumDomWaitStylesheetsReady = (timeoutMs) => {
    const budget = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 2500;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ready) => {
        if (settled) return;
        settled = true;
        try { refreshKnownSheets(); } catch (_) {}
        resolve({ ready: !!ready });
      };
      let pending = [];
      try {
        const links = document.querySelectorAll('link[rel~="stylesheet"],link[rel="stylesheet"]');
        for (let i = 0; i < links.length; i++) {
          const link = links[i];
          let needsWait = false;
          try {
            // sheet is null while still loading; CORS sheets may throw on .sheet
            needsWait = !link.sheet && !link.disabled;
          } catch (_) {
            needsWait = !link.disabled;
          }
          if (needsWait) pending.push(link);
        }
      } catch (_) {}
      if (!pending.length) {
        // Brief settle so late styleSheets registration lands before install map.
        setTimeout(() => finish(true), 120);
        return;
      }
      let left = pending.length;
      const timer = setTimeout(() => finish(false), budget);
      const onOne = () => {
        left -= 1;
        if (left <= 0) {
          clearTimeout(timer);
          setTimeout(() => finish(true), 120);
        }
      };
      for (let i = 0; i < pending.length; i++) {
        const link = pending[i];
        try {
          link.addEventListener('load', onOne, { once: true });
          link.addEventListener('error', onOne, { once: true });
        } catch (_) {
          onOne();
        }
      }
    });
  };
  window.__speculumDomMapDocument = () => {
    const pageStart = Date.now();
    let t0 = pageStart;
    let takeRecordsMs = 0;
    let clearLedgerMs = 0;
    let anchorAllMs = 0;
    let remintMs = 0;
    let mapNodeMs = 0;
    let resetPublishedMs = 0;
    // Discard pending MO so resync map does not re-emit pre-map mutations (T8).
    try {
      if (observer && typeof observer.takeRecords === 'function') observer.takeRecords();
    } catch (_) {}
    takeRecordsMs = Date.now() - t0;
    t0 = Date.now();
    // Drop stale map entries so clone collisions remint against live DOM (BZ4 / T7).
    anchorToNode.clear();
    clearLedgerMs = Date.now() - t0;
    t0 = Date.now();
    anchorAll(document.documentElement);
    ensureDocumentRootAnchors(document);
    anchorAllMs = Date.now() - t0;
    t0 = Date.now();
    remintDuplicateConnectedAnchors(document.documentElement);
    remintMs = Date.now() - t0;
    t0 = Date.now();
    const root = mapNode(document.documentElement);
    mapNodeMs = Date.now() - t0;
    t0 = Date.now();
    resetPublishedFromMapped(root);
    resetPublishedMs = Date.now() - t0;
    // Stringify in-page so CDP returns a scalar string (not a structured-clone tree).
    t0 = Date.now();
    const rootJson = JSON.stringify(root);
    const stringifyMs = Date.now() - t0;
    const pageTotalMs = Date.now() - pageStart;
    return {
      generation,
      rootJson,
      timings: {
        takeRecordsMs,
        clearLedgerMs,
        anchorAllMs,
        remintMs,
        mapNodeMs,
        resetPublishedMs,
        cssomMs: 0,
        stringifyMs,
        pageTotalMs,
      },
    };
  };
  /**
   * OOB resync Dom map (T8): same truthful root as MapDocument, but skip the
   * full anchorAll rebuild when the ledger is already live — MapDocument's clear
   * + walk dominates Beleza (~seconds). Remint duplicates still runs (T7/BZ4).
   */
  window.__speculumDomMapDocumentResync = () => {
    const pageStart = Date.now();
    let t0 = pageStart;
    let takeRecordsMs = 0;
    let remintMs = 0;
    let mapNodeMs = 0;
    let resetPublishedMs = 0;
    try {
      if (observer && typeof observer.takeRecords === 'function') observer.takeRecords();
    } catch (_) {}
    takeRecordsMs = Date.now() - t0;
    t0 = Date.now();
    ensureDocumentRootAnchors(document);
    remintDuplicateConnectedAnchors(document.documentElement);
    remintMs = Date.now() - t0;
    t0 = Date.now();
    const root = mapNode(document.documentElement);
    mapNodeMs = Date.now() - t0;
    t0 = Date.now();
    resetPublishedFromMapped(root);
    resetPublishedMs = Date.now() - t0;
    t0 = Date.now();
    const rootJson = JSON.stringify(root);
    const stringifyMs = Date.now() - t0;
    const pageTotalMs = Date.now() - pageStart;
    return {
      generation,
      rootJson,
      timings: {
        takeRecordsMs,
        clearLedgerMs: 0,
        anchorAllMs: 0,
        remintMs,
        mapNodeMs,
        resetPublishedMs,
        cssomMs: 0,
        stringifyMs,
        pageTotalMs,
      },
    };
  };
  window.__speculumDomMapCssom = () => {
    const { current } = refreshKnownSheets();
    publishedSheets.clear();
    const sheets = current.map((entry) => {
      publishedSheets.add(entry.id);
      return sheetWire(entry);
    });
    cssomLive = true;
    return { generation, sheets };
  };
  /**
   * Establish: map Dom+Cssom and arm live emit in one sync turn so MO cannot
   * stamp mute-window anchors that never appear in the pushed document (T10).
   */
  window.__speculumDomMapAndArmEstablish = () => {
    const pageStart = Date.now();
    let t0 = pageStart;
    let takeRecordsMs = 0;
    let clearLedgerMs = 0;
    let anchorAllMs = 0;
    let remintMs = 0;
    let mapNodeMs = 0;
    let resetPublishedMs = 0;
    let cssomMs = 0;
    // Pending MO records already reflect in the live DOM; discard notifications so
    // arm does not immediately re-emit pre-map mutations against the new baseline.
    try {
      if (typeof observer !== 'undefined' && observer && typeof observer.takeRecords === 'function') {
        observer.takeRecords();
      }
    } catch (_) {}
    takeRecordsMs = Date.now() - t0;
    t0 = Date.now();
    anchorToNode.clear();
    clearLedgerMs = Date.now() - t0;
    t0 = Date.now();
    anchorAll(document.documentElement);
    ensureDocumentRootAnchors(document);
    anchorAllMs = Date.now() - t0;
    t0 = Date.now();
    remintDuplicateConnectedAnchors(document.documentElement);
    remintMs = Date.now() - t0;
    t0 = Date.now();
    const root = mapNode(document.documentElement);
    mapNodeMs = Date.now() - t0;
    t0 = Date.now();
    resetPublishedFromMapped(root);
    resetPublishedMs = Date.now() - t0;
    t0 = Date.now();
    const { current } = refreshKnownSheets();
    publishedSheets.clear();
    const sheets = current.map((entry) => {
      publishedSheets.add(entry.id);
      return sheetWire(entry);
    });
    cssomLive = true;
    liveEmit = true;
    cssomMs = Date.now() - t0;
    // Stringify in-page so CDP returns scalar strings (not structured-clone trees).
    t0 = Date.now();
    const rootJson = JSON.stringify(root);
    const sheetsJson = JSON.stringify(sheets);
    const stringifyMs = Date.now() - t0;
    const pageTotalMs = Date.now() - pageStart;
    return {
      generation,
      rootJson,
      sheetsJson,
      timings: {
        takeRecordsMs,
        clearLedgerMs,
        anchorAllMs,
        remintMs,
        mapNodeMs,
        resetPublishedMs,
        cssomMs,
        stringifyMs,
        pageTotalMs,
      },
    };
  };
  /** Sidecar arms after Dom document + Cssom install are on the materialize chain (T10.4). */
  window.__speculumDomArmLiveEmit = () => {
    liveEmit = true;
  };
  /**
   * EventBridge Dom near capacity (T5 backpressure defer) — keep MO, stop wire emits.
   * Resume path re-establishes (document+install) so deferred mutations are not a silent hole.
   */
  window.__speculumDomPauseLiveEmit = () => {
    try {
      if (typeof observer !== 'undefined' && observer && typeof observer.takeRecords === 'function') {
        observer.takeRecords();
      }
    } catch (_) {}
    liveEmit = false;
  };
  /**
   * Sidecar owns monotonic generation. Optional absolute value after Document
   * swap — never let a fresh page script reset the wire epoch downward (T3/D4).
   */
  window.__speculumDomBumpGeneration = (absolute) => {
    if (typeof absolute === 'number' && absolute > 0) generation = absolute;
    else generation += 1;
    localSequence = 0;
    anchorToNode.clear();
    knownSheets = [];
    publishedSheets.clear();
    publishedAnchors.clear();
    publishedParent.clear();
    pendingRetires.length = 0;
    cssomLive = false;
    liveEmit = false;
    viewportEcho = null;
    elementEcho.clear();
    anchorAll(document.documentElement);
    ensureDocumentRootAnchors(document);
    remintDuplicateConnectedAnchors(document.documentElement);
    return generation;
  };
  window.__speculumDomSetGeneration = (absolute) => {
    if (typeof absolute === 'number' && absolute > 0) generation = absolute;
    return generation;
  };
  /**
   * CDP / Chromium-control path for closed shadows not retained by attachShadow
   * (declarative shadowrootmode=closed, pre-hook roots) — T7 pierce.
   * @param publish when true (mid-epoch push), emit host patch + childList for new F children.
   */
  window.__speculumDomAdoptClosedShadow = (host, shadow, publish) => {
    if (!host || host.nodeType !== 1 || !shadow) return false;
    if (closedShadows.has(host)) return false;
    try {
      // Light-only F count before pierce (same as projected tree pre-op).
      const lightCount = fChildEntries(host, null).length;
      closedShadows.set(host, shadow);
      host.setAttribute('speculum-shadow-root', 'true');
      host.setAttribute('speculum-shadow-closed', 'true');
      ensureAnchor(host);
      const kids = shadow.childNodes;
      for (let i = 0; i < kids.length; i++) anchorAll(kids[i]);
      registerRoot(shadow);
      syncSheets();
      if (!publish || !host.isConnected) return true;
      emitElementPatch(host);
      const selector = selectorForElement(host);
      if (!selector) return true;
      const entries = fChildEntries(host, null);
      const added = [];
      for (let i = lightCount; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.type === 'text') {
          added.push({ index: i, node: { tag: '#text', text: entry.text } });
        } else if (entry.type === 'comment') {
          added.push({ index: i, node: { tag: '#comment', text: entry.text } });
        } else if (entry.type === 'element') {
          const node = mapNode(entry.el);
          if (node) added.push({ index: i, node });
        }
      }
      if (added.length) {
        beginDiff([host]);
        emit('dom', 'childList', { selector, removed: [], added });
        const hostA = host.getAttribute(ANCHOR_ATTR);
        for (const entry of added) {
          if (entry.node) markPublishedMapped(entry.node, hostA || null);
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  };
  window.__speculumDomNoteScrollEcho = (note) => {
    if (!note) return;
    if (note.viewport) {
      viewportEcho = { x: Number(note.viewport.x) || 0, y: Number(note.viewport.y) || 0 };
    }
    if (note.element && note.element.anchor) {
      elementEcho.set(note.element.anchor, {
        top: Number(note.element.top) || 0,
        left: Number(note.element.left) || 0,
      });
    }
  };
  window.__speculumDomConsumeScrollEchoIfAt = (note) => {
    if (!note) return false;
    if (note.viewport) {
      const x = window.scrollX || 0;
      const y = window.scrollY || 0;
      if (viewportEcho && viewportEcho.x === x && viewportEcho.y === y) {
        viewportEcho = null;
        try {
          if (typeof window.__speculumDomScrollEchoHit === 'function') {
            window.__speculumDomScrollEchoHit({ kind: 'viewport', scrollX: x, scrollY: y });
          }
        } catch (_) {}
        return true;
      }
      return false;
    }
    if (note.element && note.element.anchor) {
      const anchor = note.element.anchor;
      const echo = elementEcho.get(anchor);
      if (!echo) return false;
      let el = null;
      try {
        el = typeof window.__speculumDomResolve === 'function'
          ? window.__speculumDomResolve(anchor)
          : null;
      } catch (_) {}
      if (!el || el.nodeType !== 1) return false;
      const top = el.scrollTop || 0;
      const left = el.scrollLeft || 0;
      if (echo.top === top && echo.left === left) {
        elementEcho.delete(anchor);
        try {
          if (typeof window.__speculumDomScrollEchoHit === 'function') {
            window.__speculumDomScrollEchoHit({
              kind: 'element',
              anchor,
              scrollTop: top,
              scrollLeft: left,
            });
          }
        } catch (_) {}
        return true;
      }
      return false;
    }
    return false;
  };
  window.__speculumDomResolve = (anchor) => {
    if (!anchor) return null;
    const n = anchorToNode.get(anchor);
    if (n && n.isConnected) return n;
    const query = '[' + ANCHOR_ATTR + '="' + escapeAnchor(anchor) + '"]';
    for (const root of [document, ...observedRoots]) {
      try {
        const el = root.querySelector && root.querySelector(query);
        if (el) {
          anchorToNode.set(anchor, el);
          return el;
        }
      } catch (_) {}
    }
    return null;
  };
})();
`;
//# sourceMappingURL=DomTreeSerializer.js.map