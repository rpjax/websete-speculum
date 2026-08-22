"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INPAGE_SCRIPT_V2_OBSERVE = void 0;
/** In-page V2 script fragment: MutationObserver, frame clock, snapshot API. */
exports.INPAGE_SCRIPT_V2_OBSERVE = String.raw `  // ---------------------------------------------------------------- shared discard + MutationObserver

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
            // else: cross-origin / not yet navigated — CDP pierce merges interior under this id.
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
//# sourceMappingURL=inpageScriptObserve.js.map