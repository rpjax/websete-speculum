"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldCssomHeavy = foldCssomHeavy;
function formatOracle(label, o) {
    if (!o)
        return `${label}=missing`;
    if (o.identical)
        return `${label}=identical`;
    return `${label} divergences=${o.divergenceCount}`;
}
function verdictFromSnap(id, result) {
    if (result.ok === false)
        return { id: `snap.${id}`, status: 'fail', reason: result.reason ?? 'snapshot failed' };
    if (!result.o2?.identical)
        return { id: `snap.${id}`, status: 'fail', reason: formatOracle('o2', result.o2) };
    if (!result.cssomO2?.identical) {
        return { id: `snap.${id}`, status: 'fail', reason: formatOracle('cssomO2', result.cssomO2) };
    }
    return { id: `snap.${id}`, status: 'pass', reason: formatOracle('cssomO2', result.cssomO2) };
}
function foldCssomHeavy(chassis) {
    const verdicts = [];
    for (const a of chassis.journal.acts) {
        if (!a.ok)
            verdicts.push({ id: `action.act.${a.name}`, status: 'fail', reason: a.error ?? 'evaluate failed' });
    }
    const snaps = chassis.journal.snaps;
    const snapById = new Map(snaps.map((s) => [s.id, s]));
    const requiredSnapIds = [
        'settle.scan',
        'theme.scan',
        'accent.scan',
        'featureCard.scan',
        'reorderAdopted.scan',
        'resync.scan',
    ];
    const required = new Set(requiredSnapIds);
    for (const id of requiredSnapIds) {
        const s = snapById.get(id);
        if (!s) {
            verdicts.push({ id: `snap.${id}`, status: 'fail', reason: 'snapshot missing' });
            continue;
        }
        verdicts.push(verdictFromSnap(s.id, s.result));
    }
    for (const s of snaps) {
        if (required.has(s.id))
            continue;
        verdicts.push(verdictFromSnap(s.id, s.result));
    }
    const theme = chassis.journal.opWindows['theme'];
    if (!theme) {
        verdicts.push({ id: 'ops.theme', status: 'fail', reason: 'op window missing' });
    }
    else if (theme.sheetDrop > 0) {
        verdicts.push({
            id: 'ops.theme',
            status: 'fail',
            reason: `SHEET_DROP=${theme.sheetDrop} on in-place theme`,
        });
    }
    else {
        verdicts.push({
            id: 'ops.theme',
            status: 'pass',
            reason: `sheetDrop=0 ruleSet=${theme.ruleSet} ruleNew=${theme.ruleNew}`,
        });
    }
    if (chassis.desyncs.length > 0) {
        verdicts.push({ id: 'wire.desync', status: 'fail', reason: `desynced events=${chassis.desyncs.length}` });
    }
    else {
        verdicts.push({ id: 'wire.desync', status: 'pass', reason: 'none' });
    }
    if (chassis.nodeTable.lastApplyError) {
        verdicts.push({ id: 'apply.nodeTable', status: 'fail', reason: chassis.nodeTable.lastApplyError });
    }
    else {
        verdicts.push({ id: 'apply.nodeTable', status: 'pass', reason: 'phase-1 apply ok' });
    }
    return verdicts;
}
//# sourceMappingURL=cssomHeavy.js.map