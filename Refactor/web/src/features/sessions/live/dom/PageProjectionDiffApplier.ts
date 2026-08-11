import type {
  CssomRule,
  CssomSheet,
  DomNode,
  DomSelector,
  PageProjectionDiff,
} from '@/lib/speculum'
import {
  absolutizeCssUrls,
  inferRootFontSizePx,
  rewriteHtmlBodySelectors,
  rewriteRemToPx,
  rewriteViewportUnits,
} from './rewriteHtmlBodySelectors'
import { mapSrcset } from './srcsetParse'

/** Stamps the reserved session-auth parameter onto a `/w7s/virtual-*` URL. */
export type DomAssetAuthAppender = (url: string) => string

/**
 * Attributes the sidecar serializer absolutizes and the serve plane rewrites,
 * so every one of them can hold a `/w7s/virtual-*` URL the browser will fetch.
 * Keep in sync with `DomTreeSerializer` — `srcset` and inline `style` are
 * handled separately because they carry more than one URL.
 */
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'xlink:href',
  'poster',
  'data-src',
  'action',
  'formaction',
])

/** docs/page-projection-input.md inputBindingDebounceMs default. */
const CONTROL_DEBOUNCE_MS = 1000

/** Owned CSSOM sheet element marker (`data-speculum-cssom-id="<sheet id>"`). */
const CSSOM_ID_ATTRIBUTE = 'data-speculum-cssom-id'

/** Parses in every engine — keeps rule ids aligned when a rule body is rejected. */
const CSSOM_PLACEHOLDER_RULE = 'speculum-unparsed-rule{}'

type PendingControl = {
  value?: string
  checked?: string
  selected?: string
  timer: ReturnType<typeof setTimeout>
}

/** One Speculum-owned projected stylesheet (`CssomSheet.id` → live handle). */
type OwnedSheet = {
  element: HTMLStyleElement
  sheet: CSSStyleSheet
  /** Rule ids in `sheet.cssRules` order — identity for `ruleList` / `patch`. */
  ruleIds: string[]
  scopeKind: string
  hostAnchor: string | null
}

export type PageProjectionDesyncReason =
  | 'sequence_gap'
  | 'generation_mismatch'
  | 'generation_ahead'
  | 'address_miss'
  | 'unknown_op'
  | 'establish_required'
  | 'install_failed'
  /** Diff uni-stream EOF while session live (fan-out Complete). */
  | 'wire_stall'
  /** Client-visible PageProjectionLifecycle phase=queue_dropped. */
  | 'queue_dropped'

export type PageProjectionDropReason =
  | PageProjectionDesyncReason
  | 'buffered_while_desynced'
  | 'stale_sequence'

/** Where ACID validation failed — required for surgical front observation. */
export type PageProjectionMissPhase =
  | 'parent'
  | 'removed'
  | 'added_materialize'
  | 'childAt'
  | 'payload'
  | 'unknown_op'
  | 'establish'
  | 'install'

export type PageProjectionDesyncInfo = {
  expected: number
  got: number
  reason: PageProjectionDesyncReason
  generation: number
  phase?: PageProjectionMissPhase
  selector?: { kind: string; query: string; index?: number | null }
  /** qSA length at miss; -1 if query threw. */
  matchCount?: number
  operation?: string
  plane?: string
}

/** Wall-clock lag vs sidecar `Date.now()` stamp (epoch ms). */
export function pageProjectionLagMs(
  sidecarTimestamp: number | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (sidecarTimestamp == null || !Number.isFinite(sidecarTimestamp)) return null
  if (sidecarTimestamp < 1e12) return null
  return nowMs - sidecarTimestamp
}

type ResolveDetail = {
  node: Node | null
  matchCount: number
  selector: { kind: string; query: string; index?: number | null } | null
}

/**
 * Applies sealed PageProjection envelopes (Dom + Cssom planes) into a host element.
 *
 * Apply is ACID per docs/page-projection-diff-streams.md: every address in the
 * envelope resolves against the pre-op tree before anything mutates, and any
 * miss (or a sequence gap) desyncs instead of half-applying. While desynced the
 * applier buffers live envelopes until OOB `PageProjection.Resync` (C8/T8).
 */
export class PageProjectionDiffApplier {
  private generation = 0
  private lastSequence = 0
  private desynced = false
  /** Reason for the current desync window — SoftNav address_miss discards mid-wipe buffer. */
  private lastDesyncReason: PageProjectionDesyncReason | null = null
  private pendingRaf: number | null = null
  private queued: PageProjectionDiff[] = []
  /** Live envelopes withheld while desynced — drained after OOB joint resync. */
  private buffered: PageProjectionDiff[] = []
  /** First+count sampling for buffered_while_desynced observation. */
  private bufferedWhileDesyncedCount = 0
  private readonly host: HTMLElement
  private readonly appendAssetToken?: DomAssetAuthAppender
  private readonly onDesync?: (info: PageProjectionDesyncInfo) => void
  private readonly onGeneration?: (generation: number) => void
  private readonly onApplied?: (diff: PageProjectionDiff) => void
  private readonly onDropped?: (reason: PageProjectionDropReason, diff: PageProjectionDiff, extra?: Record<string, unknown>) => void
  /** Anchors currently being edited locally — debounce upstream control attrs. */
  private readonly localDirtyUntil = new Map<string, number>()
  private readonly pendingControls = new Map<string, PendingControl>()
  /**
   * Last Diff-applied scroll position per scroller (Dom-plane echo filter).
   * On a Projected `scroll` event, equal position → eco (do not re-ingest); else clear.
   */
  private viewportScrollEcho: { x: number; y: number } | null = null
  private readonly elementScrollEcho = new Map<string, { top: number; left: number }>()
  /** Receives body children + body attrs; targeted by rewritten `body` selectors. */
  private bodyStandIn: HTMLElement | null = null
  /** Receives head children; keeps F child space of `html` isomorphic (T7/T13). */
  private headStandIn: HTMLElement | null = null
  /** Anchor stamped on the surface for the projected `html` element. */
  private hostAnchor: string | null = null
  private readonly ownedSheets = new Map<string, OwnedSheet>()
  private stylesheetEpoch = 0
  /** Projected root font-size for rem→px (html { font-size: 62.5% } → 10). */
  private rootFontSizePx = 10
  /** Diff under apply — enriches desync observation. */
  private activeDiff: PageProjectionDiff | null = null

  constructor(
    host: HTMLElement,
    appendAssetToken?: DomAssetAuthAppender,
    onDesync?: (info: PageProjectionDesyncInfo) => void,
    onGeneration?: (generation: number) => void,
    onApplied?: (diff: PageProjectionDiff) => void,
    onDropped?: (
      reason: PageProjectionDropReason,
      diff: PageProjectionDiff,
      extra?: Record<string, unknown>,
    ) => void,
  ) {
    this.host = host
    this.appendAssetToken = appendAssetToken
    this.onDesync = onDesync
    this.onGeneration = onGeneration
    this.onApplied = onApplied
    this.onDropped = onDropped
  }

  /** Mark a control as locally edited; keep latest upstream until debounce fires. */
  noteLocalEdit(anchor: string): void {
    if (!anchor) return
    this.localDirtyUntil.set(anchor, performance.now() + CONTROL_DEBOUNCE_MS)
  }

  /**
   * Dom-plane echo filter (Projected mirror of Virtual NoteScrollEcho):
   * if observed absolute position equals the last Diff-applied mark for this
   * scroller → consume mark and return true (suppress intent); otherwise clear
   * any stale mark and return false. No timers.
   */
  consumeScrollEcho(
    target: 'viewport' | string,
    observed: {
      scrollX?: number
      scrollY?: number
      scrollTop?: number
      scrollLeft?: number
    },
  ): boolean {
    if (target === 'viewport') {
      const echo = this.viewportScrollEcho
      if (!echo) return false
      const x = Number(observed.scrollX ?? 0)
      const y = Number(observed.scrollY ?? 0)
      this.viewportScrollEcho = null
      return echo.x === x && echo.y === y
    }
    const echo = this.elementScrollEcho.get(target)
    if (!echo) return false
    const top = Number(observed.scrollTop ?? 0)
    const left = Number(observed.scrollLeft ?? 0)
    this.elementScrollEcho.delete(target)
    return echo.top === top && echo.left === left
  }

  getGeneration(): number {
    return this.generation
  }

  getLastSequence(): number {
    return this.lastSequence
  }

  /** Total owned Cssom rules across every installed sheet (client_surface_probe). */
  getOwnedRuleCount(): number {
    let count = 0
    for (const owned of this.ownedSheets.values()) count += owned.ruleIds.length
    return count
  }

  /** True while the projected tree is not provably contiguous with Virtual. */
  isDesynced(): boolean {
    return this.desynced
  }

  /**
   * Diff pipe cut / queue_dropped lifecycle — force desync so T8 OOB resync runs.
   * Re-notifies even when already desynced so a coalesced resync can still fire.
   */
  noteWireCut(reason: 'wire_stall' | 'queue_dropped'): void {
    if (this.desynced) {
      this.lastDesyncReason = reason
      this.onDesync?.({
        expected: this.lastSequence + 1,
        got: this.lastSequence + 1,
        reason,
        generation: this.generation,
      })
      return
    }
    this.desync(this.lastSequence + 1, reason)
  }

  /**
   * Apply OOB PageProjection.Resync (T8/C8): Dom root + Cssom install + watermark.
   * Does not consume a live sequence number from the pipe.
   */
  applyOobResync(snap: {
    generation: number
    coversThroughSequence: number
    root: DomNode
    sheets: CssomSheet[]
  }): void {
    if (!snap.root || snap.root.tag !== 'html') {
      this.desynced = true
      return
    }
    this.desynced = false
    this.bufferedWhileDesyncedCount = 0
    this.generation = Number(snap.generation ?? 0)
    // Arm only after a successful drain while still synced (D12) — caller must
    // check isDesynced() before re-arming. Do not notify generation here.
    this.mountHtmlTree(snap.root)

    for (const owned of this.ownedSheets.values()) owned.element.remove()
    this.ownedSheets.clear()
    for (const sheet of snap.sheets ?? []) {
      this.installSheet(sheet, null)
    }

    this.lastSequence = Number(snap.coversThroughSequence ?? 0)
    // SoftNav SPA wipes leave buffered childList/patch against orphaned anchors.
    // Replaying that mid-wipe history after the joint snapshot re-desyncs (cascade).
    // Resume only with live sequence > coversThrough; keep qSA===1 on live apply.
    if (this.lastDesyncReason === 'address_miss') {
      this.buffered = []
      this.bufferedWhileDesyncedCount = 0
      this.lastDesyncReason = null
      if (!this.desynced) {
        this.onGeneration?.(this.generation)
      }
      return
    }

    // T8: drop obsolete, apply contiguous newer envelopes; gap → desync → another OOB
    // (no silent sequence jump). Fast OOB + emit pause keep this from cascading.
    this.drainBuffered()
    this.lastDesyncReason = null
    if (!this.desynced) {
      this.onGeneration?.(this.generation)
    }
  }

  /** Queue a diff; applied inside requestAnimationFrame. */
  enqueue(diff: PageProjectionDiff): void {
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
    this.buffered = []
    this.generation = 0
    this.lastSequence = 0
    this.desynced = false
    this.lastDesyncReason = null
    this.clearScrollEchoMarks()
    this.localDirtyUntil.clear()
    for (const p of this.pendingControls.values()) clearTimeout(p.timer)
    this.pendingControls.clear()
    this.ownedSheets.clear()
    this.bodyStandIn = null
    this.headStandIn = null
    this.stylesheetEpoch += 1
    this.rootFontSizePx = 10
    if (this.hostAnchor) this.host.removeAttribute('speculum-anchor')
    this.hostAnchor = null
    this.host.replaceChildren()
  }

  private applyNow(diff: PageProjectionDiff): void {
    const plane = String(diff.plane ?? '')
    const operation = String(diff.operation ?? '')
    const sequence = Number(diff.sequence ?? 0)
    const generation = Number(diff.generation ?? 0)
    const isDomDocument = plane === 'dom' && operation === 'document'
    const isCssomInstall = plane === 'cssom' && operation === 'install'
    // Live `document` / `install` establish a generation epoch while synced.
    // While desynced, recovery is OOB joint Resync only (C8) — never clear via
    // one live plane alone.
    const establishes = isDomDocument || isCssomInstall
    this.activeDiff = diff

    try {
      if (this.desynced) {
        this.buffered.push(diff)
        this.bufferedWhileDesyncedCount += 1
        // First + every 32nd — keep the ring useful without flooding.
        if (this.bufferedWhileDesyncedCount === 1 || this.bufferedWhileDesyncedCount % 32 === 0) {
          this.onDropped?.('buffered_while_desynced', diff, {
            bufferedCount: this.bufferedWhileDesyncedCount,
          })
        }
        return
      }

      if (this.generation > 0 && generation > 0) {
        if (generation < this.generation) {
          // Stale epoch on the wire — observe drop, then recover via OOB resync (T3/T8).
          this.onDropped?.('generation_mismatch', diff)
          this.desync(sequence, 'generation_mismatch')
          this.buffered.push(diff)
          return
        }
        if (generation > this.generation && !establishes) {
          this.desync(sequence, 'generation_ahead')
          this.buffered.push(diff)
          return
        }
      }

      // Late / duplicate sequences (e.g. historical gRPC rewrite-after-drain) — never re-apply.
      if (!establishes && this.lastSequence > 0 && sequence <= this.lastSequence) {
        this.onDropped?.('stale_sequence', diff, {
          lastSequence: this.lastSequence,
        })
        return
      }

      if (!establishes && this.lastSequence > 0 && sequence > this.lastSequence + 1) {
        this.desync(sequence, 'sequence_gap')
        this.buffered.push(diff)
        return
      }

      const applied = plane === 'dom'
        ? this.applyDomOperation(operation, diff, sequence)
        : plane === 'cssom'
          ? this.applyCssomOperation(operation, diff, sequence, generation)
          : false
      if (!applied) return

      this.lastSequence = sequence
      this.onApplied?.(diff)
    } finally {
      this.activeDiff = null
    }
  }

  /** @returns false when the op did not apply (already desynced / unknown op). */
  private applyDomOperation(
    operation: string,
    diff: PageProjectionDiff,
    sequence: number,
  ): boolean {
    switch (operation) {
      case 'document':
        return this.applyDocument(diff, sequence)
      case 'childList':
        return this.applyChildList(diff, sequence)
      case 'patch':
        return this.applyPatch(diff, sequence)
      case 'scrollViewport':
        return this.applyScrollViewport(diff, sequence)
      case 'scrollElement':
        return this.applyScrollElement(diff, sequence)
      default:
        this.desync(sequence, 'unknown_op', { phase: 'unknown_op' })
        return false
    }
  }

  private applyCssomOperation(
    operation: string,
    diff: PageProjectionDiff,
    sequence: number,
    generation: number,
  ): boolean {
    switch (operation) {
      case 'install':
        return this.applyCssomInstall(diff, sequence, generation)
      case 'sheetList':
        return this.applyCssomSheetList(diff, sequence)
      case 'ruleList':
        return this.applyCssomRuleList(diff, sequence)
      case 'patch':
        return this.applyCssomPatch(diff, sequence)
      default:
        this.desync(sequence, 'unknown_op', { phase: 'unknown_op' })
        return false
    }
  }

  /** Desync: stop applying, buffer inbound, ask the owner for an OOB resync. */
  private desync(
    sequence: number,
    reason: PageProjectionDesyncReason = 'address_miss',
    detail?: {
      phase?: PageProjectionMissPhase
      selector?: { kind: string; query: string; index?: number | null } | null
      matchCount?: number
    },
  ): void {
    this.desynced = true
    this.lastDesyncReason = reason
    const diff = this.activeDiff
    this.onDesync?.({
      expected: this.lastSequence + 1,
      got: sequence,
      reason,
      generation: this.generation,
      phase: detail?.phase,
      selector: detail?.selector
        ? {
            kind: detail.selector.kind,
            query: detail.selector.query,
            index: detail.selector.index ?? null,
          }
        : undefined,
      matchCount: detail?.matchCount,
      operation: diff?.operation != null ? String(diff.operation) : undefined,
      plane: diff?.plane != null ? String(diff.plane) : undefined,
    })
  }

  private drainBuffered(): void {
    const pending = this.buffered
    this.buffered = []
    for (const item of pending) {
      if (Number(item.generation ?? 0) < this.generation) continue
      if (Number(item.sequence ?? 0) <= this.lastSequence) continue
      this.applyNow(item)
    }
  }

  private applyDocument(diff: PageProjectionDiff, sequence: number): boolean {
    const root = diff.document?.root
    if (!root || root.tag !== 'html') {
      this.desync(sequence, 'address_miss', { phase: 'establish' })
      return false
    }

    // Stream establish may send html/head/body shells with empty children; later
    // childList ops fill the stand-ins (prefix-true load).
    this.generation = Number(diff.generation ?? 0)
    this.onGeneration?.(this.generation)
    this.mountHtmlTree(root)
    return true
  }

  private applyChildList(diff: PageProjectionDiff, sequence: number): boolean {
    const payload = diff.childList
    if (!payload) {
      this.desync(sequence, 'address_miss', { phase: 'payload' })
      return false
    }

    // Validate phase — every address resolves against the same pre-op tree.
    const parentHit = this.resolveSelectorDetailed(payload.selector)
    if (!(parentHit.node instanceof Element)) {
      this.desync(sequence, 'address_miss', {
        phase: parentHit.selector?.kind === 'childAt' ? 'childAt' : 'parent',
        selector: parentHit.selector,
        matchCount: parentHit.matchCount,
      })
      return false
    }
    const parent = parentHit.node
    const fKids = fVisibleChildren(parent)
    const removed: Node[] = []
    for (const entry of payload.removed ?? []) {
      const hit = this.resolveSelectorDetailed(entry.selector)
      // F-parent membership (light + shadow flatten) — not strict parentNode===host.
      if (!hit.node || !fKids.includes(hit.node)) {
        this.desync(sequence, 'address_miss', {
          phase: hit.selector?.kind === 'childAt' && hit.matchCount === 1 ? 'childAt' : 'removed',
          selector: hit.selector,
          matchCount: hit.matchCount,
        })
        return false
      }
      removed.push(hit.node)
    }
    const added = [...(payload.added ?? [])].sort((a, b) => Number(a.index) - Number(b.index))
    const materialized: Array<{ index: number; node: Node }> = []
    for (const entry of added) {
      const node = this.materialize(entry.node)
      if (!node) {
        this.desync(sequence, 'address_miss', { phase: 'added_materialize' })
        return false
      }
      materialized.push({ index: Number(entry.index), node })
    }

    for (const node of removed) {
      node.parentNode?.removeChild(node)
    }
    for (const entry of materialized) {
      const slot = fInsertSlot(parent, entry.index)
      slot.owner.insertBefore(entry.node, slot.before)
    }
    return true
  }

  private applyPatch(diff: PageProjectionDiff, sequence: number): boolean {
    const payload = diff.patch
    if (!payload) {
      this.desync(sequence, 'address_miss', { phase: 'payload' })
      return false
    }
    const hit = this.resolveSelectorDetailed(payload.selector)
    if (!hit.node) {
      this.desync(sequence, 'address_miss', {
        phase: hit.selector?.kind === 'childAt' && hit.matchCount === 1 ? 'childAt' : 'parent',
        selector: hit.selector,
        matchCount: hit.matchCount,
      })
      return false
    }
    const target = hit.node

    // characterData locus — text or comment (T9); snapshot is the whole run/node.
    if (target.nodeType === Node.TEXT_NODE || target.nodeType === Node.COMMENT_NODE) {
      target.textContent = payload.node.text ?? ''
      return true
    }
    if (!(target instanceof Element)) {
      this.desync(sequence, 'address_miss', {
        phase: 'parent',
        selector: hit.selector,
        matchCount: hit.matchCount,
      })
      return false
    }

    // Patch never carries children — attrs / form state only, in place.
    const attrs = { ...(payload.node.attrs ?? {}) }
    if (payload.node.anchor && !attrs['speculum-anchor']) {
      attrs['speculum-anchor'] = payload.node.anchor
    }
    for (const name of target.getAttributeNames()) {
      if (isOwnedAttribute(name) || name in attrs) continue
      target.removeAttribute(name)
    }
    this.applyAttrs(target, attrs)
    if (target instanceof HTMLElement) this.applyControlBindings(target)
    return true
  }

  private applyScrollViewport(diff: PageProjectionDiff, sequence: number): boolean {
    const payload = diff.scrollViewport
    if (!payload) {
      this.desync(sequence, 'address_miss', { phase: 'payload' })
      return false
    }
    const left = Number(payload.scrollX ?? 0)
    const top = Number(payload.scrollY ?? 0)
    // Note before mutate (same contract as Virtual __speculumDomNoteScrollEcho).
    this.viewportScrollEcho = { x: left, y: top }
    if (typeof this.host.scrollTo === 'function') {
      this.host.scrollTo(left, top)
      return true
    }
    this.host.scrollLeft = left
    this.host.scrollTop = top
    return true
  }

  private applyScrollElement(diff: PageProjectionDiff, sequence: number): boolean {
    const payload = diff.scrollElement
    if (!payload) {
      this.desync(sequence, 'address_miss', { phase: 'payload' })
      return false
    }
    const hit = this.resolveSelectorDetailed(payload.selector)
    if (!(hit.node instanceof Element)) {
      this.desync(sequence, 'address_miss', {
        phase: hit.selector?.kind === 'childAt' && hit.matchCount === 1 ? 'childAt' : 'parent',
        selector: hit.selector,
        matchCount: hit.matchCount,
      })
      return false
    }
    const top = Number(payload.scrollTop ?? 0)
    const left = Number(payload.scrollLeft ?? 0)
    const anchor = hit.node.getAttribute('speculum-anchor')
    if (anchor) this.elementScrollEcho.set(anchor, { top, left })
    hit.node.scrollTop = top
    hit.node.scrollLeft = left
    return true
  }

  private clearScrollEchoMarks(): void {
    this.viewportScrollEcho = null
    this.elementScrollEcho.clear()
  }

  /**
   * Resolve a wire address on the projected tree: `querySelectorAll(query)` must
   * yield exactly one element (the surface itself counts — it stands in for
   * `html`), then `childAt` steps into the F-visible child space.
   */
  private resolveSelectorDetailed(selector: DomSelector | null | undefined): ResolveDetail {
    if (!selector) {
      return { node: null, matchCount: 0, selector: null }
    }
    const kind = typeof selector.kind === 'string' ? selector.kind : ''
    // T7: exclusive variants — unknown kind rejects (desync upstream).
    if (kind !== 'element' && kind !== 'childAt') {
      return {
        node: null,
        matchCount: 0,
        selector: { kind: kind || '?', query: String(selector.query ?? ''), index: selector.index ?? null },
      }
    }
    let query = typeof selector.query === 'string' ? selector.query.trim() : ''
    if (!query) {
      return { node: null, matchCount: 0, selector: { kind, query: '', index: selector.index ?? null } }
    }
    query = this.rewriteStandInRootQuery(query)
    const wireSel = {
      kind,
      query,
      index: selector.index ?? null,
    }

    let matches: Element[]
    try {
      matches = Array.from(this.host.querySelectorAll(query))
      if (this.host.matches(query)) matches.unshift(this.host)
    } catch {
      return { node: null, matchCount: -1, selector: wireSel }
    }
    if (matches.length !== 1) {
      return { node: null, matchCount: matches.length, selector: wireSel }
    }

    const element = matches[0]!
    if (kind === 'element') {
      if (selector.index != null) {
        return { node: null, matchCount: 1, selector: wireSel }
      }
      return { node: element, matchCount: 1, selector: wireSel }
    }
    const index = Number(selector.index ?? -1)
    if (!Number.isInteger(index) || index < 0) {
      return { node: null, matchCount: 1, selector: wireSel }
    }
    const child = fVisibleChildren(element)[index] ?? null
    return { node: child, matchCount: 1, selector: wireSel }
  }

  /**
   * Legacy writer paths may emit `html`/`body`/`head` tag roots; projected tree
   * uses stand-ins. Map those roots onto Speculum anchors when possible.
   */
  private rewriteStandInRootQuery(query: string): string {
    const mapRoot = (tag: string, anchor: string | null | undefined): string | null => {
      if (!anchor) return null
      const a = `[speculum-anchor="${cssEscapeAttr(anchor)}"]`
      if (query === tag) return a
      if (query.startsWith(`${tag} > `)) return a + query.slice(tag.length)
      if (query.startsWith(`${tag}>`)) return a + query.slice(tag.length)
      return null
    }
    return (
      mapRoot('html', this.hostAnchor)
      ?? mapRoot('body', this.bodyStandIn?.getAttribute('speculum-anchor'))
      ?? mapRoot('head', this.headStandIn?.getAttribute('speculum-anchor'))
      ?? query
    )
  }

  private clearHost(): void {
    this.stylesheetEpoch += 1
    this.ownedSheets.clear()
    this.clearScrollEchoMarks()
    this.host.replaceChildren()
    this.bodyStandIn = null
    this.headStandIn = null
    if (this.hostAnchor) this.host.removeAttribute('speculum-anchor')
    this.hostAnchor = null
  }

  private ensureHeadStandIn(): HTMLElement {
    if (this.headStandIn?.isConnected) return this.headStandIn
    this.ensureStandInBaseStyle()
    const el = document.createElement('div')
    el.setAttribute('data-speculum-dom-head', '')
    // Keep F slot under html; hide so it does not affect layout.
    el.setAttribute('hidden', '')
    this.host.appendChild(el)
    this.headStandIn = el
    return el
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
    // Margin/padding reset: surface is a transform BFC (no margin-collapse with
    // the real document). Author CSSOM still overrides later. Head must never
    // take layout space in F.
    //
    // T13 empty non-iframe placeholders are host `div`s; Virtual UA does not
    // paint script/noscript/template/base/object/embed/applet — keep hosts
    // non-painting so author CSS (e.g. `.noJs{display:flex}`) cannot invent a
    // box. iframe stays layout-capable for pierce children.
    const emptyPlaceholderTags = [
      'script',
      'noscript',
      'template',
      'base',
      'object',
      'embed',
      'applet',
    ]
      // Host is always `div` after T13 rewrite — tag+attr beats author `.noJs{display:flex}`.
      .map((t) => `div[speculum-projected-tag="${t}"]`)
      .join(',')
    return [
      `[data-speculum-dom-surface]{display:block;box-sizing:border-box;container-type:size;margin:0;padding:0;font-size:${this.rootFontSizePx}px;}`,
      '[data-speculum-dom-head]{display:none!important;}',
      '[data-speculum-dom-body]{display:block;box-sizing:border-box;margin:0;padding:0;min-height:100%;width:100%;}',
      `${emptyPlaceholderTags}{display:none!important;}`,
    ].join('')
  }

  private syncStandInBaseStyle(): void {
    const base = this.host.querySelector('style[data-speculum-standin-base]')
    if (base) base.textContent = this.standInBaseCss()
  }

  private mountHtmlTree(html: DomNode): void {
    this.clearHost()
    this.rootFontSizePx = 10

    const htmlAnchor = html.anchor ?? html.attrs?.['speculum-anchor']
    if (htmlAnchor) {
      this.host.setAttribute('speculum-anchor', htmlAnchor)
      this.hostAnchor = htmlAnchor
    }

    const head = html.children?.find((c) => c.tag === 'head')
    const body = html.children?.find((c) => c.tag === 'body')
    if (head) {
      this.mountHeadChildren(head)
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

  private mountHeadChildren(head: DomNode): void {
    const standIn = this.ensureHeadStandIn()
    this.applyHeadStandInAttrs(standIn, head)
    standIn.replaceChildren()
    for (const child of head.children ?? []) {
      const n = this.materialize(child)
      if (n) standIn.appendChild(n)
    }
  }

  private applyHeadStandInAttrs(standIn: HTMLElement, head: DomNode): void {
    const attrs = head.attrs ?? {}
    const keepAnchor = standIn.getAttribute('speculum-anchor')
    for (const name of [...standIn.getAttributeNames()]) {
      if (name === 'data-speculum-dom-head' || name === 'hidden') continue
      standIn.removeAttribute(name)
    }
    standIn.setAttribute('data-speculum-dom-head', '')
    standIn.setAttribute('hidden', '')
    const anchor = head.anchor ?? attrs['speculum-anchor'] ?? keepAnchor
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

  private mountBodyChildren(body: DomNode): void {
    const standIn = this.ensureBodyStandIn()
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

  private materialize(node: DomNode): Node | null {
    if (node.text != null && !node.tag) {
      return document.createTextNode(node.text)
    }
    if (!node.tag) return null

    if (node.tag === '#text' || node.tag === 'text') {
      return document.createTextNode(node.text ?? '')
    }
    if (node.tag === '#comment' || node.tag === 'comment') {
      return document.createComment(node.text ?? '')
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
    // Dom `<style>` is a structural shell only (C5/C6) — rule paint is Cssom-owned.
    this.ensureStandInBaseStyle()
    const el = document.createElement('style')
    const attrs = { ...(node.attrs ?? {}) }
    if (node.anchor && !attrs['speculum-anchor']) {
      attrs['speculum-anchor'] = node.anchor
    }
    this.applyAttrs(el, attrs)
    el.textContent = ''
    return el
  }

  private materializeStylesheetLink(node: DomNode): HTMLElement {
    // Dom `<link rel=stylesheet>` is a structural slot only (C6/C9). Live CSS
    // rides the owned Cssom plane — never URL-reload as a live update channel.
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
    if (hrefRaw) placeholder.setAttribute('data-speculum-css-href', hrefRaw)
    placeholder.setAttribute('data-speculum-css-slot', 'link')
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

  private applyAttrs(el: Element, attrs: Record<string, string>): void {
    for (const [name, raw] of Object.entries(attrs)) {
      let value = raw
      // Inline style uses the same rem/vh pipeline as prepareCss (parity with sheets).
      if (name === 'style') {
        value = rewriteRemToPx(raw, this.rootFontSizePx)
        value = rewriteViewportUnits(value)
        if (this.appendAssetToken) {
          value = rewriteCssUrls(normalizeCssStringUrls(value), this.appendAssetToken)
        }
      } else if (this.appendAssetToken) {
        if (name === 'srcset' || name === 'imagesrcset') {
          value = mapSrcset(raw, (u) =>
            u.startsWith('/w7s/virtual-') ? this.appendAssetToken!(u) : u,
          )
        } else if (
          URL_ATTRIBUTES.has(name)
          && (value.startsWith('/w7s/virtual-') || value.includes('/virtual-'))
        ) {
          value = this.appendAssetToken(value)
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

  private applyCssomInstall(
    diff: PageProjectionDiff,
    sequence: number,
    generation: number,
  ): boolean {
    const payload = diff.install
    if (!payload) {
      this.desync(sequence, 'install_failed', { phase: 'install' })
      return false
    }
    if (generation > this.generation) {
      this.generation = generation
      this.onGeneration?.(this.generation)
    }

    for (const owned of this.ownedSheets.values()) owned.element.remove()
    this.ownedSheets.clear()

    for (const sheet of payload.sheets ?? []) {
      if (!this.installSheet(sheet, null)) {
        this.desync(sequence, 'install_failed', { phase: 'install' })
        return false
      }
    }
    return true
  }

  private applyCssomSheetList(diff: PageProjectionDiff, sequence: number): boolean {
    const payload = diff.sheetList
    if (!payload) {
      this.desync(sequence, 'address_miss', { phase: 'payload' })
      return false
    }

    const removed: Array<[string, OwnedSheet]> = []
    for (const entry of payload.removed ?? []) {
      const id = String(entry.selector?.id ?? '')
      const owned = this.ownedSheets.get(id)
      if (!owned) {
        this.desync(sequence, 'address_miss', {
          phase: 'removed',
          selector: { kind: 'sheet', query: id },
          matchCount: 0,
        })
        return false
      }
      removed.push([id, owned])
    }

    for (const [id, owned] of removed) {
      this.ownedSheets.delete(id)
      owned.element.remove()
    }
    const added = [...(payload.added ?? [])].sort((a, b) => Number(a.index) - Number(b.index))
    for (const entry of added) {
      if (!this.installSheet(entry.sheet, Number(entry.index))) {
        this.desync(sequence, 'install_failed', { phase: 'install' })
        return false
      }
    }
    return true
  }

  private applyCssomRuleList(diff: PageProjectionDiff, sequence: number): boolean {
    const payload = diff.ruleList
    if (!payload) {
      this.desync(sequence, 'address_miss', { phase: 'payload' })
      return false
    }
    const owned = this.ownedSheets.get(String(payload.selector?.id ?? ''))
    if (!owned) {
      this.desync(sequence, 'address_miss', {
        phase: 'parent',
        selector: { kind: 'sheet', query: String(payload.selector?.id ?? '') },
        matchCount: 0,
      })
      return false
    }

    const removedIndexes: number[] = []
    for (const entry of payload.removed ?? []) {
      const index = owned.ruleIds.indexOf(String(entry.selector?.id ?? ''))
      if (index < 0) {
        this.desync(sequence, 'address_miss', {
          phase: 'removed',
          selector: { kind: 'rule', query: String(entry.selector?.id ?? '') },
          matchCount: 0,
        })
        return false
      }
      removedIndexes.push(index)
    }

    for (const index of [...removedIndexes].sort((a, b) => b - a)) {
      owned.sheet.deleteRule(index)
      owned.ruleIds.splice(index, 1)
    }
    const added = [...(payload.added ?? [])].sort((a, b) => Number(a.index) - Number(b.index))
    for (const entry of added) {
      this.insertOwnedRule(owned, entry.rule, Number(entry.index))
    }
    return true
  }

  /**
   * C3.1: patch updates the existing projected rule in place — never
   * deleteRule+insertRule of the same locus.
   */
  private applyCssomPatch(diff: PageProjectionDiff, sequence: number): boolean {
    const payload = diff.cssomPatch
    if (!payload) {
      this.desync(sequence, 'address_miss', { phase: 'payload' })
      return false
    }
    const ruleId = String(payload.selector?.id ?? '')
    const target = this.findOwnedRule(ruleId)
    if (!target) {
      this.desync(sequence, 'address_miss', {
        phase: 'parent',
        selector: { kind: 'rule', query: ruleId },
        matchCount: 0,
      })
      return false
    }
    const authorCss = payload.rule?.cssText ?? ''
    // Nested style rules under pierce `@scope` already inherit scope — patch
    // the author body in place (C3.1). Outer wrapper fallback uses scoped text.
    const live = this.liveStyleRule(target.owned, target.index)
    if (live instanceof CSSStyleRule) {
      const match = /^(.*?)\s*\{([\s\S]*)\}\s*$/.exec(authorCss.trim())
      try {
        if (match) {
          const selectorText = match[1]!.trim()
          const body = match[2] ?? ''
          if (selectorText) live.selectorText = selectorText
          live.style.cssText = body
          return true
        }
        live.style.cssText = authorCss
        return true
      } catch {
        this.desync(sequence, 'install_failed', { phase: 'install' })
        return false
      }
    }
    const outer = target.owned.sheet.cssRules[target.index]
    if (!outer) {
      this.desync(sequence, 'address_miss', {
        phase: 'childAt',
        selector: { kind: 'rule', query: ruleId },
        matchCount: 0,
      })
      return false
    }
    try {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(outer), 'cssText')
      if (desc?.set) {
        desc.set.call(outer, this.prepareCss(this.scopeOwnedCss(target.owned, authorCss), null))
        return true
      }
    } catch {
      /* fall through */
    }
    this.desync(sequence, 'install_failed', { phase: 'install' })
    return false
  }

  /** Pierce mid-epoch ops must keep `@scope` wrapping (C7). */
  private scopeOwnedCss(owned: OwnedSheet, cssText: string): string {
    if (owned.scopeKind === 'pierceHost' && owned.hostAnchor) {
      return scopeCssText(cssText, owned.hostAnchor)
    }
    return cssText
  }

  /** Prefer the nested style rule when the owned entry is an `@scope` wrapper. */
  private liveStyleRule(owned: OwnedSheet, index: number): CSSRule | null {
    const outer = owned.sheet.cssRules[index]
    if (!outer) return null
    if (outer instanceof CSSStyleRule) return outer
    const group = outer as CSSGroupingRule
    if (typeof group.cssRules !== 'undefined' && group.cssRules.length > 0) {
      const inner = group.cssRules[0]
      if (inner) return inner
    }
    return outer
  }

  private findOwnedRule(ruleId: string): { owned: OwnedSheet; index: number } | null {
    if (!ruleId) return null
    for (const owned of this.ownedSheets.values()) {
      const index = owned.ruleIds.indexOf(ruleId)
      if (index >= 0) return { owned, index }
    }
    return null
  }

  /** @param index position among owned sheet elements, or null to append. */
  private installSheet(sheet: CssomSheet | undefined, index: number | null): boolean {
    const id = String(sheet?.id ?? '')
    if (!sheet || !id) return false

    const scopeKind = String(sheet.scope?.kind ?? 'main')
    const hostAnchor = sheet.scope?.hostAnchor ? String(sheet.scope.hostAnchor) : null
    if (scopeKind === 'pierceHost' && !hostAnchor) return false

    const element = document.createElement('style')
    element.setAttribute(CSSOM_ID_ATTRIBUTE, id)
    if (scopeKind === 'pierceHost' && hostAnchor) {
      element.setAttribute('data-speculum-cssom-scope', hostAnchor)
    }
    const siblings = Array.from(this.host.querySelectorAll(`style[${CSSOM_ID_ATTRIBUTE}]`))
    const before = index == null ? null : (siblings[index] ?? null)
    this.host.insertBefore(element, before)

    const rules = sheet.rules ?? []
    // C6.5 CORS/asset seed: one opaque author blob — insertRule cannot accept it.
    const seedRule =
      rules.length === 1 && String(rules[0]?.id ?? '').startsWith('seed:')
        ? rules[0]
        : null

    if (seedRule) {
      const owned: OwnedSheet = {
        element,
        sheet: element.sheet as CSSStyleSheet,
        ruleIds: [],
        scopeKind,
        hostAnchor,
      }
      const scoped = this.scopeOwnedCss(owned, seedRule.cssText ?? '')
      element.textContent = this.prepareCss(scoped, null)
      owned.sheet = element.sheet as CSSStyleSheet
      owned.ruleIds = [String(seedRule.id)]
      this.ownedSheets.set(id, owned)
      return !!element.sheet
    }

    let live = element.sheet
    if (!live) {
      // Rare: style not yet attached to a document stylesheet list — retry once.
      element.remove()
      this.host.appendChild(element)
      live = element.sheet
      if (!live) {
        element.remove()
        return false
      }
    }
    const owned: OwnedSheet = {
      element,
      sheet: live,
      ruleIds: [],
      scopeKind,
      hostAnchor,
    }
    this.ownedSheets.set(id, owned)
    for (const [position, rule] of rules.entries()) {
      this.insertOwnedRule(owned, rule, position)
    }
    return true
  }

  private insertOwnedRule(owned: OwnedSheet, rule: CssomRule | undefined, index: number): void {
    const id = String(rule?.id ?? '')
    if (!id) return
    const at = Math.min(Math.max(index, 0), owned.ruleIds.length)
    const raw = rule?.cssText ?? ''
    const scoped = this.scopeOwnedCss(owned, raw)
    const cssText = this.prepareCss(scoped, null)
    try {
      owned.sheet.insertRule(cssText, at)
    } catch {
      // A rejected body must not shift the id ↔ index mapping of its siblings.
      owned.sheet.insertRule(CSSOM_PLACEHOLDER_RULE, at)
    }
    owned.ruleIds.splice(at, 0, id)
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

/**
 * F-visible child nodes: light children then open/closed shadow children (writer
 * `fChildEntries` order). Speculum-owned stand-in scaffolding is not part of it.
 * Adjacent text collapses into the first text node for index space (T7).
 */
function fVisibleChildren(parent: Node): Node[] {
  const out: Node[] = []
  let pendingText: Text | null = null
  const flushText = () => {
    if (pendingText) {
      out.push(pendingText)
      pendingText = null
    }
  }
  const pushList = (owner: ParentNode) => {
    for (const child of Array.from(owner.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!pendingText) pendingText = child as Text
        // Collapse adjacent text into the first node for index space (T7); do not
        // call normalize() on the live tree.
        continue
      }
      flushText()
      if (child.nodeType === Node.COMMENT_NODE) {
        out.push(child)
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as Element
      if (el.hasAttribute('data-speculum-standin-base') || el.hasAttribute(CSSOM_ID_ATTRIBUTE)) {
        continue
      }
      out.push(child)
    }
  }
  if (parent instanceof Element || parent instanceof DocumentFragment || parent instanceof Document) {
    pushList(parent)
  } else if (parent.childNodes) {
    pushList(parent as ParentNode)
  }
  // Writer starts a fresh text run at the shadow boundary (separate pushList).
  flushText()
  if (parent instanceof Element) {
    try {
      const shadow = parent.shadowRoot
      if (shadow) pushList(shadow)
    } catch {
      /* closed / opaque */
    }
  }
  flushText()
  return out
}

/** Light-only F slice — used to decide whether an insert index lands in shadow. */
function fLightVisibleCount(parent: Element): number {
  const out: Node[] = []
  let pendingText: Text | null = null
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!pendingText) {
        pendingText = child as Text
        out.push(child)
      }
      continue
    }
    pendingText = null
    if (child.nodeType === Node.COMMENT_NODE) {
      out.push(child)
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as Element
    if (el.hasAttribute('data-speculum-standin-base') || el.hasAttribute(CSSOM_ID_ATTRIBUTE)) continue
    out.push(child)
  }
  return out.length
}

/**
 * Insert locus for an F index on \`host\`: light children first, then shadow
 * (same order as writer \`fChildEntries\`).
 */
function fInsertSlot(host: Element, index: number): { owner: ParentNode; before: Node | null } {
  const siblings = fVisibleChildren(host)
  const before = siblings[index] ?? null
  if (before) {
    const owner = before.parentNode
    if (owner) return { owner, before }
  }
  const lightCount = fLightVisibleCount(host)
  if (host.shadowRoot && index >= lightCount) {
    return { owner: host.shadowRoot, before: null }
  }
  return { owner: host, before: null }
}

/** Wrap pierce-scoped author CSS so rules only match under the host subtree (C7). */
function scopeCssText(cssText: string, hostAnchor: string): string {
  const trimmed = cssText.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('@scope')) return trimmed
  const escaped = hostAnchor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `@scope ([speculum-anchor="${escaped}"]) { ${trimmed} }`
}

/** Stand-in scaffolding attrs a `patch` snapshot must never strip. */
function isOwnedAttribute(name: string): boolean {
  return name === 'data-speculum-dom-body'
    || name === 'data-speculum-dom-head'
    || name === 'data-speculum-dom-surface'
    || name === 'data-speculum-css-href'
    || name === CSSOM_ID_ATTRIBUTE
}

function cssEscapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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
