import type { DomDiff, DomNode, DomOp } from '@/lib/speculum'

export type DomAssetUrlResolver = (hash: string) => string | null

/**
 * Applies DomDiff snapshots/patches into a host element.
 * Ids map to projected nodes; gaps in sequence are reported via onSequenceGap.
 */
export class DomDiffApplier {
  private readonly idToNode = new Map<number, Node>()
  private generation = 0
  private lastSequence = 0
  private pendingRaf: number | null = null
  private queued: DomDiff[] = []
  private readonly host: HTMLElement
  private readonly resolveAssetUrl?: DomAssetUrlResolver
  private readonly onSequenceGap?: (expected: number, got: number) => void

  constructor(
    host: HTMLElement,
    resolveAssetUrl?: DomAssetUrlResolver,
    onSequenceGap?: (expected: number, got: number) => void,
  ) {
    this.host = host
    this.resolveAssetUrl = resolveAssetUrl
    this.onSequenceGap = onSequenceGap
  }

  /** Queue a diff; applied inside requestAnimationFrame. */
  enqueue(diff: DomDiff): void {
    this.queued.push(diff)
    if (this.pendingRaf != null) return
    this.pendingRaf = requestAnimationFrame(() => {
      this.pendingRaf = null
      const batch = this.queued
      this.queued = []
      for (const item of batch) {
        this.applyNow(item)
      }
    })
  }

  reset(): void {
    if (this.pendingRaf != null) {
      cancelAnimationFrame(this.pendingRaf)
      this.pendingRaf = null
    }
    this.queued = []
    this.idToNode.clear()
    this.generation = 0
    this.lastSequence = 0
    this.host.replaceChildren()
  }

  private applyNow(diff: DomDiff): void {
    const sequence = Number(diff.sequence ?? 0)
    if (this.lastSequence > 0 && sequence > this.lastSequence + 1) {
      this.onSequenceGap?.(this.lastSequence + 1, sequence)
      // Wait for snapshot keyframe before applying further patches blindly.
      if (diff.kind !== 'snapshot') {
        return
      }
    }

    if (diff.kind === 'snapshot') {
      this.applySnapshot(diff)
      this.lastSequence = sequence
      return
    }

    if (diff.kind === 'patch' && Array.isArray(diff.ops)) {
      if (diff.generation != null && diff.generation !== this.generation) {
        // Stale generation — wait for snapshot.
        return
      }
      for (const op of diff.ops) {
        this.applyOp(op)
      }
      this.lastSequence = sequence
    }
  }

  private applySnapshot(diff: DomDiff): void {
    this.idToNode.clear()
    this.host.replaceChildren()
    this.generation = Number(diff.generation ?? 0)
    if (!diff.root) return

    // Never nest <html>/<body> under a host div — browsers break layout/CSS.
    // Map those ids onto the host so later patches still resolve.
    if (diff.root.tag === 'html') {
      this.idToNode.set(diff.root.id, this.host)
      const head = diff.root.children?.find((c) => c.tag === 'head')
      const body = diff.root.children?.find((c) => c.tag === 'body')
      if (head) {
        this.idToNode.set(head.id, this.host)
        for (const child of head.children ?? []) {
          if (child.tag !== 'link' && child.tag !== 'style' && child.tag !== 'meta') {
            continue
          }
          const built = this.buildNode(child)
          if (built) this.host.appendChild(built)
        }
      }
      if (body) {
        this.idToNode.set(body.id, this.host)
        for (const child of body.children ?? []) {
          const built = this.buildNode(child)
          if (built) this.host.appendChild(built)
        }
      }
      return
    }

    const built = this.buildNode(diff.root)
    if (built) this.host.appendChild(built)
  }

  private applyOp(op: DomOp): void {
    switch (op.op) {
      case 'insert': {
        const parent =
          op.parentId != null ? this.idToNode.get(op.parentId) : this.host
        // Text/Comment cannot take children; stale parentIds after flatten must not throw.
        if (!(parent instanceof Element) || !op.node) return
        const built = this.buildNode(op.node)
        if (!built) return
        const index = Math.max(0, Math.min(op.index ?? parent.childNodes.length, parent.childNodes.length))
        const ref = parent.childNodes[index] ?? null
        try {
          parent.insertBefore(built, ref)
        } catch {
          // Void elements / hierarchy violations — skip rather than crash the surface.
        }
        break
      }
      case 'remove': {
        const node = this.idToNode.get(op.id)
        if (!node) return
        node.parentNode?.removeChild(node)
        this.forget(op.id)
        break
      }
      case 'setAttr': {
        const node = this.idToNode.get(op.id)
        if (!(node instanceof Element) || !op.name) return
        node.setAttribute(op.name, this.rewriteAttr(op.name, op.value ?? ''))
        break
      }
      case 'removeAttr': {
        const node = this.idToNode.get(op.id)
        if (!(node instanceof Element) || !op.name) return
        node.removeAttribute(op.name)
        break
      }
      case 'setText': {
        const node = this.idToNode.get(op.id)
        if (!node) return
        node.textContent = op.text ?? ''
        break
      }
      case 'move': {
        const node = this.idToNode.get(op.id)
        const parent =
          op.parentId != null ? this.idToNode.get(op.parentId) : this.host
        if (!node || !(parent instanceof Element)) return
        const index = Math.max(0, Math.min(op.index ?? parent.childNodes.length, parent.childNodes.length))
        const ref = parent.childNodes[index] ?? null
        try {
          parent.insertBefore(node, ref)
        } catch {
          // ignore hierarchy violations
        }
        break
      }
      default:
        break
    }
  }

  private buildNode(spec: DomNode): Node | null {
    if (spec.tag === '#text') {
      const text = document.createTextNode(spec.text ?? '')
      this.idToNode.set(spec.id, text)
      return text
    }

    // Skip document roots / scripts — never nest under the projection host.
    const tag = (spec.tag || 'div').toLowerCase()
    if (tag === 'html' || tag === 'head' || tag === 'body' || tag === 'script' || tag === 'noscript') {
      return null
    }

    let el: Element
    try {
      el = document.createElement(spec.tag || 'div')
    } catch {
      el = document.createElement('div')
    }
    this.idToNode.set(spec.id, el)
    el.setAttribute('data-speculum-id', String(spec.id))
    if (spec.attrs) {
      for (const [name, value] of Object.entries(spec.attrs)) {
        if (name === 'data-speculum-id') continue
        try {
          el.setAttribute(name, this.rewriteAttr(name, value))
        } catch {
          // ignore invalid attr names
        }
      }
    }
    // Preload without `as` is invalid and floods the console; drop those links.
    if (
      tag === 'link'
      && (el.getAttribute('rel') || '').toLowerCase() === 'preload'
      && !el.getAttribute('as')
    ) {
      this.idToNode.delete(spec.id)
      return null
    }
    if (spec.text != null && !spec.children?.length) {
      el.textContent = spec.text
    }
    if (spec.children) {
      for (const child of spec.children) {
        const built = this.buildNode(child)
        if (built) el.appendChild(built)
      }
    }
    return el
  }

  private rewriteAttr(name: string, value: string): string {
    if ((name === 'src' || name === 'href') && value.startsWith('speculum-asset:')) {
      const hash = value.slice('speculum-asset:'.length)
      return this.resolveAssetUrl?.(hash) ?? value
    }
    return value
  }

  private forget(id: number): void {
    const node = this.idToNode.get(id)
    this.idToNode.delete(id)
    if (!node || !(node instanceof Element)) return
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT)
    let current: Node | null = walk.currentNode
    while (current) {
      if (current instanceof Element) {
        const raw = current.getAttribute('data-speculum-id')
        if (raw) this.idToNode.delete(Number(raw))
      }
      current = walk.nextNode()
    }
  }
}
