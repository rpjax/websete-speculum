/**
 * §5.4 — one opcode space covers both planes; there is no `plane` header
 * field because a single frame may carry Dom and Cssom operations together
 * (Q19). Values are wire-stable: never renumber, only append.
 */
export enum OpCode {
  EstablishBegin = 1,
  EstablishChunk = 2,
  EstablishEnd = 3,
  ChildList = 4,
  Patch = 5,
  ScrollViewport = 6,
  ScrollElement = 7,
  CssomInstall = 8,
  CssomSheetList = 9,
  CssomRuleList = 10,
  CssomPatch = 11,
  /** §5.2.6 — title/lang/dir/meta[viewport]. Appended out of plane order; never renumber. */
  DocumentState = 12,
}

const NAMES: Readonly<Record<OpCode, string>> = {
  [OpCode.EstablishBegin]: 'establishBegin',
  [OpCode.EstablishChunk]: 'establishChunk',
  [OpCode.EstablishEnd]: 'establishEnd',
  [OpCode.ChildList]: 'childList',
  [OpCode.Patch]: 'patch',
  [OpCode.ScrollViewport]: 'scrollViewport',
  [OpCode.ScrollElement]: 'scrollElement',
  [OpCode.CssomInstall]: 'cssomInstall',
  [OpCode.CssomSheetList]: 'cssomSheetList',
  [OpCode.CssomRuleList]: 'cssomRuleList',
  [OpCode.CssomPatch]: 'cssomPatch',
  [OpCode.DocumentState]: 'documentState',
};

export function opCodeName(code: OpCode): string {
  return NAMES[code] ?? `unknown(${code})`;
}

/** Explicit membership, not a range check — `DocumentState` (12) rides in the `dom` plane despite sorting after the Cssom codes (Q19). */
const CSSOM_CODES: ReadonlySet<OpCode> = new Set([
  OpCode.CssomInstall,
  OpCode.CssomSheetList,
  OpCode.CssomRuleList,
  OpCode.CssomPatch,
]);

/** `dom` ops ride in an establish/live frame; `cssom` ops ride in either — never a `plane` header. */
export function opCodePlane(code: OpCode): 'dom' | 'cssom' {
  return CSSOM_CODES.has(code) ? 'cssom' : 'dom';
}
