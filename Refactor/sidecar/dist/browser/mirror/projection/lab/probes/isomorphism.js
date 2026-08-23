"use strict";
/**
 * Lab isomorphism — compose BrowserSession diagnostics. Not a session primitive.
 *
 * Virtual side is a **state snapshot** per `contextId` ({@link BrowserSession.getStateSnapshot}):
 * takeRecords, drain MO buffer, emit frame S, table×DOM (`o2`) + CSSOM + digest + tree.
 * Caller table apply then snapshots Projected at S. Multi-context = one call per id.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapStateSnapshotToOracleView = mapStateSnapshotToOracleView;
exports.captureVirtualLabSnap = captureVirtualLabSnap;
exports.runIsomorphism = runIsomorphism;
const tableDigest_1 = require("@speculum/page-projection/core/tableDigest");
const formControlSnap_1 = require("@speculum/page-projection/core/formControlSnap");
const structuralDiff_1 = require("./structuralDiff");
function mapStateSnapshotToOracleView(snap) {
    if (!snap.ok) {
        return {
            ok: false,
            reason: snap.reason ?? 'getStateSnapshot failed',
            o2: null,
            cssomO2: null,
            table: null,
        };
    }
    const digest = snap.table && typeof snap.table === 'object' && 'digest' in snap.table
        ? snap.table.digest
        : snap.table;
    const rows = snap.table && typeof snap.table === 'object' && 'rows' in snap.table
        ? (snap.table.rows ?? null)
        : null;
    const cssomO2 = snap.cssom && typeof snap.cssom === 'object'
        ? (snap.cssom.live?.sheets ??
            null)
        : null;
    const frameNew = snap.frameNewNodes;
    const nodeNewConnected = frameNew
        ? {
            ok: frameNew.every((n) => n.connected),
            checked: frameNew.length,
            disconnectedIds: frameNew.filter((n) => !n.connected).map((n) => n.nodeId),
        }
        : undefined;
    return {
        ok: true,
        generation: snap.generation,
        sequence: snap.sequence,
        o2: rows,
        cssomO2,
        table: digest,
        tree: snap.tree ?? undefined,
        formProps: snap.formProps ?? undefined,
        nodeNewConnected,
        cascade: null,
    };
}
/**
 * Lab capture: prefer concrete `snapshotContext` so PP-CSSOM-A-2 `cascade` stays caller-side
 * (not on sealed {@link StateSnapshotResult}).
 */
async function captureVirtualLabSnap(session, contextId, opts) {
    const cssom = opts.cssom ?? 'none';
    const snapCtx = session.snapshotContext;
    if (typeof snapCtx === 'function') {
        const r = await snapCtx.call(session, contextId, {
            includeTree: opts.tree === true,
            cssom,
        });
        if (!r.ok) {
            return { ok: false, reason: r.reason, o2: null, cssomO2: null, table: null };
        }
        const v = r.value;
        return {
            ok: true,
            generation: v.generation,
            sequence: v.sequence,
            o2: v.o2 ?? null,
            cssomO2: cssom === 'none' ? null : (v.cssomO2 ?? null),
            table: v.table ?? null,
            tree: opts.tree === true ? v.tree : undefined,
            formProps: opts.formProps === true ? (v.formProps ?? []) : undefined,
            nodeNewConnected: opts.frameNewNodes === true ? v.nodeNewConnected : undefined,
            cascade: v.cascade ?? null,
        };
    }
    const getSnap = session.getStateSnapshot;
    if (!getSnap) {
        return {
            ok: false,
            reason: 'session does not expose getStateSnapshot/snapshotContext',
            o2: null,
            cssomO2: null,
            table: null,
        };
    }
    const sealed = await getSnap.call(session, contextId, {
        table: opts.table ?? 'full',
        liveChildOrder: opts.liveChildOrder === true,
        tree: opts.tree === true,
        cssom,
        formProps: opts.formProps === true,
        frameNewNodes: opts.frameNewNodes === true,
    });
    return mapStateSnapshotToOracleView(sealed);
}
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
    const resume = opts.session.resumeClocks;
    const halt = opts.session.haltClocks;
    const contextIds = opts.contextIds?.length ? [...opts.contextIds] : [1];
    const session = opts.session;
    const capture = {
        table: opts.virtualCapture?.table ?? 'full',
        liveChildOrder: opts.virtualCapture?.liveChildOrder ?? true,
        tree: opts.virtualCapture?.tree ?? true,
        cssom: opts.virtualCapture?.cssom ?? 'scan',
        formProps: opts.virtualCapture?.formProps ?? true,
        frameNewNodes: opts.virtualCapture?.frameNewNodes ?? true,
    };
    if (!session.getStateSnapshot && !session.snapshotContext) {
        return emptyIsoResult([
            { id: 'isomorphism', reason: 'session does not expose getStateSnapshot/snapshotContext' },
        ]);
    }
    try {
        await halt?.call(opts.session);
        const contexts = {};
        for (const contextId of contextIds) {
            const view = await captureVirtualLabSnap(session, contextId, { ...capture });
            const mapped = view.ok
                ? {
                    ok: true,
                    generation: view.generation,
                    sequence: view.sequence,
                    o2: view.o2,
                    table: view.table,
                    cssomO2: view.cssomO2,
                    nodeNewConnected: view.nodeNewConnected,
                    cascade: view.cascade ?? null,
                    formProps: view.formProps,
                    tree: view.tree,
                }
                : { ok: false, reason: view.reason ?? 'virtual snapshot failed' };
            contexts[contextId] = await compareContextPair({
                contextId,
                virtual: mapped,
                getClientSnapshot: getClient,
            });
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
        await resume?.call(opts.session);
    }
}
//# sourceMappingURL=isomorphism.js.map