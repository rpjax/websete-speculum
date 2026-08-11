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
};

export function opCodeName(code: OpCode): string {
  return NAMES[code] ?? `unknown(${code})`;
}

/** `dom` ops ride in an establish/live frame; `cssom` ops ride in either — never a `plane` header. */
export function opCodePlane(code: OpCode): 'dom' | 'cssom' {
  return code >= OpCode.CssomInstall ? 'cssom' : 'dom';
}
