"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.URL_REWRITE_ATTRS = exports.VIRTUAL_DATA_PREFIX = exports.VIRTUAL_BLOB_PREFIX = exports.VIRTUAL_ASSETS_PREFIX = exports.STATE_ATTR_KEYS = exports.IFRAME_HOST_ATTR = exports.SHADOW_CLOSED_ATTR = exports.SHADOW_ROOT_ATTR = exports.PROJECTED_TAG_ATTR = exports.PLACEHOLDER_TAGS = void 0;
exports.toShallow = toShallow;
exports.isPlaceholderTag = isPlaceholderTag;
exports.isDeniedAttrName = isDeniedAttrName;
exports.stripDeniedAttrs = stripDeniedAttrs;
exports.publishElementSnapshot = publishElementSnapshot;
exports.publishTextSnapshot = publishTextSnapshot;
exports.publishCommentSnapshot = publishCommentSnapshot;
exports.extractDocumentState = extractDocumentState;
function toShallow(node) {
    if (node.kind !== 'element')
        return node;
    return { kind: 'element', id: node.id, tag: node.tag, attrs: node.attrs };
}
// ---------------------------------------------------------------- §5.2.2 placeholders
/** T13, extended per §5.2.2: `iframe` is a placeholder host whose interior is the pierced document. */
exports.PLACEHOLDER_TAGS = new Set([
    'script',
    'noscript',
    'template',
    'iframe',
    'base',
    'object',
    'embed',
    'applet',
]);
/** Only `iframe` keeps a real interior (the pierced document); the rest publish empty. */
const PLACEHOLDER_WITH_INTERIOR = new Set(['iframe']);
function isPlaceholderTag(tag) {
    return exports.PLACEHOLDER_TAGS.has(tag.toLowerCase());
}
/** Attribute stamped on a placeholder host so the client knows the original tag. */
exports.PROJECTED_TAG_ATTR = 'speculum-projected-tag';
exports.SHADOW_ROOT_ATTR = 'speculum-shadow-root';
exports.SHADOW_CLOSED_ATTR = 'speculum-shadow-closed';
exports.IFRAME_HOST_ATTR = 'speculum-iframe';
// ---------------------------------------------------------------- §5.2.3 attribute deny-list
const ATTR_DENY_EXACT = new Set(['integrity']);
/** Attributes whose value is a URL that may legitimately carry `javascript:`. */
const URL_BEARING_ATTRS = new Set([
    'href',
    'src',
    'xlink:href',
    'poster',
    'action',
    'formaction',
    'data-src',
]);
function isEventHandlerAttr(name) {
    return name.toLowerCase().startsWith('on');
}
function isJavascriptUrl(value) {
    return /^\s*javascript:/i.test(value);
}
function isDeniedAttrName(name) {
    const n = name.toLowerCase();
    return isEventHandlerAttr(n) || ATTR_DENY_EXACT.has(n);
}
/** §5.2.3 — deny-list attrs, dropping `javascript:` URLs on the attributes that carry one. */
function stripDeniedAttrs(attrs) {
    const out = {};
    for (const [name, value] of attrs) {
        if (isDeniedAttrName(name))
            continue;
        if (URL_BEARING_ATTRS.has(name.toLowerCase()) && isJavascriptUrl(value))
            continue;
        out[name] = value;
    }
    return out;
}
// ---------------------------------------------------------------- §5.2.1 node state schema
/** Keys of the §5.2.1 table — the only state that rides in F with no backing DOM attribute. */
exports.STATE_ATTR_KEYS = {
    inputValue: 'speculum-input-value',
    inputChecked: 'speculum-input-checked',
    optionSelected: 'speculum-option-selected',
    dialogModal: 'speculum-dialog-modal',
    popoverOpen: 'speculum-popover-open',
    mediaPaused: 'speculum-media-paused',
    mediaCurrentTime: 'speculum-media-current-time',
    mediaMuted: 'speculum-media-muted',
    mediaVolume: 'speculum-media-volume',
    customValidity: 'speculum-custom-validity',
};
function applyStateAttrs(attrs, state) {
    if (!state)
        return;
    for (const key of Object.keys(state)) {
        const value = state[key];
        if (value !== undefined)
            attrs[exports.STATE_ATTR_KEYS[key]] = value;
    }
}
/** §5.2 — builds one element's F snapshot: placeholder rewrite, deny-list, boundary + state stamps. */
function publishElementSnapshot(input) {
    const tagLower = input.rawTag.toLowerCase();
    const placeholder = isPlaceholderTag(tagLower);
    const attrs = stripDeniedAttrs(input.rawAttrs);
    if (placeholder)
        attrs[exports.PROJECTED_TAG_ATTR] = tagLower;
    if (input.shadowRoot) {
        attrs[exports.SHADOW_ROOT_ATTR] = 'true';
        if (input.shadowClosed)
            attrs[exports.SHADOW_CLOSED_ATTR] = 'true';
    }
    if (input.iframeHost)
        attrs[exports.IFRAME_HOST_ATTR] = 'true';
    applyStateAttrs(attrs, input.state);
    const publishInterior = !placeholder || PLACEHOLDER_WITH_INTERIOR.has(tagLower);
    return {
        kind: 'element',
        id: input.id,
        tag: placeholder ? 'div' : tagLower,
        attrs,
        children: publishInterior ? input.children : [],
    };
}
function publishTextSnapshot(id, value) {
    return { kind: 'text', id, value };
}
function publishCommentSnapshot(id, value) {
    return { kind: 'comment', id, value };
}
/** §5.2.6 — `<title>`, `lang`, `dir` and `meta[viewport]` MUST be published; omission is a K4 failure. */
function extractDocumentState(doc) {
    return {
        title: doc.title ?? '',
        lang: doc.documentElementLang ?? null,
        dir: doc.documentElementDir ?? null,
        viewportContent: doc.viewportMetaContent ?? null,
    };
}
// ---------------------------------------------------------------- §5.2.4 URL rewrite policy
/** Policy constants only — rewrite execution lives in `node/rewrite.ts` (Node-side, per session). */
exports.VIRTUAL_ASSETS_PREFIX = '/w7s/virtual-assets/';
exports.VIRTUAL_BLOB_PREFIX = '/w7s/virtual-blob/';
exports.VIRTUAL_DATA_PREFIX = '/w7s/virtual-data/';
/** Attributes that carry a URL and MUST be rewritten (§5.2.4). */
exports.URL_REWRITE_ATTRS = new Set([
    'src',
    'href',
    'xlink:href',
    'data-src',
    'poster',
    'srcset',
    'imagesrcset',
]);
//# sourceMappingURL=fmap.js.map