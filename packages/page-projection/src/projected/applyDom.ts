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

import { NodeKind, OpCode } from '../core/opcodes';
import { ElementNs, elementNsUri } from '../core/elementNs';
import { applyFramesUntilDesync } from '../core/applyBatch';
import {
  CSSOM_SCOPE_PIERCE_HOST,
  DOCUMENT_ID,
  INSERT_AT_END,
  SHADOW_INIT_CLONABLE,
  SHADOW_INIT_DELEGATES_FOCUS,
  SHADOW_INIT_SERIALIZABLE,
  SHADOW_MODE_CLOSED,
  type AttrPair,
  type FrameOp,
  type PropSetOp,
} from '../core/frame';
import { FormPropDirty } from '../core/formPropDirty';
import { PROP_ID_CHECKED, PROP_ID_SELECTED, PROP_ID_VALUE } from '../core/propSet';
import { applyAttrPairs } from '../core/attrApply';
import { insertIndexFromBefore, allSheetIds, orderedRuleIds, matchCssomEndOfFrame, declarationBlockFromRuleText } from '../core/cssomApplyIndex';
import { planRuleSetApply } from '../core/cssomRuleSet';
import type { AssembledFrame } from '../core/decode';
import { ReplicatedTable } from '../core/replicatedTable';
import { applyFrameToTableChecked } from '../core/replicatedTableApply';
import type { PageProjectionRegistry } from './registry';
import { isNestedHostNavAttr } from '../core/nestedNav';
import {
  installScriptingOnPaintParity,
  paintParityInstalled,
  paritySheetForDocument,
  withScriptingOnPaintParity,
} from './scriptingOnPaintParity';
import {
  stampProjectedStandardsSrcdoc,
} from './projectedBlankIframe';
import { registerClosedShadowRoot } from '../core/closedShadowLookup';

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
  /** Client-side warn (e.g. paint-parity sheet failed) — not a table desync. */
  onWarn?: (message: string) => void;
  applyBudgetMs?: number;
  /** Parent installs the nested apply into this blank host. */
  onNestedHost?: (el: HTMLIFrameElement, childScopeId: number) => void;
  /** Host row dropped — dispose the nested apply for that childScopeId. */
  onNestedHostDrop?: (childScopeId: number) => void;
  /**
   * Stamp `/w7s/virtual-*` URLs with session auth before paint (virtual-assets §1.1).
   * Composition root supplies token + asset base; applier stays host-agnostic.
   */
  stampUrl?: (name: string, value: string) => string;
  /** Stamp cssText / rule text the same way. */
  stampCssText?: (text: string) => string;
}

export class DomFrameApplier {
  private queued: AssembledFrame[] = [];
  private raf: number | null = null;
  private readonly doc: Document;
  private readonly registry: PageProjectionRegistry;
  private readonly options: DomFrameApplierOptions;
  private readonly table = new ReplicatedTable();
  private readonly propDirty = new FormPropDirty();
  private readonly sheets = new Map<number, CSSStyleSheet>();
  private readonly rules = new Map<number, CSSRule>();
  /** Sheet id → `hostNode` (0 = document adopted list). Survives phase-1 drop of the row. */
  private readonly sheetHost = new Map<number, number>();
  private readonly childScopes = new Map<number, number>();
  private readonly nestedHostIds = new Set<number>();
  private paritySheet: CSSStyleSheet | null = null;

  constructor(doc: Document, registry: PageProjectionRegistry, options: DomFrameApplierOptions = {}) {
    this.doc = doc;
    this.registry = registry;
    this.options = options;
    // Document must already be a projected blank (srcdoc birth + strip). K4 is iframe birth
    // work — this applier cannot repair a BackCompat / orphan Document.
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
    this.propDirty.reset();
    this.childScopes.clear();
    this.nestedHostIds.clear();
    this.clearCssom();
  }

  /**
   * End of this document install (runtime-redesign.md §7): a generation change destroys the
   * instance instead of enumerating what to clear. Everything the `tableHash` does not cover —
   * sheets, rules, parity sheet, prop-dirty, child scopes — dies with the object; only the
   * nested appliers the parent installed on our behalf need an explicit goodbye.
   */
  dispose(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.queued = [];
    for (const childScopeId of this.childScopes.values()) {
      this.options.onNestedHostDrop?.(childScopeId);
    }
    this.childScopes.clear();
    this.nestedHostIds.clear();
  }

  /** Input plane marks this when the user is editing the control (§7.2). Unused in lab. */
  markPropDirty(id: number): void {
    this.propDirty.mark(id);
  }

  /** Lab/diag — node id bound to a nested context on this applier. */
  nestedHostNodeForContext(contextId: number): number | undefined {
    for (const [nodeId, ctx] of this.childScopes) {
      if (ctx === contextId) return nodeId;
    }
    return undefined;
  }

  /** Lab/diag — whether installNestedHost was triggered for this host row. */
  isNestedHostMarked(nodeId: number): boolean {
    return this.nestedHostIds.has(nodeId);
  }

  /** iframe/object/embed rows materialized but not yet marked nested-host on this applier. */
  unmarkedNestedHostCandidateIds(): number[] {
    const out: number[] = [];
    this.registry.forEachId((id, node) => {
      if (this.nestedHostIds.has(id)) return;
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = (node as Element).localName.toLowerCase();
      if (tag !== 'iframe' && tag !== 'object' && tag !== 'embed') return;
      out.push(id);
    });
    return out;
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
      const op = frame.ops[i]!;
      try {
        if (!this.applyOp(op)) return false;
      } catch (err) {
        const opLabel = op.op === OpCode.Insert
          ? `insert parent=${op.parent} before=${op.before} ids=[${op.ids.join(',')}]`
          : `op=${op.op}`;
        const errText =
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : typeof err === 'object' && err !== null && 'name' in err
              ? `${String((err as { name?: unknown }).name)}: ${String((err as { message?: unknown }).message ?? err)}`
              : String(err);
        const message = `${errText} @op[${i}]=${op.op} ${opLabel}`;
        return this.failOp('malformed', 'apply', 'id' in op && typeof (op as { id?: number }).id === 'number'
          ? (op as { id: number }).id
          : 0, message);
      }
    }
    if (!this.cssomHandlesMatchTable()) return false;
    this.ensurePaintParity();
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
      case OpCode.PropSet:
        return this.applyPropSet(op);
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

  private clearCssom(): void {
    this.sheets.clear();
    this.rules.clear();
    this.sheetHost.clear();
    this.paritySheet = null;
    try {
      installScriptingOnPaintParity(this.doc);
      const sheet = paritySheetForDocument(this.doc);
      this.paritySheet = sheet ?? null;
      this.doc.adoptedStyleSheets = sheet != null ? [sheet] : [];
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.options.onWarn?.(`scriptingOnPaintParity: clearCssom failed: ${detail}`);
    }
  }

  /**
   * K5 sandbox has no `allow-scripts`; hide `<noscript>` like Chromium with JS on.
   * Call after phase-2 materialize — `defaultView`/head can be gone mid-apply.
   */
  private ensurePaintParity(): void {
    installScriptingOnPaintParity(this.doc);
    const sheet = paritySheetForDocument(this.doc);
    if (sheet != null) this.paritySheet = sheet;
    if (!paintParityInstalled(this.doc) && this.doc.documentElement != null) {
      this.options.onWarn?.(
        'scriptingOnPaintParity: install failed after apply (no adopted sheet and no style element)',
      );
    }
  }

  /**
   * After the frame: every table Sheet/Rule row must have a live handle in claimed sheet/order
   * (SEAL-CSSOM-P0-EOF / PP-CSSOM-A-3) — not sheet handles alone.
   */
  private cssomHandlesMatchTable(): boolean {
    const tableSheetIds = allSheetIds(this.table);
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

  /** Iframe nodes fail `instanceof Element` from the parent realm — use this document's constructors. */
  private isElement(node: Node): node is Element {
    const view = this.doc.defaultView;
    return view !== null ? node instanceof view.Element : node.nodeType === Node.ELEMENT_NODE;
  }

  private shadowRootOfHost(hostNode: number): ShadowRoot | null {
    const node = this.registry.get(hostNode);
    if (!node) return null;
    if (this.isElement(node)) return node.shadowRoot;
    const view = this.doc.defaultView;
    if (view !== null && node instanceof view.ShadowRoot) return node;
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && (node as ShadowRoot).host != null) {
      return node as ShadowRoot;
    }
    const owned = this.table.shadowRootOf(hostNode);
    if (owned === 0) return null;
    const sr = this.registry.get(owned);
    if (!sr) return null;
    if (view !== null && sr instanceof view.ShadowRoot) return sr;
    if (sr.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return sr as ShadowRoot;
    return null;
  }

  private adoptedListOf(hostNode: number): CSSStyleSheet[] {
    if (hostNode === 0) {
      try {
        return Array.from(this.doc.adoptedStyleSheets);
      } catch {
        return [];
      }
    }
    const root = this.shadowRootOfHost(hostNode);
    if (root == null) return [];
    try {
      return Array.from(root.adoptedStyleSheets);
    } catch {
      return [];
    }
  }

  private setAdoptedOf(hostNode: number, next: CSSStyleSheet[]): boolean {
    try {
      if (hostNode === 0) {
        this.doc.adoptedStyleSheets = withScriptingOnPaintParity(this.doc, next);
        return true;
      }
      const root = this.shadowRootOfHost(hostNode);
      if (root == null) {
        return this.fail('address_miss', 'sheetNew', hostNode);
      }
      root.adoptedStyleSheets = next;
      return true;
    } catch {
      return this.fail('malformed', 'sheetOrder', hostNode);
    }
  }

  private adoptedList(): CSSStyleSheet[] {
    return this.adoptedListOf(0);
  }

  private setAdopted(next: CSSStyleSheet[]): boolean {
    return this.setAdoptedOf(0, next);
  }

  private materializedSheetIdsOf(hostNode: number): number[] {
    const list = this.adoptedListOf(hostNode);
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

  private materializedSheetIds(): number[] {
    return this.materializedSheetIdsOf(0);
  }

  private applySheetNew(op: Extract<FrameOp, { op: OpCode.SheetNew }>): boolean {
    const pierce = op.scope === CSSOM_SCOPE_PIERCE_HOST || op.hostNode !== 0;
    const hostNode = pierce ? op.hostNode : 0;
    if (pierce && this.shadowRootOfHost(hostNode) == null) {
      return this.fail('address_miss', 'sheetNew', hostNode);
    }
    if (this.sheets.has(op.id)) return true;
    const view = this.doc.defaultView;
    if (view === null) return this.fail('bad_target', 'sheetNew', op.id);
    let sheet: CSSStyleSheet;
    try {
      sheet = new view.CSSStyleSheet();
    } catch {
      return this.fail('malformed', 'sheetNew', op.id);
    }
    const at = insertIndexFromBefore(this.materializedSheetIdsOf(hostNode), op.before);
    if (at < 0) return this.fail('address_miss', 'sheetNew', op.before);
    const next = this.adoptedListOf(hostNode);
    next.splice(at, 0, sheet);
    if (!this.setAdoptedOf(hostNode, next)) return false;
    this.sheets.set(op.id, sheet);
    this.sheetHost.set(op.id, hostNode);
    return true;
  }

  private applySheetDrop(op: Extract<FrameOp, { op: OpCode.SheetDrop }>): boolean {
    const dropByHost = new Map<number, Set<CSSStyleSheet>>();
    for (let i = 0; i < op.ids.length; i++) {
      const id = op.ids[i]!;
      const sheet = this.sheets.get(id);
      if (sheet === undefined) return this.fail('address_miss', 'sheetDrop', id);
      const hostNode = this.sheetHost.get(id) ?? 0;
      let set = dropByHost.get(hostNode);
      if (set === undefined) {
        set = new Set();
        dropByHost.set(hostNode, set);
      }
      set.add(sheet);
      for (const [ruleId, rule] of this.rules) {
        if (rule.parentStyleSheet === sheet) this.rules.delete(ruleId);
      }
      this.sheets.delete(id);
      this.sheetHost.delete(id);
    }
    for (const [hostNode, drop] of dropByHost) {
      const next = this.adoptedListOf(hostNode).filter((s) => !drop.has(s));
      if (!this.setAdoptedOf(hostNode, next)) return false;
    }
    return true;
  }

  private applySheetOrder(op: Extract<FrameOp, { op: OpCode.SheetOrder }>): boolean {
    if (op.ids.length === 0) return true;
    const hostNode = this.sheetHost.get(op.ids[0]!) ?? 0;
    const next: CSSStyleSheet[] = [];
    for (let i = 0; i < op.ids.length; i++) {
      const sheet = this.sheets.get(op.ids[i]!);
      if (sheet === undefined) return this.fail('address_miss', 'sheetOrder', op.ids[i]!);
      next.push(sheet);
    }
    return this.setAdoptedOf(hostNode, next);
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
      inserted = sheet.insertRule(this.options.stampCssText?.(op.text) ?? op.text, index);
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
      (rule as CSSStyleRule).style.cssText = declarationBlockFromRuleText(
        this.options.stampCssText?.(op.text) ?? op.text,
      );
      return true;
    } catch {
      return this.fail('malformed', 'ruleSet', op.id);
    }
  }

  /** §4.2 `NODE_DROP` `DOM` effect: "none — the subtree is already detached." Registry-only. */
  private applyNodeDrop(op: Extract<FrameOp, { op: OpCode.NodeDrop }>): boolean {
    for (const hostId of [...this.childScopes.keys()]) {
      if (!this.table.has(hostId)) {
        const childScopeId = this.childScopes.get(hostId);
        this.childScopes.delete(hostId);
        this.nestedHostIds.delete(hostId);
        if (childScopeId !== undefined) this.options.onNestedHostDrop?.(childScopeId);
      }
    }
    for (let i = 0; i < op.ids.length; i++) {
      const id = op.ids[i]!;
      const node = this.registry.get(id);
      if (node !== undefined) this.registry.unregisterSubtree(node);
    }
    for (const id of [...this.sheets.keys()]) {
      if (this.table.has(id)) continue;
      const sheet = this.sheets.get(id);
      this.sheets.delete(id);
      this.sheetHost.delete(id);
      if (sheet === undefined) continue;
      for (const [ruleId, rule] of this.rules) {
        if (rule.parentStyleSheet === sheet) this.rules.delete(ruleId);
      }
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
      // K4 nested host: stamp standards srcdoc **before** INSERT so the first navigation is
      // never about:blank BackCompat. installNestedHost waits for load then strips.
      if (op.nestedHost === true) {
        stampProjectedStandardsSrcdoc(node as HTMLIFrameElement);
      }
      const attrs =
        op.nestedHost === true ? op.attrs.filter((a) => !isNestedHostNavAttr(a.name)) : op.attrs;
      // SEAL-DOM-P0-ATTR: register only after attrs land — failed setAttribute → desync.
      if (!applyAttrs(node as Element, attrs, this.options.stampUrl)) {
        return this.fail('malformed', 'nodeNew', op.id);
      }
      if (op.nestedHost === true && op.childScopeId != null) {
        this.childScopes.set(op.id, op.childScopeId);
        this.nestedHostIds.add(op.id);
      }
    } else if (op.kind === NodeKind.Text) {
      node = this.doc.createTextNode(op.value);
    } else if (op.kind === NodeKind.Comment) {
      node = this.doc.createComment(op.value);
      } else if (op.kind === NodeKind.Doctype) {
      const want = op.name || 'html';
      const existing = this.doc.doctype;
      if (existing && existing.name === want) {
        // Keep the CSS1Compat doctype from projected blank srcdoc birth (K4).
        node = existing;
      } else {
        if (existing) existing.remove();
        // Orphaned documents (defaultView null after iframe nav) return null here — desync,
        // never hand null to the registry WeakMap.
        const created = this.doc.implementation.createDocumentType(want, '', '');
        if (created == null) {
          return this.failOp(
            'malformed',
            'nodeNew',
            op.id,
            'createDocumentType returned null (document has no browsing context)',
          );
        }
        node = created;
      }
    } else if (op.kind === NodeKind.ShadowRoot) {
      const host = this.registry.get(op.host);
      if (!host || host.nodeType !== Node.ELEMENT_NODE) return this.fail('address_miss', 'nodeNew', op.host);
      const el = host as Element;
      if (el.shadowRoot) return this.fail('bad_target', 'nodeNew', op.id);
      const init: ShadowRootInit = { mode: op.mode === SHADOW_MODE_CLOSED ? 'closed' : 'open' };
      if ((op.initFlags & SHADOW_INIT_DELEGATES_FOCUS) !== 0) init.delegatesFocus = true;
      const extra = init as ShadowRootInit & { clonable?: boolean; serializable?: boolean };
      if ((op.initFlags & SHADOW_INIT_CLONABLE) !== 0) extra.clonable = true;
      if ((op.initFlags & SHADOW_INIT_SERIALIZABLE) !== 0) extra.serializable = true;
      try {
        node = el.attachShadow(init);
        if (init.mode === 'closed') {
          registerClosedShadowRoot(el, node as ShadowRoot);
        }
      } catch {
        return this.fail('malformed', 'nodeNew', op.id);
      }
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
      // Standards seed may already own this DocumentType — re-insert throws HierarchyRequestError.
      if (
        node.nodeType === Node.DOCUMENT_TYPE_NODE
        && parent === this.doc
        && this.doc.doctype === node
      ) {
        continue;
      }
      parent.insertBefore(node, before);
      this.maybeInstallNestedHost(id, node);
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
    const attrs = this.nestedHostIds.has(op.node)
      ? op.attrs.filter((a) => !isNestedHostNavAttr(a.name))
      : op.attrs;
    if (!applyAttrs(node as Element, attrs, this.options.stampUrl)) {
      return this.fail('malformed', 'attrSet', op.node);
    }
    this.maybeInstallNestedHost(op.node, node);
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

  private applyPropSet(op: PropSetOp): boolean {
    if (this.propDirty.isDirty(op.node)) {
      this.propDirty.hold(op);
      return true;
    }
    const node = this.registry.get(op.node);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return this.fail('address_miss', 'propSet', op.node);
    const el = node as HTMLElement;
    if (op.propId === PROP_ID_VALUE && 'value' in el) {
      (el as HTMLInputElement).value = String(op.value);
      return true;
    }
    if (op.propId === PROP_ID_CHECKED && 'checked' in el) {
      (el as HTMLInputElement).checked = Boolean(op.value);
      return true;
    }
    if (op.propId === PROP_ID_SELECTED && el instanceof HTMLOptionElement) {
      el.selected = Boolean(op.value);
      return true;
    }
    return true;
  }

  /**
   * Install nested apply when the row is a marked host with a live browsing context.
   * Invariant: install is a function of host state (marked + contentWindow), not which op
   * revealed it (NODE_NEW, AttrSet, INSERT, …).
   */
  private maybeInstallNestedHost(id: number, node: Node): void {
    if (!this.nestedHostIds.has(id)) return;
    const childScopeId = this.childScopes.get(id);
    if (childScopeId === undefined) return;
    const el = node as HTMLIFrameElement;
    // Projected host stays about:blank. ProjectionClient waits for the initial `load`
    // before binding NestedProjectedApply (pre-load contentDocument is discarded).
    if (el.contentWindow) this.options.onNestedHost?.(el, childScopeId);
  }
}

/** SEAL-DOM-P0-ATTR / PP-APPLY-2: failed setAttribute → false (callers desync). */
function applyAttrs(
  el: Element,
  attrs: AttrPair[],
  stampUrl?: (name: string, value: string) => string,
): boolean {
  return applyAttrPairs((name, value) => {
    const stamped = stampUrl ? stampUrl(name, value) : value;
    el.setAttribute(name, stamped);
  }, attrs);
}
