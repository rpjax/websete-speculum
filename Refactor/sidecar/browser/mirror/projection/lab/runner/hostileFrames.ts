/**
 * Hostile frames for lab injectFrame — producer-honest path never emits these.
 * Client relay only (not Virtual, not chassis nodeTable).
 */

import { BinaryFrameEncoder } from '../../virtual/frame/binaryFrameEncoder';
import {
  CHECK_SCOPE_TABLE,
  CSSOM_SCOPE_MAIN,
  DOCUMENT_ID,
  INSERT_AT_END,
  createFrame,
  type FrameOp,
} from '../../models/frame';
import { NodeKind, OpCode } from '../../models/opcodes';

export type HostileKind = 'attr' | 'ruleset' | 'eof';

/** High ids — well above a typical lab document allocator. */
const ATTR_NODE_ID = 199_991;
const SHEET_ID = 199_980;
const RULE_ID = 199_981;

function encodeOps(args: {
  generation: number;
  sequence: number;
  preTableHash: bigint;
  ops: FrameOp[];
}): Uint8Array {
  const frame = createFrame({
    generation: args.generation,
    sequence: args.sequence,
    ops: args.ops,
    preTableHash: args.preTableHash,
    resync: false,
  });
  const parts = new BinaryFrameEncoder().encode(frame);
  if (parts.length !== 1) {
    throw new Error(`hostile frame split into ${parts.length} parts`);
  }
  return parts[0]!;
}

/** NODE_NEW Element with an invalid attribute name — setAttribute throws (SEAL-DOM-P0-ATTR). */
export function encodeAttrDesyncFrame(generation: number, sequence: number, preTableHash: bigint): Uint8Array {
  return encodeOps({
    generation,
    sequence,
    preTableHash,
    ops: [
      {
        op: OpCode.NodeNew,
        id: ATTR_NODE_ID,
        kind: NodeKind.Element,
        name: 'div',
        attrs: [{ name: 'foo bar', value: 'x' }],
      },
    ],
  });
}

/** SHEET_NEW + RULE_NEW @media + RULE_SET on that grouping id (SEAL-CSSOM-P0-RULESET). */
export function encodeRulesetDesyncFrame(generation: number, sequence: number, preTableHash: bigint): Uint8Array {
  return encodeOps({
    generation,
    sequence,
    preTableHash,
    ops: [
      {
        op: OpCode.SheetNew,
        id: SHEET_ID,
        scope: CSSOM_SCOPE_MAIN,
        hostNode: DOCUMENT_ID,
        before: INSERT_AT_END,
      },
      {
        op: OpCode.RuleNew,
        sheet: SHEET_ID,
        id: RULE_ID,
        before: INSERT_AT_END,
        text: '@media all{.x{color:red}}',
      },
      {
        op: OpCode.RuleSet,
        id: RULE_ID,
        text: '@media all{.x{color:navy}}',
      },
    ],
  });
}

/** Honest constructed sheet+rule so EOF has a live handle to tamper against. */
export function encodeEofSetupFrame(generation: number, sequence: number, preTableHash: bigint): Uint8Array {
  return encodeOps({
    generation,
    sequence,
    preTableHash,
    ops: [
      {
        op: OpCode.SheetNew,
        id: SHEET_ID,
        scope: CSSOM_SCOPE_MAIN,
        hostNode: DOCUMENT_ID,
        before: INSERT_AT_END,
      },
      {
        op: OpCode.RuleNew,
        sheet: SHEET_ID,
        id: RULE_ID,
        before: INSERT_AT_END,
        text: '.lab-eof{color:red}',
      },
    ],
  });
}

/** CHECK-only — table unchanged; EOF verify runs after a live ghost rule (SEAL-CSSOM-P0-EOF). */
export function encodeEofCheckFrame(generation: number, sequence: number, tableHash: bigint): Uint8Array {
  return encodeOps({
    generation,
    sequence,
    preTableHash: tableHash,
    ops: [
      {
        op: OpCode.Check,
        scope: CHECK_SCOPE_TABLE,
        lo: 0,
        hi: 0,
        hash: tableHash,
      },
    ],
  });
}
