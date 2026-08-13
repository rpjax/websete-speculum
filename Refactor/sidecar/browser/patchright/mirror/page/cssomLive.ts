/**
 * Live CSSOM wiring — snapshot enrichment (W4 CDP) and tick-delta absorb onto
 * the engine coalescer (§5.10.4).
 */

import type { CDPSession } from 'patchright';
import type { CssomCoalescer, CssomSheetDescriptor } from './cssom';
import { enrichCrossOriginSheets } from './cssomCdp';
import { PAGE_PROJECTION_V2_PAGE_SCRIPT } from './inpageScript';
import type { UrlRewriter } from './node/rewrite';

/** Wire shape of one `tick.cssom[]` delta entry — mirrors `PageProjectionEngine.cssom`'s method surface 1:1. */
export type RawCssomDelta =
  | { op: 'addSheet'; sheetId: number; index: number; sheet: CssomSheetDescriptor }
  | { op: 'removeSheet'; sheetId: number }
  | { op: 'addRule'; sheetId: number; ruleId: number; index: number; rule: { id: number; cssText: string } }
  | { op: 'removeRule'; sheetId: number; ruleId: number }
  | { op: 'patchRule'; ruleId: number; cssText: string };

/** Minimal page surface for CSSOM snapshot evaluate. */
export type CssomLivePage = {
  evaluate(pageFunction: string): Promise<unknown>;
};

const SNAPSHOT_CSSOM_SNIPPET = `
  (typeof window.__speculumPageProjectionV2 !== 'undefined'
    && typeof window.__speculumPageProjectionV2.snapshotCssom === 'function')
    ? window.__speculumPageProjectionV2.snapshotCssom()
    : []
`;

function rewriteSheetUrls(rewriter: UrlRewriter, sheet: CssomSheetDescriptor): CssomSheetDescriptor {
  const baseHref = sheet.href;
  return {
    ...sheet,
    rules: sheet.rules.map((rule) => ({
      ...rule,
      cssText: rewriter.rewriteCssUrlFunctions(rule.cssText, baseHref),
    })),
  };
}

export async function snapshotCssomSheets(
  page: CssomLivePage,
  cdp: CDPSession | null,
  rewriter?: UrlRewriter | null,
): Promise<CssomSheetDescriptor[]> {
  const pageWithTimeout = page as CssomLivePage & {
    setDefaultTimeout?: (ms: number) => void;
    getDefaultTimeout?: () => number;
  };
  const prevTimeout = pageWithTimeout.getDefaultTimeout?.() ?? 30_000;
  pageWithTimeout.setDefaultTimeout?.(120_000);
  try {
    const hasApi = await page.evaluate(`(function(){
      return typeof window.__speculumPageProjectionV2 !== 'undefined'
        && typeof window.__speculumPageProjectionV2.snapshotCssom === 'function';
    })()`);
    if (!hasApi) {
      await page.evaluate(PAGE_PROJECTION_V2_PAGE_SCRIPT);
    }
    const result = await page.evaluate(SNAPSHOT_CSSOM_SNIPPET);
    let sheets: CssomSheetDescriptor[] = Array.isArray(result)
      ? (result as CssomSheetDescriptor[])
      : [];
    if (cdp && sheets.length > 0) {
      sheets = await enrichCrossOriginSheets(cdp, sheets);
    }
    if (rewriter) {
      sheets = sheets.map((s) => rewriteSheetUrls(rewriter, s));
    }
    return sheets;
  } finally {
    pageWithTimeout.setDefaultTimeout?.(prevTimeout);
  }
}

/** Applies one `tick.cssom[]` delta directly onto the engine's coalescer (§5.10.4) — no raw-tree dependency. */
export async function absorbCssomDelta(
  cssom: CssomCoalescer,
  cdp: CDPSession | null,
  delta: RawCssomDelta,
  rewriter?: UrlRewriter | null,
): Promise<void> {
  switch (delta.op) {
    case 'addSheet': {
      let sheet = delta.sheet;
      if (cdp && sheet.rules.length === 0 && sheet.href) {
        const enriched = await enrichCrossOriginSheets(cdp, [sheet]);
        sheet = enriched[0] ?? sheet;
      }
      if (rewriter) sheet = rewriteSheetUrls(rewriter, sheet);
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
