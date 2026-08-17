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

import { NodeKind, OpCode } from '../models/opcodes';
import { ElementNs, elementNsUri } from '../models/elementNs';
import { applyFramesUntilDesync } from '../models/applyBatch';
import {
  CSSOM_SCOPE_PIERCE_HOST,
  DOCUMENT_ID,
  INSERT_AT_END,
  type AttrPair,
  type FrameOp,
} from '../models/frame';
import { applyAttrPairs } from '../models/attrApply';
import { insertIndexFromBefore, orderedSheetIds, orderedRuleIds, matchCssomEndOfFrame, declarationBlockFromRuleText } from '../models/cssomApplyIndex';
import { planRuleSetApply } from '../models/cssomRuleSet';
import type { AssembledFrame } from '../models/decode';
import { ReplicatedTable } from '../models/replicatedTable';
import { applyFrameToTableChecked } from '../models/replicatedTableApply';
import type { PageProjectionRegistry } from './registry';

export type DomDesyncReason = 'address_miss' | 'bad_target' | 'precondition' | 'malformed';
export interface DomDesyncInfo {
  reason: DomDesyncReason;
  op: string;
  id: number;
  /** Only set for `reason: 'precondition'` (§6 phase-1 abort) — the table hashes that disagreed. */
  expected?: bigint;
  actual?: bigint;
  /** `NODE_DROP`/`MAX_ROWS` failures (Stage 3) — human-readable diagnostic detail. */
  message?: string;
  /**
   * Overrides `models/telemetry.ts`'s `errorCode → phase` default for this desync — needed for
 * `reason: 'malformed'` raised here (OPEN-1 CLOSED: absent-id `NODE_DROP`), which is caught during
   * phase-1 *apply*, not decode, unlike every other `'malformed'` source (`models/decode.ts`).
   */
  phase?: 'apply';
}

export interface DomFrameApplierOptions {
  onDesync?: (info: DomDesyncInfo) => void;
  onApplied?: (frame: AssembledFrame, applyMs: number) => void;
  onOverrun?: (durationMs: number, lastSequence: number) => void;
  applyBudgetMs?: number;
}

export class DomFrameApplier {
  private queued: AssembledFrame[] = [];
  private raf: number | null = null;
  private readonly doc: Document;
  private readonly registry: PageProjectionRegistry;
  private readonly options: DomFrameApplierOptions;
  private readonly table = new ReplicatedTable();
  private readonly sheets = new Map<number, CSSStyleSheet>();
  private readonly rules = new Map<number, CSSRule>();

  constructor(doc: Document, registry: PageProjectionRegistry, options: DomFrameApplierOptions = {}) {
    this.doc = doc;
    this.registry = registry;
    this.options = options;
  }

  /** Client's own row/hash table (§1.3-§1.5) — read-only outside this class. */
  get replicatedTable(): ReplicatedTable {
    return this.table;
  }

  enqueue(frame: AssembledFrame): void {
    this.queued.push(frame);
    if (this.raf != null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.flush();
    });
  }

  flush(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    const batch = this.queued.sort((a, b) => a.sequence - b.sequence);
    this.queued = [];
    if (batch.length === 0) return;
    const start = performance.now();
    let lastSequence = 0;
    // SEAL-DOM-P0-FLUSH / PP-APPLY-1: stop the batch on first desync — do not apply later
    // frames over a dirty or already-reset table (lab client resets in onDesync).
    applyFramesUntilDesync(batch, (frame) => {
      lastSequence = frame.sequence;
      return this.applyFrame(frame);
    });
    const duration = performance.now() - start;
    const budget = this.options.applyBudgetMs ?? 4;
    if (duration > budget) this.options.onOverrun?.(duration, lastSequence);
  }

  reset(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.queued = [];
    this.table.reset();
    this.clearCssom();
  }

  /** @returns `false` when a desync was reported — `flush` must not apply later frames in the batch. */
  private applyFrame(frame: AssembledFrame): boolean {
    const start = performance.now();

    // Phase 1 (table) — §6, §P3: pure memory, no DOM. `preTableHash` is unchecked for resync
    // frames (§2 — "no prior state to check against a wholesale replace"); an ordinary frame's
    // `preTableHash` must match this client's own table *before* any op in it applies.
    if (!frame.resync && frame.preTableHash !== this.table.tableHash) {
      return this.fail('precondition', 'preTableHash', frame.preTableHash, this.table.tableHash);
    }
    const result = applyFrameToTableChecked(this.table, frame.resync, frame.ops, frame.sequence);
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
        if (!this.applyOp(frame.ops[i]!)) return false;
      } catch {
        return this.fail('malformed', 'apply', 0);
      }
    }
    if (!this.cssomHandlesMatchTable()) return false;
    this.options.onApplied?.(frame, performance.now() - start);
    return true;
  }

  private fail(reason: DomDesyncReason, opName: string, expected: bigint, actual: bigint): false;
  private fail(reason: DomDesyncReason, opName: string, id: number): false;
  private fail(reason: DomDesyncReason, opName: string, a: number | bigint, b?: bigint): false {
    if (typeof a === 'bigint') {
      this.options.onDesync?.({ reason, op: opName, id: 0, expected: a, actual: b });
    } else {
      this.options.onDesync?.({ reason, op: opName, id: a });
    }
    return false;
  }

  /** Phase-1 Pre / `MAX_ROWS` failures — `message` for diagnostics, explicit `phase`. */
  private failOp(reason: 'malformed' | 'precondition', opName: string, id: number, message: string): false {
    this.options.onDesync?.({ reason, op: opName, id, message, phase: 'apply' });
    return false;
  }

  private applyOp(op: FrameOp): boolean {
    switch (op.op) {
      case OpCode.Check:
        return true; // §4.1 — no DOM effect; already evaluated in phase 1
      case OpCode.EpochReset:
        return this.applyEpochReset();
      case OpCode.StrDef:
        return true; // already resolved at decode time (decode.ts PersistentStringTable)
      case OpCode.NodeNew:
        return this.applyNodeNew(op);
      case OpCode.NodeDrop:
        return this.applyNodeDrop(op);
      case OpCode.Insert:
        return this.applyInsert(op);
      case OpCode.Remove:
        return this.applyRemove(op);
      case OpCode.AttrSet:
        return this.applyAttrSet(op);
      case OpCode.AttrDel:
        return this.applyAttrDel(op);
      case OpCode.TextSet:
        return this.applyTextSet(op);
      case OpCode.SheetNew:
        return this.applySheetNew(op);
      case OpCode.SheetDrop:
        return this.applySheetDrop(op);
      case OpCode.SheetOrder:
        return this.applySheetOrder(op);
      case OpCode.RuleNew:
        return this.applyRuleNew(op);
      case OpCode.RuleDrop:
        return this.applyRuleDrop(op);
      case OpCode.RuleSet:
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
  private applyEpochReset(): boolean {
    this.doc.replaceChildren();
    this.registry.clear();
    this.registry.register(DOCUMENT_ID, this.doc);
    this.clearCssom();
    return true;
  }

  private clearCssom(): void {
    this.sheets.clear();
    this.rules.clear();
    try {
      this.doc.adoptedStyleSheets = [];
    } catch {
      /* adoptedStyleSheets may be missing on a test document */
    }
  }

  /**
   * After the frame: every table Sheet/Rule row must have a live handle in claimed sheet/order
   * (SEAL-CSSOM-P0-EOF / PP-CSSOM-A-3) — not sheet handles alone.
   */
  private cssomHandlesMatchTable(): boolean {
    const tableSheetIds = orderedSheetIds(this.table);
    const liveSheetIdsPresent = new Set<number>();
    const tableRuleIdsBySheet = new Map<number, readonly number[]>();
    const liveRuleIdsBySheet = new Map<number, readonly number[]>();

    for (let i = 0; i < tableSheetIds.length; i++) {
      const sheetId = tableSheetIds[i]!;
      tableRuleIdsBySheet.set(sheetId, orderedRuleIds(this.table, sheetId));
      const sheet = this.sheets.get(sheetId);
      if (sheet === undefined) continue;
      liveSheetIdsPresent.add(sheetId);

      const liveRuleIds: number[] = [];
      for (let k = 0; k < sheet.cssRules.length; k++) {
        const live = sheet.cssRules.item(k);
        if (live === null) {
          return this.fail('address_miss', 'ruleNew', sheetId);
        }
        let mapped: number | undefined;
        for (const [id, bound] of this.rules) {
          if (bound === live) {
            mapped = id;
            break;
          }
        }
        if (mapped === undefined) {
          return this.fail('address_miss', 'ruleNew', sheetId);
        }
        liveRuleIds.push(mapped);
      }
      liveRuleIdsBySheet.set(sheetId, liveRuleIds);
    }

    const result = matchCssomEndOfFrame(
      tableSheetIds,
      tableRuleIdsBySheet,
      liveSheetIdsPresent,
      liveRuleIdsBySheet,
    );
    if (!result.ok) return this.fail('address_miss', result.op, result.id);
    return true;
  }

  private adoptedList(): CSSStyleSheet[] {
    return Array.from(this.doc.adoptedStyleSheets);
  }

  private setAdopted(next: CSSStyleSheet[]): boolean {
    try {
      this.doc.adoptedStyleSheets = next;
      return true;
    } catch {
      return this.fail('malformed', 'sheetOrder', 0);
    }
  }

  private materializedSheetIds(): number[] {
    const list = this.adoptedList();
    const ids: number[] = [];
    for (let i = 0; i < list.length; i++) {
      const sheet = list[i]!;
      for (const [id, bound] of this.sheets) {
        if (bound === sheet) {
          ids.push(id);
          break;
        }
      }
    }
    return ids;
  }

  private applySheetNew(op: Extract<FrameOp, { op: OpCode.SheetNew }>): boolean {
    if (op.scope === CSSOM_SCOPE_PIERCE_HOST || op.hostNode !== 0) {
      return this.fail('bad_target', 'sheetNew', op.id);
    }
    if (this.sheets.has(op.id)) return this.fail('bad_target', 'sheetNew', op.id);
    const view = this.doc.defaultView;
    if (view === null) return this.fail('bad_target', 'sheetNew', op.id);
    let sheet: CSSStyleSheet;
    try {
      sheet = new view.CSSStyleSheet();
    } catch {
      return this.fail('malformed', 'sheetNew', op.id);
    }
    const at = insertIndexFromBefore(this.materializedSheetIds(), op.before);
    if (at < 0) return this.fail('address_miss', 'sheetNew', op.before);
    const next = this.adoptedList();
    next.splice(at, 0, sheet);
    if (!this.setAdopted(next)) return false;
    this.sheets.set(op.id, sheet);
    return true;
  }

  private applySheetDrop(op: Extract<FrameOp, { op: OpCode.SheetDrop }>): boolean {
    const drop = new Set<CSSStyleSheet>();
    for (let i = 0; i < op.ids.length; i++) {
      const id = op.ids[i]!;
      const sheet = this.sheets.get(id);
      if (sheet === undefined) return this.fail('address_miss', 'sheetDrop', id);
      drop.add(sheet);
      for (const [ruleId, rule] of this.rules) {
        if (rule.parentStyleSheet === sheet) this.rules.delete(ruleId);
      }
      this.sheets.delete(id);
    }
    const next = this.adoptedList().filter((s) => !drop.has(s));
    return this.setAdopted(next);
  }

  private applySheetOrder(op: Extract<FrameOp, { op: OpCode.SheetOrder }>): boolean {
    const next: CSSStyleSheet[] = [];
    for (let i = 0; i < op.ids.length; i++) {
      const sheet = this.sheets.get(op.ids[i]!);
      if (sheet === undefined) return this.fail('address_miss', 'sheetOrder', op.ids[i]!);
      next.push(sheet);
    }
    return this.setAdopted(next);
  }

  private applyRuleNew(op: Extract<FrameOp, { op: OpCode.RuleNew }>): boolean {
    const sheet = this.sheets.get(op.sheet);
    if (sheet === undefined) return this.fail('address_miss', 'ruleNew', op.sheet);
    if (this.rules.has(op.id)) return this.fail('bad_target', 'ruleNew', op.id);
    let index: number;
    if (op.before === INSERT_AT_END) {
      index = sheet.cssRules.length;
    } else {
      const beforeRule = this.rules.get(op.before);
      if (beforeRule === undefined) return this.fail('address_miss', 'ruleNew', op.before);
      index = -1;
      for (let k = 0; k < sheet.cssRules.length; k++) {
        if (sheet.cssRules.item(k) === beforeRule) {
          index = k;
          break;
        }
      }
      if (index < 0) return this.fail('address_miss', 'ruleNew', op.before);
    }
    let inserted: number;
    try {
      inserted = sheet.insertRule(op.text, index);
    } catch {
      return this.fail('malformed', 'ruleNew', op.id);
    }
    const rule = sheet.cssRules.item(inserted);
    if (rule === null) return this.fail('address_miss', 'ruleNew', op.id);
    this.rules.set(op.id, rule);
    return true;
  }

  private applyRuleDrop(op: Extract<FrameOp, { op: OpCode.RuleDrop }>): boolean {
    const sheet = this.sheets.get(op.sheet);
    if (sheet === undefined) return this.fail('address_miss', 'ruleDrop', op.sheet);
    for (let i = 0; i < op.ids.length; i++) {
      const id = op.ids[i]!;
      const rule = this.rules.get(id);
      if (rule === undefined) return this.fail('address_miss', 'ruleDrop', id);
      let at = -1;
      for (let k = 0; k < sheet.cssRules.length; k++) {
        if (sheet.cssRules.item(k) === rule) {
          at = k;
          break;
        }
      }
      if (at < 0) return this.fail('address_miss', 'ruleDrop', id);
      sheet.deleteRule(at);
      this.rules.delete(id);
    }
    return true;
  }

  private applyRuleSet(op: Extract<FrameOp, { op: OpCode.RuleSet }>): boolean {
    const rule = this.rules.get(op.id);
    if (rule === undefined) return this.fail('address_miss', 'ruleSet', op.id);
    const view = this.doc.defaultView;
    const StyleRule = view !== null ? view.CSSStyleRule : undefined;
    const isStyle = StyleRule !== undefined && rule instanceof StyleRule;
    // SEAL-CSSOM-P0-RULESET: non-CSSStyleRule must desync — never silent cssText no-op.
    if (planRuleSetApply(isStyle).mode === 'desync') {
      return this.fail('bad_target', 'ruleSet', op.id);
    }
    try {
      (rule as CSSStyleRule).style.cssText = declarationBlockFromRuleText(op.text);
      return true;
    } catch {
      return this.fail('malformed', 'ruleSet', op.id);
    }
  }

  /** §4.2 `NODE_DROP` `DOM` effect: "none — the subtree is already detached." Registry-only. */
  private applyNodeDrop(op: Extract<FrameOp, { op: OpCode.NodeDrop }>): boolean {
    for (let i = 0; i < op.ids.length; i++) {
      const node = this.registry.get(op.ids[i]!);
      if (node !== undefined) this.registry.unregisterSubtree(node);
    }
    return true;
  }

  private applyNodeNew(op: Extract<FrameOp, { op: OpCode.NodeNew }>): boolean {
    let node: Node;
    if (op.kind === NodeKind.Element) {
      if (op.ns === ElementNs.Custom && !(op.uri && op.uri.length > 0)) {
        return this.fail('malformed', 'nodeNew', op.id);
      }
      const uri = elementNsUri(op.ns, op.uri);
      node = this.doc.createElementNS(uri, op.name);
      // SEAL-DOM-P0-ATTR: register only after attrs land — failed setAttribute → desync.
      if (!applyAttrs(node as Element, op.attrs)) {
        return this.fail('malformed', 'nodeNew', op.id);
      }
    } else if (op.kind === NodeKind.Text) {
      node = this.doc.createTextNode(op.value);
    } else if (op.kind === NodeKind.Comment) {
      node = this.doc.createComment(op.value);
    } else if (op.kind === NodeKind.Doctype) {
      node = this.doc.implementation.createDocumentType(op.name || 'html', '', '');
    } else {
      return this.fail('bad_target', 'nodeNew', op.id);
    }
    this.registry.register(op.id, node);
    return true;
  }

  private applyInsert(op: Extract<FrameOp, { op: OpCode.Insert }>): boolean {
    const parent = this.registry.get(op.parent);
    if (!parent) return this.fail('address_miss', 'insert', op.parent);
    let before: Node | null = null;
    if (op.before !== INSERT_AT_END) {
      before = this.registry.get(op.before) ?? null;
      if (before === null) return this.fail('address_miss', 'insert', op.before);
    }
    for (let i = 0; i < op.ids.length; i++) {
      const id = op.ids[i]!;
      const node = this.registry.get(id);
      if (!node) return this.fail('address_miss', 'insert', id);
      parent.insertBefore(node, before);
    }
    return true;
  }

  private applyRemove(op: Extract<FrameOp, { op: OpCode.Remove }>): boolean {
    const parent = this.registry.get(op.parent);
    if (!parent) return this.fail('address_miss', 'remove', op.parent);
    for (let i = 0; i < op.ids.length; i++) {
      const id = op.ids[i]!;
      const node = this.registry.get(id);
      if (!node) return this.fail('address_miss', 'remove', id);
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

  private applyAttrSet(op: Extract<FrameOp, { op: OpCode.AttrSet }>): boolean {
    const node = this.registry.get(op.node);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return this.fail('address_miss', 'attrSet', op.node);
    if (!applyAttrs(node as Element, op.attrs)) {
      return this.fail('malformed', 'attrSet', op.node);
    }
    return true;
  }

  private applyAttrDel(op: Extract<FrameOp, { op: OpCode.AttrDel }>): boolean {
    const node = this.registry.get(op.node);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return this.fail('address_miss', 'attrDel', op.node);
    const el = node as Element;
    for (let i = 0; i < op.names.length; i++) el.removeAttribute(op.names[i]!);
    return true;
  }

  private applyTextSet(op: Extract<FrameOp, { op: OpCode.TextSet }>): boolean {
    const node = this.registry.get(op.node);
    if (!node) return this.fail('address_miss', 'textSet', op.node);
    node.textContent = op.value;
    return true;
  }
}

/** SEAL-DOM-P0-ATTR / PP-APPLY-2: failed setAttribute → false (callers desync). */
function applyAttrs(el: Element, attrs: AttrPair[]): boolean {
  return applyAttrPairs((name, value) => el.setAttribute(name, value), attrs);
}
