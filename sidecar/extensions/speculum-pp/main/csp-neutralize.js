(function speculum_csp_meta_neutralize() {
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
})();
