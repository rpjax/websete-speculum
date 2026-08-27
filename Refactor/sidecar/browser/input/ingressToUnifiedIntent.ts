/**
 * Map wire / DomInputIngress → UnifiedIntent (sparse-cdp / id-addressed).
 */

import {
  UNIFIED_INTENT_SCHEMA_VERSION,
  type UnifiedIntent,
} from '@speculum/page-projection/core/input/unifiedIntentTypes';
import type { DomInputIngress } from '@speculum/page-projection/core/input/intentTypes';

function parsePayload(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* */
  }
  return {};
}

function buttonName(v: unknown): 'left' | 'middle' | 'right' {
  if (v === 'middle' || v === 1) return 'middle';
  if (v === 'right' || v === 2) return 'right';
  return 'left';
}

/** Accept unified types and legacy V2 aliases on the same ingress. */
export function ingressToUnifiedIntent(raw: DomInputIngress & {
  viewportW?: number | null;
  viewportH?: number | null;
  x?: number;
  y?: number;
  key?: string;
  code?: string;
  scrollX?: number;
  scrollY?: number;
  button?: string | number;
}): UnifiedIntent | null {
  const type = raw.type.trim();
  const payload = parsePayload(raw.payload ?? raw.payloadJson);
  const viewportW = Number(raw.viewportW ?? payload.viewportW ?? 0);
  const viewportH = Number(raw.viewportH ?? payload.viewportH ?? 0);
  const x = Number(raw.x ?? payload.x ?? 0);
  const y = Number(raw.y ?? payload.y ?? 0);

  const mapLegacy = (t: string): string => {
    if (t === 'mousemove') return 'move';
    if (t === 'mousedown') return 'down';
    if (t === 'mouseup') return 'up';
    if (t === 'keydown') return 'keyDown';
    if (t === 'keyup') return 'keyUp';
    if (t === 'scrollViewport' || t === 'scrollelement' || t === 'scrollElement') return 'scrollSet';
    return t;
  };

  const unifiedType = mapLegacy(type);

  if (unifiedType === 'move' || unifiedType === 'down' || unifiedType === 'up') {
    const nodeId = raw.nodeId ?? raw.targetId ?? null;
    return {
      schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
      type: unifiedType,
      timestampClient: raw.timestampClient ?? undefined,
      viewportW,
      viewportH,
      x,
      y,
      button: buttonName(raw.button ?? payload.button),
      contextId:
        unifiedType === 'move' ? undefined : raw.contextId && raw.contextId > 0 ? raw.contextId : 1,
      nodeId: unifiedType === 'move' ? undefined : nodeId != null && nodeId > 0 ? nodeId : null,
    };
  }

  if (unifiedType === 'keyDown' || unifiedType === 'keyUp') {
    return {
      schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
      type: unifiedType,
      timestampClient: raw.timestampClient ?? undefined,
      key: String(raw.key ?? payload.key ?? ''),
      code: String(raw.code ?? payload.code ?? ''),
      modifiers: (payload.modifiers as {
        ctrl?: boolean;
        shift?: boolean;
        alt?: boolean;
        meta?: boolean;
      }) ?? undefined,
    };
  }

  if (unifiedType === 'scrollSet') {
    const nodeId = raw.nodeId ?? raw.targetId ?? null;
    return {
      schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
      type: 'scrollSet',
      timestampClient: raw.timestampClient ?? undefined,
      contextId: raw.contextId && raw.contextId > 0 ? raw.contextId : 1,
      nodeId: nodeId != null && nodeId > 0 ? nodeId : null,
      scrollX: Number(raw.scrollX ?? payload.scrollX ?? payload.scrollLeft ?? 0),
      scrollY: Number(raw.scrollY ?? payload.scrollY ?? payload.scrollTop ?? 0),
    };
  }

  if (unifiedType === 'setFiles') {
    const nodeId = raw.nodeId ?? raw.targetId;
    if (nodeId == null || nodeId <= 0) return null;
    return {
      schemaVersion: UNIFIED_INTENT_SCHEMA_VERSION,
      type: 'setFiles',
      timestampClient: raw.timestampClient ?? undefined,
      contextId: raw.contextId && raw.contextId > 0 ? raw.contextId : 1,
      nodeId,
      files: payload.files ?? payload,
    };
  }

  return null;
}
