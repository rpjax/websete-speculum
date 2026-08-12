/**
 * Wire constants shared with the sidecar producer.
 * docs/page-projection-engine-redesign.md §5.4 (op vocabulary) and §5.5 (wire format).
 *
 * One opcode space covers both the Dom and Cssom planes — a frame carries no
 * `plane` header field (Q19); the opcode alone disambiguates.
 */
export const PageProjectionOp = {
  establishBegin: 1,
  establishChunk: 2,
  establishEnd: 3,
  childList: 4,
  patch: 5,
  scrollViewport: 6,
  scrollElement: 7,
  cssomInstall: 8,
  cssomSheetList: 9,
  cssomRuleList: 10,
  cssomPatch: 11,
  /** §5.2.6 — title/lang/dir/meta[viewport]. Rides in the `dom` plane despite sorting after the Cssom codes. */
  documentState: 12,
} as const

export type PageProjectionOpCode = (typeof PageProjectionOp)[keyof typeof PageProjectionOp]

/** Frame header magic (ASCII 'PP') — §5.5. */
export const PAGE_PROJECTION_MAGIC = 0x5050

/** Current wire version. An unknown version on decode is always a desync (§5.7.1), never best-effort parse. */
export const PAGE_PROJECTION_VERSION = 1

/** Frame header `flags` bit layout — §5.5. */
export const PageProjectionFrameFlag = {
  Establish: 0b01,
  Resync: 0b10,
} as const

/** `Node.kind` byte — §5.5 preorder self-delimiting node encoding. */
export const PageProjectionNodeKind = {
  Element: 1,
  Text: 2,
  Comment: 3,
} as const

/** `childList` payload `mode` byte — §5.4.2. */
export const PageProjectionChildListMode = {
  Full: 0,
  Append: 1,
} as const

/** `childList` `ChildRef` discriminator byte — §5.4.2 (`existing { id }` | `fresh { node }`). */
export const PageProjectionChildRefKind = {
  Existing: 0,
  Fresh: 1,
} as const

/** Cssom sheet `scope.kind` byte — §5.10, C7 (`main` | `pierceHost`). */
export const PageProjectionCssomScope = {
  Main: 0,
  PierceHost: 1,
} as const
