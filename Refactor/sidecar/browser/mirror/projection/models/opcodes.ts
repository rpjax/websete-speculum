/**
 * docs/page-projection/spec/frame-protocol.md §3–§4 — one opcode space, table + structure + node state.
 * Values are wire-stable: never renumber, only append. Ranges match §3 exactly.
 *
 * CSSOM opcodes `0xA0–0xA5` (§4.6) are on the wire. Lab client phase 2 materializes owned
 * constructed sheets on `adoptedStyleSheets` + `CSSStyleRule` (C6); pierce still desyncs.
 * `Check`/`NodeDrop` are used. OPEN-2 deferred GC still applies to DOM rows.
 */

export enum OpCode {
  Check = 0x01,
  EpochReset = 0x02,
  StrDef = 0x03,

  NodeNew = 0x20,
  NodeDrop = 0x21,

  Insert = 0x40,
  Remove = 0x41,

  AttrSet = 0x60,
  AttrDel = 0x61,
  TextSet = 0x62,

  SheetNew = 0xa0,
  SheetDrop = 0xa1,
  SheetOrder = 0xa2,
  RuleNew = 0xa3,
  RuleDrop = 0xa4,
  RuleSet = 0xa5,
}

const NAMES: Readonly<Partial<Record<OpCode, string>>> = {
  [OpCode.Check]: 'check',
  [OpCode.EpochReset]: 'epochReset',
  [OpCode.StrDef]: 'strDef',
  [OpCode.NodeNew]: 'nodeNew',
  [OpCode.NodeDrop]: 'nodeDrop',
  [OpCode.Insert]: 'insert',
  [OpCode.Remove]: 'remove',
  [OpCode.AttrSet]: 'attrSet',
  [OpCode.AttrDel]: 'attrDel',
  [OpCode.TextSet]: 'textSet',
  [OpCode.SheetNew]: 'sheetNew',
  [OpCode.SheetDrop]: 'sheetDrop',
  [OpCode.SheetOrder]: 'sheetOrder',
  [OpCode.RuleNew]: 'ruleNew',
  [OpCode.RuleDrop]: 'ruleDrop',
  [OpCode.RuleSet]: 'ruleSet',
};

export function opCodeName(code: OpCode): string {
  return NAMES[code] ?? `unknown(${code})`;
}

/** §1.3 node row `kind`. Sheet/Rule are table rows (phase 1); owned CSSOM apply is C6. */
export enum NodeKind {
  Element = 1,
  Text = 2,
  Comment = 3,
  Sheet = 4,
  Rule = 5,
  Doctype = 6,
}
