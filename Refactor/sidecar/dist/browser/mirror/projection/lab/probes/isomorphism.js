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
const tableDigest_1 = require("@speculum/page-projection/core/tableDigest");
const formControlSnap_1 = require("@speculum/page-projection/core/formControlSnap");
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
function emptyIsoResult(skipped) {
    const emptyTable = { virtual: null, client: null, identical: null };
    return {
        sequence: null,
        generation: null,
        o2: null,
        cssomO2: null,
        table: emptyTable,
        tableFailReason: null,
        structuralDiff: null,
        skipped,
        nodeNewConnected: null,
        cascade: null,
        formProps: { virtual: null, client: null, identical: null, reason: null },
        shadow: null,
        nested: null,
        contexts: {},
        allPass: false,
    };
}
async function compareContextPair(opts) {
    const skipped = [];
    const emptyTable = { virtual: null, client: null, identical: null };
    if (!opts.virtual.ok) {
        return {
            contextId: opts.contextId,
            sequence: null,
            generation: null,
            o2: null,
            cssomO2: null,
            table: emptyTable,
            tableFailReason: null,
            structuralDiff: null,
            skipped: [{ id: 'isomorphism', reason: opts.virtual.reason ?? 'virtual snapshot failed' }],
            nodeNewConnected: null,
            cascade: null,
            formProps: { virtual: null, client: null, identical: null, reason: null },
        };
    }
    const virtualTable = opts.virtual.table ?? null;
    const targetSeq = opts.virtual.sequence ?? 0;
    let clientSnap = null;
    if (opts.getClientSnapshot) {
        clientSnap = await waitClientAtSequence(async () => {
            const v = opts.getClientSnapshot(opts.contextId);
            return v instanceof Promise ? await v : v;
        }, targetSeq);
    }
    let structuralDiff = null;
    if (!opts.getClientSnapshot) {
        skipped.push({ id: 'structuralDiff', reason: 'no lab client apply surface' });
        skipped.push({ id: 'table', reason: 'no lab client apply surface' });
        skipped.push({ id: 'formProps', reason: 'no lab client apply surface' });
    }
    else if (clientSnap == null) {
        skipped.push({ id: 'structuralDiff', reason: 'client did not reply to requestSnapshot after flush' });
        skipped.push({ id: 'table', reason: 'client did not reply to requestSnapshot after flush' });
        skipped.push({ id: 'formProps', reason: 'client did not reply to requestSnapshot after flush' });
    }
    else if (clientSnap.tree == null) {
        skipped.push({ id: 'structuralDiff', reason: 'no DOM apply surface for context' });
    }
    else if (opts.virtual.tree == null) {
        skipped.push({ id: 'structuralDiff', reason: 'virtual tree missing for context' });
    }
    else {
        structuralDiff = (0, structuralDiff_1.diffTrees)(opts.virtual.tree, clientSnap.tree);
    }
    const virtualFormProps = opts.virtual.formProps ?? null;
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
                reason: `client at sequence ${clientSnap.sequence}, Virtual at ${targetSeq}`,
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
        contextId: opts.contextId,
        sequence: opts.virtual.sequence ?? null,
        generation: opts.virtual.generation ?? null,
        o2: opts.virtual.o2 ?? null,
        cssomO2: opts.virtual.cssomO2 ?? null,
        table: { virtual: virtualTable, client: clientTable, identical: tableIdentical },
        tableFailReason,
        structuralDiff,
        nodeNewConnected: opts.virtual.nodeNewConnected && typeof opts.virtual.nodeNewConnected.ok === 'boolean'
            ? opts.virtual.nodeNewConnected
            : null,
        cascade: { virtual: opts.virtual.cascade ?? null, client: clientSnap?.cascade ?? null },
        formProps: { virtual: virtualFormProps, client: clientFormProps, identical: formIdentical, reason: formReason },
        skipped: [
            ...skipped,
            ...(opts.virtual.o2 ? [] : [{ id: 'o2', reason: 'O2 missing from virtual snapshot' }]),
            ...(opts.virtual.cssomO2 ? [] : [{ id: 'isomorphism.cssom', reason: 'cssomO2 missing from virtual snapshot' }]),
        ],
        virtualTree: opts.virtual.tree ?? null,
        clientTree: clientSnap?.tree ?? null,
    };
}
function contextPasses(ctx) {
    if (ctx.o2 && !ctx.o2.identical)
        return false;
    if (ctx.cssomO2 && !ctx.cssomO2.identical)
        return false;
    if (ctx.table.identical === false)
        return false;
    if (ctx.structuralDiff && !ctx.structuralDiff.identical)
        return false;
    if (ctx.formProps.identical === false)
        return false;
    if (ctx.nodeNewConnected && !ctx.nodeNewConnected.ok)
        return false;
    return true;
}
async function runIsomorphism(opts) {
    const getClient = opts.getClientSnapshot;
    const flushSnap = opts.session.flushProjectionSnapshot;
    const snapshotAll = opts.session.snapshotAllContexts;
    const resumeAll = opts.session.resumeAllContexts;
    const resume = opts.session.resumeProjectionWorld;
    const contextIds = opts.contextIds?.length ? [...opts.contextIds] : [1];
    if (!flushSnap && !snapshotAll) {
        return emptyIsoResult([{ id: 'isomorphism', reason: 'session does not expose snapshot RPC' }]);
    }
    try {
        const contexts = {};
        if (snapshotAll) {
            const virtualMap = await snapshotAll.call(opts.session, contextIds, {
                includeTree: true,
                cssom: 'scan',
            });
            for (const contextId of contextIds) {
                const entry = virtualMap[contextId];
                const virtual = entry && entry.ok
                    ? {
                        ok: true,
                        generation: entry.value.generation,
                        sequence: entry.value.sequence,
                        o2: entry.value.o2,
                        table: entry.value.table,
                        cssomO2: entry.value.cssomO2,
                        nodeNewConnected: entry.value.nodeNewConnected,
                        cascade: entry.value.cascade,
                        formProps: entry.value.formProps,
                        tree: entry.value.tree,
                    }
                    : { ok: false, reason: entry && !entry.ok ? entry.reason : 'virtual snapshot missing' };
                contexts[contextId] = await compareContextPair({ contextId, virtual, getClientSnapshot: getClient });
            }
        }
        else {
            const virtual = await flushSnap.call(opts.session, { includeTree: true, cssom: 'scan' });
            const mapped = virtual.ok
                ? {
                    ok: true,
                    generation: virtual.generation,
                    sequence: virtual.sequence,
                    o2: virtual.o2,
                    table: virtual.table,
                    cssomO2: virtual.cssomO2,
                    nodeNewConnected: virtual.nodeNewConnected,
                    cascade: virtual.cascade,
                    formProps: virtual.formProps,
                    tree: virtual.tree,
                }
                : { ok: false, reason: virtual.reason ?? 'flushProjectionSnapshot failed' };
            contexts[1] = await compareContextPair({ contextId: 1, virtual: mapped, getClientSnapshot: getClient });
        }
        const root = contexts[1] ?? Object.values(contexts)[0];
        if (!root)
            return emptyIsoResult([{ id: 'isomorphism', reason: 'no context results' }]);
        const allPass = Object.values(contexts).every(contextPasses);
        return {
            sequence: root.sequence,
            generation: root.generation,
            o2: root.o2,
            cssomO2: root.cssomO2,
            table: root.table,
            tableFailReason: root.tableFailReason,
            structuralDiff: root.structuralDiff,
            nodeNewConnected: root.nodeNewConnected,
            cascade: root.cascade,
            formProps: root.formProps,
            shadow: root.virtualTree != null
                ? {
                    virtualHosts: (0, structuralDiff_1.countShadowTrees)(root.virtualTree),
                    clientHosts: root.clientTree != null ? (0, structuralDiff_1.countShadowTrees)(root.clientTree) : 0,
                }
                : null,
            nested: root.virtualTree != null
                ? {
                    virtualDocs: (0, structuralDiff_1.countNestedDocuments)(root.virtualTree),
                    clientDocs: root.clientTree != null ? (0, structuralDiff_1.countNestedDocuments)(root.clientTree) : 0,
                    clientFrameHrefs: root.clientTree != null ? (0, structuralDiff_1.collectFrameHrefs)(root.clientTree) : [],
                }
                : null,
            skipped: root.skipped,
            contexts,
            allPass,
        };
    }
    finally {
        if (resumeAll)
            await resumeAll.call(opts.session, contextIds);
        else
            await resume?.call(opts.session);
    }
}
//# sourceMappingURL=isomorphism.js.map