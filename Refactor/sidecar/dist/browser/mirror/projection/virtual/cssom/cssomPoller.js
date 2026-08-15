"use strict";
/**
 * In-page CSSOM poll — I3 detector. Copy refs, hash the copy, skip stale slots, abort mass
 * divergence. Emits §4.6 ops (phase 1 table). No CDP. No prototype hooks. C5 not relocked.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CssomPoller = void 0;
exports.foldSheetPieces = foldSheetPieces;
exports.emptyCssomPollStats = emptyCssomPollStats;
const cssomReconcile_1 = require("./cssomReconcile");
const fnv32_1 = require("./fnv32");
const cssomIds_1 = require("./cssomIds");
const cssomOps_1 = require("./cssomOps");
const cssomWalk_1 = require("./cssomWalk");
const EMPTY = {
    pollMs: 0,
    identityWalkMs: 0,
    cssTextSerializeMs: 0,
    readableSheetCount: 0,
    unreadableSheetCount: 0,
    topLevelRulesVisited: 0,
    topLevelRulesSerialized: 0,
    styleTagTextUnchangedSheets: 0,
    rulesAppeared: 0,
    rulesDisappeared: 0,
    rulesTextChangedInPlace: 0,
    sheetsWithRuleListChanged: 0,
};
class CssomPoller {
    lastRules = new WeakMap();
    lastStyleTagTextHash = new WeakMap();
    ids = new cssomIds_1.CssomIds();
    lastSheetOrder = [];
    classifySheets(doc = document) {
        const readable = [];
        let unreadableSheetCount = 0;
        for (const sheet of collectSheets(doc)) {
            const list = tryCssRules(sheet);
            if (list === null)
                unreadableSheetCount += 1;
            else
                readable.push({ sheet, rules: list });
        }
        return { readable, unreadableSheetCount };
    }
    /** Phase A — refs only. */
    beginSheetWalk(sheet, list) {
        const t0 = performance.now();
        const copyRefs = (0, cssomWalk_1.copyRuleRefs)(list);
        return {
            sheet,
            copyRefs,
            copyLength: list.length,
            cursor: 0,
            hashed: [],
            texts: new Map(),
            staleSlots: 0,
            identityWalkMs: performance.now() - t0,
            cssTextSerializeMs: 0,
            aborted: false,
        };
    }
    /**
     * Phase B batch. Returns false when the sheet walk is finished (hashed or aborted).
     */
    hashSheetBatch(walk, timeRemaining, floorMs) {
        const list = tryCssRules(walk.sheet);
        const live = list ? (0, cssomWalk_1.liveRuleList)(list) : [];
        const liveLen = list ? list.length : 0;
        while (walk.cursor < walk.copyRefs.length && timeRemaining() > floorMs) {
            const rule = walk.copyRefs[walk.cursor];
            walk.cursor += 1;
            if (!(0, cssomWalk_1.isRuleSlotLive)(rule, walk.sheet, live)) {
                walk.staleSlots += 1;
                if ((0, cssomWalk_1.shouldAbortSheet)(walk.copyLength, walk.staleSlots, liveLen)) {
                    walk.aborted = true;
                    walk.hashed = [];
                    walk.texts.clear();
                    return false;
                }
                continue;
            }
            const t0 = performance.now();
            let text = '';
            try {
                text = rule.cssText;
            }
            catch {
                walk.staleSlots += 1;
                walk.cssTextSerializeMs += performance.now() - t0;
                continue;
            }
            walk.texts.set(rule, text);
            walk.hashed.push({ key: rule, contentHash: (0, fnv32_1.fnv1a32)(text) });
            walk.cssTextSerializeMs += performance.now() - t0;
        }
        if (walk.cursor < walk.copyRefs.length)
            return true;
        if ((0, cssomWalk_1.shouldAbortSheet)(walk.copyLength, walk.staleSlots, liveLen)) {
            walk.aborted = true;
            walk.hashed = [];
            walk.texts.clear();
        }
        return false;
    }
    finishSheetWalk(walk) {
        if (walk.aborted) {
            return {
                snap: [],
                identityWalkMs: walk.identityWalkMs,
                cssTextSerializeMs: walk.cssTextSerializeMs,
                topLevelRulesVisited: walk.copyLength,
                topLevelRulesSerialized: 0,
                styleTagTextUnchanged: false,
                rulesAppeared: 0,
                rulesDisappeared: 0,
                rulesTextChangedInPlace: 0,
                ruleListChanged: false,
                aborted: true,
            };
        }
        const list = tryCssRules(walk.sheet);
        const live = list ? (0, cssomWalk_1.liveRuleList)(list) : [];
        const hashByKey = new Map(walk.hashed.map((s) => [s.key, s]));
        const committed = [];
        const texts = new Map();
        for (const rule of live) {
            const row = hashByKey.get(rule);
            if (row === undefined)
                continue;
            committed.push(row);
            const t = walk.texts.get(rule);
            if (t !== undefined)
                texts.set(rule, t);
        }
        walk.hashed = committed;
        walk.texts = texts;
        const prev = this.lastRules.get(walk.sheet) ?? [];
        const delta = (0, cssomReconcile_1.diffRules)(prev, committed);
        const styleTagHash = styleElementTextHash(walk.sheet);
        let styleTagTextUnchanged = false;
        if (styleTagHash !== null) {
            styleTagTextUnchanged = this.lastStyleTagTextHash.get(walk.sheet) === styleTagHash;
        }
        return {
            snap: committed,
            identityWalkMs: walk.identityWalkMs,
            cssTextSerializeMs: walk.cssTextSerializeMs,
            topLevelRulesVisited: walk.copyLength,
            topLevelRulesSerialized: committed.length,
            styleTagTextUnchanged,
            rulesAppeared: delta.rulesAppeared,
            rulesDisappeared: delta.rulesDisappeared,
            rulesTextChangedInPlace: delta.rulesTextChangedInPlace,
            ruleListChanged: delta.ruleListChanged,
            aborted: false,
        };
    }
    commitSheet(sheet, snap) {
        this.lastRules.set(sheet, snap);
        const hash = styleElementTextHash(sheet);
        if (hash !== null)
            this.lastStyleTagTextHash.set(sheet, hash);
    }
    /** Whole-pass commit: lastRules + live/resync ops. Skips aborted pieces. */
    commitPass(readable, pieces, textsBySheet, mode) {
        const nextOrder = [];
        const hashed = [];
        for (let i = 0; i < readable.length; i++) {
            const sheet = readable[i].sheet;
            const piece = pieces[i];
            if (!piece || piece.aborted) {
                nextOrder.push({
                    sheet,
                    snaps: this.lastRules.get(sheet) ?? [],
                    texts: new Map(),
                    skipOps: true,
                });
                continue;
            }
            const rec = {
                sheet,
                snaps: piece.snap,
                texts: textsBySheet.get(sheet) ?? new Map(),
            };
            nextOrder.push(rec);
            hashed.push(rec);
        }
        const ops = mode === 'resync'
            ? (0, cssomOps_1.emitResyncCssomOps)(this.ids, hashed)
            : (0, cssomOps_1.emitLiveCssomOps)(this.ids, this.lastSheetOrder, nextOrder, this.lastRules);
        for (const c of hashed)
            this.commitSheet(c.sheet, c.snaps);
        this.lastSheetOrder = nextOrder.map((c) => c.sheet);
        return ops;
    }
    /**
     * Blocking A+B (resync / snapshot scan). Commits non-aborted sheets then snapshot ops.
     */
    poll(doc = document, mode = 'resync') {
        const t0 = performance.now();
        const { readable, unreadableSheetCount } = this.classifySheets(doc);
        const pieces = [];
        const textsBySheet = new WeakMap();
        for (const { sheet, rules } of readable) {
            const walk = this.beginSheetWalk(sheet, rules);
            this.hashSheetBatch(walk, () => 1e9, 0);
            const piece = this.finishSheetWalk(walk);
            pieces.push(piece);
            if (!piece.aborted)
                textsBySheet.set(sheet, walk.texts);
        }
        const ops = this.commitPass(readable, pieces, textsBySheet, mode);
        return {
            stats: foldSheetPieces(unreadableSheetCount, pieces, performance.now() - t0),
            ops,
        };
    }
}
exports.CssomPoller = CssomPoller;
function foldSheetPieces(unreadableSheetCount, pieces, pollMs) {
    let identityWalkMs = 0;
    let cssTextSerializeMs = 0;
    let topLevelRulesVisited = 0;
    let topLevelRulesSerialized = 0;
    let styleTagTextUnchangedSheets = 0;
    let rulesAppeared = 0;
    let rulesDisappeared = 0;
    let rulesTextChangedInPlace = 0;
    let sheetsWithRuleListChanged = 0;
    let readable = 0;
    for (const p of pieces) {
        identityWalkMs += p.identityWalkMs;
        cssTextSerializeMs += p.cssTextSerializeMs;
        topLevelRulesVisited += p.topLevelRulesVisited;
        topLevelRulesSerialized += p.topLevelRulesSerialized;
        if (p.aborted)
            continue;
        readable += 1;
        if (p.styleTagTextUnchanged)
            styleTagTextUnchangedSheets += 1;
        rulesAppeared += p.rulesAppeared;
        rulesDisappeared += p.rulesDisappeared;
        rulesTextChangedInPlace += p.rulesTextChangedInPlace;
        if (p.ruleListChanged)
            sheetsWithRuleListChanged += 1;
    }
    return {
        pollMs,
        identityWalkMs,
        cssTextSerializeMs,
        readableSheetCount: readable,
        unreadableSheetCount,
        topLevelRulesVisited,
        topLevelRulesSerialized,
        styleTagTextUnchangedSheets,
        rulesAppeared,
        rulesDisappeared,
        rulesTextChangedInPlace,
        sheetsWithRuleListChanged,
    };
}
function collectSheets(doc) {
    const out = [];
    const linked = doc.styleSheets;
    for (let i = 0; i < linked.length; i++) {
        const s = linked.item(i);
        if (s)
            out.push(s);
    }
    const adopted = doc.adoptedStyleSheets;
    if (adopted) {
        for (let i = 0; i < adopted.length; i++) {
            const s = adopted[i];
            if (s)
                out.push(s);
        }
    }
    return out;
}
function tryCssRules(sheet) {
    try {
        return sheet.cssRules;
    }
    catch {
        return null;
    }
}
function styleElementTextHash(sheet) {
    const node = sheet.ownerNode;
    if (node === null || node.nodeType !== Node.ELEMENT_NODE)
        return null;
    const el = node;
    if (el.localName !== 'style')
        return null;
    return (0, fnv32_1.fnv1a32)(el.textContent ?? '');
}
function emptyCssomPollStats() {
    return { ...EMPTY };
}
//# sourceMappingURL=cssomPoller.js.map