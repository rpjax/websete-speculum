"use strict";
/**
 * Live establish helpers — PP-EST-7 checksum over chunked HTML parse,
 * DocumentState snapshot, establish/resync wire assembly (§5.6 / §5.7.2).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checksumEstablishHtml = checksumEstablishHtml;
exports.snapshotDocumentStateRaw = snapshotDocumentStateRaw;
exports.buildEstablishWireOps = buildEstablishWireOps;
exports.emitLiveEstablishFrame = emitLiveEstablishFrame;
exports.captureMirrorResyncSnapshot = captureMirrorResyncSnapshot;
exports.orchestrateLiveEstablish = orchestrateLiveEstablish;
const fmap_1 = require("./fmap");
const encode_1 = require("./encode");
const establish_1 = require("./establish");
const cssomLive_1 = require("./cssomLive");
const assetsLive_1 = require("./assetsLive");
const SNAPSHOT_DOCUMENT_STATE_SNIPPET = `
  (typeof window.__speculumPageProjectionV2 !== 'undefined'
    && typeof window.__speculumPageProjectionV2.snapshotDocumentState === 'function')
    ? window.__speculumPageProjectionV2.snapshotDocumentState()
    : null
`;
/** CDP arg size limit — stage HTML onto the ephemeral page in slices. */
const EST_CHK_HTML_SLICE = 256 * 1024;
/**
 * PP-EST-7 — FNV over anchored tags after the same **chunked** HTML parse the
 * client uses (`doc.write` per establishChunk). Runs on an ephemeral
 * `about:blank` page in the session context — never mutates Virtual.
 */
async function checksumEstablishHtml(opts) {
    const { context, chunks, pageEpochId, onParity } = opts;
    const chunkBytes = opts.establishChunkBytes > 0 ? opts.establishChunkBytes : establish_1.ESTABLISH_CHUNK_BYTES_DEFAULT;
    let chkPage = null;
    try {
        chkPage = await context.newPage();
        await chkPage.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        const html = chunks.join('');
        await chkPage.evaluate(`(() => { globalThis.__speculumPPv2EstChkHtml = ''; })()`);
        for (let start = 0; start < html.length; start += EST_CHK_HTML_SLICE) {
            const slice = html.slice(start, start + EST_CHK_HTML_SLICE);
            await chkPage.evaluate((piece) => {
                const g = globalThis;
                g.__speculumPPv2EstChkHtml = (g.__speculumPPv2EstChkHtml || '') + piece;
            }, slice);
        }
        const parsed = await chkPage.evaluate(({ chunkBytes: cb }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const document = globalThis.document;
            const g = globalThis;
            const full = g.__speculumPPv2EstChkHtml || '';
            g.__speculumPPv2EstChkHtml = undefined;
            document.open();
            for (let i = 0; i < full.length; i += cb) {
                document.write(full.slice(i, i + cb));
            }
            try {
                document.close();
            }
            catch {
                /* already closed */
            }
            const FNV_OFFSET_BASIS = 0x811c9dc5;
            const FNV_PRIME = 0x01000193;
            let hash = FNV_OFFSET_BASIS;
            let count = 0;
            const addTag = (tag) => {
                count += 1;
                for (let i = 0; i < tag.length; i++) {
                    hash ^= tag.charCodeAt(i);
                    hash = Math.imul(hash, FNV_PRIME);
                }
                hash ^= count & 0xff;
                hash = Math.imul(hash, FNV_PRIME);
            };
            const walk = (node) => {
                if (node.nodeType !== 1)
                    return;
                if (node.hasAttribute('data-pp-cssom-id'))
                    return;
                const raw = node.getAttribute('speculum-anchor');
                if (raw) {
                    const idNum = Number(raw);
                    if (Number.isInteger(idNum) && idNum > 0)
                        addTag(node.tagName.toLowerCase());
                }
                const children = node.childNodes;
                for (let i = 0; i < children.length; i++)
                    walk(children[i]);
            };
            if (document.documentElement)
                walk(document.documentElement);
            return { nodeCount: count, checksum: hash >>> 0 };
        }, { chunkBytes });
        if (parsed.nodeCount <= 0) {
            onParity?.('parity_establish_checksum', {
                pageEpochId,
                errorCode: 'establish_checksum_empty',
                phase: 'establish',
                chunkCount: chunks.length,
            });
            return null;
        }
        return { nodeCount: parsed.nodeCount, checksum: parsed.checksum };
    }
    catch (err) {
        onParity?.('parity_establish_checksum', {
            pageEpochId,
            errorCode: 'establish_checksum_eval',
            phase: 'establish',
            detail: err instanceof Error ? err.message : String(err),
            chunkCount: chunks.length,
        });
        return null;
    }
    finally {
        if (chkPage) {
            try {
                await chkPage.close();
            }
            catch {
                /* */
            }
        }
    }
}
async function snapshotDocumentStateRaw(page) {
    try {
        const result = await page.evaluate(SNAPSHOT_DOCUMENT_STATE_SNIPPET);
        if (!result || typeof result !== 'object')
            return null;
        const state = (0, fmap_1.extractDocumentState)(result);
        return { op: 'documentState', ...state };
    }
    catch {
        return null;
    }
}
function buildEstablishWireOps(opts) {
    // documentState MUST arrive before establishEnd — client applies it only while
    // the standby build exists (finishEstablish clears the build).
    return [
        { op: 'cssomInstall', sheets: opts.sheets },
        { op: 'establishBegin', payload: (0, establish_1.buildEstablishBegin)(opts.generation, opts.viewport, { x: 0, y: 0 }) },
        ...opts.chunks.map((chunk) => ({ op: 'establishChunk', bytes: Buffer.from(chunk, 'utf8') })),
        ...(opts.documentState ? [opts.documentState] : []),
        { op: 'establishEnd', nodeCount: opts.nodeCount, checksum: opts.checksum },
    ];
}
/**
 * §5.6 / W2 — seed mirror from raw, checksum, cssomInstall-first wire emit (D-FLASH).
 * Caller owns handoff begin/flush, scheduler start, and asset prefetch.
 */
async function emitLiveEstablishFrame(opts) {
    opts.treeQuery.load(opts.raw);
    const rootFNode = opts.treeQuery.buildFullFNode(opts.raw);
    opts.mirror.clear();
    opts.mirror.seedRoot(rootFNode);
    opts.markEstablishSnapshot();
    (0, assetsLive_1.enforceMirrorMaxBytes)({
        mirror: opts.mirror,
        mirrorMaxBytes: opts.mirrorMaxBytes,
        pageEpochId: opts.pageEpochId,
        generation: opts.generation,
        onParity: opts.onParity,
    });
    const html = opts.mirror.serializeToHtml();
    const chunks = (0, establish_1.splitHtmlIntoChunks)(html, opts.establishChunkBytes);
    // PP-EST-7 — browser-identical chunked HTML parse (must match client registry).
    const parsed = await checksumEstablishHtml({
        context: opts.page.context(),
        chunks,
        establishChunkBytes: opts.establishChunkBytes,
        pageEpochId: opts.pageEpochId,
        onParity: opts.onParity,
    });
    if (!parsed) {
        opts.onParity?.('parity_establish_failed', {
            pageEpochId: opts.pageEpochId,
            generation: opts.generation,
            errorCode: 'establish_checksum_eval',
            phase: 'establish',
            tVirtualMs: opts.tVirtualMs(),
        });
        return { ok: false };
    }
    const { nodeCount, checksum } = parsed;
    opts.onParity?.('parity_establish_checksum', {
        pageEpochId: opts.pageEpochId,
        generation: opts.generation,
        nodeCount,
        checksum,
        chunkCount: chunks.length,
        source: 'html_parse',
        tVirtualMs: opts.tVirtualMs(),
    });
    const viewport = opts.page.viewportSize() ?? { width: 0, height: 0 };
    opts.dropBufferedCssomFromHandoff();
    opts.resetCssom(); // §5.10 — the full install below supersedes any deltas accumulated before establish.
    opts.onParity?.('parity_establish_cssom_install_started', {
        pageEpochId: opts.pageEpochId,
        generation: opts.generation,
        source: 'snapshot',
        tVirtualMs: opts.tVirtualMs(),
    });
    let sheets;
    try {
        sheets = await (0, cssomLive_1.snapshotCssomSheets)(opts.page, opts.cdp, opts.rewriter);
    }
    catch (err) {
        opts.onParity?.('parity_establish_failed', {
            pageEpochId: opts.pageEpochId,
            generation: opts.generation,
            errorCode: 'cssom_snapshot_eval',
            phase: 'establish',
            detail: err instanceof Error ? err.message : String(err),
            tVirtualMs: opts.tVirtualMs(),
        });
        return { ok: false };
    }
    const ruleCount = sheets.reduce((n, s) => n + (s.rules?.length ?? 0), 0);
    let virtualSheetCount = 0;
    try {
        virtualSheetCount = Number(await opts.page.evaluate(`document.styleSheets ? document.styleSheets.length : 0`));
    }
    catch {
        virtualSheetCount = 0;
    }
    if (virtualSheetCount > 0 && ruleCount === 0) {
        opts.onParity?.('parity_establish_failed', {
            pageEpochId: opts.pageEpochId,
            generation: opts.generation,
            errorCode: 'cssom_snapshot_empty',
            phase: 'establish',
            virtualSheetCount,
            sheetCount: sheets.length,
            tVirtualMs: opts.tVirtualMs(),
        });
        return { ok: false };
    }
    const documentState = await snapshotDocumentStateRaw(opts.page);
    opts.onParity?.('parity_establish_cssom_install_completed', {
        pageEpochId: opts.pageEpochId,
        generation: opts.generation,
        source: 'snapshot',
        durationMs: 0,
        sheetCount: sheets.length,
        ruleCount,
        seededSheetCount: sheets.length,
        tVirtualMs: opts.tVirtualMs(),
    });
    const ops = buildEstablishWireOps({
        sheets,
        generation: opts.generation,
        viewport,
        chunks,
        nodeCount,
        checksum,
        documentState,
    });
    const meta = {
        generation: opts.generation,
        sequence: opts.sequence,
        establish: true,
    };
    opts.emitParts((0, encode_1.encodeFrame)(ops, meta), meta);
    opts.onParity?.('parity_establish_first_diff_emitted', {
        pageEpochId: opts.pageEpochId,
        generation: opts.generation,
        plane: 'dom',
        operation: 'establish',
        sequence: opts.sequence,
        nodeCount,
        tSinceCommitMs: Date.now() - opts.pageEpochCommitAtMs,
        tVirtualMs: opts.tVirtualMs(),
    });
    return { ok: true, mirror: opts.mirror, viewport, nodeCount };
}
/**
 * §5.7.2 W3 binary OOB resync — served from the Node-side mirror (never a fresh
 * page walk; never advances the live `sequence` counter).
 */
async function captureMirrorResyncSnapshot(opts) {
    const start = Date.now();
    const html = opts.mirror.serializeToHtml();
    const chunks = (0, establish_1.splitHtmlIntoChunks)(html, opts.establishChunkBytes);
    const parsed = await checksumEstablishHtml({
        context: opts.page.context(),
        chunks,
        establishChunkBytes: opts.establishChunkBytes,
        pageEpochId: opts.pageEpochId,
        onParity: opts.onParity,
    });
    if (!parsed)
        return null;
    const { nodeCount, checksum } = parsed;
    const viewport = opts.page.viewportSize() ?? { width: 0, height: 0 };
    let sheets;
    try {
        sheets = await (0, cssomLive_1.snapshotCssomSheets)(opts.page, opts.cdp, opts.rewriter);
    }
    catch (err) {
        opts.onParity?.('parity_establish_failed', {
            pageEpochId: opts.pageEpochId,
            generation: opts.generation,
            errorCode: 'cssom_snapshot_eval',
            phase: 'resync',
            detail: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
    const ruleCount = sheets.reduce((n, s) => n + (s.rules?.length ?? 0), 0);
    let virtualSheetCount = 0;
    try {
        virtualSheetCount = Number(await opts.page.evaluate(`document.styleSheets ? document.styleSheets.length : 0`));
    }
    catch {
        virtualSheetCount = 0;
    }
    if (virtualSheetCount > 0 && ruleCount === 0) {
        opts.onParity?.('parity_establish_failed', {
            pageEpochId: opts.pageEpochId,
            generation: opts.generation,
            errorCode: 'cssom_snapshot_empty',
            phase: 'resync',
            virtualSheetCount,
            sheetCount: sheets.length,
        });
        return null;
    }
    const documentState = await snapshotDocumentStateRaw(opts.page);
    const ops = buildEstablishWireOps({
        sheets,
        generation: opts.generation,
        viewport,
        chunks,
        nodeCount,
        checksum,
        documentState,
    });
    const meta = {
        generation: opts.generation,
        sequence: opts.coversThroughSequence,
        resync: true,
    };
    return {
        generation: opts.generation,
        coversThroughSequence: opts.coversThroughSequence,
        parts: (0, encode_1.encodeFrame)(ops, meta),
        pageEpochId: opts.pageEpochId || undefined,
        source: 'mirror',
        serializeMs: Date.now() - start,
    };
}
/**
 * §5.6 / W2 — settle → snapshot → emit after handoff begin.
 * Returns whether establish completed (false if stopped / empty / checksum fail).
 */
async function orchestrateLiveEstablish(opts) {
    opts.onParity?.('parity_establish_snapshot_started', {
        pageEpochId: opts.pageEpochId,
        generation: opts.generation,
        path: 'live_v2',
        tVirtualMs: opts.tVirtualMs(),
    });
    const establishStarted = Date.now();
    await opts.waitDocumentReady();
    if (opts.isStopped()) {
        opts.flushEstablishHandoff();
        return false;
    }
    await opts.adoptClosedShadows();
    const raw = await opts.snapshotDocumentRaw();
    if (!raw) {
        opts.onParity?.('parity_establish_failed', {
            pageEpochId: opts.pageEpochId,
            generation: opts.generation,
            errorCode: 'dom_map_empty',
            phase: 'dom_map',
            tVirtualMs: opts.tVirtualMs(),
        });
        opts.flushEstablishHandoff();
        return false;
    }
    const emitted = await emitLiveEstablishFrame({
        page: opts.page,
        cdp: opts.cdp,
        rewriter: opts.rewriter,
        treeQuery: opts.treeQuery,
        mirror: opts.mirror,
        raw,
        establishChunkBytes: opts.establishChunkBytes,
        mirrorMaxBytes: opts.mirrorMaxBytes,
        pageEpochId: opts.pageEpochId,
        pageEpochCommitAtMs: opts.pageEpochCommitAtMs,
        generation: opts.generation,
        sequence: opts.sequence,
        tVirtualMs: opts.tVirtualMs,
        onParity: opts.onParity,
        markEstablishSnapshot: opts.markEstablishSnapshot,
        dropBufferedCssomFromHandoff: opts.dropBufferedCssomFromHandoff,
        resetCssom: opts.resetCssom,
        emitParts: opts.emitParts,
    });
    if (!emitted.ok) {
        opts.flushEstablishHandoff();
        return false;
    }
    // PP-EST-3 — replay buffered live frames over the establish snapshot.
    opts.flushEstablishHandoff();
    opts.onParity?.('parity_establish_completed', {
        pageEpochId: opts.pageEpochId,
        generation: opts.generation,
        totalMs: Date.now() - establishStarted,
        tSinceCommitMs: Date.now() - opts.pageEpochCommitAtMs,
        tVirtualMs: opts.tVirtualMs(),
    });
    opts.scheduleAssetPrefetch(emitted.mirror, emitted.viewport);
    return true;
}
//# sourceMappingURL=establishLive.js.map