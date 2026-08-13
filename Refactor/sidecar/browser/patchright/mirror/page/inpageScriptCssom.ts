/** In-page V2 script fragment: Cssom prototype hooks + style/link lifecycle. */
export const INPAGE_SCRIPT_V2_CSSOM = String.raw`  // ---------------------------------------------------------------- §5.10 Cssom sensors

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
      // Cross-origin (non-CORS) external stylesheet — cssRules throws.
      // W4: Node fills bodies via CDP CSS.getStyleSheetText using href.
      cssomKnownRules.set(sheetId, ruleMap);
      return { id: sheetId, scope: sheetScopeFor(sheet), rules, href: sheet.href || undefined };
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
      if (!sheet) return; // load failed; XO bodies filled via W4 CDP on install/delta.
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

`;
