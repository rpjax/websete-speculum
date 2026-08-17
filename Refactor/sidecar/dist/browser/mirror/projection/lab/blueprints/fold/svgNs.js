"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldSvgNs = foldSvgNs;
const applyAttrs_1 = require("./applyAttrs");
/** PP-F-SVG-1 — same snap+iso as apply-attrs; ns_mismatch is an explicit fail. */
function foldSvgNs(chassis) {
    const verdicts = (0, applyAttrs_1.foldApplyAttrs)(chassis);
    const iso = chassis.journal.iso;
    const kinds = iso?.structuralDiff?.divergences?.map((d) => d.kind) ?? [];
    if (kinds.includes('ns_mismatch')) {
        verdicts.push({ id: 'iso.ns', status: 'fail', reason: 'ns_mismatch' });
    }
    return verdicts;
}
//# sourceMappingURL=svgNs.js.map