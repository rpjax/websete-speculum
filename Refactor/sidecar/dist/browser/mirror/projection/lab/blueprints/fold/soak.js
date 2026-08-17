"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldSoak = foldSoak;
const iso_1 = require("./iso");
function foldSoak(chassis, overrides) {
    const verdicts = [];
    const o = overrides ?? {};
    if (o.cpu !== true) {
        verdicts.push({ id: 'cpu', status: 'skipped', reason: 'cpu not requested' });
    }
    else if (chassis.journal.cpuSummary) {
        const s = chassis.journal.cpuSummary;
        verdicts.push({ id: 'cpu', status: 'pass', reason: `samples=${s.totalSamples}` });
    }
    else {
        verdicts.push({ id: 'cpu', status: 'skipped', reason: 'no cpu summary' });
    }
    if (o.invariants === false) {
        verdicts.push({ id: 'invariant', status: 'skipped', reason: 'invariants not requested' });
    }
    else {
        for (const check of chassis.invariantMonitor.getSummary()) {
            verdicts.push({
                id: `invariant.${check.id}`,
                status: check.failCount === 0 ? 'pass' : 'fail',
                reason: check.failCount === 0
                    ? `${check.passCount} passes`
                    : `${check.failCount} fails (${check.failures[0]?.details ?? check.description})`,
            });
        }
    }
    const iso = chassis.journal.iso;
    if (iso) {
        verdicts.push(...(0, iso_1.foldIsoJournal)(iso, { requireDomTree: chassis.hasClientRelay }));
    }
    else if (o.iso === true) {
        verdicts.push({ id: 'iso.dom', status: 'fail', reason: 'iso journal missing' });
        verdicts.push({ id: 'probe.nodeNewConnected', status: 'fail', reason: 'iso journal missing' });
    }
    else {
        verdicts.push({ id: 'iso.dom', status: 'skipped', reason: 'iso not requested' });
        verdicts.push({ id: 'probe.nodeNewConnected', status: 'fail', reason: 'iso journal missing' });
    }
    return verdicts;
}
//# sourceMappingURL=soak.js.map