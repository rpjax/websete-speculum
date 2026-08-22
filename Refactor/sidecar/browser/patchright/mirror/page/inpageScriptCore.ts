/** In-page V2 script fragment: identity, pierce, state/scroll sensors. */
export const INPAGE_SCRIPT_V2_CORE = String.raw`
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
    if (!doc) return; // cross-origin — CDP pierce injects a satellite script into the child frame.
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

`;
