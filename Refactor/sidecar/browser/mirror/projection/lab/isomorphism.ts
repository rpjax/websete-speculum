/**
 * Lab isomorphism — compose BrowserSession probes. Not a session primitive.
 *
 * Virtual side is one in-page turn ({@link BrowserSession.flushProjectionSnapshot}):
 * drain MO buffer, emit frame S, O2 + table digest + tree while JS holds the document.
 * Client applies S then snapshots its table + tree; those must match Virtual at S.
 */

import type { BrowserSession } from '../../../BrowserSession';
import type { TableLiveOracleResult } from '../models/tableLiveOracle';
import type { ReplicatedTableDigest } from '../models/tableDigest';
import { tableDigestsEqual } from '../models/tableDigest';
import type { TreeNode } from '../models/treeNode';
import { diffTrees, type StructuralDiffResult } from './structuralDiff';

export type ClientStateSnapshot = {
  tree: TreeNode | null;
  table: ReplicatedTableDigest | null;
};

export type IsomorphismResult = {
  sequence: number | null;
  generation: number | null;
  o2: TableLiveOracleResult | null;
  table: {
    virtual: ReplicatedTableDigest | null;
    client: ReplicatedTableDigest | null;
    identical: boolean | null;
  };
  structuralDiff: StructuralDiffResult | null;
  skipped: { id: string; reason: string }[];
};

export async function runIsomorphism(opts: {
  session: BrowserSession;
  getClientSnapshot?: () => Promise<ClientStateSnapshot | null>;
}): Promise<IsomorphismResult> {
  const skipped: { id: string; reason: string }[] = [];
  const emptyTable = { virtual: null, client: null, identical: null as boolean | null };
  const flushSnap = opts.session.flushProjectionSnapshot;
  const resume = opts.session.resumeProjectionWorld;

  if (!flushSnap) {
    return {
      sequence: null,
      generation: null,
      o2: null,
      table: emptyTable,
      structuralDiff: null,
      skipped: [{ id: 'isomorphism', reason: 'session does not expose flushProjectionSnapshot' }],
    };
  }

  try {
    const virtual = await flushSnap.call(opts.session, { includeTree: true });
    if (!virtual.ok) {
      return {
        sequence: null,
        generation: null,
        o2: null,
        table: emptyTable,
        structuralDiff: null,
        skipped: [{ id: 'isomorphism', reason: virtual.reason ?? 'flushProjectionSnapshot failed' }],
      };
    }

    const virtualTable = virtual.table ?? null;

    let clientSnap: ClientStateSnapshot | null = null;
    if (opts.getClientSnapshot) {
      await new Promise((r) => setTimeout(r, 200));
      clientSnap = await opts.getClientSnapshot();
    }

    let structuralDiff: StructuralDiffResult | null = null;
    if (!opts.getClientSnapshot) {
      skipped.push({
        id: 'structuralDiff',
        reason: 'structuralDiff unavailable: no lab client apply surface',
      });
      skipped.push({
        id: 'table',
        reason: 'client table digest unavailable: no lab client apply surface',
      });
    } else if (clientSnap == null) {
      skipped.push({
        id: 'structuralDiff',
        reason: 'client did not reply to requestSnapshot after flush',
      });
      skipped.push({
        id: 'table',
        reason: 'client did not reply to requestSnapshot after flush',
      });
    } else {
      if (virtual.tree == null || clientSnap.tree == null) {
        skipped.push({
          id: 'structuralDiff',
          reason: 'virtual or client tree missing',
        });
      } else {
        structuralDiff = diffTrees(virtual.tree as TreeNode, clientSnap.tree);
      }
    }

    const clientTable = clientSnap?.table ?? null;
    let tableIdentical: boolean | null = null;
    if (virtualTable && clientTable) {
      tableIdentical = tableDigestsEqual(virtualTable, clientTable);
    } else if (opts.getClientSnapshot && clientSnap != null && (virtualTable == null || clientTable == null)) {
      skipped.push({
        id: 'table',
        reason: virtualTable == null ? 'virtual table digest missing' : 'client table digest missing',
      });
    }

    return {
      sequence: virtual.sequence ?? null,
      generation: virtual.generation ?? null,
      o2: virtual.o2 ?? null,
      table: { virtual: virtualTable, client: clientTable, identical: tableIdentical },
      structuralDiff,
      skipped: [
        ...skipped,
        ...(virtual.o2 ? [] : [{ id: 'o2', reason: 'O2 missing from flushProjectionSnapshot' }]),
      ],
    };
  } finally {
    await resume?.call(opts.session);
  }
}
