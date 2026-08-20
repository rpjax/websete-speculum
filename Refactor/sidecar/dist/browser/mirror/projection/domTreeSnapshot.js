"use strict";
var __speculumSnapshot = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // browser/mirror/projection/client/domTreeSnapshot.ts
  var domTreeSnapshot_exports = {};
  __export(domTreeSnapshot_exports, {
    snapshotTree: () => snapshotTree
  });

  // browser/mirror/projection/models/elementNs.ts
  var ELEMENT_NS_HTML = "http://www.w3.org/1999/xhtml";
  var ELEMENT_NS_SVG = "http://www.w3.org/2000/svg";
  var ELEMENT_NS_MATHML = "http://www.w3.org/1998/Math/MathML";
  function classifyElementNs(namespaceURI) {
    if (namespaceURI === null) return { ns: 3 /* None */ };
    if (namespaceURI === ELEMENT_NS_HTML) return { ns: 0 /* Html */ };
    if (namespaceURI === ELEMENT_NS_SVG) return { ns: 1 /* Svg */ };
    if (namespaceURI === ELEMENT_NS_MATHML) return { ns: 2 /* Mathml */ };
    return { ns: 4 /* Custom */, uri: namespaceURI };
  }
  function elementNsSnapshotLabel(namespaceURI) {
    const { ns, uri } = classifyElementNs(namespaceURI);
    switch (ns) {
      case 0 /* Html */:
        return void 0;
      case 1 /* Svg */:
        return "svg";
      case 2 /* Mathml */:
        return "mathml";
      case 3 /* None */:
        return "none";
      case 4 /* Custom */:
        return uri;
    }
  }

  // browser/mirror/projection/client/domTreeSnapshot.ts
  function snapshotTree(root) {
    return walkNode(root ?? document);
  }
  function walkNode(node) {
    switch (node.nodeType) {
      case 9:
        return { tag: "#document", children: mapChildren(node) };
      case 10: {
        const dt = node;
        return { tag: "#doctype", text: dt.name };
      }
      case 1: {
        const el = node;
        const attrs = [];
        const host = el.contentWindow != null;
        for (let i = 0; i < el.attributes.length; i++) {
          const a = el.attributes[i];
          if (host && (a.name === "src" || a.name === "srcdoc")) continue;
          attrs.push([a.name, a.value]);
        }
        attrs.sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
        const result = { tag: el.tagName.toLowerCase() };
        const ns = elementNsSnapshotLabel(el.namespaceURI);
        if (ns !== void 0) result.ns = ns;
        if (attrs.length > 0) result.attrs = attrs;
        const children = mapChildren(node);
        if (children.length > 0) result.children = children;
        const sr = el.shadowRoot;
        if (sr !== null && sr.mode === "open" && sr.slotAssignment !== "manual") {
          const shadowKids = mapChildren(sr);
          result.shadow = { tag: "#shadow-root", ...shadowKids.length > 0 ? { children: shadowKids } : {} };
        }
        if (host) {
          try {
            const iframe = el;
            const win = iframe.contentWindow;
            if (win) result.frameHref = win.location.href;
            const inner = iframe.contentDocument;
            if (inner) result.nested = walkNode(inner);
          } catch {
          }
        }
        return result;
      }
      case 3:
        return { tag: "#text", text: node.textContent ?? "" };
      case 8:
        return { tag: "#comment", text: node.textContent ?? "" };
      default:
        return { tag: `#unknown(${node.nodeType})` };
    }
  }
  function mapChildren(node) {
    const out = [];
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) out.push(walkNode(children[i]));
    return out;
  }
  return __toCommonJS(domTreeSnapshot_exports);
})();
