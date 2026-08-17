"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldCssomDouble = foldCssomDouble;
const iso_1 = require("./iso");
function formatOracle(label, o) {
    if (!o)
        return `${label}=missing`;
    if (o.identical)
        return `${label}=identical`;
    return `${label} divergences=${o.divergenceCount}`;
}
function foldCssomDouble(chassis) {
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
        if (!result.cssomO2?.identical) {
            verdicts.push({ id: `snap.${s.id}`, status: 'fail', reason: formatOracle('cssomO2', result.cssomO2) });
            continue;
        }
        verdicts.push({
            id: `snap.${s.id}`,
            status: 'pass',
            reason: `${formatOracle('o2', result.o2)}; ${formatOracle('cssomO2', result.cssomO2)}`,
        });
    }
    const iso = chassis.journal.iso;
    if (iso) {
        verdicts.push(...(0, iso_1.foldIsoJournal)(iso, { requireDomTree: chassis.hasClientRelay }));
        verdicts.push(...(0, iso_1.foldCssomPaintBoundary)(iso.cascade, { requireProjected: chassis.hasClientRelay }));
    }
    else {
        const settle = chassis.journal.snaps.find((s) => s.id === 'settle');
        const cascade = settle ? settle.result.cascade : null;
        verdicts.push(...(0, iso_1.foldCssomPaintBoundary)({ virtual: cascade ?? null, client: null }, { requireProjected: chassis.hasClientRelay }));
        verdicts.push({ id: 'iso', status: 'fail', reason: 'iso journal missing' });
    }
    return verdicts;
}
//# sourceMappingURL=cssomDouble.js.map