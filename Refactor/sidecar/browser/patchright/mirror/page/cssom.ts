/**
 * §5.10 — Cssom plane types and within-frame coalescing (§5.10.4). Sheet and
 * rule ids share the Dom uint32 id space; the opcode alone disambiguates.
 */

export type CssomId = number;

/** C7 scope enforcement — unchanged: a flattened tree must not let pierced CSS leak into the parent. */
export type CssomScope = { kind: 'main' } | { kind: 'pierceHost'; hostId: CssomId };

export type CssomRuleDescriptor = { id: CssomId; cssText: string };

export type CssomSheetDescriptor = {
  id: CssomId;
  scope: CssomScope;
  rules: CssomRuleDescriptor[];
};

export type CssomInstallOp = { op: 'cssomInstall'; sheets: CssomSheetDescriptor[] };

export type CssomSheetListOp = {
  op: 'cssomSheetList';
  removed: CssomId[];
  added: { index: number; sheet: CssomSheetDescriptor }[];
};

export type CssomRuleListOp = {
  op: 'cssomRuleList';
  sheet: CssomId;
  removed: CssomId[];
  added: { index: number; rule: CssomRuleDescriptor }[];
};

export type CssomPatchOp = { op: 'cssomPatch'; rule: CssomId; cssText: string };

export type CssomOp = CssomInstallOp | CssomSheetListOp | CssomRuleListOp | CssomPatchOp;

/**
 * §5.10.4 — coalesces sheet/rule adds, removes and patches observed within
 * one frame window into the smallest net-effect op set: a sheet (or rule)
 * added and removed within the same frame is never sent; repeated patches to
 * one rule collapse to the last value.
 */
export class CssomCoalescer {
  private readonly sheetAdds = new Map<CssomId, { index: number; sheet: CssomSheetDescriptor }>();
  private readonly sheetRemoves = new Set<CssomId>();
  private readonly ruleAdds = new Map<CssomId, Map<CssomId, { index: number; rule: CssomRuleDescriptor }>>();
  private readonly ruleRemoves = new Map<CssomId, Set<CssomId>>();
  private readonly rulePatches = new Map<CssomId, string>();

  addSheet(sheetId: CssomId, index: number, sheet: CssomSheetDescriptor): void {
    this.sheetRemoves.delete(sheetId);
    this.sheetAdds.set(sheetId, { index, sheet });
  }

  removeSheet(sheetId: CssomId): void {
    if (this.sheetAdds.delete(sheetId)) return; // add+remove within the frame cancels (§5.10.4).
    this.sheetRemoves.add(sheetId);
  }

  addRule(sheetId: CssomId, ruleId: CssomId, index: number, rule: CssomRuleDescriptor): void {
    const removes = this.ruleRemoves.get(sheetId);
    if (removes?.delete(ruleId) && removes.size === 0) this.ruleRemoves.delete(sheetId);
    let adds = this.ruleAdds.get(sheetId);
    if (!adds) {
      adds = new Map();
      this.ruleAdds.set(sheetId, adds);
    }
    adds.set(ruleId, { index, rule });
  }

  removeRule(sheetId: CssomId, ruleId: CssomId): void {
    this.rulePatches.delete(ruleId);
    const adds = this.ruleAdds.get(sheetId);
    if (adds?.delete(ruleId)) {
      if (adds.size === 0) this.ruleAdds.delete(sheetId); // add+remove within the frame cancels.
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
  patchRule(ruleId: CssomId, cssText: string): void {
    this.rulePatches.set(ruleId, cssText);
  }

  get isEmpty(): boolean {
    return (
      this.sheetAdds.size === 0
      && this.sheetRemoves.size === 0
      && this.ruleAdds.size === 0
      && this.ruleRemoves.size === 0
      && this.rulePatches.size === 0
    );
  }

  /** Emits the net-effect ops for the current frame window, then clears. */
  flush(): CssomOp[] {
    const ops: CssomOp[] = [];
    if (this.sheetAdds.size > 0 || this.sheetRemoves.size > 0) {
      ops.push({
        op: 'cssomSheetList',
        removed: [...this.sheetRemoves],
        added: [...this.sheetAdds.values()],
      });
    }
    const sheetsWithRuleChanges = new Set<CssomId>([...this.ruleAdds.keys(), ...this.ruleRemoves.keys()]);
    for (const sheetId of sheetsWithRuleChanges) {
      const added = this.ruleAdds.get(sheetId);
      const removed = this.ruleRemoves.get(sheetId);
      if ((added?.size ?? 0) === 0 && (removed?.size ?? 0) === 0) continue;
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

  reset(): void {
    this.sheetAdds.clear();
    this.sheetRemoves.clear();
    this.ruleAdds.clear();
    this.ruleRemoves.clear();
    this.rulePatches.clear();
  }
}

export function buildCssomInstall(sheets: CssomSheetDescriptor[]): CssomInstallOp {
  return { op: 'cssomInstall', sheets };
}
