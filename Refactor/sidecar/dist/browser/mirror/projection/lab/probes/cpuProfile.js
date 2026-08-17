"use strict";
/**
 * CDP CPU-profile capture + aggregation for the Virtual/producer side — formalizes the
 * pattern this session proved out ad-hoc in scripts/profile-virtual.js and
 * scripts/profile-real-site-full.js (both now import this instead of duplicating the
 * math; see scripts/lib/... call sites). Deliberately Virtual-side only — see
 * frame-protocol.md's lab-consolidation decision log entry for why client-side CPU stays
 * wall-clock (`applyMs`, already in telemetry) instead of CDP self-time.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OUR_FUNCTION_NAMES = void 0;
exports.startCpuProfile = startCpuProfile;
exports.stopCpuProfile = stopCpuProfile;
exports.summarizeProfile = summarizeProfile;
/**
 * Every function name that is *ours* on the Virtual/producer path — an explicit allowlist so
 * "our cost" is a real accounting ("didn't make the top-25" is a weaker claim than "summed to
 * exactly N%", per this session's real-site profiling), not an eyeball guess at what looks
 * unfamiliar in a stack trace. Extend this list — don't invent a second mechanism — when a new
 * producer module lands (e.g. `CHECK`/`preTableHash` row hashing).
 */
exports.OUR_FUNCTION_NAMES = new Set([
    'build',
    'walkChildList',
    'walkSiblingRun',
    'prepareChild',
    'resolvedBefore',
    'describeNodeNew',
    'readAttrs',
    'nodeKindOf',
    'allocate',
    'keyOf',
    'bind',
    'resetIdentity',
    'liveEntries',
    'encodeFrame',
    'assemblePart',
    'str',
    'u64',
    'u32',
    'u16',
    'u8',
    'debugStrings',
    'sendInitial',
    'emitResyncFrame',
    'rebuildAndResync',
    'describeDomResync',
    'rebuildDomIdentity',
    'blockingScan',
    'recordFrameEmitted',
    'FrameEmitter',
    'TableFrameBuilder',
    'DomNodeTable',
    'MutationBuffer',
    // frame-protocol-production-completeness Stage 1 — rowHash.ts / replicatedTable.ts /
    // replicatedTableApply.ts. Deliberately excludes generic single-word names ('remove', 'clear')
    // that also match unrelated native DOM calls under this same-name-only allowlist match.
    'h64Bytes',
    'h64Str',
    'h64U32',
    'addMod64',
    'subMod64',
    'hashName',
    'hashValue',
    'hashAttr',
    'computeRowHash',
    'upsert',
    'createElementRow',
    'createLeafRow',
    'setAttrs',
    'delAttrs',
    'setValue',
    'insertBatch',
    'removeBatch',
    'dropRow',
    'setRow',
    'relinkPrevSibling',
    'linkAfter',
    'unlink',
    'applyOpToTable',
    'applyOpsToTable',
    'applyFrameToTable',
]);
/**
 * `Profiler.*` is not declared in patchright's bundled `Protocol.CommandParameters`
 * (confirmed: absent from `node_modules/patchright-core/types/protocol.d.ts` — Playwright
 * itself never uses this CDP domain), even though Chromium supports it at runtime — proven
 * repeatedly this session against real sites via the ad-hoc scripts this module replaces.
 * This is the one narrow, explicit escape hatch for that vendored-type gap, not a general
 * `any` — every other CDP call in this codebase keeps full typing.
 */
function cdpSend(cdp, method, params) {
    return cdp.send(method, params);
}
async function startCpuProfile(cdp, samplingIntervalUs = 100) {
    await cdpSend(cdp, 'Profiler.enable');
    await cdpSend(cdp, 'Profiler.setSamplingInterval', { interval: samplingIntervalUs });
    await cdpSend(cdp, 'Profiler.start');
}
async function stopCpuProfile(cdp, bucketCount = 0) {
    const { profile } = await cdpSend(cdp, 'Profiler.stop');
    return { raw: profile, summary: summarizeProfile(profile, bucketCount) };
}
/**
 * Aggregates self-time per function (`hitCount` on `profile.nodes[]` is already self-time,
 * independent of call-stack position — "where CPU actually goes", not "who called it"),
 * plus an explicit our-code total, plus an optional time-bucketed breakdown (using
 * `profile.samples[]`/`timeDeltas[]` — CPU Profile format: sample i fired `timeDeltas[i]`
 * microseconds after sample i-1, first delta relative to `profile.startTime`).
 */
function summarizeProfile(profile, bucketCount = 0) {
    const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
    const selfHits = new Map();
    for (const n of profile.nodes)
        selfHits.set(n.id, n.hitCount ?? 0);
    const totalHits = [...selfHits.values()].reduce((a, b) => a + b, 0);
    const totalDurationUs = profile.endTime && profile.startTime ? profile.endTime - profile.startTime : 0;
    const usPerHit = totalHits > 0 ? totalDurationUs / totalHits : 0;
    const byFunctionKey = new Map();
    for (const [id, hits] of selfHits) {
        if (hits === 0)
            continue;
        const n = nodeById.get(id);
        if (!n)
            continue;
        const cf = n.callFrame;
        const key = `${cf.functionName || '(anonymous)'} @ ${shortUrl(cf.url)}:${cf.lineNumber + 1}`;
        byFunctionKey.set(key, (byFunctionKey.get(key) ?? 0) + hits);
    }
    const toRow = (key, hits) => ({
        key,
        hits,
        ms: (hits * usPerHit) / 1000,
        pct: totalHits > 0 ? (100 * hits) / totalHits : 0,
    });
    const topSelfTime = [...byFunctionKey.entries()]
        .map(([key, hits]) => toRow(key, hits))
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 25);
    let ourTotalHits = 0;
    const ourByFunction = new Map();
    for (const [id, hits] of selfHits) {
        if (hits === 0)
            continue;
        const n = nodeById.get(id);
        if (!n)
            continue;
        const name = n.callFrame.functionName;
        if (!exports.OUR_FUNCTION_NAMES.has(name))
            continue;
        ourTotalHits += hits;
        ourByFunction.set(name, (ourByFunction.get(name) ?? 0) + hits);
    }
    const ourCode = {
        totalPct: totalHits > 0 ? (100 * ourTotalHits) / totalHits : 0,
        totalMs: (ourTotalHits * usPerHit) / 1000,
        byFunction: [...ourByFunction.entries()]
            .map(([key, hits]) => toRow(key, hits))
            .sort((a, b) => b.hits - a.hits),
    };
    const summary = {
        totalSamples: totalHits,
        wallMs: totalDurationUs / 1000,
        approxCpuMs: (totalHits * usPerHit) / 1000,
        topSelfTime,
        ourCode,
    };
    if (bucketCount > 0 && Array.isArray(profile.samples) && Array.isArray(profile.timeDeltas)) {
        summary.timeBuckets = bucketProfile(profile, nodeById, bucketCount, totalDurationUs);
    }
    return summary;
}
function bucketProfile(profile, nodeById, bucketCount, totalDurationUs) {
    const bucketUs = totalDurationUs / bucketCount;
    const buckets = Array.from({ length: bucketCount }, () => new Map());
    const bucketTotals = new Array(bucketCount).fill(0);
    const samples = profile.samples ?? [];
    const timeDeltas = profile.timeDeltas ?? [];
    let cursorUs = 0;
    for (let i = 0; i < samples.length; i++) {
        cursorUs += timeDeltas[i] ?? 0;
        const bucketIdx = Math.min(bucketCount - 1, Math.floor(cursorUs / bucketUs));
        const n = nodeById.get(samples[i]);
        if (!n)
            continue;
        const key = n.callFrame.functionName || '(anonymous)';
        const bucket = buckets[bucketIdx];
        bucket.set(key, (bucket.get(key) ?? 0) + 1);
        bucketTotals[bucketIdx] += 1;
    }
    return buckets.map((bucket, b) => {
        const total = bucketTotals[b] || 1;
        const idle = bucket.get('(idle)') ?? 0;
        const ourHits = [...bucket.entries()]
            .filter(([name]) => exports.OUR_FUNCTION_NAMES.has(name))
            .reduce((sum, [, hits]) => sum + hits, 0);
        const topNonIdle = [...bucket.entries()]
            .filter(([name]) => name !== '(idle)' && name !== '(program)')
            .sort((a, z) => z[1] - a[1])
            .slice(0, 4)
            .map(([name, hits]) => ({ name, pct: (100 * hits) / total }));
        return {
            rangeMs: [(b * bucketUs) / 1000, ((b + 1) * bucketUs) / 1000],
            idlePct: (100 * idle) / total,
            ourCodePct: (100 * ourHits) / total,
            topNonIdle,
        };
    });
}
function shortUrl(url) {
    if (!url)
        return '(native)';
    const idx = url.lastIndexOf('/');
    return idx >= 0 ? url.slice(idx + 1) : url;
}
//# sourceMappingURL=cpuProfile.js.map