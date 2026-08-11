import type { NodeId } from './identity';

/**
 * §5.2 — F, the structural map. Publish rules only: placeholder rewrite,
 * the attribute deny-list, and the §5.2.1 node-state schema. Producing an
 * `FNode` from a real DOM element is the caller's job (observe/frame glue,
 * wired later) — this module has no DOM dependency so it stays unit-testable
 * without a `window`.
 */

export type FElementAttrs = Record<string, string>;

export type FElementNode = {
  kind: 'element';
  id: NodeId;
  tag: string;
  attrs: FElementAttrs;
  /** Full F-visible children, in order. Empty for placeholder interiors (T13) other than `iframe`. */
  children: FNode[];
};

export type FTextNode = {
  kind: 'text';
  id: NodeId;
  value: string;
};

export type FCommentNode = {
  kind: 'comment';
  id: NodeId;
  value: string;
};

/** §5.2.1 / §5.4.1 — a `patch` carries this shape: no children, ever. */
export type FNodeShallow =
  | { kind: 'element'; id: NodeId; tag: string; attrs: FElementAttrs }
  | FTextNode
  | FCommentNode;

export type FNode = FElementNode | FTextNode | FCommentNode;

export function toShallow(node: FNode): FNodeShallow {
  if (node.kind !== 'element') return node;
  return { kind: 'element', id: node.id, tag: node.tag, attrs: node.attrs };
}

// ---------------------------------------------------------------- §5.2.2 placeholders

/** T13, extended per §5.2.2: `iframe` is a placeholder host whose interior is the pierced document. */
export const PLACEHOLDER_TAGS: ReadonlySet<string> = new Set([
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
const PLACEHOLDER_WITH_INTERIOR: ReadonlySet<string> = new Set(['iframe']);

export function isPlaceholderTag(tag: string): boolean {
  return PLACEHOLDER_TAGS.has(tag.toLowerCase());
}

/** Attribute stamped on a placeholder host so the client knows the original tag. */
export const PROJECTED_TAG_ATTR = 'speculum-projected-tag';
export const SHADOW_ROOT_ATTR = 'speculum-shadow-root';
export const SHADOW_CLOSED_ATTR = 'speculum-shadow-closed';
export const IFRAME_HOST_ATTR = 'speculum-iframe';

// ---------------------------------------------------------------- §5.2.3 attribute deny-list

const ATTR_DENY_EXACT: ReadonlySet<string> = new Set(['integrity']);

/** Attributes whose value is a URL that may legitimately carry `javascript:`. */
const URL_BEARING_ATTRS: ReadonlySet<string> = new Set([
  'href',
  'src',
  'xlink:href',
  'poster',
  'action',
  'formaction',
  'data-src',
]);

function isEventHandlerAttr(name: string): boolean {
  return name.toLowerCase().startsWith('on');
}

function isJavascriptUrl(value: string): boolean {
  return /^\s*javascript:/i.test(value);
}

export function isDeniedAttrName(name: string): boolean {
  const n = name.toLowerCase();
  return isEventHandlerAttr(n) || ATTR_DENY_EXACT.has(n);
}

/** §5.2.3 — deny-list attrs, dropping `javascript:` URLs on the attributes that carry one. */
export function stripDeniedAttrs(attrs: Iterable<readonly [string, string]>): FElementAttrs {
  const out: FElementAttrs = {};
  for (const [name, value] of attrs) {
    if (isDeniedAttrName(name)) continue;
    if (URL_BEARING_ATTRS.has(name.toLowerCase()) && isJavascriptUrl(value)) continue;
    out[name] = value;
  }
  return out;
}

// ---------------------------------------------------------------- §5.2.1 node state schema

/** Keys of the §5.2.1 table — the only state that rides in F with no backing DOM attribute. */
export const STATE_ATTR_KEYS = {
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
} as const;

export type StateAttrKey = keyof typeof STATE_ATTR_KEYS;
export type StateAttrValues = Partial<Record<StateAttrKey, string>>;

function applyStateAttrs(attrs: FElementAttrs, state: StateAttrValues | undefined): void {
  if (!state) return;
  for (const key of Object.keys(state) as StateAttrKey[]) {
    const value = state[key];
    if (value !== undefined) attrs[STATE_ATTR_KEYS[key]] = value;
  }
}

// ---------------------------------------------------------------- snapshot builders

export type PublishElementInput = {
  id: NodeId;
  /** Raw tag name, any case. */
  rawTag: string;
  rawAttrs: Iterable<readonly [string, string]>;
  /** Full F-visible children (already published/snapshotted by the caller). */
  children: FNode[];
  shadowRoot?: boolean;
  shadowClosed?: boolean;
  iframeHost?: boolean;
  state?: StateAttrValues;
};

/** §5.2 — builds one element's F snapshot: placeholder rewrite, deny-list, boundary + state stamps. */
export function publishElementSnapshot(input: PublishElementInput): FElementNode {
  const tagLower = input.rawTag.toLowerCase();
  const placeholder = isPlaceholderTag(tagLower);
  const attrs = stripDeniedAttrs(input.rawAttrs);

  if (placeholder) attrs[PROJECTED_TAG_ATTR] = tagLower;
  if (input.shadowRoot) {
    attrs[SHADOW_ROOT_ATTR] = 'true';
    if (input.shadowClosed) attrs[SHADOW_CLOSED_ATTR] = 'true';
  }
  if (input.iframeHost) attrs[IFRAME_HOST_ATTR] = 'true';
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

export function publishTextSnapshot(id: NodeId, value: string): FTextNode {
  return { kind: 'text', id, value };
}

export function publishCommentSnapshot(id: NodeId, value: string): FCommentNode {
  return { kind: 'comment', id, value };
}

// ---------------------------------------------------------------- §5.2.6 document-level state

export type DocumentState = {
  title: string;
  lang: string | null;
  dir: string | null;
  /** `<meta name="viewport">` content, or null when absent. */
  viewportContent: string | null;
};

export type DocumentLike = {
  title: string;
  documentElementLang: string | null;
  documentElementDir: string | null;
  viewportMetaContent: string | null;
};

/** §5.2.6 — `<title>`, `lang`, `dir` and `meta[viewport]` MUST be published; omission is a K4 failure. */
export function extractDocumentState(doc: DocumentLike): DocumentState {
  return {
    title: doc.title ?? '',
    lang: doc.documentElementLang ?? null,
    dir: doc.documentElementDir ?? null,
    viewportContent: doc.viewportMetaContent ?? null,
  };
}

// ---------------------------------------------------------------- §5.2.4 URL rewrite policy

/** Policy constants only — rewrite execution lives in `node/rewrite.ts` (Node-side, per session). */
export const VIRTUAL_ASSETS_PREFIX = '/w7s/virtual-assets/';
export const VIRTUAL_BLOB_PREFIX = '/w7s/virtual-blob/';
export const VIRTUAL_DATA_PREFIX = '/w7s/virtual-data/';

/** Attributes that carry a URL and MUST be rewritten (§5.2.4). */
export const URL_REWRITE_ATTRS: ReadonlySet<string> = new Set([
  'src',
  'href',
  'xlink:href',
  'data-src',
  'poster',
  'srcset',
  'imagesrcset',
]);
