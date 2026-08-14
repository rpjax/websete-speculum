/**
 * docs/page-projection/spec/frame-protocol.md §3–§4 — one opcode space, table + structure + node state.
 * Values are wire-stable: never renumber, only append. Ranges match §3 exactly.
 *
 * v0 scope (this lab increment): DOM only. `Check`/`NodeDrop`/`NodeMeta` are defined for wire
 * completeness but the v0 producer never emits them and the v0 client never requires them —
 * see frame-protocol.md OPEN-2 (deferred GC) and the resync section (§5.8, not implemented yet).
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
};

export function opCodeName(code: OpCode): string {
  return NAMES[code] ?? `unknown(${code})`;
}

/** §1.3 node row `kind`. `Sheet`/`Rule` reserved — not projected by the v0 (DOM-only) producer. */
export enum NodeKind {
  Element = 1,
  Text = 2,
  Comment = 3,
  Sheet = 4,
  Rule = 5,
  Doctype = 6,
}
