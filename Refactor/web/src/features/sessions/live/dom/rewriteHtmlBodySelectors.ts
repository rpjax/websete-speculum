/** Matches the projection surface (html stand-in). */
export const DOM_SURFACE_SELECTOR = '[data-speculum-dom-surface]'

/** Matches the body stand-in inside the surface. */
export const DOM_BODY_SELECTOR = '[data-speculum-dom-body]'

/**
 * Rewrite `html` / `body` type selectors so flattened projection hosts receive
 * document-level paint rules (background, color, font-size, …).
 *
 * Does not rewrite identifiers inside strings, comments, or @keyframes names
 * beyond a best-effort selector-token pass (V1).
 */
export function rewriteHtmlBodySelectors(css: string): string {
  if (!css) return css
  // Strip comments first so "body" inside comments is not rewritten oddly.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return withoutComments.replace(
    /(^|[\s,~+>()}]|:is\(|:where\(|:not\(|:has\()(html|body)(?=[\s.~:#\[>+~,)|{]|$)/gi,
    (_full, pre: string, tag: string) => {
      const sel = tag.toLowerCase() === 'html' ? DOM_SURFACE_SELECTOR : DOM_BODY_SELECTOR
      return `${pre}${sel}`
    },
  )
}

/**
 * `rem` always resolves against the real documentElement — not the projection
 * surface. Convert to px using the projected root size so layouts that depend
 * on `html { font-size: 62.5% }` stay isomorphic.
 */
export function rewriteRemToPx(css: string, rootFontSizePx: number): string {
  if (!css || !(rootFontSizePx > 0)) return css
  return css.replace(/(-?\d*\.?\d+)rem\b/gi, (_full, n: string) => {
    const px = parseFloat(n) * rootFontSizePx
    if (!Number.isFinite(px)) return _full
    const rounded = Math.round(px * 1000) / 1000
    return `${rounded}px`
  })
}

/** Best-effort parse of projected root font-size from html/surface rules. */
export function inferRootFontSizePx(css: string, fallback = 10): number {
  if (!css) return fallback
  const patterns = [
    /html\s*\{[^}]*font-size:\s*([\d.]+)(px|%)/i,
    /\[data-speculum-dom-surface\]\s*\{[^}]*font-size:\s*([\d.]+)(px|%)/i,
  ]
  for (const re of patterns) {
    const m = css.match(re)
    if (!m) continue
    const n = parseFloat(m[1]!)
    if (!Number.isFinite(n)) continue
    if ((m[2] || '').toLowerCase() === 'px') return n
    if ((m[2] || '') === '%') return (n / 100) * 16
  }
  return fallback
}

/**
 * `vw`/`vh` resolve against the real browser viewport, not the projection
 * surface. Map them to container query units so they track the surface box
 * (`container-type: size` on `[data-speculum-dom-surface]`).
 */
export function rewriteViewportUnits(css: string): string {
  if (!css) return css
  return css
    .replace(/(-?\d*\.?\d+)vw\b/gi, '$1cqw')
    .replace(/(-?\d*\.?\d+)vh\b/gi, '$1cqh')
    .replace(/(-?\d*\.?\d+)vmin\b/gi, '$1cqmin')
    .replace(/(-?\d*\.?\d+)vmax\b/gi, '$1cqmax')
    .replace(/(-?\d*\.?\d+)vi\b/gi, '$1cqi')
    .replace(/(-?\d*\.?\d+)vb\b/gi, '$1cqb')
}

/** Absolutize `url(...)` against a stylesheet href; leave data:/blob: alone. */
export function absolutizeCssUrls(css: string, baseHref: string): string {
  if (!css || !baseHref) return css
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, q: string, raw: string) => {
    const u = String(raw).trim()
    if (!u || /^data:|^blob:|^https?:|^\/\//i.test(u)) return full
    try {
      const abs = new URL(u, baseHref).href
      return `url(${q}${abs}${q})`
    } catch {
      return full
    }
  })
}
