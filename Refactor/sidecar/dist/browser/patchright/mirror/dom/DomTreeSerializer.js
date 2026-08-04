"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOM_PROJECTION_PAGE_SCRIPT = void 0;
exports.serializeElementPayload = serializeElementPayload;
exports.encodeDomBody = encodeDomBody;
exports.decodeDomBody = decodeDomBody;
const SKIP_TAGS = new Set(['SCRIPT', 'NOSCRIPT', 'TEMPLATE']);
const ATTR_ALLOW = new Set([
    'id',
    'class',
    'href',
    'src',
    'alt',
    'title',
    'type',
    'name',
    'value',
    'placeholder',
    'role',
    'aria-label',
    'aria-hidden',
    'disabled',
    'readonly',
    'checked',
    'selected',
    'for',
    'action',
    'method',
    'target',
    'rel',
    'type',
    'width',
    'height',
    'colspan',
    'rowspan',
    'tabindex',
]);
/**
 * Serializes main-frame DOM to a compact JSON tree / ops for Dom Projection.
 * Runs in the Node process against Playwright ElementHandles via evaluate payloads.
 */
function serializeElementPayload(payload, ids) {
    if (!payload || typeof payload !== 'object')
        return null;
    return payload;
}
function encodeDomBody(body) {
    return Buffer.from(JSON.stringify(body), 'utf8');
}
function decodeDomBody(bytes) {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
}
/** Page-side serializer source installed via page.evaluate. */
exports.DOM_PROJECTION_PAGE_SCRIPT = `
(() => {
  if (window.__speculumDomInstalled) return;
  window.__speculumDomInstalled = true;

  const SKIP = new Set(['SCRIPT', 'NOSCRIPT', 'TEMPLATE']);
  const ATTR_ALLOW = new Set(${JSON.stringify([...ATTR_ALLOW])});
  let nextId = 1;
  const nodeToId = new WeakMap();
  const idToNode = new Map();
  let generation = 1;
  let pending = [];
  let flushTimer = null;
  const COALESCE_MS = 8;

  function ensure(node) {
    let id = nodeToId.get(node);
    if (id != null) return id;
    id = nextId++;
    nodeToId.set(node, id);
    idToNode.set(id, node);
    return id;
  }

  function attrsOf(el) {
    const out = {};
    for (const a of el.attributes) {
      if (!ATTR_ALLOW.has(a.name) && !a.name.startsWith('aria-') && a.name !== 'style') continue;
      out[a.name] = a.value;
    }
    return Object.keys(out).length ? out : undefined;
  }

  function serialize(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent || '';
      if (!t.trim()) return null;
      return { id: ensure(node), tag: '#text', text: t };
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node;
    if (SKIP.has(el.tagName)) return null;
    const children = [];
    for (const c of el.childNodes) {
      const s = serialize(c);
      if (s) children.push(s);
    }
    return {
      id: ensure(el),
      tag: el.tagName.toLowerCase(),
      attrs: attrsOf(el),
      children: children.length ? children : undefined,
    };
  }

  function snapshot() {
    const root = serialize(document.documentElement);
    return { kind: 'snapshot', generation, root };
  }

  function queueOp(op) {
    pending.push(op);
    if (flushTimer != null) return;
    flushTimer = setTimeout(flush, COALESCE_MS);
  }

  function flush() {
    flushTimer = null;
    if (!pending.length) return;
    const ops = pending;
    pending = [];
    if (typeof window.__speculumDomEmit === 'function') {
      window.__speculumDomEmit({ kind: 'patch', generation, ops });
    }
  }

  function onMutations(mutations) {
    for (const m of mutations) {
      if (m.type === 'characterData' && m.target) {
        queueOp({ op: 'setText', id: ensure(m.target), text: m.target.textContent || '' });
        continue;
      }
      if (m.type === 'attributes' && m.target && m.target.nodeType === Node.ELEMENT_NODE) {
        const el = m.target;
        const name = m.attributeName;
        if (!name) continue;
        if (!ATTR_ALLOW.has(name) && !name.startsWith('aria-') && name !== 'style') continue;
        const value = el.getAttribute(name);
        if (value == null) queueOp({ op: 'removeAttr', id: ensure(el), name });
        else queueOp({ op: 'setAttr', id: ensure(el), name, value });
        continue;
      }
      if (m.type === 'childList') {
        const parent = m.target;
        const parentId = ensure(parent);
        m.removedNodes.forEach((n) => {
          const id = nodeToId.get(n);
          if (id != null) queueOp({ op: 'remove', id, parentId });
        });
        m.addedNodes.forEach((n) => {
          const node = serialize(n);
          if (!node) return;
          let index = 0;
          let sib = n.previousSibling;
          while (sib) {
            if (nodeToId.has(sib) || (sib.nodeType === Node.ELEMENT_NODE && !SKIP.has(sib.tagName))) index++;
            else if (sib.nodeType === Node.TEXT_NODE && (sib.textContent || '').trim()) index++;
            sib = sib.previousSibling;
          }
          queueOp({ op: 'insert', id: node.id, parentId, index, node });
        });
      }
    }
  }

  const observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  window.__speculumDomSnapshot = snapshot;
  window.__speculumDomBumpGeneration = () => {
    generation += 1;
    nextId = 1;
    idToNode.clear();
    pending = [];
    return generation;
  };
  window.__speculumDomResolve = (id) => idToNode.get(id) || null;
})();
`;
//# sourceMappingURL=DomTreeSerializer.js.map