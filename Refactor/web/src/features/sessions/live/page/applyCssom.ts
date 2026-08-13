/**
 * Cssom-plane apply — docs/page-projection/spec/engine-redesign.md §5.10, C1-C9.
 *
 * Owned CSSOM: every projected stylesheet is a client-created `<style>`
 * mutated through the live `CSSStyleSheet`, never a URL reload (C6). Scope
 * enforcement (`main` | `pierceHost`, C7) is preserved with an `@scope` wrap
 * keyed by a client-only marker attribute on the resolved pierce host — this
 * never touches Virtual's DOM, it exists solely on the Projected surface.
 */
import type { CssomInstallOp, CssomPatchOp, CssomRuleListOp, CssomSheetListOp, CssomSheetWire } from './decode'
import type { PageProjectionRegistry } from './registry'
import { stampCssVirtualUrls, type VirtualAuthAppender } from './stampVirtualAuth'

interface OwnedSheet {
  element: HTMLStyleElement
  sheet: CSSStyleSheet
  ruleIds: number[]
  scope: 'main' | 'pierceHost'
  hostAnchor: number | null
}

export type CssomDesyncReason = 'address_miss' | 'install_failed' | 'cssom_apply_failed'
export interface CssomDesyncInfo { reason: CssomDesyncReason; op: string; id?: number }

/** Marks the pierce-host element for `@scope` targeting — Projected-side only, never Virtual. */
const PIERCE_HOST_ATTR = 'data-pp-pierce-host'
const SHEET_ID_ATTR = 'data-pp-cssom-id'

export class CssomApplier {
  private readonly owned = new Map<number, OwnedSheet>()
  private readonly doc: Document
  private readonly registry: PageProjectionRegistry
  private readonly onDesync?: (info: CssomDesyncInfo) => void
  /** Pierce-host sheets deferred until anchors exist in the parsed document. */
  private pendingPierce: CssomSheetWire[] = []
  private readonly getStampAuth: () => VirtualAuthAppender | null

  constructor(
    doc: Document,
    registry: PageProjectionRegistry,
    onDesync?: (info: CssomDesyncInfo) => void,
    getStampAuth?: () => VirtualAuthAppender | null,
  ) {
    this.doc = doc
    this.registry = registry
    this.onDesync = onDesync
    this.getStampAuth = getStampAuth ?? (() => null)
  }

  private stampAuth(): VirtualAuthAppender | null {
    return this.getStampAuth()
  }

  /** `cssomInstall` — MUST be applied before the first establish chunk reaches the parser (D-FLASH). */
  applyInstall(op: CssomInstallOp): boolean {
    this.reset()
    this.pendingPierce = []
    for (const sheet of op.sheets) {
      if (sheet.scope === 'pierceHost' && !this.resolvePierceHost(sheet.hostAnchor)) {
        this.pendingPierce.push(sheet)
        continue
      }
      if (!this.installSheet(sheet, null)) {
        this.onDesync?.({ reason: 'install_failed', op: 'cssomInstall', id: sheet.id })
        return false
      }
    }
    return true
  }

  /**
   * Retries pierce-host sheets after establish HTML has anchors (registry and/or
   * `speculum-anchor` in the document). Returns false if any remaining sheet fails.
   */
  flushPendingPierce(): boolean {
    if (this.pendingPierce.length === 0) return true
    const still: CssomSheetWire[] = []
    for (const sheet of this.pendingPierce) {
      if (!this.resolvePierceHost(sheet.hostAnchor)) {
        still.push(sheet)
        continue
      }
      if (!this.installSheet(sheet, null)) {
        this.onDesync?.({ reason: 'install_failed', op: 'cssomInstall', id: sheet.id })
        this.pendingPierce = still
        return false
      }
    }
    this.pendingPierce = still
    return still.length === 0
  }

  applySheetList(op: CssomSheetListOp): boolean {
    for (const id of op.removed) {
      if (!this.owned.has(id)) {
        this.onDesync?.({ reason: 'address_miss', op: 'cssomSheetList', id })
        return false
      }
    }
    for (const id of op.removed) {
      this.owned.get(id)!.element.remove()
      this.owned.delete(id)
    }
    for (const entry of [...op.added].sort((a, b) => a.index - b.index)) {
      if (!this.installSheet(entry.sheet, entry.index)) {
        this.onDesync?.({ reason: 'install_failed', op: 'cssomSheetList', id: entry.sheet.id })
        return false
      }
    }
    return true
  }

  applyRuleList(op: CssomRuleListOp): boolean {
    const owned = this.owned.get(op.sheet)
    if (!owned) {
      this.onDesync?.({ reason: 'address_miss', op: 'cssomRuleList', id: op.sheet })
      return false
    }
    const removeIndexes: number[] = []
    for (const id of op.removed) {
      const idx = owned.ruleIds.indexOf(id)
      if (idx < 0) {
        this.onDesync?.({ reason: 'address_miss', op: 'cssomRuleList', id })
        return false
      }
      removeIndexes.push(idx)
    }
    for (const idx of [...removeIndexes].sort((a, b) => b - a)) {
      owned.sheet.deleteRule(idx)
      owned.ruleIds.splice(idx, 1)
    }
    for (const entry of [...op.added].sort((a, b) => a.index - b.index)) {
      if (!insertOwnedRule(owned, entry.rule.id, entry.rule.cssText, entry.index, this.stampAuth())) {
        this.onDesync?.({ reason: 'cssom_apply_failed', op: 'cssomRuleList', id: entry.rule.id })
        return false
      }
    }
    return true
  }

  /** C3.1 — patches the existing rule body in place, never delete+insert of the same locus. */
  applyPatch(op: CssomPatchOp): boolean {
    for (const owned of this.owned.values()) {
      const idx = owned.ruleIds.indexOf(op.rule)
      if (idx < 0) continue
      const live = owned.sheet.cssRules[idx]
      if (!(live instanceof CSSStyleRule)) break
      const match = /^(.*?)\s*\{([\s\S]*)\}\s*$/.exec(op.cssText.trim())
      try {
        if (match) {
          if (match[1]!.trim()) live.selectorText = match[1]!.trim()
          live.style.cssText = match[2] ?? ''
        } else {
          live.style.cssText = op.cssText
        }
        return true
      } catch {
        this.onDesync?.({ reason: 'install_failed', op: 'cssomPatch', id: op.rule })
        return false
      }
    }
    this.onDesync?.({ reason: 'address_miss', op: 'cssomPatch', id: op.rule })
    return false
  }

  /** Total owned rules across every installed sheet — surface health probes. */
  getOwnedRuleCount(): number {
    let count = 0
    for (const owned of this.owned.values()) count += owned.ruleIds.length
    return count
  }

  /** Double-buffer epoch boundary (§5.8.5) — drops every owned sheet element. */
  reset(): void {
    for (const owned of this.owned.values()) owned.element.remove()
    this.owned.clear()
    this.pendingPierce = []
  }

  private installSheet(sheet: CssomSheetWire, index: number | null): boolean {
    const hostEl = sheet.scope === 'pierceHost' ? this.resolvePierceHost(sheet.hostAnchor) : null
    if (sheet.scope === 'pierceHost' && !hostEl) return false

    const element = this.doc.createElement('style')
    element.setAttribute(SHEET_ID_ATTR, String(sheet.id))
    const parent = this.doc.head ?? this.doc.documentElement
    if (!parent) return false
    parent.appendChild(element)
    if (index != null) {
      const siblings = Array.from(this.doc.querySelectorAll(`style[${SHEET_ID_ATTR}]`))
      const before = siblings[index]
      if (before && before !== element) before.parentNode?.insertBefore(element, before)
    }
    const live = element.sheet
    if (!live) {
      element.remove()
      return false
    }

    const owned: OwnedSheet = { element, sheet: live, ruleIds: [], scope: sheet.scope, hostAnchor: sheet.hostAnchor }
    this.owned.set(sheet.id, owned)
    for (const rule of sheet.rules) {
      if (!insertOwnedRule(owned, rule.id, rule.cssText, owned.ruleIds.length, this.stampAuth())) {
        element.remove()
        this.owned.delete(sheet.id)
        return false
      }
    }
    return true
  }

  private resolvePierceHost(hostAnchor: number | null): Element | null {
    if (hostAnchor == null) return null
    let node: Element | null = null
    const registered = this.registry.get(hostAnchor)
    if (registered instanceof Element) node = registered
    if (!node) {
      try {
        node = this.doc.querySelector(`[speculum-anchor="${hostAnchor}"]`)
      } catch {
        node = null
      }
    }
    if (!node) return null
    if (!node.hasAttribute(PIERCE_HOST_ATTR)) node.setAttribute(PIERCE_HOST_ATTR, String(hostAnchor))
    return node
  }
}

function insertOwnedRule(
  owned: OwnedSheet,
  id: number,
  cssText: string,
  index: number,
  stampAuth?: VirtualAuthAppender | null,
): boolean {
  const at = Math.min(Math.max(index, 0), owned.ruleIds.length)
  const stamped = stampAuth ? stampCssVirtualUrls(cssText, stampAuth) : cssText
  const scoped = owned.scope === 'pierceHost' && owned.hostAnchor != null ? scopeRule(stamped, owned.hostAnchor) : stamped
  try {
    owned.sheet.insertRule(scoped, at)
  } catch {
    // Fail closed — never lie with placeholder rules that inflate ownedRules.
    return false
  }
  owned.ruleIds.splice(at, 0, id)
  return true
}

/** Wraps pierce-scoped author CSS so rules only match under the host subtree (C7). */
function scopeRule(cssText: string, hostAnchor: number): string {
  const trimmed = cssText.trim()
  if (!trimmed || trimmed.startsWith('@scope')) return trimmed
  return `@scope ([${PIERCE_HOST_ATTR}="${hostAnchor}"]) { ${trimmed} }`
}
