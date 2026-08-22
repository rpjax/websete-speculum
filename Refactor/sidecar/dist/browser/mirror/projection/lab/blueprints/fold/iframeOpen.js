"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldIframeOpen = foldIframeOpen;
const applyAttrs_1 = require("./applyAttrs");
const iso_1 = require("./iso");
function isAboutBlank(href) {
    return href === 'about:blank' || href.startsWith('about:blank') || href === '';
}
/** Same-origin iframe: tree iso must enter the nested document; Projected must stay blank. */
function foldIframeOpen(chassis) {
    const verdicts = (0, applyAttrs_1.foldApplyAttrs)(chassis);
    const iso = chassis.journal.iso;
    if (!chassis.hasClientRelay) {
        verdicts.push({
            id: 'iso.nested',
            status: 'fail',
            reason: 'no DOM client — nested apply unproven',
        });
        return verdicts;
    }
    const nested = chassis.journal.nestedEvidence ?? iso?.nested ?? null;
    const virtualDocs = nested?.virtualDocs ?? 0;
    const clientDocs = nested?.clientDocs ?? 0;
    if (virtualDocs === 0) {
        verdicts.push({
            id: 'iso.nested',
            status: 'fail',
            reason: 'virtual tree has no nested document (light-only snapshot)',
        });
    }
    else if (clientDocs === 0) {
        verdicts.push({
            id: 'iso.nested',
            status: 'fail',
            reason: 'Projected nested apply never armed (no inner document)',
        });
    }
    else if (chassis.journal.nestedEvidence && !chassis.journal.nestedEvidence.treeIdenticalWhileNested) {
        verdicts.push({
            id: 'iso.nested',
            status: 'fail',
            reason: `nested tree diverged (${chassis.journal.nestedEvidence.treeDivergencesWhileNested})`,
        });
    }
    else {
        verdicts.push({
            id: 'iso.nested',
            status: 'pass',
            reason: `virtualDocs=${virtualDocs} clientDocs=${clientDocs}`,
        });
    }
    const hrefs = nested?.clientFrameHrefs ?? [];
    const navigated = hrefs.filter((h) => !isAboutBlank(h));
    if (navigated.length > 0) {
        verdicts.push({
            id: 'iso.nested.blank',
            status: 'fail',
            reason: `Projected navigated live src: ${navigated.join(', ')}`,
        });
    }
    else if (clientDocs > 0) {
        verdicts.push({
            id: 'iso.nested.blank',
            status: 'pass',
            reason: 'Projected host stayed about:blank',
        });
    }
    // ContextIndex keeps ids forever; last iso is often post-dropHost. Prove nested while live
    // via nestedEvidence / successful context iso — do not fail because the child is gone now.
    const nestedProven = (chassis.journal.nestedEvidence?.clientDocs ?? 0) > 0 &&
        (chassis.journal.nestedEvidence?.treeIdenticalWhileNested === true ||
            ((chassis.journal.nestedEvidence?.treeDivergencesWhileNested ?? 0) === 0 &&
                (chassis.journal.nestedEvidence?.virtualDocs ?? 0) > 0));
    const contextIds = chassis.contextIndex.list().filter((id) => id >= 2);
    if (contextIds.length > 0) {
        const contexts = iso?.contexts ?? {};
        for (const id of contextIds) {
            const ctx = contexts[id];
            if (!ctx || (0, iso_1.isNestedContextGone)(ctx)) {
                verdicts.push({
                    id: `iso.context.${id}.nested`,
                    status: nestedProven ? 'pass' : 'skipped',
                    reason: nestedProven
                        ? 'nested proven while live; absent after drop'
                        : 'nested context absent (post-drop)',
                });
                continue;
            }
            const tableOk = ctx.table?.identical === true;
            const treeOk = ctx.structuralDiff?.identical === true;
            if (!tableOk || !treeOk) {
                verdicts.push({
                    id: `iso.context.${id}.nested`,
                    status: 'fail',
                    reason: 'table or tree mismatch for nested context',
                });
            }
            else {
                verdicts.push({
                    id: `iso.context.${id}.nested`,
                    status: 'pass',
                    reason: 'nested context iso ok',
                });
            }
        }
    }
    return verdicts;
}
//# sourceMappingURL=iframeOpen.js.map