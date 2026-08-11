"use strict";
/**
 * §5.10 — Cssom plane types and within-frame coalescing (§5.10.4). Sheet and
 * rule ids share the Dom uint32 id space; the opcode alone disambiguates.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CssomCoalescer = void 0;
exports.buildCssomInstall = buildCssomInstall;
/**
 * §5.10.4 — coalesces sheet/rule adds, removes and patches observed within
 * one frame window into the smallest net-effect op set: a sheet (or rule)
 * added and removed within the same frame is never sent; repeated patches to
 * one rule collapse to the last value.
 */
class CssomCoalescer {
    sheetAdds = new Map();
    sheetRemoves = new Set();
    ruleAdds = new Map();
    ruleRemoves = new Map();
    rulePatches = new Map();
    addSheet(sheetId, index, sheet) {
        this.sheetRemoves.delete(sheetId);
        this.sheetAdds.set(sheetId, { index, sheet });
    }
    removeSheet(sheetId) {
        if (this.sheetAdds.delete(sheetId))
            return; // add+remove within the frame cancels (§5.10.4).
        this.sheetRemoves.add(sheetId);
    }
    addRule(sheetId, ruleId, index, rule) {
        const removes = this.ruleRemoves.get(sheetId);
        if (removes?.delete(ruleId) && removes.size === 0)
            this.ruleRemoves.delete(sheetId);
        let adds = this.ruleAdds.get(sheetId);
        if (!adds) {
            adds = new Map();
            this.ruleAdds.set(sheetId, adds);
        }
        adds.set(ruleId, { index, rule });
    }
    removeRule(sheetId, ruleId) {
        this.rulePatches.delete(ruleId);
        const adds = this.ruleAdds.get(sheetId);
        if (adds?.delete(ruleId)) {
            if (adds.size === 0)
                this.ruleAdds.delete(sheetId); // add+remove within the frame cancels.
            return;
        }
        let removes = this.ruleRemoves.get(sheetId);
        if (!removes) {
            removes = new Set();
            this.ruleRemoves.set(sheetId, removes);
        }
        removes.add(ruleId);
    }
    /** Repeated writes to one rule within the frame collapse to the last value. */
    patchRule(ruleId, cssText) {
        this.rulePatches.set(ruleId, cssText);
    }
    get isEmpty() {
        return (this.sheetAdds.size === 0
            && this.sheetRemoves.size === 0
            && this.ruleAdds.size === 0
            && this.ruleRemoves.size === 0
            && this.rulePatches.size === 0);
    }
    /** Emits the net-effect ops for the current frame window, then clears. */
    flush() {
        const ops = [];
        if (this.sheetAdds.size > 0 || this.sheetRemoves.size > 0) {
            ops.push({
                op: 'cssomSheetList',
                removed: [...this.sheetRemoves],
                added: [...this.sheetAdds.values()],
            });
        }
        const sheetsWithRuleChanges = new Set([...this.ruleAdds.keys(), ...this.ruleRemoves.keys()]);
        for (const sheetId of sheetsWithRuleChanges) {
            const added = this.ruleAdds.get(sheetId);
            const removed = this.ruleRemoves.get(sheetId);
            if ((added?.size ?? 0) === 0 && (removed?.size ?? 0) === 0)
                continue;
            ops.push({
                op: 'cssomRuleList',
                sheet: sheetId,
                removed: removed ? [...removed] : [],
                added: added ? [...added.values()] : [],
            });
        }
        for (const [ruleId, cssText] of this.rulePatches) {
            ops.push({ op: 'cssomPatch', rule: ruleId, cssText });
        }
        this.reset();
        return ops;
    }
    reset() {
        this.sheetAdds.clear();
        this.sheetRemoves.clear();
        this.ruleAdds.clear();
        this.ruleRemoves.clear();
        this.rulePatches.clear();
    }
}
exports.CssomCoalescer = CssomCoalescer;
function buildCssomInstall(sheets) {
    return { op: 'cssomInstall', sheets };
}
//# sourceMappingURL=cssom.js.map