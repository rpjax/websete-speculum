"use strict";
/**
 * The single, shared "what table effect does this op have" interpreter — frame-protocol.md §4,
 * `Table` column of each instruction. One function, imported by both the producer (right after
 * it builds a tick's `ops`, `virtual/frame/tableFrameBuilder.ts`/`resync.ts`) and the client
 * (Phase 1 of frame apply, `client/applyDom.ts`) — never two independent copies, for the same
 * reason `models/rowHash.ts` is shared: divergence between two hand-written interpretations of
 * "what INSERT does to the table" would defeat `preTableHash`/`CHECK` before they even run.
 *
 * DOM-free — operates purely on `FrameOp` data and a `ReplicatedTable`, so it is fully unit
 * -testable in plain Node (see unit.ts) without a browser, independent of whichever side (Virtual
 * producer or projected client) happens to call it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyOpToTable = applyOpToTable;
exports.applyOpsToTable = applyOpsToTable;
exports.applyFrameToTable = applyFrameToTable;
exports.applyFrameToTableChecked = applyFrameToTableChecked;
const frame_1 = require("./frame");
const limits_1 = require("./limits");
const opcodes_1 = require("./opcodes");
/**
 * `CHECK` has no table effect of its own (§4.1) — evaluation lives in
 * `evaluateCheck`/`applyFrameToTableChecked` below. `NODE_DROP` here is the **unchecked** table
 * effect only (drops the subtree unconditionally) — precondition validation (absent id ⇒
 * `malformed`/OPEN-1, attached id ⇒ `precondition`, §4.2) is `applyFrameToTableChecked`'s job,
 * since the producer's own (unchecked) use of this function only ever drops ids it just verified
 * itself (`tableFrameBuilder.ts`'s GC sweep only selects rows it can already see are detached).
 */
function applyOpToTable(table, op) {
    switch (op.op) {
        case opcodes_1.OpCode.Check:
            return;
        case opcodes_1.OpCode.EpochReset:
            table.reset();
            return;
        case opcodes_1.OpCode.StrDef:
            return;
        case opcodes_1.OpCode.NodeNew:
            if (op.kind === opcodes_1.NodeKind.Element)
                table.createElementRow(op.id, op.name, op.attrs);
            else if (op.kind === opcodes_1.NodeKind.Doctype)
                table.createLeafRow(op.id, op.kind, op.name);
            else
                table.createLeafRow(op.id, op.kind, op.value);
            return;
        case opcodes_1.OpCode.NodeDrop:
            for (let i = 0; i < op.ids.length; i++)
                table.dropSubtree(op.ids[i]);
            return;
        case opcodes_1.OpCode.Insert:
            table.insertBatch(op.parent, op.before, op.ids);
            return;
        case opcodes_1.OpCode.Remove:
            table.removeBatch(op.parent, op.ids);
            return;
        case opcodes_1.OpCode.AttrSet:
            table.setAttrs(op.node, op.attrs);
            return;
        case opcodes_1.OpCode.AttrDel:
            table.delAttrs(op.node, op.names);
            return;
        case opcodes_1.OpCode.TextSet:
            table.setValue(op.node, op.value);
            return;
        default:
            return;
    }
}
function applyOpsToTable(table, ops) {
    for (let i = 0; i < ops.length; i++)
        applyOpToTable(table, ops[i]);
}
/**
 * Frame-level entry point: a `resync`-flagged frame replaces the table wholesale (§2 flags bit1;
 * §5.8 "clears the identity map … replaces the table wholesale rather than extending it") — any
 * row not re-described by this frame's ops simply ceases to exist, with no per-id `NODE_DROP`.
 * An ordinary frame's ops apply against whatever the table already holds. `sequence` stamps
 * every row this pass touches (`ReplicatedTable.setSequence`, §1.3/§4 preamble).
 *
 * Unchecked — never evaluates `CHECK`/`NODE_DROP` preconditions and cannot fail. Used where
 * there is nothing to gate on (the producer's own phase-1-only apply, `tableFrameBuilder.ts`/
 * `resync.ts`, §6: "the real DOM already mutated, which is what the MutationObserver reported")
 * or in tests that only need the table-effect semantics. The client's real two-phase apply (§6)
 * uses `applyFrameToTableChecked`.
 */
function applyFrameToTable(table, resync, ops, sequence = 0) {
    if (resync)
        table.reset();
    table.setSequence(sequence);
    applyOpsToTable(table, ops);
}
function evaluateCheck(table, op) {
    return op.scope === frame_1.CHECK_SCOPE_RANGE ? table.hashRange(op.lo, op.hi) : table.tableHash;
}
/**
 * §6 phase 1, real two-phase apply (Stage 2, frame-protocol-production-completeness): applies
 * each op's table effect in order, evaluating `CHECK` inline against the table's state *at the
 * point it appears* (§7 ordering rule 5) instead of only at the end. Stops at the first
 * violation and reports it — the caller (`client/applyDom.ts`) is responsible for never reaching
 * phase 2 (materialize into the DOM) when this returns `ok: false` (§P3: "if phase 1 fails, the
 * DOM was never touched").
 *
 * Beyond `CHECK`, this is also where the two Stage-3 preconditions the wire-effect switch
 * (`applyOpToTable`) does not itself validate are enforced: `NODE_DROP` of an absent id
 * (`malformed`, closes OPEN-1) or an attached id (`precondition`, §4.2's own text), and
 * `NODE_NEW` that would grow the table past `MAX_ROWS` (`precondition`, §8) — both checked
 * *before* the corresponding table mutation, matching §8's "checked before any allocation".
 *
 * Ops before the failing one have already mutated `table` — not rolled back. This is
 * intentional, not a shortcut: §P3 scopes phase 1 as "pure memory, no DOM", and a table left
 * disagreeing with the producer is exactly the condition the *next* frame's `preTableHash` check
 * (or a future resync, Stage 4) is designed to catch and heal, not something this function owes
 * undo-log machinery for.
 */
function applyFrameToTableChecked(table, resync, ops, sequence = 0) {
    if (resync)
        table.reset();
    table.setSequence(sequence);
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op.op === opcodes_1.OpCode.Check) {
            const actual = evaluateCheck(table, op);
            if (actual !== op.hash) {
                return {
                    ok: false,
                    reason: 'precondition',
                    failedOpIndex: i,
                    opName: 'check',
                    scope: op.scope,
                    lo: op.lo,
                    hi: op.hi,
                    expected: op.hash,
                    actual,
                };
            }
            continue;
        }
        if (op.op === opcodes_1.OpCode.NodeDrop) {
            for (let j = 0; j < op.ids.length; j++) {
                const id = op.ids[j];
                if (!table.has(id)) {
                    return {
                        ok: false,
                        reason: 'malformed',
                        failedOpIndex: i,
                        opName: 'nodeDrop',
                        id,
                        message: 'NODE_DROP of an absent id (frame-protocol.md OPEN-1)',
                    };
                }
                if (table.getRow(id).parent !== 0) {
                    return {
                        ok: false,
                        reason: 'precondition',
                        failedOpIndex: i,
                        opName: 'nodeDrop',
                        id,
                        message: 'NODE_DROP of an attached row (frame-protocol.md §4.2)',
                    };
                }
            }
            for (let j = 0; j < op.ids.length; j++)
                table.dropSubtree(op.ids[j]);
            continue;
        }
        if (op.op === opcodes_1.OpCode.NodeNew && !table.has(op.id) && table.size >= limits_1.MAX_ROWS) {
            return {
                ok: false,
                reason: 'precondition',
                failedOpIndex: i,
                opName: 'nodeNew',
                id: op.id,
                message: `MAX_ROWS (${limits_1.MAX_ROWS}) exceeded (frame-protocol.md §8)`,
            };
        }
        applyOpToTable(table, op);
    }
    return { ok: true };
}
//# sourceMappingURL=replicatedTableApply.js.map