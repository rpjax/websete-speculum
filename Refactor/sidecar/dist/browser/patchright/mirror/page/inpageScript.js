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
 */
exports.PAGE_PROJECTION_V2_PAGE_SCRIPT = String.raw `
(() => {
  if (window.__speculumPageProjectionV2) return window.__speculumPageProjectionV2;

  const forward = new WeakMap();
  const reverse = new Map();
  let nextId = 1;
  let generation = 1;

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

  function discardNonPublished(target) {
    if (!target || target.nodeType !== 1) return false;
    const tag = target.tagName;
    if (tag === 'STYLE' || tag === 'LINK') return true;
    let p = target.parentNode;
    while (p) {
      if (p.nodeType === 1 && PLACEHOLDERS.has(p.tagName) && p.tagName !== 'IFRAME') return true;
      p = p.parentNode;
    }
    return false;
  }

  function markStateDirty(el) {
    if (!el) return;
    const id = allocate(el);
    dirty.stateDirty.add(id);
  }

  ['input', 'change', 'toggle', 'close'].forEach((type) => {
    document.addEventListener(
      type,
      (e) => {
        const t = e.target;
        if (t && t.nodeType === 1) markStateDirty(t);
      },
      true,
    );
  });

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      const t = r.target;
      if (discardNonPublished(t)) continue;
      if (r.type === 'childList') {
        const parent = t.nodeType === 1 ? t : t.parentElement;
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

  mo.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  // Unthrottled frame clock — MUST NOT use rAF (§5.3.4)
  let rateHz = 60;
  let timer = null;
  const listeners = new Set();

  function tick() {
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
            detached: [...dirty.detached],
          },
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
    /** Live-attach establish/re-sync source: full raw tree (attrs + children), STYLE/LINK excluded (cssom plane owns those). */
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
          if (tag === 'IFRAME' || !PLACEHOLDERS.has(tag)) {
            for (const c of n.childNodes) {
              const built = buildRaw(c);
              if (built) children.push(built);
            }
          }
          return { kind: 'element', id, tag: tag.toLowerCase(), attrs, children };
        }
        if (n.nodeType === 3) return { kind: 'text', id: allocate(n), value: n.nodeValue || '' };
        if (n.nodeType === 8) return { kind: 'comment', id: allocate(n), value: n.nodeValue || '' };
        return null;
      }
      return buildRaw(document.documentElement);
    },
  };

  window.__speculumPageProjectionV2 = api;
  return api;
})();
`;
//# sourceMappingURL=inpageScript.js.map