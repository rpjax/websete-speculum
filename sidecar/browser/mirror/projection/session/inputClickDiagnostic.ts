/**
 * Manual click diagnostic — one dump after a Projected pointer event (lab browse).
 * Combines client capture counters, sidecar rejects, last resolve, root elementFromPoint.
 */

import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';

export type LastClickResolveRecord = {
  contextId: number;
  nodeId: number;
  localX?: number;
  localY?: number;
  ok: boolean;
  x?: number;
  y?: number;
  reason?: string;
  atMs: number;
};

export type LastInputIntentRecord = {
  type: string;
  contextId?: number;
  nodeId?: number | null;
  localX?: number;
  localY?: number;
  x?: number;
  y?: number;
  /** Wire ingress stamp — recorded from DomInputIngress, not UnifiedIntent. */
  schemaVersion: number;
  viewportW: number;
  viewportH: number;
  /** Wire ingress census JSON (null when absent). */
  census: string | null;
  atMs: number;
};

export type InputRejectMetricsSnapshot = {
  total: number;
  byKey: Record<string, number>;
};

export class InputRejectMetrics {
  private readonly byKey: Record<string, number> = {};

  noteReject(errorCode: string, phase: string): void {
    const key = `${phase}:${errorCode}`;
    this.byKey[key] = (this.byKey[key] ?? 0) + 1;
  }

  snapshot(): InputRejectMetricsSnapshot {
    const total = Object.values(this.byKey).reduce((n, v) => n + v, 0);
    return { total, byKey: { ...this.byKey } };
  }
}

export type InputClickDiagnostic = {
  capturedAt: string;
  projectedCapture: unknown;
  sidecarRejects: InputRejectMetricsSnapshot;
  lastIntent: LastInputIntentRecord | null;
  lastResolve: LastClickResolveRecord | null;
  rootElementFromPoint: string | null;
};

export function rootElementFromPointExpression(x: number, y: number): string {
  const sx = Number.isFinite(x) ? x : 0;
  const sy = Number.isFinite(y) ? y : 0;
  return (
    `(function(){var el=document.elementFromPoint(${sx},${sy});` +
    `if(!el)return null;var t=el.tagName.toLowerCase();var id=el.id||'';` +
    `var src=el.tagName==='IFRAME'?(el.getAttribute('src')||''):'';` +
    `return t+'|'+id+'|'+src.slice(0,120);})()`
  );
}

export async function probeRootElementFromPoint(
  evaluateVirtual: (expr: string, contextId?: number) => Promise<unknown>,
  x: number,
  y: number,
): Promise<string | null> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const raw = await evaluateVirtual(rootElementFromPointExpression(x, y), CONTEXT_ID_ROOT);
  return typeof raw === 'string' ? raw : null;
}
