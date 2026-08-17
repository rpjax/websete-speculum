"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldApplyAttrs = foldApplyAttrs;
const iso_1 = require("./iso");
function formatOracle(label, o) {
    if (!o)
        return `${label}=missing`;
    if (o.identical)
        return `${label}=identical`;
    return `${label} divergences=${o.divergenceCount}`;
}
function foldApplyAttrs(chassis) {
    const verdicts = [];
    for (const a of chassis.journal.acts) {
        if (!a.ok)
            verdicts.push({ id: `action.act.${a.name}`, status: 'fail', reason: a.error ?? 'evaluate failed' });
    }
    for (const s of chassis.journal.snaps) {
        const result = s.result;
        if (result.ok === false) {
            verdicts.push({ id: `snap.${s.id}`, status: 'fail', reason: result.reason ?? 'snapshot failed' });
            continue;
        }
        if (!result.o2?.identical) {
            verdicts.push({ id: `snap.${s.id}`, status: 'fail', reason: formatOracle('o2', result.o2) });
            continue;
        }
        verdicts.push({ id: `snap.${s.id}`, status: 'pass', reason: formatOracle('o2', result.o2) });
    }
    if (chassis.journal.iso) {
        verdicts.push(...(0, iso_1.foldIsoJournal)(chassis.journal.iso, { requireDomTree: chassis.hasClientRelay }));
    }
    return verdicts;
}
//# sourceMappingURL=applyAttrs.js.map