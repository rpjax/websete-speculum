/**
 * In-page CSSOM poll — I3 detector. Copy refs, hash the copy, skip stale slots, abort mass
 * divergence. Emits §4.6 ops (phase 1 table). No CDP. No prototype hooks. C5 not relocked.
 */

import { diffRules, type RuleSnap } from './cssomReconcile';
import { fnv1a32 } from './fnv32';
import { CssomIds } from './cssomIds';
import { emitLiveCssomOps, emitResyncCssomOps, type CommittedSheet } from './cssomOps';
import { collectCssomPlaneSheets } from './cssomSheetList';
import {
  copyRuleRefs,
  isRuleSlotLive,
  liveRuleList,
  shouldAbortSheet,
} from './cssomWalk';
import type { FrameOp } from '../../models/frame';
import {
  countCssomOps,
  emptyCssomPollStats,
  stampCssomPoll,
  type CssomPollSource,
  type CssomPollStats,
} from '../../models/telemetry';

export type { CssomPollStats, CssomPollSource };

/** One poll pass — names match TelemetryCssomPoll (investigation, not an assert). */

export type ClassifiedSheets = {
  readable: { sheet: CSSStyleSheet; rules: CSSRuleList; hostNode: number }[];
  unreadableSheetCount: number;
};

export type SheetPollPiece = {
  snap: RuleSnap[];
  identityWalkMs: number;
  cssTextSerializeMs: number;
  topLevelRulesVisited: number;
  topLevelRulesSerialized: number;
  styleTagTextUnchanged: boolean;
  rulesAppeared: number;
  rulesDisappeared: number;
  rulesTextChangedInPlace: number;
  ruleListChanged: boolean;
  aborted: boolean;
  slotsSkipped: number;
};

export type SheetWalkState = {
  sheet: CSSStyleSheet;
  copyRefs: object[];
  copyLength: number;
  cursor: number;
  hashed: RuleSnap[];
  texts: Map<object, string>;
  staleSlots: number;
  identityWalkMs: number;
  cssTextSerializeMs: number;
  aborted: boolean;
};

export class CssomPoller {
  private readonly lastRules = new WeakMap<CSSStyleSheet, RuleSnap[]>();
  private readonly lastStyleTagTextHash = new WeakMap<CSSStyleSheet, number>();
  readonly ids: CssomIds;
  private lastSheetOrder: { sheet: object; hostNode: number }[] = [];
  private readonly hostIdOf: ((host: Element) => number) | undefined;

  constructor(ids?: CssomIds, hostIdOf?: (host: Element) => number) {
    this.ids = ids ?? new CssomIds();
    this.hostIdOf = hostIdOf;
  }

  classifySheets(doc: Document = document): ClassifiedSheets {
    const readable: { sheet: CSSStyleSheet; rules: CSSRuleList; hostNode: number }[] = [];
    let unreadableSheetCount = 0;
    for (const listed of collectCssomPlaneSheets(doc, this.hostIdOf)) {
      const list = tryCssRules(listed.sheet);
      if (list === null) unreadableSheetCount += 1;
      else readable.push({ sheet: listed.sheet, rules: list, hostNode: listed.hostNode });
    }
    return { readable, unreadableSheetCount };
  }

  /** Phase A — refs only. */
  beginSheetWalk(sheet: CSSStyleSheet, list: CSSRuleList): SheetWalkState {
    const t0 = performance.now();
    const copyRefs = copyRuleRefs(list);
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
  hashSheetBatch(walk: SheetWalkState, timeRemaining: () => number, floorMs: number): boolean {
    const list = tryCssRules(walk.sheet);
    const live = list ? liveRuleList(list) : [];
    const liveLen = list ? list.length : 0;

    while (walk.cursor < walk.copyRefs.length && timeRemaining() > floorMs) {
      const rule = walk.copyRefs[walk.cursor]!;
      walk.cursor += 1;
      if (!isRuleSlotLive(rule, walk.sheet, live)) {
        walk.staleSlots += 1;
        if (shouldAbortSheet(walk.copyLength, walk.staleSlots, liveLen)) {
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
        text = (rule as CSSRule).cssText;
      } catch {
        walk.staleSlots += 1;
        walk.cssTextSerializeMs += performance.now() - t0;
        continue;
      }
      walk.texts.set(rule, text);
      walk.hashed.push({ key: rule, contentHash: fnv1a32(text) });
      walk.cssTextSerializeMs += performance.now() - t0;
    }

    if (walk.cursor < walk.copyRefs.length) return true;
    if (shouldAbortSheet(walk.copyLength, walk.staleSlots, liveLen)) {
      walk.aborted = true;
      walk.hashed = [];
      walk.texts.clear();
    }
    return false;
  }

  finishSheetWalk(walk: SheetWalkState): SheetPollPiece {
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
        slotsSkipped: walk.staleSlots,
      };
    }

    const list = tryCssRules(walk.sheet);
    const live = list ? liveRuleList(list) : [];
    const hashByKey = new Map(walk.hashed.map((s) => [s.key, s] as const));
    const committed: RuleSnap[] = [];
    const texts = new Map<object, string>();
    for (const rule of live) {
      const row = hashByKey.get(rule);
      if (row === undefined) continue;
      committed.push(row);
      const t = walk.texts.get(rule);
      if (t !== undefined) texts.set(rule, t);
    }
    walk.hashed = committed;
    walk.texts = texts;

    const prev = this.lastRules.get(walk.sheet) ?? [];
    const delta = diffRules(prev, committed);
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
      slotsSkipped: walk.staleSlots,
    };
  }

  commitSheet(sheet: CSSStyleSheet, snap: RuleSnap[]): void {
    this.lastRules.set(sheet, snap);
    const hash = styleElementTextHash(sheet);
    if (hash !== null) this.lastStyleTagTextHash.set(sheet, hash);
  }

  /** Whole-pass commit: lastRules + live/resync ops. Skips aborted pieces. */
  commitPass(
    readable: readonly { sheet: CSSStyleSheet; hostNode: number }[],
    pieces: readonly SheetPollPiece[],
    textsBySheet: WeakMap<CSSStyleSheet, Map<object, string>>,
    mode: 'live' | 'resync',
  ): FrameOp[] {
    const nextOrder: CommittedSheet[] = [];
    const hashed: CommittedSheet[] = [];
    for (let i = 0; i < readable.length; i++) {
      const rec = readable[i]!;
      const piece = pieces[i]!;
      if (!piece || piece.aborted) {
        nextOrder.push({
          sheet: rec.sheet,
          hostNode: rec.hostNode,
          snaps: this.lastRules.get(rec.sheet) ?? [],
          texts: new Map(),
          skipOps: true,
        });
        continue;
      }
      const committed: CommittedSheet = {
        sheet: rec.sheet,
        hostNode: rec.hostNode,
        snaps: piece.snap,
        texts: textsBySheet.get(rec.sheet) ?? new Map(),
      };
      nextOrder.push(committed);
      hashed.push(committed);
    }
    const ops =
      mode === 'resync'
        ? emitResyncCssomOps(this.ids, hashed)
        : emitLiveCssomOps(this.ids, this.lastSheetOrder, nextOrder, this.lastRules);
    for (const c of hashed) this.commitSheet(c.sheet as CSSStyleSheet, c.snaps);
    this.lastSheetOrder = nextOrder.map((c) => ({ sheet: c.sheet, hostNode: c.hostNode }));
    return ops;
  }

  /**
   * Blocking A+B (resync / snapshot scan). Commits non-aborted sheets then snapshot ops.
   */
  poll(doc: Document = document, mode: 'live' | 'resync' = 'resync'): { stats: CssomPollStats; ops: FrameOp[] } {
    const t0 = performance.now();
    const { readable, unreadableSheetCount } = this.classifySheets(doc);
    const pieces: SheetPollPiece[] = [];
    const textsBySheet = new WeakMap<CSSStyleSheet, Map<object, string>>();
    for (const { sheet, rules } of readable) {
      const walk = this.beginSheetWalk(sheet, rules);
      this.hashSheetBatch(walk, () => 1e9, 0);
      const piece = this.finishSheetWalk(walk);
      pieces.push(piece);
      if (!piece.aborted) textsBySheet.set(sheet, walk.texts);
    }
    const ops = this.commitPass(
      readable,
      pieces,
      textsBySheet,
      mode,
    );
    return {
      stats: foldSheetPieces(unreadableSheetCount, pieces, performance.now() - t0, {
        source: mode === 'resync' ? 'resync' : 'idle',
        idleSlices: 0,
        ops,
      }),
      ops,
    };
  }
}

export function foldSheetPieces(
  unreadableSheetCount: number,
  pieces: readonly SheetPollPiece[],
  pollMs: number,
  extra: { source: CssomPollSource; idleSlices: number; ops: readonly FrameOp[]; sequence?: number },
): CssomPollStats {
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
  let sheetsAborted = 0;
  let slotsSkipped = 0;
  for (const p of pieces) {
    identityWalkMs += p.identityWalkMs;
    cssTextSerializeMs += p.cssTextSerializeMs;
    topLevelRulesVisited += p.topLevelRulesVisited;
    topLevelRulesSerialized += p.topLevelRulesSerialized;
    slotsSkipped += p.slotsSkipped;
    if (p.aborted) {
      sheetsAborted += 1;
      continue;
    }
    readable += 1;
    if (p.styleTagTextUnchanged) styleTagTextUnchangedSheets += 1;
    rulesAppeared += p.rulesAppeared;
    rulesDisappeared += p.rulesDisappeared;
    rulesTextChangedInPlace += p.rulesTextChangedInPlace;
    if (p.ruleListChanged) sheetsWithRuleListChanged += 1;
  }
  return stampCssomPoll(emptyCssomPollStats(), {
    source: extra.source,
    sequence: extra.sequence ?? 0,
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
    sheetsAborted,
    slotsSkipped,
    idleSlices: extra.idleSlices,
    ...countCssomOps(extra.ops),
  });
}

function tryCssRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

function styleElementTextHash(sheet: CSSStyleSheet): number | null {
  const node = sheet.ownerNode;
  if (node === null || node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  if (el.localName !== 'style') return null;
  return fnv1a32(el.textContent ?? '');
}

export { emptyCssomPollStats } from '../../models/telemetry';
