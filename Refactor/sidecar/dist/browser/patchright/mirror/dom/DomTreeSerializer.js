"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOM_PROJECTION_PAGE_SCRIPT = exports.ATTR_DENY = void 0;
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
function encodeDomBody(body) {
    return Buffer.from(JSON.stringify(body), 'utf8');
}
function decodeDomBody(bytes) {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
}
/**
 * F page script: Anchorer + DiffProducer (dirty climb → node list) + CSSOM hooks.
 * Installed via addInitScript / evaluate.
 */
exports.DOM_PROJECTION_PAGE_SCRIPT = `
(() => {
  if (window.__speculumDomInstalled) return;
  window.__speculumDomInstalled = true;

  const SKIP = new Set(['SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'BASE']);
  const ATTR_DENY = new Set(${JSON.stringify([...ATTR_DENY])});
  const ANCHOR_ATTR = 'speculum-anchor';
  const COALESCE_MS = ${Number(process.env['SPECULUM_DOM_COALESCE_MS']) > 0 ? Number(process.env['SPECULUM_DOM_COALESCE_MS']) : 8};
  const MAX_WAIT_MS = ${Number(process.env['SPECULUM_DOM_MAX_WAIT_MS']) > 0 ? Number(process.env['SPECULUM_DOM_MAX_WAIT_MS']) : 50};

  let generation = 1;
  const anchorToNode = new Map();
  const dirty = new Set();
  let cssomDirtyUrls = new Set();
  let flushTimer = null;
  let firstDirtyAt = 0;
  let observer = null;

  function mintAnchor() {
    const a = 'a' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    return a;
  }

  function ensureAnchor(el) {
    if (!el || el.nodeType !== 1) return null;
    let a = el.getAttribute(ANCHOR_ATTR);
    if (a) {
      const mapped = anchorToNode.get(a);
      // Google (and others) clone nodes and copy speculum-anchor — remint on collision.
      if (mapped && mapped !== el && mapped.isConnected) {
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

  function anchorAll(root) {
    if (!root) return;
    if (root.nodeType === 1) {
      if (!SKIP.has(root.tagName)) ensureAnchor(root);
      const kids = root.childNodes;
      for (let i = 0; i < kids.length; i++) anchorAll(kids[i]);
      try {
        if (root.shadowRoot) {
          root.setAttribute('speculum-shadow-root', 'true');
          anchorAll(root.shadowRoot);
        }
      } catch (_) {}
      if (root.tagName === 'IFRAME') {
        try {
          const doc = root.contentDocument;
          if (doc && doc.documentElement) {
            root.setAttribute('speculum-iframe', 'true');
            anchorAll(doc.documentElement);
            observeRoot(doc.documentElement);
          }
        } catch (_) {}
      }
    }
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

  function attrsOf(el) {
    const out = {};
    for (const a of el.attributes) {
      if (isDeniedAttr(a.name)) continue;
      let v = a.value;
      if ((a.name === 'href' || a.name === 'src' || a.name === 'xlink:href' || a.name === 'poster' || a.name === 'action' || a.name === 'formaction') && /^\\s*javascript:/i.test(v)) continue;
      if (a.name === 'href' || a.name === 'src' || a.name === 'xlink:href' || a.name === 'poster' || a.name === 'action' || a.name === 'formaction' || a.name === 'data-src') {
        try { v = new URL(v, document.baseURI).href; } catch (_) {}
      }
      if (a.name === 'srcset') {
        v = v.split(',').map((part) => {
          const bits = part.trim().split(/\\s+/);
          if (bits[0]) {
            try { bits[0] = new URL(bits[0], document.baseURI).href; } catch (_) {}
          }
          return bits.join(' ');
        }).join(', ');
      }
      out[a.name] = v;
    }
    delete out.integrity;
    controlAttrs(el, out);
    ensureAnchor(el);
    out[ANCHOR_ATTR] = el.getAttribute(ANCHOR_ATTR);
    if (el.shadowRoot) {
      out['speculum-shadow-root'] = 'true';
    }
    if (el.tagName === 'IFRAME' && el.hasAttribute('speculum-iframe')) {
      out['speculum-iframe'] = 'true';
    }
    return out;
  }

  function mapNode(node) {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      return { tag: '#text', text: node.textContent || '' };
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node;
    if (SKIP.has(el.tagName)) return null;
    if (el.tagName === 'META') {
      const httpEquiv = (el.getAttribute('http-equiv') || '').toLowerCase();
      if (httpEquiv === 'content-security-policy') return null;
    }
    const children = [];
    const pushChild = (c) => {
      const s = mapNode(c);
      if (s) children.push(s);
    };
    for (const c of el.childNodes) pushChild(c);
    try {
      if (el.shadowRoot) {
        for (const c of el.shadowRoot.childNodes) pushChild(c);
      }
    } catch (_) {}
    if (el.tagName === 'IFRAME') {
      try {
        const doc = el.contentDocument;
        if (doc && doc.documentElement) {
          const mapped = mapNode(doc.documentElement);
          if (mapped) children.push(mapped);
        }
      } catch (_) {}
    }
    const anchor = ensureAnchor(el);
    return {
      anchor: anchor || undefined,
      tag: el.tagName.toLowerCase(),
      attrs: attrsOf(el),
      children: children.length ? children : undefined,
    };
  }

  function markDirty(node) {
    if (!node) return;
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el.nodeType === 1) {
      if (!SKIP.has(el.tagName)) {
        ensureAnchor(el);
        dirty.add(el);
      }
      el = el.parentElement;
    }
  }

  function outermostDirty() {
    const roots = [];
    for (const el of dirty) {
      if (!(el instanceof Element) || !el.isConnected) continue;
      let p = el.parentElement;
      let nested = false;
      while (p) {
        if (dirty.has(p)) { nested = true; break; }
        p = p.parentElement;
      }
      if (!nested) roots.push(el);
    }
    return roots;
  }

  function scheduleFlush() {
    const now = Date.now();
    if (!firstDirtyAt) firstDirtyAt = now;
    if (flushTimer != null) clearTimeout(flushTimer);
    const waited = now - firstDirtyAt;
    const delay = waited >= MAX_WAIT_MS ? 0 : Math.min(COALESCE_MS, MAX_WAIT_MS - waited);
    flushTimer = setTimeout(flush, delay);
  }

  function flush() {
    flushTimer = null;
    firstDirtyAt = 0;
    const cssUrls = [...cssomDirtyUrls];
    cssomDirtyUrls = new Set();
    if (cssUrls.length && typeof window.__speculumDomEmit === 'function') {
      window.__speculumDomEmit({ kind: 'cssom', generation, urls: cssUrls });
    }
    if (!dirty.size) return;
    const roots = outermostDirty();
    dirty.clear();
    const nodes = [];
    for (const el of roots) {
      const mapped = mapNode(el);
      if (mapped) nodes.push(mapped);
    }
    if (!nodes.length) return;
    if (typeof window.__speculumDomEmit === 'function') {
      window.__speculumDomEmit({ kind: 'patch', generation, nodes });
    }
  }

  function onMutations(mutations) {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === ANCHOR_ATTR) {
        const el = m.target;
        if (el && el.nodeType === 1 && !el.getAttribute(ANCHOR_ATTR)) {
          ensureAnchor(el);
        }
        continue;
      }
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => {
          anchorAll(n);
          markDirty(m.target);
        });
        m.removedNodes.forEach(() => markDirty(m.target));
        continue;
      }
      markDirty(m.target);
    }
    scheduleFlush();
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

  function installCssomHooks() {
    const proto = CSSStyleSheet && CSSStyleSheet.prototype;
    if (!proto || proto.__speculumCssomHooked) return;
    proto.__speculumCssomHooked = true;
    const wrap = (name) => {
      const orig = proto[name];
      if (typeof orig !== 'function') return;
      proto[name] = function (...args) {
        try {
          const owner = this.ownerNode;
          if (owner && owner.nodeType === 1) {
            const href = owner.getAttribute && owner.getAttribute('href');
            if (href) cssomDirtyUrls.add(href);
            else markDirty(owner);
          } else {
            cssomDirtyUrls.add('__inline__');
          }
          scheduleFlush();
        } catch (_) {}
        return orig.apply(this, args);
      };
    };
    wrap('insertRule');
    wrap('deleteRule');
    if (proto.replaceSync) wrap('replaceSync');
    if (proto.replace) wrap('replace');
  }

  observer = new MutationObserver(onMutations);
  anchorAll(document.documentElement);
  observeRoot(document.documentElement);
  installCssomHooks();

  window.__speculumDomSnapshot = () => {
    anchorAll(document.documentElement);
    return { kind: 'snapshot', generation, root: mapNode(document.documentElement) };
  };
  window.__speculumDomBumpGeneration = () => {
    generation += 1;
    anchorToNode.clear();
    dirty.clear();
    cssomDirtyUrls = new Set();
    firstDirtyAt = 0;
    if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
    anchorAll(document.documentElement);
    return generation;
  };
  window.__speculumDomResolve = (anchor) => {
    if (!anchor) return null;
    const n = anchorToNode.get(anchor);
    if (n && n.isConnected) return n;
    try {
      const el = document.querySelector('[' + ANCHOR_ATTR + '="' + CSS.escape(anchor) + '"]');
      if (el) {
        anchorToNode.set(anchor, el);
        return el;
      }
    } catch (_) {}
    return null;
  };
})();
`;
//# sourceMappingURL=DomTreeSerializer.js.map