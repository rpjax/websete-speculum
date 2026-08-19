"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldShadowOpen = foldShadowOpen;
exports.foldShadowClosed = foldShadowClosed;
exports.foldShadowManual = foldShadowManual;
const applyAttrs_1 = require("./applyAttrs");
/** PP-F-3 — open named shadow: tree iso must enter `.shadow`; light-only is a fail. */
function foldShadowOpen(chassis) {
    const verdicts = (0, applyAttrs_1.foldApplyAttrs)(chassis);
    const iso = chassis.journal.iso;
    if (!chassis.hasClientRelay)
        return verdicts;
    const virtualHosts = iso?.shadow?.virtualHosts ?? 0;
    const clientHosts = iso?.shadow?.clientHosts ?? 0;
    if (virtualHosts === 0) {
        verdicts.push({
            id: 'iso.shadow',
            status: 'fail',
            reason: 'virtual tree has no shadow (light-only snapshot)',
        });
    }
    else if (clientHosts === 0) {
        verdicts.push({
            id: 'iso.shadow',
            status: 'fail',
            reason: 'Projected host has no ShadowRoot',
        });
    }
    else {
        verdicts.push({
            id: 'iso.shadow',
            status: 'pass',
            reason: `virtualHosts=${virtualHosts} clientHosts=${clientHosts}`,
        });
    }
    return verdicts;
}
/** PP-F-4 — closed shadow is NIT; never soft-skip. */
function foldShadowClosed(_chassis) {
    return [
        {
            id: 'unsupported.shadow.closed',
            status: 'fail',
            reason: 'closed shadow is NIT (PP-F-4)',
        },
    ];
}
/** Manual slotAssignment is NIT; never soft-skip. */
function foldShadowManual(_chassis) {
    return [
        {
            id: 'unsupported.shadow.manual',
            status: 'fail',
            reason: 'slotAssignment=manual is NIT',
        },
    ];
}
//# sourceMappingURL=shadowOpen.js.map