/**
 * `flat` — the IR tree becomes **our** HTML.
 *
 * This is the emitter `emit.md` §3 always specified and that was never written. It
 * ships our markup plus the origin's authored CSS, and **no JavaScript at all** —
 * which is not a limitation, it is the whole mechanism. Every failure the `rehost`
 * bundle produced (hydration mismatch, lazy chunks that 404, a third-party SDK
 * throwing inside the app's error boundary, CORS on the API host, fixture matching)
 * is a failure of *running someone else's application*. A page that runs nothing
 * cannot fail those ways.
 *
 * What survives: exact structure, the complete authored cascade, and therefore every
 * CSS-driven behaviour — `:hover`, `:focus`, transitions, keyframes, media queries,
 * container queries, custom properties. What does not: anything that needed script.
 * That trade is stated once here and never worked around.
 *
 * Pure: no fs, no network, no repo imports. Everything it needs arrives as an
 * argument, which is what makes it provable without a browser (C-4e's lesson).
 */

// ── the tree, as the agent serialized it (ir.md §3) ────────────────────────────

export interface TextNode { t: 'text'; v: string }
export interface ElementNode {
  t: 'element'
  n: string
  a: Record<string, string>
  c?: TreeNode[]
  /** live state the origin never served as an attribute */
  s?: { value?: string; checked?: boolean; selected?: boolean; scrollTop?: number; scrollLeft?: number }
  shadow?: { mode: 'open' | 'closed'; root: ElementNode }
  doc?: { src: string | null; crossOrigin: boolean; root: ElementNode | null }
  canvas?: { w: number; h: number; substitute: string | null }
}
export type TreeNode = TextNode | ElementNode

export interface FlatDeps {
  /** absolute asset URL → path inside the bundle, or null when we do not hold it */
  resolve(url: string): string | null
  /** absolute page URL → another document in this bundle, or null */
  document(url: string): string | null
  /** our ordered stylesheet paths, injected into <head> in cascade order (IR-4) */
  stylesheets: string[]
  /** emit a same-origin iframe's inner document; returns its path in the bundle */
  subdocument?: (root: ElementNode, index: number) => string | null
  /** the document's own URL, to resolve relative references the DOM kept */
  baseUrl: string
}

export interface FlatResult {
  html: string
  /** referenced but not held — a capture gap, named, never silently dropped (IR-8) */
  missing: string[]
  warnings: string[]
}

// ── what a page that runs nothing must not carry ───────────────────────────────

/**
 * Dropped whole. `script` is the point of the emitter. `style` and stylesheet
 * `link`s go because the authored cascade is re-emitted in order from the CSSOM
 * (IR-4) — keeping the originals too would apply the cascade twice, and the second
 * copy would still point at the origin. `noscript` holds the fallback markup for a
 * page that never ran, which would duplicate content that did.
 */
const DROP_ELEMENTS = new Set(['script', 'style', 'noscript', 'base', 'template'])

/** `link` is kept only for what a dead page can honestly use. */
const KEEP_LINK_REL = new Set(['icon', 'shortcut icon', 'apple-touch-icon', 'mask-icon'])

/**
 * Dropped attributes.
 *
 * `integrity` cannot survive a rewritten byte and a stale hash is a blank page
 * (E2/§2.3). `nonce` belongs to a CSP that is no longer ours. `on*` handlers are
 * inline script by another name. `loading="lazy"` defers images that will never be
 * scrolled into view by a script, and `data-src`-style attributes are inert.
 */
const DROP_ATTRS = new Set(['integrity', 'nonce', 'crossorigin', 'srcdoc'])

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/** URL-bearing attributes, by element. A destination is not a subresource. */
const URL_ATTRS: Record<string, string[]> = {
  img: ['src'], source: ['src'], video: ['src', 'poster'], audio: ['src'],
  track: ['src'], embed: ['src'], object: ['data'], input: ['src'],
  link: ['href'], use: ['href'], image: ['href'],
}
const SRCSET_ATTRS = new Set(['srcset', 'imagesrcset'])

/** Where the reader goes when they click, as opposed to what the page loads. */
function isNavigation(tag: string, attr: string): boolean {
  return (attr === 'href' && (tag === 'a' || tag === 'area')) ||
    (attr === 'action' && tag === 'form')
}

/** Elements whose `src` loads a whole document, decided by the frame branch alone. */
const FRAME_ELEMENTS = new Set(['iframe', 'frame'])

function withoutSrc(a: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(a)) if (k.toLowerCase() !== 'src') out[k] = v
  return out
}

// ── escaping ───────────────────────────────────────────────────────────────────

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

// ── CSS `url()` rewriting ──────────────────────────────────────────────────────

/**
 * Rewrite every `url()` in a stylesheet or a `style` attribute.
 *
 * This is a blind replace on text, and it is allowed here for the reason the ban
 * exists: the ban (E2/§2.1) is on rewriting **minified JavaScript**, where a string
 * that looks like a URL may be anything. `url()` in CSS is a grammar production with
 * exactly one meaning. `flat` never touches JavaScript, so the dangerous case cannot
 * arise — which is the deeper reason this emitter is the safe one.
 */
export function rewriteCssUrls(
  css: string,
  resolve: (url: string) => string | null,
  base: string,
  onMissing: (url: string) => void,
): string {
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
    (whole, quote: string, raw: string) => {
      const trimmed = raw.trim()
      // data:, blob: and fragment-only references are already self-contained
      if (/^(data:|blob:|#)/i.test(trimmed)) return whole
      const abs = absolute(trimmed, base)
      if (!abs) return whole
      const local = resolve(abs)
      // Single-quoted deliberately: the same text has to be valid inside a
      // stylesheet file *and* inside a double-quoted `style` attribute, where a
      // double quote would come back out as `&quot;`. Our paths are
      // `assets/<hex>.<ext>`, so a quote can never appear inside one.
      if (!local) { onMissing(abs); return `url('about:blank')` }
      return `url('${local}')`
    },
  )
}

function absolute(url: string, base: string): string | null {
  try { return new URL(url, base).href } catch { return null }
}

/** `a.png 1x, b.png 2x` — each candidate rewritten, descriptors preserved. */
function rewriteSrcset(
  value: string,
  resolve: (url: string) => string | null,
  base: string,
  onMissing: (url: string) => void,
): string | null {
  const kept: string[] = []
  for (const part of value.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const [rawUrl, ...descriptors] = trimmed.split(/\s+/)
    if (!rawUrl) continue
    const abs = absolute(rawUrl, base)
    const local = abs ? resolve(abs) : null
    if (!local) { if (abs) onMissing(abs); continue }
    kept.push([local, ...descriptors].join(' '))
  }
  return kept.length ? kept.join(', ') : null
}

// ── serialization ──────────────────────────────────────────────────────────────

export function emitDocument(root: ElementNode, deps: FlatDeps): FlatResult {
  const missing = new Set<string>()
  const warnings: string[] = []
  let subdocs = 0

  const noteMissing = (url: string) => { missing.add(url) }

  const attrsOf = (el: ElementNode): string => {
    const out: string[] = []
    const urlAttrs = URL_ATTRS[el.n] ?? []

    for (const [name, rawValue] of Object.entries(el.a)) {
      const lower = name.toLowerCase()
      if (DROP_ATTRS.has(lower)) continue
      // inline script by another name
      if (lower.startsWith('on')) continue
      // a lazy image on a page with no scroll script simply never loads
      if (el.n === 'img' && lower === 'loading') continue

      let value = rawValue

      if (SRCSET_ATTRS.has(lower)) {
        const rewritten = rewriteSrcset(value, deps.resolve, deps.baseUrl, noteMissing)
        if (!rewritten) continue
        value = rewritten
      } else if (urlAttrs.includes(lower)) {
        const abs = absolute(value, deps.baseUrl)
        const local = abs ? deps.resolve(abs) : null
        if (!local) {
          // E2 — closed world. Leaving the original would send the rendered page to
          // the real internet, which is the one thing the bundle must never do.
          if (abs) noteMissing(abs)
          continue
        }
        value = local
      } else if (isNavigation(el.n, lower)) {
        // A destination, not a byte — but it must still be a destination that works.
        //
        // "Leave it exactly as the origin wrote it" was wrong for the 71 links out of
        // 87 that a real page writes **root-relative** (`/store/all`): under our
        // origin those resolve to `127.0.0.1:<port>/store/all` and dead-end inside
        // the bundle. So every navigation target is resolved against the page's own
        // URL first: a page this session captured points at our copy, and everything
        // else keeps the **absolute** original, which is where the origin was
        // sending the reader anyway. E2 is untouched — a link issues no request
        // until a human clicks it, exactly like the absolute links already here.
        if (value.startsWith('#')) { out.push(`${name}="${escapeAttr(value)}"`); continue }
        if (/^javascript:/i.test(value)) continue // inline script by another name
        const abs = absolute(value, deps.baseUrl)
        if (abs) value = deps.document(abs) ?? abs
      } else if (lower === 'style') {
        value = rewriteCssUrls(value, deps.resolve, deps.baseUrl, noteMissing)
      }

      out.push(`${name}="${escapeAttr(value)}"`)
    }

    // live state the origin never served as markup — emitted explicitly, so the
    // static page shows what the operator actually saw (never faked as origin bytes)
    if (el.s) {
      if (el.s.value !== undefined && (el.n === 'input' || el.n === 'textarea') && !('value' in el.a)) {
        out.push(`value="${escapeAttr(el.s.value)}"`)
      }
      if (el.s.checked) out.push('checked=""')
      if (el.s.selected) out.push('selected=""')
    }

    return out.length ? ' ' + out.join(' ') : ''
  }

  const serialize = (node: TreeNode): string => {
    if (node.t === 'text') return escapeText(node.v)

    const el = node
    if (DROP_ELEMENTS.has(el.n)) return ''

    if (el.n === 'link') {
      const rel = (el.a['rel'] ?? '').toLowerCase().trim()
      if (!KEEP_LINK_REL.has(rel)) return '' // stylesheet, preload, manifest, prefetch…
    }
    if (el.n === 'meta') {
      const equiv = (el.a['http-equiv'] ?? '').toLowerCase()
      // their CSP is not ours (§2.4), and a refresh would navigate off the bundle
      if (equiv === 'content-security-policy' || equiv === 'refresh') return ''
    }

    // A frame with no `doc` record at all (the agent could not reach it) is still a
    // frame: keeping its src would fetch from the origin at render time.
    if (FRAME_ELEMENTS.has(el.n) && !el.doc) {
      if (el.a['src']) warnings.push(`<${el.n}> emitted without src — nothing was captured for it: ${el.a['src']}`)
      return `<${el.n}${attrsOf({ ...el, a: withoutSrc(el.a) })}></${el.n}>`
    }

    const open = `<${el.n}${attrsOf(el)}>`
    if (VOID_ELEMENTS.has(el.n)) return open

    let inner = ''

    // Declarative shadow DOM: the browser builds the shadow tree from markup, with
    // no script. A closed root is emitted open — we cannot reproduce closedness
    // without script, and structure matters more than an unobservable flag.
    if (el.shadow) {
      if (el.shadow.mode === 'closed') {
        warnings.push(`closed shadow root emitted as open: <${el.n}>`)
      }
      const children = (el.shadow.root.c ?? []).map(serialize).join('')
      inner += `<template shadowrootmode="open">${children}</template>`
    }

    // A frame's `src` is decided here and nowhere else.
    //
    // This is the leak that reached a real bundle: `iframe` is not in URL_ATTRS, so
    // its `src` fell through as an ordinary attribute and kept pointing at the real
    // internet — six live external frames (a review widget, an anti-fraud SDK, three
    // tracking pixels) in a page that is supposed to be a closed world. A frame we
    // cannot serve gets **no src at all**; the warning says which one and why.
    if (el.doc) {
      const inner = el.doc.crossOrigin || !el.doc.root
        ? null
        : deps.subdocument?.(el.doc.root, subdocs++) ?? null
      const rest = attrsOf({ ...el, a: withoutSrc(el.a) })
      if (inner) return `<${el.n}${rest} src="${escapeAttr(inner)}"></${el.n}>`
      warnings.push(
        el.doc.crossOrigin
          ? `cross-origin iframe emitted without src — its document was never readable: ${el.doc.src ?? '(no src)'}`
          : `iframe emitted without src — no document was captured for it: ${el.doc.src ?? '(no src)'}`,
      )
      return `<${el.n}${rest}></${el.n}>`
    }

    if (el.canvas && !el.canvas.substitute) {
      warnings.push(`canvas left blank (${el.canvas.w}×${el.canvas.h}) — its pixels needed script`)
    }

    inner += (el.c ?? []).map(serialize).join('')

    // our cascade, in order, at the end of <head> where the origin's sheets were
    if (el.n === 'head') {
      inner += deps.stylesheets
        .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`)
        .join('')
    }

    return `${open}${inner}</${el.n}>`
  }

  let html = serialize(root)
  if (!/<head[\s>]/i.test(html)) {
    // a tree with no <head> still needs the cascade
    const links = deps.stylesheets
      .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`)
      .join('')
    html = html.replace(/^(<html[^>]*>)/i, `$1<head>${links}</head>`)
    warnings.push('document had no <head>; one was created for the cascade')
  }

  return { html: `<!doctype html>\n${html}`, missing: [...missing], warnings }
}
