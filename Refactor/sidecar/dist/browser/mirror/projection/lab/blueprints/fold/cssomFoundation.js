"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldCssomFoundation = foldCssomFoundation;
const iso_1 = require("./iso");
function formatOracle(label, o) {
    if (!o)
        return `${label}=missing`;
    if (o.identical)
        return `${label}=identical`;
    return `${label} divergences=${o.divergenceCount}`;
}
function verdictFromSnap(id, mode, result) {
    if (result.ok === false)
        return { id: `snap.${id}`, status: 'fail', reason: result.reason ?? 'snapshot failed' };
    if (!result.o2?.identical)
        return { id: `snap.${id}`, status: 'fail', reason: formatOracle('o2', result.o2) };
    if (mode === 'none') {
        if (result.cssomO2 !== null && result.cssomO2 !== undefined) {
            return { id: `snap.${id}`, status: 'fail', reason: 'expected cssomO2=null' };
        }
        return { id: `snap.${id}`, status: 'pass', reason: 'cssomO2=null; o2 identical' };
    }
    if (!result.cssomO2?.identical) {
        return { id: `snap.${id}`, status: 'fail', reason: formatOracle('cssomO2', result.cssomO2) };
    }
    return { id: `snap.${id}`, status: 'pass', reason: formatOracle('cssomO2', result.cssomO2) };
}
function foldOpWindow(id, counts, expect) {
    if (!counts)
        return { id, status: 'fail', reason: 'op window missing' };
    if (expect.sheetDrop !== undefined && counts.sheetDrop !== expect.sheetDrop) {
        return { id, status: 'fail', reason: `SHEET_DROP=${counts.sheetDrop}` };
    }
    if (expect.ruleSetMin !== undefined && counts.ruleSet < expect.ruleSetMin) {
        return { id, status: 'fail', reason: `ruleSet=${counts.ruleSet} want >=${expect.ruleSetMin}` };
    }
    if (expect.ruleSet !== undefined && counts.ruleSet !== expect.ruleSet) {
        return { id, status: 'fail', reason: `RULE_SET=${counts.ruleSet} want ${expect.ruleSet}` };
    }
    if (expect.ruleDropMin !== undefined && counts.ruleDrop < expect.ruleDropMin) {
        return { id, status: 'fail', reason: `ruleDrop=${counts.ruleDrop} want >=${expect.ruleDropMin}` };
    }
    if (expect.ruleNewMin !== undefined && counts.ruleNew < expect.ruleNewMin) {
        return { id, status: 'fail', reason: `ruleNew=${counts.ruleNew} want >=${expect.ruleNewMin}` };
    }
    return {
        id,
        status: 'pass',
        reason: `sheetDrop=${counts.sheetDrop} ruleSet=${counts.ruleSet} ruleDrop=${counts.ruleDrop} ruleNew=${counts.ruleNew}`,
    };
}
function foldCssomFoundation(chassis) {
    const verdicts = [];
    for (const a of chassis.journal.acts) {
        if (!a.ok)
            verdicts.push({ id: `action.act.${a.name}`, status: 'fail', reason: a.error ?? 'evaluate failed' });
    }
    for (const s of chassis.journal.snaps) {
        verdicts.push(verdictFromSnap(s.id, s.mode, s.result));
    }
    verdicts.push(foldOpWindow('ops.styleSet', chassis.journal.opWindows['styleSet'], { sheetDrop: 0, ruleSetMin: 1 }));
    verdicts.push(foldOpWindow('ops.mediaInner', chassis.journal.opWindows['mediaInner'], {
        ruleSet: 0,
        ruleDropMin: 1,
        ruleNewMin: 1,
    }));
    if (chassis.idlePolls < 1) {
        verdicts.push({
            id: 'sensor.idle',
            status: 'fail',
            reason: 'no cssomPoll idle in the whole run (cap on)',
        });
    }
    else {
        verdicts.push({
            id: 'sensor.idle',
            status: 'pass',
            reason: `idlePolls=${chassis.idlePolls}`,
        });
    }
    if (chassis.journal.iso) {
        verdicts.push(...(0, iso_1.foldIsoJournal)(chassis.journal.iso, { requireDomTree: chassis.hasClientRelay }));
    }
    return verdicts;
}
//# sourceMappingURL=cssomFoundation.js.map