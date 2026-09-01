/**
 * Assert Projected nested host is bound before input — reproduces Turnstile-class silent divergence
 * (pending frames + host row without nested apply).
 */

import type { LabChassis } from '../host/chassis';
import type { LabVerdict } from '../dossier/types';
import type { ClientStateSnapshot } from './isomorphism';

export type NestedHostReadyResult = {
  contextId: number;
  ok: boolean;
  reason?: string;
  nestedPeek: ClientStateSnapshot['nestedPeek'];
};

function nestedMaterialized(session: {
  bodyLen?: number;
  tableRowCount?: number | null;
} | undefined): boolean {
  if (!session) return false;
  const bodyLen = session.bodyLen ?? 0;
  const tableRows = session.tableRowCount ?? 0;
  // Light body may stay empty when subtree lives in shadow; table rows prove replication.
  return bodyLen > 0 || (typeof tableRows === 'number' && tableRows > 10);
}

export async function runNestedHostReadyProbe(opts: {
  contextId: number;
  getClientSnapshot: () => Promise<ClientStateSnapshot | null>;
}): Promise<NestedHostReadyResult> {
  const { contextId, getClientSnapshot } = opts;
  const snap = await getClientSnapshot();
  const nestedPeek = snap?.nestedPeek ?? null;
  if (!nestedPeek) {
    return { contextId, ok: false, reason: 'no nestedPeek from projected client', nestedPeek };
  }
  const pending = nestedPeek.pendingFrames[String(contextId)] ?? 0;
  if (pending > 0) {
    return {
      contextId,
      ok: false,
      reason: `pendingFrames[${contextId}]=${pending}`,
      nestedPeek,
    };
  }
  if (!nestedPeek.nested.includes(contextId)) {
    return {
      contextId,
      ok: false,
      reason: `ctx${contextId} not in nested map (bound=${nestedPeek.nested.join(',') || 'none'})`,
      nestedPeek,
    };
  }
  const session = nestedPeek.sessions.find((s) => s.contextId === contextId);
  if (session?.desynced) {
    return {
      contextId,
      ok: false,
      reason: `ctx${contextId} desynced: ${session.applyError ?? 'yes'}`,
      nestedPeek,
    };
  }
  if (!nestedMaterialized(session)) {
    return {
      contextId,
      ok: false,
      reason: `ctx${contextId} not materialized bodyLen=${session?.bodyLen ?? 0} tableRows=${session?.tableRowCount ?? '?'}`,
      nestedPeek,
    };
  }
  return { contextId, ok: true, nestedPeek };
}

export function foldNestedHostReady(
  chassis: LabChassis,
  contextId: number,
): LabVerdict[] {
  const probe = (chassis.journal as { nestedHostReady?: NestedHostReadyResult }).nestedHostReady;
  if (!chassis.hasClientRelay) {
    return [
      {
        id: 'nestedHost.ready',
        status: 'fail',
        reason: 'no DOM client — nested bind unproven',
      },
    ];
  }
  if (!probe) {
    return [{ id: 'nestedHost.ready', status: 'fail', reason: 'probe did not run' }];
  }
  if (!probe.ok) {
    return [{ id: 'nestedHost.ready', status: 'fail', reason: probe.reason ?? 'not ready' }];
  }
  const session = probe.nestedPeek?.sessions.find((s) => s.contextId === contextId);
  return [
    {
      id: 'nestedHost.ready',
      status: 'pass',
      reason: `ctx${contextId} bound bodyLen=${session?.bodyLen ?? '?'} tableRows=${session?.tableRowCount ?? '?'}`,
    },
    {
      id: 'nestedHost.pendingFrames',
      status: 'pass',
      reason: 'empty',
    },
  ];
}
