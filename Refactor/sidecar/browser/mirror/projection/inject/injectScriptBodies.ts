/**
 * Inline script bodies for the unified CDP inject bundle (no HTML tags).
 */

export const META_CSP_NEUTRALIZE_BODY = `
  'use strict';
  if (typeof Element === 'undefined' || typeof Node === 'undefined') return;

  function isCspMeta(el) {
    if (!el || el.nodeType !== 1) return false;
    if (String(el.tagName || '').toLowerCase() !== 'meta') return false;
    var he = (el.getAttribute && el.getAttribute('http-equiv')) || el.httpEquiv || '';
    return String(he).toLowerCase() === 'content-security-policy';
  }

  function dropCspMeta(el) {
    return isCspMeta(el);
  }

  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function speculum_setAttribute(name, value) {
    var n = String(name || '').toLowerCase();
    if (n === 'http-equiv' && String(value || '').toLowerCase() === 'content-security-policy') {
      return;
    }
    if (n === 'content' && isCspMeta(this)) {
      return;
    }
    return origSetAttribute.call(this, name, value);
  };

  var origAppend = Node.prototype.appendChild;
  Node.prototype.appendChild = function speculum_appendChild(child) {
    if (dropCspMeta(child)) return child;
    return origAppend.call(this, child);
  };

  var origInsert = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function speculum_insertBefore(newNode, ref) {
    if (dropCspMeta(newNode)) return newNode;
    return origInsert.call(this, newNode, ref);
  };

  var origReplace = Element.prototype.replaceChild;
  if (origReplace) {
    Element.prototype.replaceChild = function speculum_replaceChild(newChild, oldChild) {
      if (dropCspMeta(newChild)) return oldChild;
      return origReplace.call(this, newChild, oldChild);
    };
  }
`;

export const SINGLE_TAB_BODY = `
  'use strict';
  try {
    Object.defineProperty(window, 'opener', {
      value: null, writable: false, configurable: false,
    });
  } catch (_) {}
  var _origOpen = window.open.bind(window);
  window.open = function speculum_single_tab_open(url, target, features) {
    var href = (url instanceof URL) ? url.href : String(url || '');
    if (href && !href.startsWith('javascript:') && !href.startsWith('about:') && !href.startsWith('blob:')) {
      window.location.href = href;
      return null;
    }
    return _origOpen(url, target, features);
  };
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    var el = e.target;
    var a = el instanceof Element ? el.closest('a') : null;
    if (!a) return;
    var t = (a.getAttribute('target') || '').toLowerCase();
    if (t !== '_blank' && t !== '_new') return;
    var href = a.href;
    if (!href || href.startsWith('javascript:') || href.startsWith('about:') || href.startsWith('blob:')) return;
    e.preventDefault();
    e.stopPropagation();
    window.location.href = href;
  }, true);
  document.addEventListener('submit', function (e) {
    var form = e.target instanceof HTMLFormElement ? e.target : null;
    if (!form) return;
    var t = (form.getAttribute('target') || '').toLowerCase();
    if (t === '_blank' || t === '_new') form.setAttribute('target', '_self');
  }, true);
`;

export const CSP_DIAG_PROBE_BODY = `
  'use strict';
  try {
    var cfg = globalThis.__SPECULUM_PROJECTION__;
    var rt = globalThis.__speculumProjection;
    var ft = rt && rt.frameTransport;
    var sock = ft && ft.dataPlane && ft.dataPlane.socket;
    var hasCfg = !!(cfg && cfg.dataPlaneUrl);
    console.log('[speculum-csp-diag] probe document=' + location.href);
    console.log('[speculum-csp-diag] probe config=' + (hasCfg ? cfg.dataPlaneUrl : 'missing'));
    console.log('[speculum-csp-diag] probe runtime wsOpen=' + (ft ? ft.isOpen : 'no-runtime') + ' readyState=' + (sock ? sock.readyState : 'no-socket'));
    var meta = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
    console.log('[speculum-csp-diag] probe metaCsp=' + (meta ? 'present len=' + (meta.content || '').length : 'absent'));
    if (!hasCfg) return;
    var ws = new WebSocket(cfg.dataPlaneUrl);
    var done = false;
    var finish = function (tag) {
      if (done) return;
      done = true;
      console.log('[speculum-csp-diag] probe ws ' + tag);
      try { ws.close(); } catch (_) {}
    };
    ws.onopen = function () { finish('open'); };
    ws.onerror = function () { finish('error'); };
    setTimeout(function () { finish('timeout'); }, 3000);
  } catch (e) {
    console.log('[speculum-csp-diag] probe err ' + (e && e.message ? e.message : String(e)));
  }
`;
