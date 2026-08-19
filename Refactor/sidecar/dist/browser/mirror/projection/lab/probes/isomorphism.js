"use strict";
/**
 * Lab isomorphism — compose BrowserSession probes. Not a session primitive.
 *
 * Virtual side is one in-page turn ({@link BrowserSession.flushProjectionSnapshot}):
 * takeRecords, drain MO buffer, emit frame S (DOM + stashed CSSOM scan), DOM O2 + CSSOM O2 + digest + tree.
 * Caller table apply (Node `applyFrameToTableChecked` or DOM client) then snapshots at S.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runIsomorphism = runIsomorphism;
const tableDigest_1 = require("../../models/tableDigest");
const formControlSnap_1 = require("../../models/formControlSnap");
const structuralDiff_1 = require("./structuralDiff");
const CLIENT_CATCH_UP_MS = 2_000;
const CLIENT_POLL_MS = 10;
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function waitClientAtSequence(getClientSnapshot, targetSequence) {
    const deadline = Date.now() + CLIENT_CATCH_UP_MS;
    let snap = await getClientSnapshot();
    if (snap == null) {
        while (Date.now() < deadline) {
            await sleep(CLIENT_POLL_MS);
            snap = await getClientSnapshot();
            if (snap != null)
                break;
        }
        return snap;
    }
    if (snap.sequence == null)
        return snap;
    while (Date.now() < deadline) {
        if (snap.applyError || snap.desynced)
            return snap;
        if ((snap.sequence ?? 0) >= targetSequence && snap.table != null)
            return snap;
        await sleep(CLIENT_POLL_MS);
        const next = await getClientSnapshot();
        if (next == null)
            continue;
        snap = next;
        if (snap.sequence == null)
            return snap;
    }
    return snap;
}
async function runIsomorphism(opts) {
    const skipped = [];
    const emptyTable = { virtual: null, client: null, identical: null };
    const flushSnap = opts.session.flushProjectionSnapshot;
    const resume = opts.session.resumeProjectionWorld;
    if (!flushSnap) {
        return {
            sequence: null,
            generation: null,
            o2: null,
            cssomO2: null,
            table: emptyTable,
            tableFailReason: null,
            structuralDiff: null,
            skipped: [{ id: 'isomorphism', reason: 'session does not expose flushProjectionSnapshot' }],
            nodeNewConnected: null,
            cascade: null,
            formProps: { virtual: null, client: null, identical: null, reason: null },
            shadow: null,
        };
    }
    try {
        const virtual = await flushSnap.call(opts.session, { includeTree: true, cssom: 'scan' });
        if (!virtual.ok) {
            return {
                sequence: null,
                generation: null,
                o2: null,
                cssomO2: null,
                table: emptyTable,
                tableFailReason: null,
                structuralDiff: null,
                skipped: [{ id: 'isomorphism', reason: virtual.reason ?? 'flushProjectionSnapshot failed' }],
                nodeNewConnected: null,
                cascade: null,
                formProps: { virtual: null, client: null, identical: null, reason: null },
                shadow: null,
            };
        }
        const virtualTable = virtual.table ?? null;
        const targetSeq = virtual.sequence ?? 0;
        let clientSnap = null;
        if (opts.getClientSnapshot) {
            const getter = opts.getClientSnapshot;
            clientSnap = await waitClientAtSequence(async () => {
                const v = getter();
                return v instanceof Promise ? await v : v;
            }, targetSeq);
        }
        let structuralDiff = null;
        if (!opts.getClientSnapshot) {
            skipped.push({
                id: 'structuralDiff',
                reason: 'structuralDiff unavailable: no lab client apply surface',
            });
            skipped.push({
                id: 'table',
                reason: 'client table digest unavailable: no lab client apply surface',
            });
            skipped.push({
                id: 'formProps',
                reason: 'client formProps unavailable: no lab client apply surface',
            });
        }
        else if (clientSnap == null) {
            skipped.push({
                id: 'structuralDiff',
                reason: 'client did not reply to requestSnapshot after flush',
            });
            skipped.push({
                id: 'table',
                reason: 'client did not reply to requestSnapshot after flush',
            });
            skipped.push({
                id: 'formProps',
                reason: 'client did not reply to requestSnapshot after flush',
            });
        }
        else if (clientSnap.tree == null) {
            skipped.push({
                id: 'structuralDiff',
                reason: 'no DOM apply surface (Node table apply only)',
            });
        }
        else if (virtual.tree == null) {
            skipped.push({
                id: 'structuralDiff',
                reason: 'virtual tree missing',
            });
        }
        else {
            structuralDiff = (0, structuralDiff_1.diffTrees)(virtual.tree, clientSnap.tree);
        }
        const virtualFormProps = virtual.formProps ?? null;
        const clientFormProps = clientSnap?.formProps ?? null;
        let formIdentical = null;
        let formReason = null;
        if (opts.getClientSnapshot && clientSnap != null) {
            const cmp = (0, formControlSnap_1.formControlSnapsEqual)(virtualFormProps, clientFormProps);
            formIdentical = cmp.identical;
            formReason = cmp.reason;
        }
        else {
            formReason = skipped.find((s) => s.id === 'formProps')?.reason ?? 'no DOM client';
        }
        const clientTable = clientSnap?.table ?? null;
        let tableIdentical = null;
        let tableFailReason = null;
        if (opts.getClientSnapshot && clientSnap != null) {
            if (clientSnap.applyError || clientSnap.desynced) {
                tableIdentical = false;
                tableFailReason = clientSnap.applyError ?? 'client desynced';
            }
            else if (clientSnap.sequence != null && clientSnap.sequence < targetSeq) {
                skipped.push({
                    id: 'table',
                    reason: `Node table apply at sequence ${clientSnap.sequence}, Virtual at ${targetSeq}`,
                });
            }
            else if (virtualTable && clientTable) {
                tableIdentical = (0, tableDigest_1.tableDigestsEqual)(virtualTable, clientTable);
                if (!tableIdentical) {
                    tableFailReason = `virtual rows=${virtualTable.rowCount} client rows=${clientTable.rowCount} hash mismatch`;
                }
            }
            else if (virtualTable == null || clientTable == null) {
                skipped.push({
                    id: 'table',
                    reason: virtualTable == null ? 'virtual table digest missing' : 'client table digest missing',
                });
            }
        }
        return {
            sequence: virtual.sequence ?? null,
            generation: virtual.generation ?? null,
            o2: virtual.o2 ?? null,
            cssomO2: virtual.cssomO2 ?? null,
            table: { virtual: virtualTable, client: clientTable, identical: tableIdentical },
            tableFailReason,
            structuralDiff,
            nodeNewConnected: virtual.nodeNewConnected && typeof virtual.nodeNewConnected.ok === 'boolean'
                ? virtual.nodeNewConnected
                : null,
            cascade: {
                virtual: virtual.cascade ?? null,
                client: clientSnap?.cascade ?? null,
            },
            formProps: {
                virtual: virtualFormProps,
                client: clientFormProps,
                identical: formIdentical,
                reason: formReason,
            },
            shadow: virtual.tree != null
                ? {
                    virtualHosts: (0, structuralDiff_1.countShadowTrees)(virtual.tree),
                    clientHosts: clientSnap?.tree != null ? (0, structuralDiff_1.countShadowTrees)(clientSnap.tree) : 0,
                }
                : null,
            skipped: [
                ...skipped,
                ...(virtual.o2 ? [] : [{ id: 'o2', reason: 'O2 missing from flushProjectionSnapshot' }]),
                ...(virtual.cssomO2 ? [] : [{ id: 'isomorphism.cssom', reason: 'cssomO2 missing from flushProjectionSnapshot' }]),
            ],
        };
    }
    finally {
        await resume?.call(opts.session);
    }
}
//# sourceMappingURL=isomorphism.js.map