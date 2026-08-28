/**
 * Algorithm use case: state snapshot (lab/debug). Inclusion is tunable.
 * Resync is not this file — {@link ./resync.ts} always pays the full system.
 */

import type { ReplicatedTable } from '../core/replicatedTable';
import { digestReplicatedTable } from '../core/tableDigest';
import type { TableLiveOracleResult } from '../core/tableLiveOracle';
import type { CssomTableLiveOracleResult } from '../core/cssomTableLiveOracle';
import type { FrameOp } from '../core/frame';
import { OpCode } from '../core/opcodes';
import type { DomNodeTable } from './dom/domNodeTable';
import { compareTableToLiveDom } from './dom/tableLiveOracle';
import type { CssomPlane } from './cssom/cssomPlane';
import type { CssomIds } from './cssom/cssomIds';
import { compareTableToLiveCssomDom } from './cssom/cssomTableLiveOracle';
import { stampCssomPoll, type CssomPollStats } from '../core/telemetry';
import { snapshotFormControls } from './dom/formPropIndex';
import type { FormControlSnap } from '../core/formControlSnap';

/** What CSSOM truth this snapshot needs. */
export type SnapshotCssom = 'none' | 'committed' | 'scan';

export type SnapshotOptions = {
  cssom?: SnapshotCssom;
};

/** PP-FR-1: every NODE_NEW in the frame just flushed is still `isConnected` on Virtual. */
export type NodeNewConnectedProbe = {
  ok: boolean;
  checked: number;
  disconnectedIds: number[];
};

/** PP-CSSOM-A-2: author `<style>` vs constructed adopted paint boundary. */
export type CssomPaintBoundaryProbe = {
  authorColor: string;
  adoptedColor: string;
  adoptedCount: number;
  styleSheetCount: number;
  styleElCount: number;
  doublePaint: boolean;
};

export type SnapshotResult = {
  generation: number;
  sequence: number;
  o2: TableLiveOracleResult;
  table: { rowCount: number; tableHash: string };
  cssom: CssomPollStats | null;
  cssomO2: CssomTableLiveOracleResult | null;
  nodeNewConnected: NodeNewConnectedProbe;
  cascade: CssomPaintBoundaryProbe | null;
  formProps: FormControlSnap[];
};

export type SnapshotPlanes = {
  domNodes: DomNodeTable;
  table: ReplicatedTable;
  cssom: CssomPlane;
  cssomIds: CssomIds | null;
  currentSequence: () => number;
  /** Drain MO + emit the current DOM tick (pipe). Returns ops of the frame emitted this call. */
  flushDom: () => FrameOp[];
  /** Investigation only (I10). */
  recordCssomPoll?: (stats: CssomPollStats) => void;
};

function probeNodeNewConnected(ops: readonly FrameOp[], domNodes: DomNodeTable): NodeNewConnectedProbe {
  const disconnectedIds: number[] = [];
  let checked = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.op !== OpCode.NodeNew) continue;
    checked += 1;
    const node = domNodes.get(op.id);
    if (node === undefined || !node.isConnected) disconnectedIds.push(op.id);
  }
  return { ok: disconnectedIds.length === 0, checked, disconnectedIds };
}

function sheetCssText(sheet: CSSStyleSheet): string {
  try {
    const parts: string[] = [];
    for (let i = 0; i < sheet.cssRules.length; i++) {
      const r = sheet.cssRules.item(i);
      if (r) parts.push(r.cssText);
    }
    return parts.join('\n');
  } catch {
    return '';
  }
}

/** Null when the fixture has no `#author-probe` / `#adopted-probe` (other lab pages). */
export function probeCssomPaintBoundary(doc: Document): CssomPaintBoundaryProbe | null {
  const authorEl = doc.getElementById('author-probe');
  const adoptedEl = doc.getElementById('adopted-probe');
  if (!authorEl || !adoptedEl) return null;
  const view = doc.defaultView;
  const authorColor = view ? view.getComputedStyle(authorEl).color : '';
  const adoptedColor = view ? view.getComputedStyle(adoptedEl).color : '';
  const adopted = doc.adoptedStyleSheets ? Array.from(doc.adoptedStyleSheets) : [];
  const styleEls = Array.from(doc.querySelectorAll('style'));
  const authorTexts = new Set<string>();
  for (let i = 0; i < styleEls.length; i++) {
    const el = styleEls[i]!;
    const sheet = (el as HTMLStyleElement).sheet;
    if (sheet) authorTexts.add(sheetCssText(sheet));
    else if (el.textContent) authorTexts.add(el.textContent);
  }
  let doublePaint = false;
  for (let i = 0; i < adopted.length; i++) {
    const s = adopted[i]!;
    if (s.ownerNode) doublePaint = true;
    const text = sheetCssText(s);
    if (text.length > 0 && authorTexts.has(text)) doublePaint = true;
  }
  return {
    authorColor,
    adoptedColor,
    adoptedCount: adopted.length,
    styleSheetCount: doc.styleSheets.length,
    styleElCount: styleEls.length,
    doublePaint,
  };
}

/**
 * One JS turn: optional CSSOM scan stashed as pending, then flush, then O2 DOM + optional O2 CSSOM.
 * `none` — halt idle (I8). `committed` — flush includes a finished idle pass if any.
 * `scan` — blocking CSSOM then emit those ops on S, then compare live × table.
 */
export function takeSnapshot(planes: SnapshotPlanes, opts: SnapshotOptions = {}): SnapshotResult {
  const mode = opts.cssom ?? 'none';
  let cssom: CssomPollStats | null = null;
  let lastOps: FrameOp[] = [];
  if (mode === 'none') {
    planes.cssom.halt();
    lastOps = planes.flushDom();
  } else if (mode === 'committed') {
    lastOps = planes.flushDom();
  } else {
    const scan = planes.cssom.blockingScan(true);
    cssom = stampCssomPoll(scan.stats, { source: 'snapshotScan' });
    lastOps = planes.flushDom();
    cssom = stampCssomPoll(cssom, { sequence: planes.currentSequence() });
  }
  const o2 = compareTableToLiveDom(planes.table, planes.domNodes, document);
  const cssomO2 =
    mode === 'none'
      ? null
      : compareTableToLiveCssomDom(planes.table, planes.cssomIds, document, (host) =>
          planes.domNodes.keyOf(host),
        );
  return {
    generation: planes.domNodes.generation,
    sequence: planes.currentSequence(),
    o2,
    table: digestReplicatedTable(planes.table),
    cssom,
    cssomO2,
    nodeNewConnected: probeNodeNewConnected(lastOps, planes.domNodes),
    cascade: probeCssomPaintBoundary(document),
    formProps: snapshotFormControls(document),
  };
}
