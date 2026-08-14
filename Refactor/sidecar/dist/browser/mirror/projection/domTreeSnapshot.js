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
        for (let i = 0; i < el.attributes.length; i++) {
          const a = el.attributes[i];
          attrs.push([a.name, a.value]);
        }
        attrs.sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
        const result = { tag: el.tagName.toLowerCase() };
        if (attrs.length > 0) result.attrs = attrs;
        const children = mapChildren(node);
        if (children.length > 0) result.children = children;
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
