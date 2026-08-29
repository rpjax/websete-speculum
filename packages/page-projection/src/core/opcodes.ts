/**
 * docs/page-projection/spec/frame-protocol.md §3–§4 — shipped ISA (lacre 2026-08-20).
 * Values are wire-stable: never renumber, only append into reserved ranges.
 * Source of truth for §4 opcode list. Strings ship in the frame header `strings` block, not as ops.
 */

export enum OpCode {
  Check = 0x01,
  // 0x02 free/reserved — was EPOCH_RESET, retired with `initContext` (runtime-redesign.md §7).
  // A generation change is stated by the frame header alone; the client rebuilds its applier.
  // 0x03–0x1F reserved (control range; no STR_DEF opcode — strings are header-local)

  NodeNew = 0x20,
  NodeDrop = 0x21,

  Insert = 0x40,
  Remove = 0x41,

  AttrSet = 0x60,
  AttrDel = 0x61,
  TextSet = 0x62,
  PropSet = 0x63,

  SheetNew = 0xa0,
  SheetDrop = 0xa1,
  SheetOrder = 0xa2,
  RuleNew = 0xa3,
  RuleDrop = 0xa4,
  RuleSet = 0xa5,
}

const NAMES: Readonly<Partial<Record<OpCode, string>>> = {
  [OpCode.Check]: 'check',
  [OpCode.NodeNew]: 'nodeNew',
  [OpCode.NodeDrop]: 'nodeDrop',
  [OpCode.Insert]: 'insert',
  [OpCode.Remove]: 'remove',
  [OpCode.AttrSet]: 'attrSet',
  [OpCode.AttrDel]: 'attrDel',
  [OpCode.TextSet]: 'textSet',
  [OpCode.PropSet]: 'propSet',
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
  ShadowRoot = 7,
}
