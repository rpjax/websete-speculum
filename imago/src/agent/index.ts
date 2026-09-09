/**
 * Imago in-page agent. Installed via addInitScript, so it runs before any page
 * script in every frame (capture.md §3.2).
 *
 * Own code — nothing shared with Speculum (I7 / D-011).
 *
 * Two jobs: keep enough state for the node side to decide when the page settled,
 * and serialize a snapshot on demand. It never pauses, freezes or dialogs (C-0).
 */

declare global {
  interface Window {
    __imago?: ImagoAgent
    __imagoMark?: (name: string) => void
  }
}

interface SheetOut {
  /** null when the sheet must be refetched node-side (C-1) */
  text: string | null
  href: string | null
  crossOrigin: boolean
  meta: { order: number; media: string; disabled: boolean; origin: string }
}

interface SnapshotOut {
  url: string
  title: string
  viewport: { width: number; height: number; dpr: number }
  tree: unknown
  sheets: SheetOut[]
  refs: string[]
}

interface ImagoAgent {
  state(): { lastMutationAt: number; now: number; fontsPending: boolean; readyState: string; url: string }
  snapshot(): SnapshotOut
}

import { isFetchable, subresourceAttrs } from '../shared/refPolicy.js'

const PRESERVE_WS = new Set(['PRE', 'TEXTAREA', 'SCRIPT', 'STYLE'])

let lastMutationAt = Date.now()
const shadowRoots = new WeakMap<Element, ShadowRoot>()

// ── closed shadow roots ────────────────────────────────────────────────────────
// attachShadow({mode:'closed'}) is unreadable by design; keep our own registry.
// Detectable surface, accepted: challenges are ignored (D-012).
;(function patchAttachShadow() {
  const native = Element.prototype.attachShadow
  if (!native) return
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
    const root = native.call(this, init)
    try { shadowRoots.set(this, root) } catch { /* frozen element */ }
    return root
  }
})()

function rootOf(el: Element): ShadowRoot | null {
  return el.shadowRoot ?? shadowRoots.get(el) ?? null
}

// ── settle signal ──────────────────────────────────────────────────────────────
function watch() {
  const bump = () => { lastMutationAt = Date.now() }
  new MutationObserver(bump).observe(document, {
    subtree: true, childList: true, attributes: true, characterData: true,
  })
  addEventListener('scroll', bump, { passive: true, capture: true })
}
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', watch, { once: true })
else watch()

// ── mark hotkey (Ctrl+Shift+M) ─────────────────────────────────────────────────
addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
    try { window.__imagoMark?.('') } catch { /* binding not installed in this frame */ }
  }
}, true)

// ── serialization ──────────────────────────────────────────────────────────────
const refs = new Set<string>()

function absolute(url: string, base?: string): string | null {
  try { return new URL(url, base ?? location.href).href } catch { return null }
}

function noteRef(raw: string | null | undefined, base?: string) {
  if (!raw || !isFetchable(raw)) return
  const abs = absolute(raw.trim(), base)
  if (abs) refs.add(abs)
}

function noteSrcset(value: string) {
  for (const part of value.split(',')) noteRef(part.trim().split(/\s+/)[0])
}

function noteCssRefs(cssText: string, base?: string) {
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cssText))) noteRef(m[2], base)
}

function serializeNode(node: Node): unknown {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? ''
    const parent = node.parentElement
    if (!text.trim() && !(parent && PRESERVE_WS.has(parent.tagName))) return null
    return { t: 'text', v: text }
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null // comments dropped (ir.md §3)

  const el = node as Element
  const attrs: Record<string, string> = {}
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value

  // Subresources only — a link is a destination, not a byte we need (refPolicy).
  for (const { attr, kind } of subresourceAttrs(el.tagName, attrs['rel'])) {
    const value = attrs[attr]
    if (!value) continue
    if (kind === 'srcset') noteSrcset(value)
    else noteRef(value)
  }
  if (attrs['imagesrcset']) noteSrcset(attrs['imagesrcset'])
  if (attrs['style']) noteCssRefs(attrs['style'])

  const out: Record<string, unknown> = { t: 'element', n: el.tagName.toLowerCase(), a: attrs }

  // form and scroll state, explicit — never faked as attributes the origin did not serve
  const state: Record<string, unknown> = {}
  if (el instanceof HTMLInputElement) { state.value = el.value; state.checked = el.checked }
  else if (el instanceof HTMLTextAreaElement) state.value = el.value
  else if (el instanceof HTMLSelectElement) state.value = el.value
  else if (el instanceof HTMLOptionElement) state.selected = el.selected
  if (el.scrollTop) state.scrollTop = el.scrollTop
  if (el.scrollLeft) state.scrollLeft = el.scrollLeft
  if (Object.keys(state).length) out.s = state

  if (el instanceof HTMLCanvasElement) {
    out.canvas = { w: el.width, h: el.height, substitute: null } // OPEN-5
  }

  const shadow = rootOf(el)
  if (shadow) {
    out.shadow = {
      mode: el.shadowRoot ? 'open' : 'closed',
      root: { t: 'element', n: '#shadow-root', a: {}, c: childrenOf(shadow) },
    }
  }

  if (el instanceof HTMLIFrameElement || el instanceof HTMLFrameElement) {
    let inner: unknown = null
    try {
      const doc = el.contentDocument
      if (doc?.documentElement) inner = serializeNode(doc.documentElement)
    } catch { inner = null } // cross-origin: boundary node only
    out.doc = { src: el.getAttribute('src'), crossOrigin: inner === null, root: inner }
    if (inner === null) return out
  }

  out.c = childrenOf(el)
  return out
}

function childrenOf(parent: ParentNode): unknown[] {
  const out: unknown[] = []
  parent.childNodes.forEach((child) => {
    const s = serializeNode(child)
    if (s) out.push(s)
  })
  return out
}

// ── CSSOM (I3 / C-1..C-3) ──────────────────────────────────────────────────────
function sheetText(sheet: CSSStyleSheet): string | null {
  try {
    let text = ''
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSImportRule && rule.styleSheet) {
        const nested = sheetText(rule.styleSheet)
        text += nested ?? `/* imago: unreadable @import ${rule.href} */\n`
      } else {
        text += rule.cssText + '\n'
      }
    }
    return text
  } catch {
    return null // SecurityError on a cross-origin sheet → node refetches (C-1)
  }
}

function collectSheets(): SheetOut[] {
  const out: SheetOut[] = []
  let order = 0
  const push = (sheet: CSSStyleSheet, origin: string) => {
    const text = sheetText(sheet)
    if (text) noteCssRefs(text, sheet.href ?? undefined)
    out.push({
      text,
      href: sheet.href,
      crossOrigin: text === null,
      meta: { order: order++, media: sheet.media?.mediaText ?? '', disabled: !!sheet.disabled, origin },
    })
  }
  for (const s of Array.from(document.styleSheets)) push(s as CSSStyleSheet, 'document')
  for (const s of (document as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? []) {
    push(s, 'document:adopted')
  }
  // shadow roots we know about, in discovery order
  const walk = (root: ParentNode, path: string) => {
    root.querySelectorAll('*').forEach((el) => {
      const sr = rootOf(el)
      if (!sr) return
      const p = `${path}>${el.tagName.toLowerCase()}`
      for (const s of (sr as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? []) {
        push(s, `shadow:${p}`)
      }
      walk(sr, p)
    })
  }
  try { walk(document, '') } catch { /* best effort */ }
  return out
}

// ── public surface ─────────────────────────────────────────────────────────────
const agent: ImagoAgent = {
  state() {
    let fontsPending = false
    try { fontsPending = document.fonts?.status !== 'loaded' } catch { fontsPending = false }
    return { lastMutationAt, now: Date.now(), fontsPending, readyState: document.readyState, url: location.href }
  },
  snapshot() {
    refs.clear()
    const sheets = collectSheets()
    const tree = document.documentElement ? serializeNode(document.documentElement) : null
    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      tree,
      sheets,
      refs: Array.from(refs),
    }
  },
}

window.__imago = agent
export {}
