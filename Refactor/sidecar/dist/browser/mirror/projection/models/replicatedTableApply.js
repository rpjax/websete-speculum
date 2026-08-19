"use strict";
/**
 * The single, shared "what table effect does this op have" interpreter — frame-protocol.md §4,
 * `Table` column of each instruction. One function, imported by both the producer (right after
 * it builds a tick's `ops`, `virtual/dom/tableFrameBuilder.ts` / `virtual/dom/domResync.ts`) and the client
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
                table.createElementRow(op.id, op.name, op.attrs, op.ns, op.uri);
            else if (op.kind === opcodes_1.NodeKind.Doctype)
                table.createLeafRow(op.id, op.kind, op.name);
            else if (op.kind === opcodes_1.NodeKind.ShadowRoot)
                table.createShadowRootRow(op.id, op.host, op.mode, op.initFlags);
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
        case opcodes_1.OpCode.PropSet:
            table.setProp(op.node, op.propId, op.value);
            return;
        case opcodes_1.OpCode.SheetNew: {
            const parent = op.hostNode === 0 ? frame_1.DOCUMENT_ID : op.hostNode;
            if (!table.has(op.id))
                table.createLeafRow(op.id, opcodes_1.NodeKind.Sheet, '');
            table.insertBatch(parent, op.before, [op.id]);
            return;
        }
        case opcodes_1.OpCode.SheetDrop:
            for (let i = 0; i < op.ids.length; i++) {
                const id = op.ids[i];
                const row = table.getRow(id);
                if (row !== undefined && row.parent !== 0)
                    table.removeBatch(row.parent, [id]);
                table.dropSubtree(id);
            }
            return;
        case opcodes_1.OpCode.SheetOrder:
            if (op.ids.length === 0)
                return;
            {
                const first = table.getRow(op.ids[0]);
                const parent = first === undefined || first.parent === 0 ? frame_1.DOCUMENT_ID : first.parent;
                table.removeBatch(parent, op.ids);
                table.insertBatch(parent, 0, op.ids);
            }
            return;
        case opcodes_1.OpCode.RuleNew:
            if (!table.has(op.id))
                table.createLeafRow(op.id, opcodes_1.NodeKind.Rule, op.text);
            else
                table.setValue(op.id, op.text);
            table.insertBatch(op.sheet, op.before, [op.id]);
            return;
        case opcodes_1.OpCode.RuleDrop:
            for (let i = 0; i < op.ids.length; i++) {
                const id = op.ids[i];
                const row = table.getRow(id);
                if (row !== undefined && row.parent !== 0)
                    table.removeBatch(row.parent, [id]);
                table.dropSubtree(id);
            }
            return;
        case opcodes_1.OpCode.RuleSet:
            table.setValue(op.id, op.text);
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
function failOp(i, reason, opName, id, message) {
    return { ok: false, reason, failedOpIndex: i, opName, id, message };
}
function addressExists(table, id) {
    return id === frame_1.DOCUMENT_ID || table.has(id);
}
/** §4.3 INSERT parent: Document id 1, ELEMENT, or SHADOW_ROOT. */
function isInsertParent(table, parent) {
    if (parent === frame_1.DOCUMENT_ID)
        return true;
    const row = table.getRow(parent);
    return row !== undefined && (row.kind === opcodes_1.NodeKind.Element || row.kind === opcodes_1.NodeKind.ShadowRoot);
}
function isShadowRootId(table, id) {
    return table.getRow(id)?.kind === opcodes_1.NodeKind.ShadowRoot;
}
/** True when `id` is `ofId` or an ancestor of `ofId` (cycle prevention for INSERT). */
function isSelfOrAncestorOf(table, id, ofId) {
    if (id === ofId)
        return true;
    let cur = ofId;
    const seen = new Set();
    while (cur !== 0 && cur !== frame_1.DOCUMENT_ID) {
        if (seen.has(cur))
            return false;
        seen.add(cur);
        const row = table.getRow(cur);
        if (row === undefined)
            return false;
        if (row.parent === id)
            return true;
        cur = row.parent;
    }
    return false;
}
/**
 * §4 Pre for structural / node-state / CSSOM ops — checked before `applyOpToTable` so a
 * precondition/`malformed` frame never mutates the table for the failing op (§6 validate then
 * materialize). `CHECK` / `NODE_DROP` / `MAX_ROWS` stay in the main loop.
 */
function validateOpPre(table, op, i) {
    switch (op.op) {
        case opcodes_1.OpCode.NodeNew: {
            if (op.kind !== opcodes_1.NodeKind.ShadowRoot)
                return null;
            if (op.mode !== frame_1.SHADOW_MODE_OPEN) {
                return failOp(i, 'malformed', 'nodeNew', op.id, 'NODE_NEW SHADOW_ROOT mode must be 0 (open) (frame-protocol.md §4.2)');
            }
            if ((op.initFlags & ~frame_1.SHADOW_INIT_FLAGS_MASK) !== 0) {
                return failOp(i, 'malformed', 'nodeNew', op.id, 'NODE_NEW SHADOW_ROOT reserved initFlags (frame-protocol.md §4.2)');
            }
            const host = table.getRow(op.host);
            if (host === undefined || host.kind !== opcodes_1.NodeKind.Element) {
                return failOp(i, 'precondition', 'nodeNew', op.host, 'NODE_NEW SHADOW_ROOT host missing or not ELEMENT (frame-protocol.md §4.2)');
            }
            if (table.shadowRootOf(op.host) !== 0) {
                return failOp(i, 'malformed', 'nodeNew', op.id, 'NODE_NEW SHADOW_ROOT host already owns a root (frame-protocol.md §4.2)');
            }
            return null;
        }
        case opcodes_1.OpCode.Insert: {
            if (op.ids.length > limits_1.MAX_CHILDREN_PER_OP) {
                return failOp(i, 'malformed', 'insert', op.parent, `INSERT count > MAX_CHILDREN_PER_OP (${limits_1.MAX_CHILDREN_PER_OP}) (frame-protocol.md §4.3)`);
            }
            if (!isInsertParent(table, op.parent)) {
                return failOp(i, 'precondition', 'insert', op.parent, 'INSERT parent missing or not ELEMENT/SHADOW_ROOT/Document (frame-protocol.md §4.3)');
            }
            if (op.before !== 0) {
                const beforeRow = table.getRow(op.before);
                if (beforeRow === undefined || beforeRow.parent !== op.parent) {
                    return failOp(i, 'precondition', 'insert', op.before, 'INSERT before must be 0 or a child of parent (frame-protocol.md §4.3)');
                }
            }
            const seen = new Set();
            for (let j = 0; j < op.ids.length; j++) {
                const id = op.ids[j];
                if (seen.has(id)) {
                    return failOp(i, 'malformed', 'insert', id, 'INSERT ids must be distinct (frame-protocol.md §4.3)');
                }
                seen.add(id);
                if (!table.has(id)) {
                    return failOp(i, 'precondition', 'insert', id, 'INSERT id missing (frame-protocol.md §4.3)');
                }
                if (isShadowRootId(table, id)) {
                    return failOp(i, 'precondition', 'insert', id, 'INSERT of a SHADOW_ROOT id (frame-protocol.md §4.3)');
                }
                if (isSelfOrAncestorOf(table, id, op.parent)) {
                    return failOp(i, 'precondition', 'insert', id, 'INSERT would create a cycle (frame-protocol.md §4.3)');
                }
            }
            return null;
        }
        case opcodes_1.OpCode.Remove: {
            if (op.ids.length > limits_1.MAX_CHILDREN_PER_OP) {
                return failOp(i, 'malformed', 'remove', op.parent, `REMOVE count > MAX_CHILDREN_PER_OP (${limits_1.MAX_CHILDREN_PER_OP}) (frame-protocol.md §4.3)`);
            }
            if (!addressExists(table, op.parent)) {
                return failOp(i, 'precondition', 'remove', op.parent, 'REMOVE parent missing (frame-protocol.md §4.3)');
            }
            for (let j = 0; j < op.ids.length; j++) {
                const id = op.ids[j];
                const row = table.getRow(id);
                if (row === undefined) {
                    return failOp(i, 'precondition', 'remove', id, 'REMOVE id missing (frame-protocol.md §4.3)');
                }
                if (row.parent !== op.parent) {
                    return failOp(i, 'precondition', 'remove', id, 'REMOVE id parent mismatch (frame-protocol.md §4.3)');
                }
                if (row.kind === opcodes_1.NodeKind.ShadowRoot) {
                    return failOp(i, 'precondition', 'remove', id, 'REMOVE of a SHADOW_ROOT id (frame-protocol.md §4.3)');
                }
            }
            return null;
        }
        case opcodes_1.OpCode.AttrSet: {
            const row = table.getRow(op.node);
            if (row === undefined || row.kind !== opcodes_1.NodeKind.Element) {
                return failOp(i, 'precondition', 'attrSet', op.node, 'ATTR_SET requires an ELEMENT row (frame-protocol.md §4.4)');
            }
            return null;
        }
        case opcodes_1.OpCode.AttrDel: {
            const row = table.getRow(op.node);
            if (row === undefined || row.kind !== opcodes_1.NodeKind.Element) {
                return failOp(i, 'precondition', 'attrDel', op.node, 'ATTR_DEL requires an ELEMENT row (frame-protocol.md §4.4)');
            }
            return null;
        }
        case opcodes_1.OpCode.TextSet: {
            const row = table.getRow(op.node);
            if (row === undefined ||
                (row.kind !== opcodes_1.NodeKind.Text && row.kind !== opcodes_1.NodeKind.Comment)) {
                return failOp(i, 'precondition', 'textSet', op.node, 'TEXT_SET requires TEXT or COMMENT (frame-protocol.md §4.4)');
            }
            return null;
        }
        case opcodes_1.OpCode.PropSet: {
            const row = table.getRow(op.node);
            if (row === undefined || row.kind !== opcodes_1.NodeKind.Element) {
                return failOp(i, 'precondition', 'propSet', op.node, 'PROP_SET requires an ELEMENT row (frame-protocol.md §4.4)');
            }
            return null;
        }
        case opcodes_1.OpCode.SheetNew: {
            if (table.has(op.id) && table.getRow(op.id).kind !== opcodes_1.NodeKind.Sheet) {
                return failOp(i, 'malformed', 'sheetNew', op.id, 'SHEET_NEW id exists with a non-SHEET kind (frame-protocol.md §4.6)');
            }
            if (op.scope === frame_1.CSSOM_SCOPE_PIERCE_HOST && !addressExists(table, op.hostNode)) {
                return failOp(i, 'precondition', 'sheetNew', op.hostNode, 'SHEET_NEW PIERCE_HOST hostNode missing (frame-protocol.md §4.6)');
            }
            const parent = op.hostNode === 0 ? frame_1.DOCUMENT_ID : op.hostNode;
            if (op.before !== 0) {
                const beforeRow = table.getRow(op.before);
                if (beforeRow === undefined || beforeRow.parent !== parent) {
                    return failOp(i, 'precondition', 'sheetNew', op.before, 'SHEET_NEW before must be 0 or a child of the sheet parent (frame-protocol.md §4.6)');
                }
            }
            return null;
        }
        case opcodes_1.OpCode.SheetDrop: {
            for (let j = 0; j < op.ids.length; j++) {
                const id = op.ids[j];
                const row = table.getRow(id);
                if (row === undefined || row.kind !== opcodes_1.NodeKind.Sheet) {
                    return failOp(i, 'precondition', 'sheetDrop', id, 'SHEET_DROP requires SHEET ids (frame-protocol.md §4.6)');
                }
            }
            return null;
        }
        case opcodes_1.OpCode.SheetOrder: {
            for (let j = 0; j < op.ids.length; j++) {
                const id = op.ids[j];
                const row = table.getRow(id);
                if (row === undefined || row.kind !== opcodes_1.NodeKind.Sheet) {
                    return failOp(i, 'precondition', 'sheetOrder', id, 'SHEET_ORDER requires SHEET ids (frame-protocol.md §4.6)');
                }
            }
            return null;
        }
        case opcodes_1.OpCode.RuleNew: {
            const sheet = table.getRow(op.sheet);
            if (sheet === undefined || sheet.kind !== opcodes_1.NodeKind.Sheet) {
                return failOp(i, 'precondition', 'ruleNew', op.sheet, 'RULE_NEW sheet missing or not SHEET (frame-protocol.md §4.6)');
            }
            if (table.has(op.id) && table.getRow(op.id).kind !== opcodes_1.NodeKind.Rule) {
                return failOp(i, 'malformed', 'ruleNew', op.id, 'RULE_NEW id exists with a non-RULE kind (frame-protocol.md §4.6)');
            }
            if (op.before !== 0) {
                const beforeRow = table.getRow(op.before);
                if (beforeRow === undefined ||
                    beforeRow.kind !== opcodes_1.NodeKind.Rule ||
                    beforeRow.parent !== op.sheet) {
                    return failOp(i, 'precondition', 'ruleNew', op.before, 'RULE_NEW before must be 0 or a rule of that sheet (frame-protocol.md §4.6)');
                }
            }
            return null;
        }
        case opcodes_1.OpCode.RuleDrop: {
            for (let j = 0; j < op.ids.length; j++) {
                const id = op.ids[j];
                const row = table.getRow(id);
                if (row === undefined || row.kind !== opcodes_1.NodeKind.Rule || row.parent !== op.sheet) {
                    return failOp(i, 'precondition', 'ruleDrop', id, 'RULE_DROP requires RULE ids parented to sheet (frame-protocol.md §4.6)');
                }
            }
            return null;
        }
        case opcodes_1.OpCode.RuleSet: {
            const row = table.getRow(op.id);
            if (row === undefined || row.kind !== opcodes_1.NodeKind.Rule) {
                return failOp(i, 'precondition', 'ruleSet', op.id, 'RULE_SET requires a RULE row (frame-protocol.md §4.6)');
            }
            return null;
        }
        default:
            return null;
    }
}
/**
 * §6 phase 1, real two-phase apply (Stage 2, frame-protocol-production-completeness): applies
 * each op's table effect in order, evaluating `CHECK` inline against the table's state *at the
 * point it appears* (§7 ordering rule 5) instead of only at the end. Stops at the first
 * violation and reports it — the caller (`client/applyDom.ts`) is responsible for never reaching
 * phase 2 (materialize into the DOM) when this returns `ok: false` (§P3: "if phase 1 fails, the
 * DOM was never touched").
 *
 * Beyond `CHECK`, this enforces §4 Pre for structure / node-state / CSSOM ops, `NODE_DROP`
 * absent/attached, and `NODE_NEW`/`SHEET_NEW`/`RULE_NEW` `MAX_ROWS` — all *before* the
 * corresponding table mutation (§8 "checked before any allocation"; §6 "validate then
 * materialize").
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
                    return failOp(i, 'malformed', 'nodeDrop', id, 'NODE_DROP of an absent id (frame-protocol.md §4.2 / OPEN-1 CLOSED)');
                }
                if (table.getRow(id).parent !== 0) {
                    return failOp(i, 'precondition', 'nodeDrop', id, 'NODE_DROP of an attached row (frame-protocol.md §4.2)');
                }
            }
            for (let j = 0; j < op.ids.length; j++)
                table.dropSubtree(op.ids[j]);
            continue;
        }
        if ((op.op === opcodes_1.OpCode.NodeNew || op.op === opcodes_1.OpCode.SheetNew || op.op === opcodes_1.OpCode.RuleNew) &&
            !table.has(op.id) &&
            table.size >= limits_1.MAX_ROWS) {
            return failOp(i, 'precondition', 'nodeNew', op.id, `MAX_ROWS (${limits_1.MAX_ROWS}) exceeded (frame-protocol.md §8)`);
        }
        const pre = validateOpPre(table, op, i);
        if (pre !== null)
            return pre;
        applyOpToTable(table, op);
    }
    return { ok: true };
}
//# sourceMappingURL=replicatedTableApply.js.map