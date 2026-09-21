/**
 * Lab probe — layout root-cause planes on the Projected document (same-S).
 * Counts alone are not a verdict; geometry + attrs + CSSOM texts + assets are.
 */
export type LayoutRootCauseSample = {
  sel: string;
  missing?: boolean;
  tag?: string;
  className?: string;
  display?: string;
  position?: string;
  flex?: string;
  grid?: string;
  width?: string;
  height?: string;
  rect?: { x: number; y: number; w: number; h: number };
  bg?: string;
};

export type LayoutRootCauseImg = {
  src: string;
  srcset: string;
  complete: boolean;
  naturalWidth: number;
  width: number;
};

export type LayoutRootCauseCssomSheet = {
  origin: 'document.styleSheets' | 'document.adoptedStyleSheets';
  href: string | null;
  owner: string | null;
  ownerId: string | null;
  ruleCount: number | null;
  err: string | null;
  /** First N rule cssTexts — enough to hash/diff, not a full dump. */
  ruleTextSample: string[];
};

export type LayoutRootCauseProbeResult = {
  ok: boolean;
  reason?: string;
  samples: LayoutRootCauseSample[];
  overlapPairsAmong40: number;
  styleEls: number;
  linkCss: number;
  adoptedSheetCount: number;
  docSheetCount: number;
  adoptedRules: number;
  docSheetRules: number;
  sheets: LayoutRootCauseCssomSheet[];
  brokenImgs: number;
  imgsSample: LayoutRootCauseImg[];
  bodyBg: string | null;
  dualHint: {
    styleElCount: number;
    adoptedSheetCount: number;
    /** True when both planes carry substantial rules — cascade risk. */
    bothPlanesSubstantial: boolean;
    /** True when the same rule text appears in styleSheets and adopted — real double-paint. */
    duplicateAuthorRules: boolean;
  };
};

const DEFAULT_SELECTORS = [
  'header',
  '[class*="header"]',
  'nav',
  'main',
  'body',
  '[class*="search"]',
  'form',
  '.container',
  '#onetrust-banner-sdk',
] as const;

export function probeLayoutRootCause(
  doc: Document,
  win: Window,
  selectors: readonly string[] = DEFAULT_SELECTORS,
): LayoutRootCauseProbeResult {
  const pick = (sel: string): LayoutRootCauseSample => {
    const el = doc.querySelector(sel);
    if (!el) return { sel, missing: true };
    const cs = win.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sel,
      tag: el.tagName,
      className: String((el as HTMLElement).className || '').slice(0, 120),
      display: cs.display,
      position: cs.position,
      flex: `${cs.flexDirection}/${cs.justifyContent}/${cs.alignItems}`,
      grid: cs.gridTemplateColumns,
      width: cs.width,
      height: cs.height,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      bg: cs.backgroundColor,
    };
  };

  const samples = selectors.map(pick);

  const nodes = [
    ...doc.querySelectorAll('header, nav, [class*="header"], [class*="Header"], a, button'),
  ].slice(0, 80);
  const rects = nodes
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 10 && r.height > 8);
  let overlaps = 0;
  const n = Math.min(rects.length, 40);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      const hit = !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
      if (hit) overlaps++;
    }
  }

  const sheets: LayoutRootCauseCssomSheet[] = [];
  let adoptedRules = 0;
  let docSheetRules = 0;

  const walk = (
    list: StyleSheetList | CSSStyleSheet[],
    origin: LayoutRootCauseCssomSheet['origin'],
  ) => {
    const len = list.length;
    for (let i = 0; i < len; i++) {
      const s = list[i] as CSSStyleSheet;
      let ruleCount: number | null = null;
      let err: string | null = null;
      const ruleTextSample: string[] = [];
      try {
        const rules = s.cssRules;
        ruleCount = rules.length;
        for (let j = 0; j < Math.min(rules.length, 8); j++) {
          ruleTextSample.push(rules.item(j)?.cssText?.slice(0, 160) ?? '');
        }
        if (origin === 'document.adoptedStyleSheets') adoptedRules += rules.length;
        else docSheetRules += rules.length;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      const owner = s.ownerNode as Element | null;
      sheets.push({
        origin,
        href: s.href || null,
        owner: owner?.nodeName ?? null,
        ownerId: owner && 'id' in owner ? String((owner as Element).id || '') || null : null,
        ruleCount,
        err,
        ruleTextSample,
      });
    }
  };

  try {
    walk(doc.styleSheets, 'document.styleSheets');
  } catch {
    /* ignore */
  }
  try {
    if (doc.adoptedStyleSheets?.length) {
      walk(doc.adoptedStyleSheets as unknown as CSSStyleSheet[], 'document.adoptedStyleSheets');
    }
  } catch {
    /* ignore */
  }

  const allImgs = [...doc.images];
  const logoImgs = allImgs.filter((img) => {
    const s = img.currentSrc || img.src || '';
    return /logo\.svg/i.test(s) || /\/logo(\.|$)/i.test(s);
  });
  const isTrackerImgUrl = (s: string) =>
    /bat\.bing\.com/i.test(s) ||
    /\/action\/0(\?|$)/i.test(s) ||
    /pixel\.(facebook|google|adnxs)/i.test(s);
  const brokenList = allImgs.filter((i) => {
    if (!(i.complete && i.naturalWidth === 0)) return false;
    const s = i.currentSrc || i.src || '';
    if (isTrackerImgUrl(s)) return false;
    return true;
  });
  const mapImg = (img: HTMLImageElement) => ({
    src: (img.currentSrc || img.src || '').slice(0, 220),
    srcset: (img.getAttribute('srcset') || '').slice(0, 160),
    complete: img.complete,
    naturalWidth: img.naturalWidth,
    width: img.width,
  });
  // Logo + todos os broken (cap 80) — sample curto não basta pra classificar H5.
  const seen = new Set<HTMLImageElement>();
  const imgs: ReturnType<typeof mapImg>[] = [];
  for (const img of [...logoImgs, ...brokenList]) {
    if (seen.has(img)) continue;
    seen.add(img);
    imgs.push(mapImg(img));
    if (imgs.length >= 80) break;
  }
  const brokenImgs = brokenList.length;

  const styleEls = doc.querySelectorAll('style').length;
  const linkCss = doc.querySelectorAll('link[rel~="stylesheet"]').length;
  const adoptedSheetCount = doc.adoptedStyleSheets?.length ?? 0;

  const docSamples = new Set<string>();
  const adoSamples = new Set<string>();
  for (const s of sheets) {
    for (const t of s.ruleTextSample) {
      if (!t) continue;
      if (s.origin === 'document.styleSheets') docSamples.add(t.slice(0, 80));
      else adoSamples.add(t.slice(0, 80));
    }
  }
  let duplicateAuthorRules = false;
  for (const t of docSamples) {
    if (adoSamples.has(t)) {
      duplicateAuthorRules = true;
      break;
    }
  }

  return {
    ok: true,
    samples,
    overlapPairsAmong40: overlaps,
    styleEls,
    linkCss,
    adoptedSheetCount,
    docSheetCount: doc.styleSheets.length,
    adoptedRules,
    docSheetRules,
    sheets,
    brokenImgs,
    imgsSample: imgs,
    bodyBg: doc.body ? win.getComputedStyle(doc.body).backgroundColor : null,
    dualHint: {
      styleElCount: styleEls,
      adoptedSheetCount,
      bothPlanesSubstantial: docSheetRules >= 50 && adoptedRules >= 50,
      duplicateAuthorRules,
    },
  };
}
