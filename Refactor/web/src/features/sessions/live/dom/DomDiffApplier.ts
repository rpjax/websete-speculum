import type { DomDiff, DomNode } from '@/lib/speculum'
import { appendCacheBust } from '@/lib/speculum/sessionBindingAuth'
import {
  absolutizeCssUrls,
  inferRootFontSizePx,
  rewriteHtmlBodySelectors,
  rewriteRemToPx,
  rewriteViewportUnits,
} from './rewriteHtmlBodySelectors'

/** Stamps the reserved session-auth parameter onto a `/w7s/virtual-*` URL. */
export type DomAssetAuthAppender = (url: string) => string

/**
 * Attributes the sidecar serializer absolutizes and the serve plane rewrites,
 * so every one of them can hold a `/w7s/virtual-*` URL the browser will fetch.
 * Keep in sync with `DomTreeSerializer` — `srcset` and inline `style` are
 * handled separately because they carry more than one URL.
 */
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'poster', 'data-src'])

/** docs/dom-projection-input.md inputBindingDebounceMs default. */
const CONTROL_DEBOUNCE_MS = 1000

type PendingControl = {
  value?: string
  checked?: string
  selected?: string
  timer: ReturnType<typeof setTimeout>
}

/**
 * Applies DomDiff frames (document remount or replace-by-anchor) into a host element.
 */
export class DomDiffApplier {
  private generation = 0
  private lastSequence = 0
  private pendingRaf: number | null = null
  private queued: DomDiff[] = []
  private readonly host: HTMLElement
  private readonly appendAssetToken?: DomAssetAuthAppender
  private readonly onSequenceGap?: (expected: number, got: number) => void
  private readonly onGeneration?: (generation: number) => void
  private readonly onApplied?: (diff: DomDiff) => void
  private readonly onDropped?: (reason: 'generation_mismatch', diff: DomDiff) => void
  /** Anchors currently being edited locally — debounce upstream control attrs. */
  private readonly localDirtyUntil = new Map<string, number>()
  private readonly pendingControls = new Map<string, PendingControl>()
  /** Host / body-stand-in for flattened html/body anchors from document diffs. */
  private readonly standInAnchors = new Map<string, HTMLElement>()
  /** Head asset anchors kept when body patches remount body children. */
  private readonly headAnchors = new Set<string>()
  /** Receives body children + body attrs; targeted by rewritten `body` selectors. */
  private bodyStandIn: HTMLElement | null = null
  private stylesheetEpoch = 0
  /** Projected root font-size for rem→px (html { font-size: 62.5% } → 10). */
  private rootFontSizePx = 10

  constructor(
    host: HTMLElement,
    appendAssetToken?: DomAssetAuthAppender,
    onSequenceGap?: (expected: number, got: number) => void,
    onGeneration?: (generation: number) => void,
    onApplied?: (diff: DomDiff) => void,
    onDropped?: (reason: 'generation_mismatch', diff: DomDiff) => void,
  ) {
    this.host = host
    this.appendAssetToken = appendAssetToken
    this.onSequenceGap = onSequenceGap
    this.onGeneration = onGeneration
    this.onApplied = onApplied
    this.onDropped = onDropped
  }

  /** Mark a control as locally edited; keep latest upstream until debounce fires. */
  noteLocalEdit(anchor: string): void {
    if (!anchor) return
    this.localDirtyUntil.set(anchor, performance.now() + CONTROL_DEBOUNCE_MS)
  }

  getGeneration(): number {
    return this.generation
  }

  /** Queue a diff; applied inside requestAnimationFrame. */
  enqueue(diff: DomDiff): void {
    this.queued.push(diff)
    if (this.pendingRaf != null) return
    this.pendingRaf = requestAnimationFrame(() => {
      this.pendingRaf = null
      this.flush()
    })
  }

  /** Apply queued diffs immediately (tests / forced sync). */
  flush(): void {
    if (this.pendingRaf != null) {
      cancelAnimationFrame(this.pendingRaf)
      this.pendingRaf = null
    }
    const batch = this.queued
    this.queued = []
    for (const item of batch) {
      this.applyNow(item)
    }
  }

  reset(): void {
    if (this.pendingRaf != null) {
      cancelAnimationFrame(this.pendingRaf)
      this.pendingRaf = null
    }
    this.queued = []
    this.generation = 0
    this.lastSequence = 0
    this.localDirtyUntil.clear()
    for (const p of this.pendingControls.values()) clearTimeout(p.timer)
    this.pendingControls.clear()
    this.standInAnchors.clear()
    this.headAnchors.clear()
    this.bodyStandIn = null
    this.stylesheetEpoch += 1
    this.rootFontSizePx = 10
    this.host.replaceChildren()
  }

  private applyNow(diff: DomDiff): void {
    const sequence = Number(diff.sequence ?? 0)
    const isDocument =
      diff.kind === 'diff' && diff.target === 'document'

    if (this.lastSequence > 0 && sequence > this.lastSequence + 1) {
      this.onSequenceGap?.(this.lastSequence + 1, sequence)
      if (!isDocument) {
        return
      }
    }

    if (diff.treeType === 'cssom' || diff.kind === 'cssom') {
      this.reloadCssom(diff.urls ?? [])
      this.lastSequence = sequence
      this.onApplied?.(diff)
      return
    }

    if (isDocument) {
      this.applyDocument(diff)
      this.lastSequence = sequence
      this.onApplied?.(diff)
      return
    }

    if (diff.kind === 'diff' && diff.target === 'anchors' && Array.isArray(diff.nodes)) {
      if (diff.generation != null && diff.generation !== this.generation) {
        this.onDropped?.('generation_mismatch', diff)
        return
      }
      for (const node of diff.nodes) {
        this.replaceByAnchor(node)
      }
      this.lastSequence = sequence
      this.onApplied?.(diff)
    }
  }

  private applyDocument(diff: DomDiff): void {
    this.generation = Number(diff.generation ?? 0)
    this.onGeneration?.(this.generation)
    const root = diff.nodes?.[0]
    if (!root) return

    if (root.tag === 'html') {
      this.mountHtmlTree(root)
      return
    }

    // Non-html document establish still needs a clean host.
    this.stylesheetEpoch += 1
    this.host.replaceChildren()
    this.standInAnchors.clear()
    this.headAnchors.clear()
    this.bodyStandIn = null

    if (root.tag === 'body') {
      this.mountBodyChildren(root)
      return
    }

    const el = this.materialize(root)
    if (el) this.ensureBodyStandIn().appendChild(el)
  }

  private ensureBodyStandIn(): HTMLElement {
    if (this.bodyStandIn?.isConnected) return this.bodyStandIn
    this.ensureStandInBaseStyle()
    const el = document.createElement('div')
    el.setAttribute('data-speculum-dom-body', '')
    this.host.appendChild(el)
    this.bodyStandIn = el
    return el
  }

  private ensureStandInBaseStyle(): void {
    if (this.host.querySelector('style[data-speculum-standin-base]')) return
    const style = document.createElement('style')
    style.setAttribute('data-speculum-standin-base', '')
    style.textContent = this.standInBaseCss()
    this.host.prepend(style)
  }

  private standInBaseCss(): string {
    return [
      `[data-speculum-dom-surface]{display:block;box-sizing:border-box;container-type:size;font-size:${this.rootFontSizePx}px;}`,
      '[data-speculum-dom-body]{display:block;box-sizing:border-box;min-height:100%;width:100%;}',
    ].join('')
  }

  private syncStandInBaseStyle(): void {
    const base = this.host.querySelector('style[data-speculum-standin-base]')
    if (base) base.textContent = this.standInBaseCss()
  }

  private mountHtmlTree(html: DomNode): void {
    // Full remount — clear so repeated html patches do not stack head assets.
    this.stylesheetEpoch += 1
    this.host.replaceChildren()
    this.headAnchors.clear()
    this.standInAnchors.clear()
    this.bodyStandIn = null
    this.rootFontSizePx = 10

    const htmlAnchor = html.anchor ?? html.attrs?.['speculum-anchor']
    if (htmlAnchor) this.standInAnchors.set(htmlAnchor, this.host)

    const head = html.children?.find((c) => c.tag === 'head')
    const body = html.children?.find((c) => c.tag === 'body')
    if (head) {
      for (const child of head.children ?? []) {
        if (child.tag !== 'link' && child.tag !== 'style' && child.tag !== 'meta') {
          continue
        }
        const n = this.materialize(child)
        if (!n) continue
        this.host.appendChild(n)
        const a = child.anchor ?? child.attrs?.['speculum-anchor']
        if (a) this.headAnchors.add(a)
      }
    }
    if (body) {
      this.mountBodyChildren(body)
    } else {
      const standIn = this.ensureBodyStandIn()
      for (const child of html.children ?? []) {
        if (child.tag === 'head') continue
        const n = this.materialize(child)
        if (n) standIn.appendChild(n)
      }
    }
  }

  private mountBodyChildren(body: DomNode): void {
    const standIn = this.ensureBodyStandIn()
    const bodyAnchor = body.anchor ?? body.attrs?.['speculum-anchor']
    if (bodyAnchor) this.standInAnchors.set(bodyAnchor, standIn)

    this.applyBodyStandInAttrs(standIn, body)

    standIn.replaceChildren()
    for (const child of body.children ?? []) {
      const n = this.materialize(child)
      if (n) standIn.appendChild(n)
    }
  }

  private applyBodyStandInAttrs(standIn: HTMLElement, body: DomNode): void {
    const attrs = body.attrs ?? {}
    const keepAnchor = standIn.getAttribute('speculum-anchor')
    for (const name of [...standIn.getAttributeNames()]) {
      if (name === 'data-speculum-dom-body') continue
      standIn.removeAttribute(name)
    }
    standIn.setAttribute('data-speculum-dom-body', '')
    const anchor = body.anchor ?? attrs['speculum-anchor'] ?? keepAnchor
    if (anchor) standIn.setAttribute('speculum-anchor', anchor)
    for (const [name, value] of Object.entries(attrs)) {
      if (name === 'speculum-anchor') continue
      try {
        standIn.setAttribute(name, value)
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Anchors path must not remount the projected document. Remount clears
   * stylesheet placeholders and re-fetches → CSS vanishes until ingest returns.
   * Only body + head asset anchors are updated in place.
   */
  private applyHtmlAnchorsWithoutCssWipe(html: DomNode): void {
    const htmlAnchor = html.anchor ?? html.attrs?.['speculum-anchor']
    if (htmlAnchor) this.standInAnchors.set(htmlAnchor, this.host)

    const head = html.children?.find((c) => c.tag === 'head')
    const body = html.children?.find((c) => c.tag === 'body')
    if (head) {
      for (const child of head.children ?? []) {
        if (child.tag !== 'link' && child.tag !== 'style' && child.tag !== 'meta') {
          continue
        }
        this.replaceHeadAssetInPlace(child)
      }
    }
    if (body) {
      this.mountBodyChildren(body)
    }
  }

  /** Replace or append a head asset without bumping stylesheetEpoch / wiping peers. */
  private replaceHeadAssetInPlace(node: DomNode): void {
    const anchor = node.anchor ?? node.attrs?.['speculum-anchor']
    const href =
      node.tag === 'link' && isStylesheetLink(node)
        ? (node.attrs?.href ?? '')
        : node.tag === 'style'
          ? (node.attrs?.['data-speculum-css-href'] ?? '')
          : ''

    if (href) {
      const existingByHref = this.findStyleByHref(href)
      if (existingByHref && existingByHref.textContent) {
        // Keep loaded CSS; only refresh attrs/anchor.
        if (anchor) {
          existingByHref.setAttribute('speculum-anchor', anchor)
          this.headAnchors.add(anchor)
        }
        return
      }
    }

    if (anchor) {
      const existing = findByAnchor(this.host, anchor)
      const next = this.materialize(node)
      if (!next) return
      if (existing?.parentNode) {
        existing.parentNode.replaceChild(next, existing)
      } else {
        this.host.appendChild(next)
      }
      this.headAnchors.add(anchor)
      return
    }

    const next = this.materialize(node)
    if (next) this.host.appendChild(next)
  }

  private findStyleByHref(href: string): HTMLStyleElement | null {
    for (const style of this.host.querySelectorAll('style[data-speculum-css-href]')) {
      if (style.getAttribute('data-speculum-css-href') === href) {
        return style as HTMLStyleElement
      }
    }
    return null
  }

  private replaceByAnchor(node: DomNode): void {
    const tag = (node.tag || '').toLowerCase()
    // Full html remount is document-only. Anchors html would wipe loaded CSS
    // (async stylesheet ingest) and flash unstyled content every flush.
    if (tag === 'html') {
      this.applyHtmlAnchorsWithoutCssWipe(node)
      return
    }
    if (tag === 'body') {
      this.mountBodyChildren(node)
      return
    }

    const anchor = node.anchor ?? node.attrs?.['speculum-anchor']
    if (!anchor) return

    const standIn = this.standInAnchors.get(anchor)
    if (standIn === this.host) {
      this.applyHtmlAnchorsWithoutCssWipe(node)
      return
    }
    if (standIn && standIn === this.bodyStandIn) {
      this.mountBodyChildren({ ...node, tag: 'body' })
      return
    }

    const existing = findByAnchor(this.host, anchor)
    const next = this.materialize(node)
    if (!next) return
    if (existing?.parentNode) {
      existing.parentNode.replaceChild(next, existing)
      return
    }
    if (tag === 'link' || tag === 'style' || tag === 'meta') {
      this.host.appendChild(next)
      this.headAnchors.add(anchor)
    }
  }

  private materialize(node: DomNode): Node | null {
    if (node.text != null && !node.tag) {
      return document.createTextNode(node.text)
    }
    if (!node.tag) return null

    if (node.tag === '#text' || node.tag === 'text') {
      return document.createTextNode(node.text ?? '')
    }

    const tag = node.tag.toLowerCase()
    if (tag === 'style') {
      return this.materializeStyle(node)
    }
    if (tag === 'link' && isStylesheetLink(node)) {
      return this.materializeStylesheetLink(node)
    }

    let el: Element
    try {
      if (node.tag.includes(':') || node.tag === 'svg' || isSvgChild(node.tag)) {
        el = document.createElementNS('http://www.w3.org/2000/svg', node.tag)
      } else {
        el = document.createElement(node.tag)
      }
    } catch {
      el = document.createElement('div')
    }

    const attrs = { ...(node.attrs ?? {}) }
    if (node.anchor && !attrs['speculum-anchor']) {
      attrs['speculum-anchor'] = node.anchor
    }

    this.applyAttrs(el, attrs)

    if (node.text != null && (!node.children || node.children.length === 0)) {
      el.textContent = node.text
    }

    for (const child of node.children ?? []) {
      const c = this.materialize(child)
      if (c) el.appendChild(c)
    }

    this.applyControlBindings(el as HTMLElement)
    return el
  }

  private materializeStyle(node: DomNode): HTMLStyleElement {
    this.ensureStandInBaseStyle()
    const el = document.createElement('style')
    const attrs = { ...(node.attrs ?? {}) }
    if (node.anchor && !attrs['speculum-anchor']) {
      attrs['speculum-anchor'] = node.anchor
    }
    this.applyAttrs(el, attrs)
    el.textContent = this.prepareCss(node.text ?? '', null)
    return el
  }

  private materializeStylesheetLink(node: DomNode): HTMLElement {
    this.ensureStandInBaseStyle()
    const placeholder = document.createElement('style')
    const attrs = { ...(node.attrs ?? {}) }
    if (node.anchor && !attrs['speculum-anchor']) {
      attrs['speculum-anchor'] = node.anchor
    }
    const hrefRaw = attrs.href ?? ''
    delete attrs.rel
    delete attrs.href
    delete attrs.as
    this.applyAttrs(placeholder, attrs)
    placeholder.setAttribute('data-speculum-css-href', hrefRaw)

    let href = hrefRaw
    if (this.appendAssetToken && href.startsWith('/w7s/virtual-')) {
      href = this.appendAssetToken(href)
    }
    const epoch = this.stylesheetEpoch
    if (href) {
      void this.ingestStylesheet(href, placeholder, epoch)
    }
    return placeholder
  }

  private prepareCss(css: string, baseHref: string | null): string {
    let out = css
    if (baseHref) out = absolutizeCssUrls(out, baseHref)
    this.rootFontSizePx = inferRootFontSizePx(out, this.rootFontSizePx)
    out = rewriteHtmlBodySelectors(out)
    out = rewriteRemToPx(out, this.rootFontSizePx)
    out = rewriteViewportUnits(out)
    if (this.appendAssetToken) {
      // `@import "x"` / `image-set("x" 1x)` are fetched by the CSS engine with
      // no auth of their own — fold the bare-string forms into url() so the
      // single tokenizer below covers every fetchable URL in the sheet.
      out = normalizeCssStringUrls(out)
      out = rewriteCssUrls(out, this.appendAssetToken)
    }
    this.syncStandInBaseStyle()
    return out
  }

  private async ingestStylesheet(
    href: string,
    target: HTMLStyleElement,
    epoch: number,
  ): Promise<void> {
    try {
      // No credentials: virtual-asset auth is the reserved query param only.
      const res = await fetch(href)
      if (!res.ok) return
      const css = await res.text()
      if (epoch !== this.stylesheetEpoch || !target.isConnected) return
      target.textContent = this.prepareCss(css, href)
    } catch {
      /* leave empty — paint without this sheet */
    }
  }

  private applyAttrs(el: Element, attrs: Record<string, string>): void {
    for (const [name, raw] of Object.entries(attrs)) {
      let value = raw
      if (this.appendAssetToken) {
        if (name === 'srcset' || name === 'imagesrcset') {
          value = raw
            .split(',')
            .map((part) => {
              const bits = part.trim().split(/\s+/)
              if (bits[0] && bits[0].startsWith('/w7s/virtual-')) {
                bits[0] = this.appendAssetToken!(bits[0]!)
              }
              return bits.join(' ')
            })
            .join(', ')
        } else if (URL_ATTRIBUTES.has(name) && value.startsWith('/w7s/virtual-')) {
          value = this.appendAssetToken(value)
        } else if (name === 'style') {
          value = rewriteCssUrls(normalizeCssStringUrls(raw), this.appendAssetToken)
        }
      }
      try {
        el.setAttribute(name, value)
      } catch {
        /* invalid attr */
      }
    }
  }

  private applyControlBindings(el: HTMLElement): void {
    const anchor = el.getAttribute('speculum-anchor')
    const upstreamValue = el.getAttribute('speculum-input-value')
    const upstreamChecked = el.getAttribute('speculum-input-checked')
    const upstreamSelected = el.getAttribute('speculum-option-selected')

    if (anchor && this.localDirtyUntil.has(anchor)) {
      const until = this.localDirtyUntil.get(anchor)!
      if (performance.now() < until) {
        this.scheduleControlApply(anchor, {
          value: upstreamValue ?? undefined,
          checked: upstreamChecked ?? undefined,
          selected: upstreamSelected ?? undefined,
        })
        return
      }
      this.localDirtyUntil.delete(anchor)
    }

    this.writeControlState(el, upstreamValue, upstreamChecked, upstreamSelected)
  }

  private scheduleControlApply(
    anchor: string,
    next: { value?: string; checked?: string; selected?: string },
  ): void {
    const existing = this.pendingControls.get(anchor)
    if (existing) clearTimeout(existing.timer)
    const remaining = Math.max(0, (this.localDirtyUntil.get(anchor) ?? 0) - performance.now())
    const timer = setTimeout(() => {
      this.pendingControls.delete(anchor)
      this.localDirtyUntil.delete(anchor)
      const el = findByAnchor(this.host, anchor) as HTMLElement | null
      if (!el) return
      this.writeControlState(el, next.value ?? null, next.checked ?? null, next.selected ?? null)
    }, remaining || CONTROL_DEBOUNCE_MS)
    this.pendingControls.set(anchor, { ...next, timer })
  }

  private writeControlState(
    el: HTMLElement,
    value: string | null | undefined,
    checked: string | null | undefined,
    selected: string | null | undefined,
  ): void {
    if (value != null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      if (el.value !== value) el.value = value
    }
    if (el instanceof HTMLSelectElement && value != null) {
      el.value = value
    }
    if (checked != null && el instanceof HTMLInputElement) {
      const want = checked === 'true' || checked === ''
      if (el.checked !== want) el.checked = want
    }
    if (selected != null && el instanceof HTMLOptionElement) {
      el.selected = selected === 'true' || selected === ''
    }
    if (el.getAttribute('speculum-canvas-placeholder') === 'true' && el instanceof HTMLCanvasElement) {
      const ctx = el.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#e5e5e5'
        ctx.fillRect(0, 0, el.width || 300, el.height || 150)
      }
    }
  }

  private reloadCssom(urls: string[]): void {
    for (const url of urls) {
      if (!url || url === '__inline__') {
        for (const style of this.host.querySelectorAll('style[data-speculum-css-href]')) {
          const href = style.getAttribute('data-speculum-css-href')
          if (!href || !(style instanceof HTMLStyleElement)) continue
          let resolved = href
          if (this.appendAssetToken && resolved.startsWith('/w7s/virtual-')) {
            resolved = this.appendAssetToken(resolved)
          }
          void this.ingestStylesheet(appendCacheBust(resolved, Date.now()), style, this.stylesheetEpoch)
        }
        continue
      }
      const base = url.split('?')[0]!
      for (const style of this.host.querySelectorAll('style[data-speculum-css-href]')) {
        const href = style.getAttribute('data-speculum-css-href') || ''
        if (!href.startsWith(base) || !(style instanceof HTMLStyleElement)) continue
        const resolved = this.appendAssetToken ? this.appendAssetToken(url) : url
        void this.ingestStylesheet(appendCacheBust(resolved, Date.now()), style, this.stylesheetEpoch)
      }
    }
  }
}

/** `@import "x"` and `image-set("x" 1x)` → url("x") so one tokenizer covers all. */
function normalizeCssStringUrls(css: string): string {
  let out = css.replace(
    /@import\s+(['"])([^'"]+)\1/gi,
    (_full, quote: string, raw: string) => `@import url(${quote}${raw}${quote})`,
  )
  out = out.replace(
    /(image-set\(\s*)(['"])([^'"]+)\2/gi,
    (_full, head: string, quote: string, raw: string) => `${head}url(${quote}${raw}${quote})`,
  )
  return out
}

/** Stamp auth on every `/w7s/virtual-*` url() in a stylesheet or style attribute. */
function rewriteCssUrls(css: string, append: DomAssetAuthAppender): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, quote: string, raw: string) => {
    const url = String(raw).trim()
    if (!url.startsWith('/w7s/virtual-')) return full
    return `url(${quote}${append(url)}${quote})`
  })
}

function isStylesheetLink(node: DomNode): boolean {
  const rel = (node.attrs?.rel || '').toLowerCase()
  return rel.split(/\s+/).includes('stylesheet')
}

function findByAnchor(root: ParentNode, anchor: string): Element | null {
  for (const el of root.querySelectorAll('[speculum-anchor]')) {
    if (el.getAttribute('speculum-anchor') === anchor) return el
  }
  return null
}

function isSvgChild(tag: string): boolean {
  return [
    'path',
    'g',
    'circle',
    'rect',
    'line',
    'polyline',
    'polygon',
    'text',
    'tspan',
    'defs',
    'use',
    'symbol',
    'clipPath',
    'mask',
    'linearGradient',
    'radialGradient',
    'stop',
    'image',
  ].includes(tag)
}
