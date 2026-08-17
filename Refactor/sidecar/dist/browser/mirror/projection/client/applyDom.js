"use strict";
/**
 * Frame → live DOM + owned CSSOM apply — frame-protocol.md §6 (client apply).
 * CSSOM phase 2: constructed sheets on `adoptedStyleSheets` (C6). Pierce is desync (not this cut).
 *
 * `Remove` detaches nodes from the DOM but does not unregister them from the registry — a
 * detached row survives, address-registered, until the producer's own age-threshold GC sweep
 * emits `NODE_DROP` for it (§1.6/§5.6, OPEN-2, Stage 3 of frame-protocol-production-completeness)
 * and this client's `applyNodeDrop` unregisters the subtree in response. Ids are monotonic and
 * never reused within a generation, so an un-swept detached row costs memory, not correctness.
 *
 * `ReplicatedTable` (§1.3-§1.5) — real two-phase apply (§6, §P3, Stage 2 of
 * frame-protocol-production-completeness): Phase 1 verifies `preTableHash`, applies every op's
 * table effect, and evaluates any `CHECK` (`models/replicatedTableApply.ts`'s
 * `applyFrameToTableChecked`) — pure memory, no DOM. Only if phase 1 fully succeeds does Phase 2
 * run, reflecting the frame's ops into the live DOM (`applyOp` below). Phase 2 is *specified* not
 * to fail (§6) because every address was validated in phase 1; if the live node is not where the
 * table just swore it was (e.g. `REMOVE` whose `parentNode` is not `op.parent`), that is a desync,
 * not a skip. Swallowing it leaves producer-clean / client-dirty. A phase-1 failure aborts the
 * whole frame via `onDesync({ reason: 'precondition', ... })` before any DOM node is touched.
 */
/// <reference lib="dom" />
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomFrameApplier = void 0;
const opcodes_1 = require("../models/opcodes");
const frame_1 = require("../models/frame");
const cssomApplyIndex_1 = require("../models/cssomApplyIndex");
const replicatedTable_1 = require("../models/replicatedTable");
const replicatedTableApply_1 = require("../models/replicatedTableApply");
class DomFrameApplier {
    queued = [];
    raf = null;
    doc;
    registry;
    options;
    table = new replicatedTable_1.ReplicatedTable();
    sheets = new Map();
    rules = new Map();
    constructor(doc, registry, options = {}) {
        this.doc = doc;
        this.registry = registry;
        this.options = options;
    }
    /** Client's own row/hash table (§1.3-§1.5) — read-only outside this class. */
    get replicatedTable() {
        return this.table;
    }
    enqueue(frame) {
        this.queued.push(frame);
        if (this.raf != null)
            return;
        this.raf = requestAnimationFrame(() => {
            this.raf = null;
            this.flush();
        });
    }
    flush() {
        if (this.raf != null) {
            cancelAnimationFrame(this.raf);
            this.raf = null;
        }
        const batch = this.queued.sort((a, b) => a.sequence - b.sequence);
        this.queued = [];
        if (batch.length === 0)
            return;
        const start = performance.now();
        let lastSequence = 0;
        for (const frame of batch) {
            lastSequence = frame.sequence;
            // SEAL-DOM-P0-FLUSH / PP-APPLY-1: stop the batch on first desync — do not apply later
            // frames over a dirty or already-reset table (lab client resets in onDesync).
            if (!this.applyFrame(frame))
                break;
        }
        const duration = performance.now() - start;
        const budget = this.options.applyBudgetMs ?? 4;
        if (duration > budget)
            this.options.onOverrun?.(duration, lastSequence);
    }
    reset() {
        if (this.raf != null) {
            cancelAnimationFrame(this.raf);
            this.raf = null;
        }
        this.queued = [];
        this.table.reset();
        this.clearCssom();
    }
    /** @returns `false` when a desync was reported — `flush` must not apply later frames in the batch. */
    applyFrame(frame) {
        const start = performance.now();
        // Phase 1 (table) — §6, §P3: pure memory, no DOM. `preTableHash` is unchecked for resync
        // frames (§2 — "no prior state to check against a wholesale replace"); an ordinary frame's
        // `preTableHash` must match this client's own table *before* any op in it applies.
        if (!frame.resync && frame.preTableHash !== this.table.tableHash) {
            return this.fail('precondition', 'preTableHash', frame.preTableHash, this.table.tableHash);
        }
        const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(this.table, frame.resync, frame.ops, frame.sequence);
        if (!result.ok) {
            if (result.opName === 'check') {
                return this.fail('precondition', 'check', result.expected, result.actual);
            }
            return this.failOp(result.reason, result.opName, result.id, result.message);
        }
        // Phase 2 (materialize) — §6. Only reached once phase 1 has fully succeeded for the whole
        // frame — "cannot fail" (§6) because every op it touches was already validated above.
        // CSSOM still uses the iframe window's `CSSStyleSheet`; a cross-realm constructor throws.
        for (let i = 0; i < frame.ops.length; i++) {
            try {
                if (!this.applyOp(frame.ops[i]))
                    return false;
            }
            catch {
                return this.fail('malformed', 'apply', 0);
            }
        }
        if (!this.cssomHandlesMatchTable())
            return false;
        this.options.onApplied?.(frame, performance.now() - start);
        return true;
    }
    fail(reason, opName, a, b) {
        if (typeof a === 'bigint') {
            this.options.onDesync?.({ reason, op: opName, id: 0, expected: a, actual: b });
        }
        else {
            this.options.onDesync?.({ reason, op: opName, id: a });
        }
        return false;
    }
    /** `NODE_DROP`/`MAX_ROWS` phase-1 failures (Stage 3) — `message` for diagnostics, explicit `phase`. */
    failOp(reason, opName, id, message) {
        this.options.onDesync?.({ reason, op: opName, id, message, phase: 'apply' });
        return false;
    }
    applyOp(op) {
        switch (op.op) {
            case opcodes_1.OpCode.Check:
                return true; // §4.1 — no DOM effect; already evaluated in phase 1
            case opcodes_1.OpCode.EpochReset:
                return this.applyEpochReset();
            case opcodes_1.OpCode.StrDef:
                return true; // already resolved at decode time (decode.ts PersistentStringTable)
            case opcodes_1.OpCode.NodeNew:
                return this.applyNodeNew(op);
            case opcodes_1.OpCode.NodeDrop:
                return this.applyNodeDrop(op);
            case opcodes_1.OpCode.Insert:
                return this.applyInsert(op);
            case opcodes_1.OpCode.Remove:
                return this.applyRemove(op);
            case opcodes_1.OpCode.AttrSet:
                return this.applyAttrSet(op);
            case opcodes_1.OpCode.AttrDel:
                return this.applyAttrDel(op);
            case opcodes_1.OpCode.TextSet:
                return this.applyTextSet(op);
            case opcodes_1.OpCode.SheetNew:
                return this.applySheetNew(op);
            case opcodes_1.OpCode.SheetDrop:
                return this.applySheetDrop(op);
            case opcodes_1.OpCode.SheetOrder:
                return this.applySheetOrder(op);
            case opcodes_1.OpCode.RuleNew:
                return this.applyRuleNew(op);
            case opcodes_1.OpCode.RuleDrop:
                return this.applyRuleDrop(op);
            case opcodes_1.OpCode.RuleSet:
                return this.applyRuleSet(op);
            default:
                return true;
        }
    }
    /**
     * §4.1 `EPOCH_RESET` `DOM` effect: "the surface is discarded (a new document buffer is
     * prepared — §6)." No double-buffer surface exists yet (Stage 4) — discards in place, which is
     * safe here specifically because phase 1 already validated the *whole* frame (§P3: "if phase
     * 1 fails, the DOM was never touched") and `EPOCH_RESET` is ordering-guaranteed first (§7 rule
     * 1), so every `NODE_NEW`/`INSERT` immediately following in this same frame rebuilds the
     * surface before Phase 2 returns — there is no observable empty-document frame.
     */
    applyEpochReset() {
        this.doc.replaceChildren();
        this.registry.clear();
        this.registry.register(frame_1.DOCUMENT_ID, this.doc);
        this.clearCssom();
        return true;
    }
    clearCssom() {
        this.sheets.clear();
        this.rules.clear();
        try {
            this.doc.adoptedStyleSheets = [];
        }
        catch {
            /* adoptedStyleSheets may be missing on a test document */
        }
    }
    /** After the frame, every table Sheet row must have a live handle (replay complete, not mid-op). */
    cssomHandlesMatchTable() {
        const ids = (0, cssomApplyIndex_1.orderedSheetIds)(this.table);
        for (let i = 0; i < ids.length; i++) {
            if (!this.sheets.has(ids[i]))
                return this.fail('address_miss', 'sheetNew', ids[i]);
        }
        return true;
    }
    adoptedList() {
        return Array.from(this.doc.adoptedStyleSheets);
    }
    setAdopted(next) {
        try {
            this.doc.adoptedStyleSheets = next;
            return true;
        }
        catch {
            return this.fail('malformed', 'sheetOrder', 0);
        }
    }
    materializedSheetIds() {
        const list = this.adoptedList();
        const ids = [];
        for (let i = 0; i < list.length; i++) {
            const sheet = list[i];
            for (const [id, bound] of this.sheets) {
                if (bound === sheet) {
                    ids.push(id);
                    break;
                }
            }
        }
        return ids;
    }
    applySheetNew(op) {
        if (op.scope === frame_1.CSSOM_SCOPE_PIERCE_HOST || op.hostNode !== 0) {
            return this.fail('bad_target', 'sheetNew', op.id);
        }
        if (this.sheets.has(op.id))
            return this.fail('bad_target', 'sheetNew', op.id);
        const view = this.doc.defaultView;
        if (view === null)
            return this.fail('bad_target', 'sheetNew', op.id);
        let sheet;
        try {
            sheet = new view.CSSStyleSheet();
        }
        catch {
            return this.fail('malformed', 'sheetNew', op.id);
        }
        const at = (0, cssomApplyIndex_1.insertIndexFromBefore)(this.materializedSheetIds(), op.before);
        if (at < 0)
            return this.fail('address_miss', 'sheetNew', op.before);
        const next = this.adoptedList();
        next.splice(at, 0, sheet);
        if (!this.setAdopted(next))
            return false;
        this.sheets.set(op.id, sheet);
        return true;
    }
    applySheetDrop(op) {
        const drop = new Set();
        for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            const sheet = this.sheets.get(id);
            if (sheet === undefined)
                return this.fail('address_miss', 'sheetDrop', id);
            drop.add(sheet);
            for (const [ruleId, rule] of this.rules) {
                if (rule.parentStyleSheet === sheet)
                    this.rules.delete(ruleId);
            }
            this.sheets.delete(id);
        }
        const next = this.adoptedList().filter((s) => !drop.has(s));
        return this.setAdopted(next);
    }
    applySheetOrder(op) {
        const next = [];
        for (let i = 0; i < op.ids.length; i++) {
            const sheet = this.sheets.get(op.ids[i]);
            if (sheet === undefined)
                return this.fail('address_miss', 'sheetOrder', op.ids[i]);
            next.push(sheet);
        }
        return this.setAdopted(next);
    }
    applyRuleNew(op) {
        const sheet = this.sheets.get(op.sheet);
        if (sheet === undefined)
            return this.fail('address_miss', 'ruleNew', op.sheet);
        if (this.rules.has(op.id))
            return this.fail('bad_target', 'ruleNew', op.id);
        let index;
        if (op.before === frame_1.INSERT_AT_END) {
            index = sheet.cssRules.length;
        }
        else {
            const beforeRule = this.rules.get(op.before);
            if (beforeRule === undefined)
                return this.fail('address_miss', 'ruleNew', op.before);
            index = -1;
            for (let k = 0; k < sheet.cssRules.length; k++) {
                if (sheet.cssRules.item(k) === beforeRule) {
                    index = k;
                    break;
                }
            }
            if (index < 0)
                return this.fail('address_miss', 'ruleNew', op.before);
        }
        let inserted;
        try {
            inserted = sheet.insertRule(op.text, index);
        }
        catch {
            return this.fail('malformed', 'ruleNew', op.id);
        }
        const rule = sheet.cssRules.item(inserted);
        if (rule === null)
            return this.fail('address_miss', 'ruleNew', op.id);
        this.rules.set(op.id, rule);
        return true;
    }
    applyRuleDrop(op) {
        const sheet = this.sheets.get(op.sheet);
        if (sheet === undefined)
            return this.fail('address_miss', 'ruleDrop', op.sheet);
        for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            const rule = this.rules.get(id);
            if (rule === undefined)
                return this.fail('address_miss', 'ruleDrop', id);
            let at = -1;
            for (let k = 0; k < sheet.cssRules.length; k++) {
                if (sheet.cssRules.item(k) === rule) {
                    at = k;
                    break;
                }
            }
            if (at < 0)
                return this.fail('address_miss', 'ruleDrop', id);
            sheet.deleteRule(at);
            this.rules.delete(id);
        }
        return true;
    }
    applyRuleSet(op) {
        const rule = this.rules.get(op.id);
        if (rule === undefined)
            return this.fail('address_miss', 'ruleSet', op.id);
        const view = this.doc.defaultView;
        const StyleRule = view !== null ? view.CSSStyleRule : undefined;
        if (StyleRule !== undefined && rule instanceof StyleRule) {
            try {
                rule.style.cssText = (0, cssomApplyIndex_1.declarationBlockFromRuleText)(op.text);
                return true;
            }
            catch {
                return this.fail('malformed', 'ruleSet', op.id);
            }
        }
        try {
            rule.cssText = op.text;
        }
        catch {
            return this.fail('malformed', 'ruleSet', op.id);
        }
        return true;
    }
    /** §4.2 `NODE_DROP` `DOM` effect: "none — the subtree is already detached." Registry-only. */
    applyNodeDrop(op) {
        for (let i = 0; i < op.ids.length; i++) {
            const node = this.registry.get(op.ids[i]);
            if (node !== undefined)
                this.registry.unregisterSubtree(node);
        }
        return true;
    }
    applyNodeNew(op) {
        let node;
        if (op.kind === opcodes_1.NodeKind.Element) {
            node = this.doc.createElement(op.name);
            applyAttrs(node, op.attrs);
        }
        else if (op.kind === opcodes_1.NodeKind.Text) {
            node = this.doc.createTextNode(op.value);
        }
        else if (op.kind === opcodes_1.NodeKind.Comment) {
            node = this.doc.createComment(op.value);
        }
        else if (op.kind === opcodes_1.NodeKind.Doctype) {
            node = this.doc.implementation.createDocumentType(op.name || 'html', '', '');
        }
        else {
            return this.fail('bad_target', 'nodeNew', op.id);
        }
        this.registry.register(op.id, node);
        return true;
    }
    applyInsert(op) {
        const parent = this.registry.get(op.parent);
        if (!parent)
            return this.fail('address_miss', 'insert', op.parent);
        let before = null;
        if (op.before !== frame_1.INSERT_AT_END) {
            before = this.registry.get(op.before) ?? null;
            if (before === null)
                return this.fail('address_miss', 'insert', op.before);
        }
        for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            const node = this.registry.get(id);
            if (!node)
                return this.fail('address_miss', 'insert', id);
            parent.insertBefore(node, before);
        }
        return true;
    }
    applyRemove(op) {
        const parent = this.registry.get(op.parent);
        if (!parent)
            return this.fail('address_miss', 'remove', op.parent);
        for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            const node = this.registry.get(id);
            if (!node)
                return this.fail('address_miss', 'remove', id);
            if (node.parentNode !== parent) {
                this.options.onDesync?.({
                    reason: 'bad_target',
                    op: 'remove',
                    id,
                    message: 'REMOVE: node is not a child of the stated parent (phase 2 vs table)',
                    phase: 'apply',
                });
                return false;
            }
            parent.removeChild(node);
        }
        return true;
    }
    applyAttrSet(op) {
        const node = this.registry.get(op.node);
        if (!node || node.nodeType !== Node.ELEMENT_NODE)
            return this.fail('address_miss', 'attrSet', op.node);
        applyAttrs(node, op.attrs);
        return true;
    }
    applyAttrDel(op) {
        const node = this.registry.get(op.node);
        if (!node || node.nodeType !== Node.ELEMENT_NODE)
            return this.fail('address_miss', 'attrDel', op.node);
        const el = node;
        for (let i = 0; i < op.names.length; i++)
            el.removeAttribute(op.names[i]);
        return true;
    }
    applyTextSet(op) {
        const node = this.registry.get(op.node);
        if (!node)
            return this.fail('address_miss', 'textSet', op.node);
        node.textContent = op.value;
        return true;
    }
}
exports.DomFrameApplier = DomFrameApplier;
function applyAttrs(el, attrs) {
    for (let i = 0; i < attrs.length; i++) {
        const { name, value } = attrs[i];
        try {
            el.setAttribute(name, value);
        }
        catch {
            /* invalid attribute name from a hostile/unusual page — ignore, not a desync */
        }
    }
}
//# sourceMappingURL=applyDom.js.map