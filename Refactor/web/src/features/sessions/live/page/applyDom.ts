/**
 * Dom-plane apply — docs/page-projection-engine-redesign.md §5.4, §5.9.1.
 *
 * ACID: every address referenced by the frame's Dom ops is resolved against
 * the registry *before* anything mutates; a single miss desyncs the whole
 * frame rather than half-applying it (§5.4.3). `childList` FULL is declarative:
 * existing nodes are moved (never destroyed and recreated), preserving media
 * playback, focus and scroll offset inside the moved subtree (§5.4.2).
 *
 * No layout reads (`getBoundingClientRect`, `offsetTop`, computed style) occur
 * anywhere on this path.
 */
import type { AssembledFrame, DecodedNode, DecodedOp, DocumentStateOp, PatchSnapshot } from './decode'
import type { PageProjectionRegistry } from './registry'
import { reconcileControlValue } from './interaction'

export type DomDesyncReason = 'address_miss'
export interface DomDesyncInfo { reason: DomDesyncReason; op: DecodedOp['op']; id: number }
export interface DomFrameApplierOptions {
  onDesync?: (info: DomDesyncInfo) => void
  onApplied?: (frame: AssembledFrame) => void
  /** E9 overrun — one rAF batch exceeded `applyBudgetMs` (default 4, §5.16). */
  onOverrun?: (durationMs: number) => void
  applyBudgetMs?: number
  /**
   * Cssom-plane ops carried by the same frame — invoked in the same rAF batch
   * as the Dom apply so style and structure never paint one frame apart.
   * Skipped when the frame's Dom ops fail to resolve (whole-frame ACID).
   */
  onCssomOps?: (ops: DecodedOp[]) => void
}

type ResolvedChild = { kind: 'existing'; node: Node } | { kind: 'fresh'; node: DecodedNode }
type ResolvedOp =
  | { op: 'childList'; parent: Element; mode: 'full' | 'append'; children: ResolvedChild[] }
  | { op: 'patch'; target: Node; snapshot: PatchSnapshot }
  | { op: 'scrollViewport'; scrollX: number; scrollY: number }
  | { op: 'scrollElement'; target: Element; scrollTop: number; scrollLeft: number }

const DOM_OP_NAMES = new Set(['childList', 'patch', 'scrollViewport', 'scrollElement'])
const CSSOM_OP_NAMES = new Set(['cssomInstall', 'cssomSheetList', 'cssomRuleList', 'cssomPatch'])

/**
 * Queues assembled frames and applies them inside `requestAnimationFrame`,
 * every pending frame in one callback, in `sequence` order (§5.9.1).
 */
export class DomFrameApplier {
  private queued: AssembledFrame[] = []
  private raf: number | null = null
  private readonly doc: Document
  private readonly registry: PageProjectionRegistry
  private readonly options: DomFrameApplierOptions

  constructor(doc: Document, registry: PageProjectionRegistry, options: DomFrameApplierOptions = {}) {
    this.doc = doc
    this.registry = registry
    this.options = options
  }

  enqueue(frame: AssembledFrame): void {
    this.queued.push(frame)
    if (this.raf != null) return
    this.raf = requestAnimationFrame(() => {
      this.raf = null
      this.flush()
    })
  }

  /** Applies every queued frame now (tests / forced sync); measured as one batch. */
  flush(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
    const batch = this.queued.sort((a, b) => a.sequence - b.sequence)
    this.queued = []
    if (batch.length === 0) return
    const start = performance.now()
    for (const frame of batch) this.applyFrame(frame)
    const duration = performance.now() - start
    const budget = this.options.applyBudgetMs ?? 4
    if (duration > budget) this.options.onOverrun?.(duration)
  }

  reset(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
    this.queued = []
  }

  private applyFrame(frame: AssembledFrame): void {
    const domOps = frame.ops.filter((op) => DOM_OP_NAMES.has(op.op))
    if (domOps.length > 0) {
      const resolved = resolveDomOps(domOps, this.registry)
      if (!resolved.ok) {
        this.options.onDesync?.({ reason: 'address_miss', op: resolved.op, id: resolved.id })
        return
      }
      applyResolvedOps(this.doc, this.registry, resolved.ops)
    }
    const cssomOps = frame.ops.filter((op) => CSSOM_OP_NAMES.has(op.op))
    if (cssomOps.length > 0) this.options.onCssomOps?.(cssomOps)
    const documentStateOp = frame.ops.find((op): op is DocumentStateOp => op.op === 'documentState')
    if (documentStateOp) applyDocumentState(this.doc, documentStateOp)
    this.options.onApplied?.(frame)
  }
}

/** Phase 1 — resolve every address; mutates nothing (§5.4.3 ACID). */
function resolveDomOps(
  ops: DecodedOp[],
  registry: PageProjectionRegistry,
): { ok: true; ops: ResolvedOp[] } | { ok: false; op: DecodedOp['op']; id: number } {
  const resolved: ResolvedOp[] = []
  for (const op of ops) {
    if (op.op === 'childList') {
      const parent = registry.get(op.parent)
      if (!(parent instanceof Element)) return { ok: false, op: op.op, id: op.parent }
      const children: ResolvedChild[] = []
      for (const ref of op.children) {
        if (ref.kind === 'fresh') {
          children.push({ kind: 'fresh', node: ref.node })
          continue
        }
        const node = registry.get(ref.id)
        if (!node) return { ok: false, op: op.op, id: ref.id }
        children.push({ kind: 'existing', node })
      }
      resolved.push({ op: 'childList', parent, mode: op.mode, children })
    } else if (op.op === 'patch') {
      const target = registry.get(op.node)
      if (!target) return { ok: false, op: op.op, id: op.node }
      resolved.push({ op: 'patch', target, snapshot: op.snapshot })
    } else if (op.op === 'scrollViewport') {
      resolved.push({ op: 'scrollViewport', scrollX: op.scrollX, scrollY: op.scrollY })
    } else if (op.op === 'scrollElement') {
      const target = registry.get(op.node)
      if (!(target instanceof Element)) return { ok: false, op: op.op, id: op.node }
      resolved.push({ op: 'scrollElement', target, scrollTop: op.scrollTop, scrollLeft: op.scrollLeft })
    }
  }
  return { ok: true, ops: resolved }
}

/** Phase 2 — mutate using the node references resolved in phase 1 only. */
function applyResolvedOps(doc: Document, registry: PageProjectionRegistry, ops: ResolvedOp[]): void {
  for (const op of ops) {
    if (op.op === 'childList') {
      applyChildList(doc, registry, op)
    } else if (op.op === 'patch') {
      applyPatch(op.target, op.snapshot)
    } else if (op.op === 'scrollViewport') {
      doc.defaultView?.scrollTo(op.scrollX, op.scrollY)
    } else {
      const el = op.target as HTMLElement
      el.scrollTop = op.scrollTop
      el.scrollLeft = op.scrollLeft
    }
  }
}

function applyChildList(
  doc: Document,
  registry: PageProjectionRegistry,
  op: { parent: Element; mode: 'full' | 'append'; children: ResolvedChild[] },
): void {
  const wanted = op.children.map((c) => (c.kind === 'existing' ? c.node : materialize(doc, registry, c.node)))

  if (op.mode === 'append') {
    for (const node of wanted) op.parent.appendChild(node)
    return
  }

  const wantedSet = new Set(wanted)
  for (const child of Array.from(op.parent.childNodes)) {
    if (wantedSet.has(child)) continue
    registry.unregisterSubtree(child)
    child.parentNode?.removeChild(child)
  }

  // Single forward pass: a real DOM move (never destroy+recreate) preserves
  // media playback, focus and scroll offset inside the moved subtree (§5.4.2).
  let cursor: Node | null = op.parent.firstChild
  for (const node of wanted) {
    if (cursor === node) {
      cursor = node.nextSibling
      continue
    }
    op.parent.insertBefore(node, cursor)
  }
}

function applyPatch(target: Node, snapshot: PatchSnapshot): void {
  if (snapshot.kind === 'text' || snapshot.kind === 'comment') {
    target.textContent = snapshot.value ?? ''
    return
  }
  if (!(target instanceof Element)) return
  applyElementSnapshot(target, snapshot.attrs ?? {})
}

/** Constructs a fresh node from a decoded subtree, registering every id (§5.9.1). */
function materialize(doc: Document, registry: PageProjectionRegistry, node: DecodedNode): Node {
  if (node.kind === 'text') {
    const n = doc.createTextNode(node.value ?? '')
    registry.register(node.id, n)
    return n
  }
  if (node.kind === 'comment') {
    const n = doc.createComment(node.value ?? '')
    registry.register(node.id, n)
    return n
  }
  const tag = node.tag ?? 'div'
  const el = isSvgTag(tag) ? doc.createElementNS('http://www.w3.org/2000/svg', tag) : doc.createElement(tag)
  registry.register(node.id, el)
  applyElementSnapshot(el, node.attrs ?? {})
  for (const child of node.children ?? []) el.appendChild(materialize(doc, registry, child))
  return el
}

/** Full attribute + §5.2.1 node-state sync — idempotent, safe to re-run on any patch. */
function applyElementSnapshot(el: Element, attrs: Record<string, string>): void {
  for (const name of Array.from(el.getAttributeNames())) {
    if (!(name in attrs)) el.removeAttribute(name)
  }
  for (const [name, value] of Object.entries(attrs)) {
    try {
      el.setAttribute(name, value)
    } catch {
      /* invalid attribute name/value — keep the rest of the snapshot */
    }
  }
  applyNodeState(el, attrs)
}

/** §5.2.1 — state with no attribute-driven rendering; a `MutationObserver` cannot see these. */
function applyNodeState(el: Element, attrs: Record<string, string>): void {
  const value = attrs['speculum-input-value']
  if (value != null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    reconcileControlValue(el, value)
  } else if (value != null && el instanceof HTMLSelectElement) {
    el.value = value
  }
  const checked = attrs['speculum-input-checked']
  if (checked != null && el instanceof HTMLInputElement) el.checked = checked === 'true'
  const selected = attrs['speculum-option-selected']
  if (selected != null && el instanceof HTMLOptionElement) el.selected = selected === 'true'

  const modal = attrs['speculum-dialog-modal']
  if (el instanceof HTMLDialogElement) {
    if (modal === 'true' && !el.open) el.showModal()
    else if (modal !== 'true' && el.open) el.close()
  }

  const popover = attrs['speculum-popover-open']
  if (popover != null && 'showPopover' in el) {
    try {
      if (popover === 'true') (el as HTMLElement & { showPopover(): void }).showPopover()
      else (el as HTMLElement & { hidePopover(): void }).hidePopover()
    } catch {
      /* already in the requested state */
    }
  }

  if (el instanceof HTMLMediaElement) {
    const paused = attrs['speculum-media-paused']
    if (paused != null) {
      if (paused === 'true' && !el.paused) el.pause()
      else if (paused !== 'true' && el.paused) void el.play().catch(() => {})
    }
    const currentTime = attrs['speculum-media-current-time']
    if (currentTime != null) el.currentTime = Number(currentTime) || 0
    const muted = attrs['speculum-media-muted']
    if (muted != null) el.muted = muted === 'true'
    const volume = attrs['speculum-media-volume']
    if (volume != null) el.volume = Number(volume) || 0
  }

  const validity = attrs['speculum-custom-validity']
  if (validity != null && typeof (el as HTMLInputElement).setCustomValidity === 'function') {
    ;(el as HTMLInputElement).setCustomValidity(validity)
  }
}

function isSvgTag(tag: string): boolean {
  return tag === 'svg' || tag.startsWith('svg:')
}

/** Exported for `surface.tsx` establish handoff (§5.6.6) — materializes one fresh subtree. */
export function materializeFreshNode(doc: Document, registry: PageProjectionRegistry, node: DecodedNode): Node {
  return materialize(doc, registry, node)
}

/**
 * §5.2.6 — applies `<title>`, `documentElement.lang`/`.dir` and `meta[viewport].content`.
 * Exported so `ProjectionClient` can apply the same op while it arrives mid-establish,
 * before a `DomFrameApplier` exists for the standby document.
 */
export function applyDocumentState(doc: Document, op: DocumentStateOp): void {
  doc.title = op.title
  const html = doc.documentElement
  if (html) {
    if (op.lang !== null) html.setAttribute('lang', op.lang)
    else html.removeAttribute('lang')
    if (op.dir !== null) html.setAttribute('dir', op.dir)
    else html.removeAttribute('dir')
  }
  applyViewportMeta(doc, op.viewportContent)
}

function applyViewportMeta(doc: Document, content: string | null): void {
  const existing = doc.querySelector('meta[name="viewport"]')
  if (content === null) {
    existing?.remove()
    return
  }
  const meta = existing ?? doc.createElement('meta')
  if (!existing) {
    meta.setAttribute('name', 'viewport')
    ;(doc.head ?? doc.documentElement)?.appendChild(meta)
  }
  meta.setAttribute('content', content)
}
