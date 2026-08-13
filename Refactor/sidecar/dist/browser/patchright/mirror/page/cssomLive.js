"use strict";
/**
 * Live CSSOM wiring — snapshot enrichment (W4 CDP) and tick-delta absorb onto
 * the engine coalescer (§5.10.4).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotCssomSheets = snapshotCssomSheets;
exports.absorbCssomDelta = absorbCssomDelta;
const cssomCdp_1 = require("./cssomCdp");
const inpageScript_1 = require("./inpageScript");
const SNAPSHOT_CSSOM_SNIPPET = `
  (typeof window.__speculumPageProjectionV2 !== 'undefined'
    && typeof window.__speculumPageProjectionV2.snapshotCssom === 'function')
    ? window.__speculumPageProjectionV2.snapshotCssom()
    : []
`;
function rewriteSheetUrls(rewriter, sheet) {
    const baseHref = sheet.href;
    return {
        ...sheet,
        rules: sheet.rules.map((rule) => ({
            ...rule,
            cssText: rewriter.rewriteCssUrlFunctions(rule.cssText, baseHref),
        })),
    };
}
async function snapshotCssomSheets(page, cdp, rewriter) {
    const pageWithTimeout = page;
    const prevTimeout = pageWithTimeout.getDefaultTimeout?.() ?? 30_000;
    pageWithTimeout.setDefaultTimeout?.(120_000);
    try {
        const hasApi = await page.evaluate(`(function(){
      return typeof window.__speculumPageProjectionV2 !== 'undefined'
        && typeof window.__speculumPageProjectionV2.snapshotCssom === 'function';
    })()`);
        if (!hasApi) {
            await page.evaluate(inpageScript_1.PAGE_PROJECTION_V2_PAGE_SCRIPT);
        }
        const result = await page.evaluate(SNAPSHOT_CSSOM_SNIPPET);
        let sheets = Array.isArray(result)
            ? result
            : [];
        if (cdp && sheets.length > 0) {
            sheets = await (0, cssomCdp_1.enrichCrossOriginSheets)(cdp, sheets);
        }
        if (rewriter) {
            sheets = sheets.map((s) => rewriteSheetUrls(rewriter, s));
        }
        return sheets;
    }
    finally {
        pageWithTimeout.setDefaultTimeout?.(prevTimeout);
    }
}
/** Applies one `tick.cssom[]` delta directly onto the engine's coalescer (§5.10.4) — no raw-tree dependency. */
async function absorbCssomDelta(cssom, cdp, delta, rewriter) {
    switch (delta.op) {
        case 'addSheet': {
            let sheet = delta.sheet;
            if (cdp && sheet.rules.length === 0 && sheet.href) {
                const enriched = await (0, cssomCdp_1.enrichCrossOriginSheets)(cdp, [sheet]);
                sheet = enriched[0] ?? sheet;
            }
            if (rewriter)
                sheet = rewriteSheetUrls(rewriter, sheet);
            cssom.addSheet(delta.sheetId, delta.index, sheet);
            return;
        }
        case 'removeSheet':
            cssom.removeSheet(delta.sheetId);
            return;
        case 'addRule': {
            const rule = rewriter
                ? { ...delta.rule, cssText: rewriter.rewriteCssUrlFunctions(delta.rule.cssText) }
                : delta.rule;
            cssom.addRule(delta.sheetId, delta.ruleId, delta.index, rule);
            return;
        }
        case 'removeRule':
            cssom.removeRule(delta.sheetId, delta.ruleId);
            return;
        case 'patchRule': {
            const cssText = rewriter ? rewriter.rewriteCssUrlFunctions(delta.cssText) : delta.cssText;
            cssom.patchRule(delta.ruleId, cssText);
            return;
        }
    }
}
//# sourceMappingURL=cssomLive.js.map