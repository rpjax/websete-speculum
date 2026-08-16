"use strict";
/**
 * Live delta / resync snapshot → §4.6 FrameOp. C3.1: in-place RULE_SET; never SHEET_DROP a live
 * sheet just to refresh rules. Inserts without text are omitted (next pass).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitResyncCssomOps = emitResyncCssomOps;
exports.emitLiveCssomOps = emitLiveCssomOps;
const frame_1 = require("../../models/frame");
const opcodes_1 = require("../../models/opcodes");
function emitResyncCssomOps(ids, sheets) {
    const ops = [];
    const sheetIds = [];
    for (let i = 0; i < sheets.length; i++) {
        const rec = sheets[i];
        const sheetId = ids.idOfSheet(rec.sheet);
        sheetIds.push(sheetId);
        ops.push({
            op: opcodes_1.OpCode.SheetNew,
            id: sheetId,
            scope: frame_1.CSSOM_SCOPE_MAIN,
            hostNode: 0,
            before: frame_1.INSERT_AT_END,
        });
        for (let r = 0; r < rec.snaps.length; r++) {
            const snap = rec.snaps[r];
            const text = rec.texts.get(snap.key) ?? '';
            ops.push({
                op: opcodes_1.OpCode.RuleNew,
                sheet: sheetId,
                id: ids.idOfRule(snap.key),
                before: frame_1.INSERT_AT_END,
                text,
            });
        }
    }
    if (sheetIds.length > 1) {
        ops.push({ op: opcodes_1.OpCode.SheetOrder, ids: sheetIds });
    }
    return ops;
}
/**
 * Delta vs last committed snaps. `hashed` is this pass's obtained hashes+text (copy survivors).
 * Live order is current topology. Unhashed live keys (insert after copy) are omitted.
 */
function emitLiveCssomOps(ids, prevSheets, nextSheets, prevSnaps) {
    const ops = [];
    const prevSet = new Set(prevSheets);
    const nextSet = new Set(nextSheets.map((s) => s.sheet));
    const dropped = [];
    for (const sheet of prevSheets) {
        if (nextSet.has(sheet))
            continue;
        const id = ids.peekSheet(sheet);
        if (id !== undefined)
            dropped.push(id);
    }
    if (dropped.length > 0)
        ops.push({ op: opcodes_1.OpCode.SheetDrop, ids: dropped });
    const nextIds = [];
    for (let i = 0; i < nextSheets.length; i++) {
        const rec = nextSheets[i];
        const sheetId = ids.idOfSheet(rec.sheet);
        nextIds.push(sheetId);
        if (rec.skipOps)
            continue;
        if (!prevSet.has(rec.sheet)) {
            ops.push({
                op: opcodes_1.OpCode.SheetNew,
                id: sheetId,
                scope: frame_1.CSSOM_SCOPE_MAIN,
                hostNode: 0,
                before: frame_1.INSERT_AT_END,
            });
        }
        ops.push(...emitRuleDelta(ids, sheetId, prevSnaps.get(rec.sheet) ?? [], rec));
    }
    const prevIds = prevSheets.map((s) => ids.peekSheet(s)).filter((x) => x !== undefined);
    if (!sameIdOrder(prevIds, nextIds) && nextIds.length > 0) {
        ops.push({ op: opcodes_1.OpCode.SheetOrder, ids: nextIds });
    }
    return ops;
}
function emitRuleDelta(ids, sheetId, prev, rec) {
    const ops = [];
    const prevKeys = new Set(prev.map((s) => s.key));
    const nextKeys = new Set(rec.snaps.map((s) => s.key));
    const dropIds = [];
    for (const row of prev) {
        if (nextKeys.has(row.key))
            continue;
        const id = ids.peekRule(row.key);
        if (id !== undefined)
            dropIds.push(id);
    }
    if (dropIds.length > 0)
        ops.push({ op: opcodes_1.OpCode.RuleDrop, sheet: sheetId, ids: dropIds });
    const prevHash = new Map();
    for (const row of prev)
        prevHash.set(row.key, row.contentHash);
    for (let i = 0; i < rec.snaps.length; i++) {
        const snap = rec.snaps[i];
        const text = rec.texts.get(snap.key) ?? '';
        let before = frame_1.INSERT_AT_END;
        for (let j = i + 1; j < rec.snaps.length; j++) {
            const nextId = ids.peekRule(rec.snaps[j].key);
            if (nextId === undefined)
                continue;
            before = nextId;
            break;
        }
        if (!prevKeys.has(snap.key)) {
            ops.push({
                op: opcodes_1.OpCode.RuleNew,
                sheet: sheetId,
                id: ids.idOfRule(snap.key),
                before,
                text,
            });
            continue;
        }
        const old = prevHash.get(snap.key);
        if (old !== snap.contentHash) {
            ops.push({ op: opcodes_1.OpCode.RuleSet, id: ids.idOfRule(snap.key), text });
        }
    }
    return ops;
}
function sameIdOrder(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
//# sourceMappingURL=cssomOps.js.map