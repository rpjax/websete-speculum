/**
 * W4 — Cross-origin (non-CORS) stylesheet rule bodies via CDP CSS.getStyleSheetText.
 * Page JS cannot read cssRules for these sheets; the browser still holds the text.
 *
 * CDP no longer has CSS.getAllStyleSheets — collect headers via CSS.styleSheetAdded
 * (re-emitted for existing sheets when CSS.enable runs).
 */
import type { CDPSession } from 'patchright';
import type { CssomRuleDescriptor, CssomSheetDescriptor } from './cssom';

type CdpStyleSheetHeader = {
  styleSheetId?: string;
  sourceURL?: string;
  frameId?: string;
  isInline?: boolean;
  disabled?: boolean;
};

type CdpSessionWire = {
  send: (m: string, p?: object) => Promise<unknown>;
  on?: (event: string, handler: (ev: { header?: CdpStyleSheetHeader }) => void) => void;
  off?: (event: string, handler: (ev: { header?: CdpStyleSheetHeader }) => void) => void;
  removeListener?: (event: string, handler: (ev: { header?: CdpStyleSheetHeader }) => void) => void;
};

/** Split a stylesheet text into top-level rule texts (brace-depth, string-aware). */
export function splitCssTopLevelRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (inStr) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const rule = css.slice(start, i + 1).trim();
        if (rule) rules.push(rule);
        start = i + 1;
      }
    }
  }
  return rules;
}

function allocRuleIds(sheets: CssomSheetDescriptor[]): () => number {
  const used = new Set<number>();
  for (const sheet of sheets) {
    used.add(sheet.id);
    for (const rule of sheet.rules) used.add(rule.id);
  }
  let next = 1;
  return () => {
    while (used.has(next)) next++;
    const id = next++;
    used.add(id);
    return id;
  };
}

/** Normalize stylesheet URLs so CDP sourceURL ↔ sheet.href survive redirects/trailing slash. */
export function canonicalizeStylesheetUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    }
    return u.href;
  } catch {
    return trimmed;
  }
}

function stylesheetUrlKeys(url: string): string[] {
  const canon = canonicalizeStylesheetUrl(url);
  if (!canon) return [];
  const keys = new Set<string>([canon, url.trim()]);
  try {
    const u = new URL(canon);
    keys.add(`${u.origin}${u.pathname}${u.search}`);
    keys.add(u.pathname + u.search);
  } catch {
    /* */
  }
  return [...keys];
}

/**
 * Collect stylesheet headers by toggling CSS.enable so Chromium re-emits
 * styleSheetAdded for every existing sheet (getAllStyleSheets was removed).
 */
async function collectStyleSheetHeaders(cdp: CdpSessionWire): Promise<CdpStyleSheetHeader[]> {
  const headers: CdpStyleSheetHeader[] = [];
  const onAdded = (ev: { header?: CdpStyleSheetHeader }) => {
    if (ev?.header) headers.push(ev.header);
  };
  cdp.on?.('CSS.styleSheetAdded', onAdded);
  try {
    try {
      await cdp.send('DOM.enable');
    } catch {
      /* */
    }
    try {
      await cdp.send('CSS.disable');
    } catch {
      /* may not have been enabled */
    }
    await cdp.send('CSS.enable');
    // Allow the burst of styleSheetAdded events for existing sheets (heavy sites need headroom).
    await new Promise((r) => setTimeout(r, 1_200));
  } finally {
    if (typeof cdp.off === 'function') cdp.off('CSS.styleSheetAdded', onAdded);
    else if (typeof cdp.removeListener === 'function') cdp.removeListener('CSS.styleSheetAdded', onAdded);
  }
  return headers;
}

/**
 * For sheets published header-only (empty rules), fill rule bodies from CDP.
 * Matching: canonical sourceURL ↔ sheet.href only — never basename / leftover order.
 */
export async function enrichCrossOriginSheets(
  cdp: CDPSession,
  sheets: CssomSheetDescriptor[],
): Promise<CssomSheetDescriptor[]> {
  const needs = sheets.filter((s) => s.rules.length === 0);
  if (needs.length === 0) return sheets;

  const wire = cdp as unknown as CdpSessionWire;
  let headers: CdpStyleSheetHeader[] = [];
  try {
    headers = await collectStyleSheetHeaders(wire);
  } catch {
    return sheets;
  }

  const byUrl = new Map<string, string>();
  for (const header of headers) {
    const id = header.styleSheetId;
    if (!id || header.disabled) continue;
    const url = (header.sourceURL || '').trim();
    if (!url) continue;
    for (const key of stylesheetUrlKeys(url)) {
      if (!byUrl.has(key)) byUrl.set(key, id);
    }
  }

  const used = new Set<string>();
  const alloc = allocRuleIds(sheets);

  async function rulesFromId(styleSheetId: string): Promise<CssomRuleDescriptor[]> {
    const textRes = (await wire.send('CSS.getStyleSheetText', { styleSheetId })) as { text?: string };
    const text = textRes.text ?? '';
    return splitCssTopLevelRules(text).map((cssText) => ({ id: alloc(), cssText }));
  }

  const out: CssomSheetDescriptor[] = [];
  for (const sheet of sheets) {
    if (sheet.rules.length > 0) {
      out.push(sheet);
      continue;
    }
    let styleSheetId: string | undefined;
    if (sheet.href) {
      for (const key of stylesheetUrlKeys(sheet.href)) {
        styleSheetId = byUrl.get(key);
        if (styleSheetId) break;
      }
    }
    if (!styleSheetId || used.has(styleSheetId)) {
      out.push(sheet);
      continue;
    }
    used.add(styleSheetId);
    try {
      const rules = await rulesFromId(styleSheetId);
      const { href: _href, ...rest } = sheet;
      void _href;
      out.push({ ...rest, rules });
    } catch {
      out.push(sheet);
    }
  }
  return out.map(({ href: _h, ...rest }) => {
    void _h;
    return rest;
  });
}
