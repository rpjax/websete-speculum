"use strict";
/**
 * NODE_NEW Element namespace — frame-protocol.md §1.3 / §4.2.
 * Known values are a u8 on the wire; `custom` is the only case that carries a StrRef.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ELEMENT_NS_MATHML = exports.ELEMENT_NS_SVG = exports.ELEMENT_NS_HTML = exports.ElementNs = void 0;
exports.classifyElementNs = classifyElementNs;
exports.elementNsUri = elementNsUri;
exports.elementNsSnapshotLabel = elementNsSnapshotLabel;
var ElementNs;
(function (ElementNs) {
    ElementNs[ElementNs["Html"] = 0] = "Html";
    ElementNs[ElementNs["Svg"] = 1] = "Svg";
    ElementNs[ElementNs["Mathml"] = 2] = "Mathml";
    ElementNs[ElementNs["None"] = 3] = "None";
    ElementNs[ElementNs["Custom"] = 4] = "Custom";
})(ElementNs || (exports.ElementNs = ElementNs = {}));
exports.ELEMENT_NS_HTML = 'http://www.w3.org/1999/xhtml';
exports.ELEMENT_NS_SVG = 'http://www.w3.org/2000/svg';
exports.ELEMENT_NS_MATHML = 'http://www.w3.org/1998/Math/MathML';
/** Producer: live `element.namespaceURI` → wire enum (+ uri only for custom). */
function classifyElementNs(namespaceURI) {
    if (namespaceURI === null)
        return { ns: ElementNs.None };
    if (namespaceURI === exports.ELEMENT_NS_HTML)
        return { ns: ElementNs.Html };
    if (namespaceURI === exports.ELEMENT_NS_SVG)
        return { ns: ElementNs.Svg };
    if (namespaceURI === exports.ELEMENT_NS_MATHML)
        return { ns: ElementNs.Mathml };
    return { ns: ElementNs.Custom, uri: namespaceURI };
}
/** Client: wire enum → `createElementNS` first argument. */
function elementNsUri(ns, customUri) {
    switch (ns) {
        case ElementNs.Html:
            return exports.ELEMENT_NS_HTML;
        case ElementNs.Svg:
            return exports.ELEMENT_NS_SVG;
        case ElementNs.Mathml:
            return exports.ELEMENT_NS_MATHML;
        case ElementNs.None:
            return null;
        case ElementNs.Custom:
            return customUri ?? '';
    }
}
/** Snapshot / iso label: omit html; `svg` / `mathml` / `none` / custom URI otherwise. */
function elementNsSnapshotLabel(namespaceURI) {
    const { ns, uri } = classifyElementNs(namespaceURI);
    switch (ns) {
        case ElementNs.Html:
            return undefined;
        case ElementNs.Svg:
            return 'svg';
        case ElementNs.Mathml:
            return 'mathml';
        case ElementNs.None:
            return 'none';
        case ElementNs.Custom:
            return uri;
    }
}
//# sourceMappingURL=elementNs.js.map