"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldFormsState = foldFormsState;
const applyAttrs_1 = require("./applyAttrs");
/** PP-PROP-1 — same snap+iso as apply-attrs; form property mismatch fails when a DOM client is present. */
function foldFormsState(chassis) {
    const verdicts = (0, applyAttrs_1.foldApplyAttrs)(chassis);
    if (!chassis.hasClientRelay)
        return verdicts;
    const iso = chassis.journal.iso;
    const nameV = iso?.formProps?.virtual?.find((c) => c.key === 'name');
    const nameC = iso?.formProps?.client?.find((c) => c.key === 'name');
    if (nameV?.value && nameC?.value != null && nameV.value !== nameC.value) {
        verdicts.push({
            id: 'iso.formProps.name',
            status: 'fail',
            reason: `Virtual #name=${nameV.value} Projected #name=${nameC.value}`,
        });
    }
    return verdicts;
}
//# sourceMappingURL=formsState.js.map