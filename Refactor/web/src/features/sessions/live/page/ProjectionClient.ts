/**
 * Orchestration only — wires decode → registry → apply → surface →
 * interaction. docs/page-projection/spec/engine-redesign.md §5 end to end.
 *
 * No algorithm lives here (§9): decoding is `decode.ts`, resolution is
 * `registry.ts`, mutation is `applyDom.ts` / `applyCssom.ts`, paint timing is
 * `surface.tsx`, capture is `interaction.ts`. This class only sequences calls
 * between them and tracks the generation/sequence/desync state machine.
 *
 * Resync is not a special payload: per §5.7.2 the OOB response is a normal
 * frame stream carrying the resync flag, so it re-enters through the same
 * `ingest()` as every other frame. The consumer only needs to issue the HTTP
 * request when `onDesync` fires and pipe the response bytes back in.
 */
import type {
  AssembledFrame,
  CssomInstallOp,
  DecodedOp,
  DocumentStateOp,
  EstablishBeginOp,
  EstablishEndOp,
} from './decode'
import { decodeFramePart, FramePartAssembler } from './decode'
import { PageProjectionRegistry } from './registry'
import { DomFrameApplier, applyDocumentState } from './applyDom'
import { CssomApplier, type CssomDesyncInfo } from './applyCssom'
import type { SurfaceBuildHandle, SurfaceHostHandle } from './surface'
import { attachPageProjectionInteraction, attachVisibilityReporter } from './interaction'
import type { PageProjectionIntentSender } from './interaction'
import { ClientStateTracker } from './clientState'
import type { PageProjectionClientStateSender } from './clientState'
import {
  makeVirtualAuthAppender,
  stampDocumentVirtualUrls,
  stampHtmlVirtualUrls,
  type VirtualAuthAppender,
} from './stampVirtualAuth'

/** Every §5.7.1 trigger this orchestrator can raise. */
export type PageProjectionDesyncReason =
  | 'unknown_version'
  | 'malformed'
  | 'missing_part'
  | 'sequence_gap'
  | 'generation_mismatch'
  | 'address_miss'
  | 'establish_mismatch'
  | 'surface_missing'
  /** Virtual-asset HTML arrived before a binding token — refuse unstamped fetches. */
  | 'auth_token_missing'
  /** cssomInstall never applied / pierce still pending at establishEnd. */
  | 'cssom_not_ready'
  /** insertRule / sheet install failed — fail closed, never soft-skip. */
  | 'cssom_apply_failed'

export interface ProjectionClientOptions {
  sendIntent: PageProjectionIntentSender
  sendClientState: PageProjectionClientStateSender
  /** Root browsing context id (default 1). */
  contextId?: number
  getViewportSize: () => { width: number; height: number }
  /** Default 1000 — §5.16 `clientStateMs`. */
  clientStateMs?: number
  /** Default 4 — §5.16 `applyBudgetMs` (E9). */
  applyBudgetMs?: number
  /** Consumer issues the OOB `PageProjection.Resync` request; feed the response back into `ingest`. */
  onDesync?: (reason: PageProjectionDesyncReason, generation: number) => void
  sessionId?: string | null
  token?: string | null
  assetBaseUrl?: string
  /** Prefer live getters — token may arrive after ProjectionClient construction. */
  getSessionId?: () => string | null | undefined
  getToken?: () => string | null | undefined
  getAssetBaseUrl?: () => string | undefined
}

const AUTH_WAIT_MS = 5_000

export class ProjectionClient {
  private readonly assembler = new FramePartAssembler()
  private readonly clientState: ClientStateTracker

  private surface: SurfaceHostHandle | null = null
  private registry = new PageProjectionRegistry()
  private domApplier: DomFrameApplier | null = null
  private cssomApplier: CssomApplier | null = null
  private detachInteraction: (() => void) | null = null
  private detachVisibility: (() => void) | null = null
  private stopClientState: (() => void) | null = null

  private build: SurfaceBuildHandle | null = null
  private buildRegistry: PageProjectionRegistry | null = null
  private buildCssom: CssomApplier | null = null
  /** cssomInstall arrives before the standby doc has a <head> — flush after first chunk. */
  private pendingCssom: CssomInstallOp | null = null
  /** True once applyInstall succeeded for the current build (pierce may still be pending). */
  private cssomInstallApplied = false
  /** §5.6.5 — stash until finishEstablish (scroll must apply on the standby doc before arm). */
  private pendingEstablishBegin: EstablishBeginOp | null = null
  private pendingDocumentState: DocumentStateOp | null = null

  /** Establish/resync frames held until `getToken()` is live — never silent drop. */
  private authBufferedFrames: AssembledFrame[] = []
  private authWaitTimer: ReturnType<typeof setInterval> | null = null
  private authWaitDeadline = 0

  private generation = 0
  private lastSequence = 0
  private desynced = false
  private queuedFrames = 0
  private readonly options: ProjectionClientOptions

  constructor(options: ProjectionClientOptions) {
    this.options = options
    this.clientState = new ClientStateTracker(options.sendClientState, options.clientStateMs)
  }

  start(): void {
    this.stopClientState = this.clientState.start()
  }

  stop(): void {
    this.clearAuthWait()
    this.authBufferedFrames = []
    this.stopClientState?.()
    this.detachInteraction?.()
    this.detachVisibility?.()
    this.domApplier?.reset()
    this.cssomApplier?.reset()
    this.build?.cancel()
    this.assembler.reset()
  }

  /** Wires the mounted `SurfaceHost` imperative handle (owned by the consumer's React tree). */
  attachSurface(surface: SurfaceHostHandle): void {
    this.surface = surface
  }

  /** Wires local-first pointer/keyboard/scroll capture to the active surface document (§5.9). */
  attachInteraction(surfaceElement: HTMLElement): void {
    this.detachInteraction?.()
    this.detachInteraction = attachPageProjectionInteraction(surfaceElement, this.registry, this.options.sendIntent, {
      contextId: this.options.contextId ?? 1,
      getGeneration: () => this.generation,
      getViewportSize: this.options.getViewportSize,
      isArmed: () => this.isArmed(),
      getSessionId: () => this.options.getSessionId?.() ?? this.options.sessionId,
      getToken: () => this.options.getToken?.() ?? this.options.token,
      getAssetBaseUrl: () => this.options.getAssetBaseUrl?.() ?? this.options.assetBaseUrl,
    })
  }

  /** Reports `visibilityState` on the control channel (§5.9.5). */
  attachVisibility(doc: Document): void {
    this.detachVisibility?.()
    this.detachVisibility = attachVisibilityReporter(doc, (v) => this.clientState.setVisibility(v))
  }

  /** No intents before arm; disarmed while desynced (§5.6.7, §5.7.1, §5.11.4). */
  isArmed(): boolean {
    return !this.desynced && (this.surface?.isArmed() ?? false)
  }

  /** Ingests one raw wire frame part — establish, resync and live frames all flow through here (§5.5). */
  ingest(bytes: Uint8Array | ArrayBuffer): void {
    const decoded = decodeFramePart(bytes)
    if (!decoded.ok) {
      this.triggerDesync(decoded.reason)
      return
    }
    const assembled = this.assembler.ingest(decoded.part)
    if (assembled === 'missing_part') {
      this.triggerDesync('missing_part')
      return
    }
    if (!assembled) return // buffering a multi-part frame

    if (assembled.establish || assembled.resync) {
      if (!this.hasToken()) {
        this.bufferUntilAuth(assembled)
        return
      }
      this.flushAuthBuffer()
      this.applyEstablish(assembled)
      return
    }
    this.applyLive(assembled)
  }

  private hasToken(): boolean {
    const token = this.options.getToken?.() ?? this.options.token
    return typeof token === 'string' && token.length > 0
  }

  private bufferUntilAuth(frame: AssembledFrame): void {
    if (this.authBufferedFrames.length === 0) {
      this.authWaitDeadline = Date.now() + AUTH_WAIT_MS
    }
    this.authBufferedFrames.push(frame)
    this.ensureAuthWait()
  }

  private ensureAuthWait(): void {
    if (this.authWaitTimer != null) return
    this.authWaitTimer = setInterval(() => {
      if (this.hasToken()) {
        this.clearAuthWait()
        this.flushAuthBuffer()
        return
      }
      if (Date.now() >= this.authWaitDeadline) {
        this.clearAuthWait()
        this.authBufferedFrames = []
        this.build?.cancel()
        this.clearBuild()
        this.triggerDesync('auth_token_missing')
      }
    }, 50)
  }

  private clearAuthWait(): void {
    if (this.authWaitTimer != null) {
      clearInterval(this.authWaitTimer)
      this.authWaitTimer = null
    }
  }

  private flushAuthBuffer(): void {
    if (this.authBufferedFrames.length === 0) return
    const pending = this.authBufferedFrames
    this.authBufferedFrames = []
    for (const frame of pending) this.applyEstablish(frame)
  }

  private applyEstablish(frame: AssembledFrame): void {
    if (!this.surface) {
      this.triggerDesync('surface_missing')
      return
    }
    if (!this.build) this.beginBuild()
    for (const op of frame.ops) {
      if (op.op === 'cssomInstall') {
        // After doc.open() there is no <head> yet — buffer until a chunk creates one (§5.4.3).
        this.pendingCssom = op
        this.flushPendingCssom()
      } else if (op.op === 'establishBegin') {
        this.generation = op.generation
        this.pendingEstablishBegin = op
      } else if (op.op === 'establishChunk') {
        const auth = this.stampAuth()
        // Stamp-before-fetch: never write `/w7s/virtual-*` without a live token
        // (browser starts loading during doc.write into the standby iframe).
        if (!auth && /\/w7s\/virtual-/.test(op.html)) {
          this.triggerDesync('auth_token_missing')
          this.build?.cancel()
          this.clearBuild()
          return
        }
        const html = auth ? stampHtmlVirtualUrls(op.html, auth) : op.html
        this.build?.writeChunk(html)
        this.flushPendingCssom()
      } else if (op.op === 'establishEnd') {
        this.flushPendingCssom()
        this.finishEstablish(op)
      } else if (op.op === 'documentState') {
        // May arrive before chunks create a document — buffer and apply in finishEstablish.
        this.pendingDocumentState = op
        if (this.build?.document?.documentElement) {
          applyDocumentState(this.build.document, op)
        }
      }
    }
  }

  private stampAuth(): VirtualAuthAppender | null {
    const token = this.options.getToken?.() ?? this.options.token
    const base =
      this.options.getAssetBaseUrl?.() ??
      this.options.assetBaseUrl ??
      (typeof window !== 'undefined' ? window.location.origin : '')
    return makeVirtualAuthAppender(token, base)
  }

  private mapCssomDesync(info: CssomDesyncInfo): PageProjectionDesyncReason {
    if (info.reason === 'cssom_apply_failed' || info.reason === 'install_failed') return 'cssom_apply_failed'
    return 'address_miss'
  }

  private beginBuild(): void {
    this.build = this.surface!.beginBuild()
    this.buildRegistry = new PageProjectionRegistry()
    this.buildCssom = new CssomApplier(
      this.build.document,
      this.buildRegistry,
      (info) => this.triggerDesync(this.mapCssomDesync(info)),
      () => this.stampAuth(),
    )
    this.pendingCssom = null
    this.cssomInstallApplied = false
    void this.build.swap().catch(() => {})
  }

  private flushPendingCssom(): void {
    if (!this.pendingCssom || !this.build || !this.buildCssom) return
    if (!this.build.document.head && !this.build.document.documentElement) return
    if (!this.applyBuildCssomInstall(this.pendingCssom)) return
    this.pendingCssom = null
  }

  private applyBuildCssomInstall(op: CssomInstallOp): boolean {
    if (!this.build || !this.buildCssom) return false
    // Main sheets may install before anchors exist; pierce-host sheets stay pending.
    // Never re-run applyInstall (it reset()s) while pierce is still flushing.
    if (!this.cssomInstallApplied) {
      if (!this.buildCssom.applyInstall(op)) return false
      this.cssomInstallApplied = true
    }
    if (!this.buildCssom.flushPendingPierce()) return false
    // Pages with no stylesheets legitimately have 0 owned rules. Fail closed only
    // when the wire carried rule bodies that did not land.
    const wireRules = op.sheets.reduce((n, s) => n + (s.rules?.length ?? 0), 0)
    if (wireRules > 0 && this.buildCssom.getOwnedRuleCount() <= 0) return false
    this.build.markCssomReady()
    return true
  }

  /** Walks the parsed document once, verifies `nodeCount`/`checksum`, then promotes the build (§5.6.4). */
  private finishEstablish(op: EstablishEndOp): void {
    const build = this.build
    const registry = this.buildRegistry
    const cssom = this.buildCssom
    if (!build || !registry || !cssom) return

    // Close the streaming parser first so the client tree is complete (§5.6.4),
    // verify checksum, then swap. Never swap an unverified establish.
    build.finalizeParser()
    const { nodeCount, checksum } = registry.buildFromDocument(build.document.documentElement)
    if (nodeCount !== op.nodeCount || checksum !== op.checksum) {
      console.error('[page-projection] establish_mismatch', {
        clientNodeCount: nodeCount,
        wireNodeCount: op.nodeCount,
        clientChecksum: checksum,
        wireChecksum: op.checksum,
      })
      this.triggerDesync('establish_mismatch')
      build.cancel()
      this.clearBuild()
      return
    }

    // Ensure cssomInstall landed before arming — never promote an unstyled surface.
    this.flushPendingCssom()
    if (this.pendingCssom || !this.cssomInstallApplied) {
      console.error('[page-projection] cssom_not_ready_at_establish_end', {
        pendingCssom: Boolean(this.pendingCssom),
        cssomInstallApplied: this.cssomInstallApplied,
      })
      this.triggerDesync('cssom_not_ready')
      build.cancel()
      this.clearBuild()
      return
    }

    // Anchors are registered — complete pierce-host CSSOM before promoting FMP.
    if (!cssom.flushPendingPierce()) {
      this.triggerDesync('cssom_not_ready')
      build.cancel()
      this.clearBuild()
      return
    }
    const auth = this.stampAuth()
    const htmlProbe = build.document.documentElement?.outerHTML ?? ''
    if (!auth && /\/w7s\/virtual-/.test(htmlProbe)) {
      this.triggerDesync('auth_token_missing')
      build.cancel()
      this.clearBuild()
      return
    }
    if (auth) stampDocumentVirtualUrls(build.document, auth)

    // §5.2.6 / §5.6.5 — documentState + scroll must land on standby before arm.
    if (this.pendingDocumentState) {
      applyDocumentState(build.document, this.pendingDocumentState)
    }
    const begin = this.pendingEstablishBegin
    if (begin) {
      build.document.defaultView?.scrollTo(begin.scrollX, begin.scrollY)
      for (const se of begin.scrollElements) {
        const el = registry.get(se.id)
        if (el instanceof Element) {
          el.scrollTop = se.scrollTop
          el.scrollLeft = se.scrollLeft
        }
      }
    }

    build.markCssomReady()
    build.markEstablishEnd()

    this.domApplier?.reset()
    this.cssomApplier?.reset()
    this.registry = registry
    this.cssomApplier = cssom
    this.domApplier = new DomFrameApplier(build.document, registry, {
      applyBudgetMs: this.options.applyBudgetMs,
      getStampAuth: () => this.stampAuth(),
      onDesync: () => this.triggerDesync('address_miss'),
      onApplied: (f) => {
        this.queuedFrames = Math.max(0, this.queuedFrames - 1)
        this.clientState.setQueuedFrames(this.queuedFrames)
        this.clientState.setAppliedThroughSequence(f.sequence)
      },
      onOverrun: (ms) => this.clientState.recordApply(ms, true),
      onCssomOps: (ops) => this.dispatchCssom(cssom, ops),
    })
    this.lastSequence = 0
    this.desynced = false
    this.clearBuild()
  }

  private clearBuild(): void {
    this.build = null
    this.buildRegistry = null
    this.buildCssom = null
    this.pendingCssom = null
    this.cssomInstallApplied = false
    this.pendingEstablishBegin = null
    this.pendingDocumentState = null
  }

  private applyLive(frame: AssembledFrame): void {
    if (this.desynced || !this.domApplier) return
    if (frame.generation !== this.generation) {
      this.triggerDesync('generation_mismatch')
      return
    }
    if (this.lastSequence > 0 && frame.sequence <= this.lastSequence) return // stale/duplicate — never re-apply
    if (this.lastSequence > 0 && frame.sequence > this.lastSequence + 1) {
      this.triggerDesync('sequence_gap')
      return
    }
    this.lastSequence = frame.sequence
    this.queuedFrames += 1
    this.clientState.setQueuedFrames(this.queuedFrames)
    this.domApplier.enqueue(frame)
  }

  private dispatchCssom(cssom: CssomApplier, ops: DecodedOp[]): void {
    for (const op of ops) {
      let ok = true
      if (op.op === 'cssomInstall') ok = cssom.applyInstall(op)
      else if (op.op === 'cssomSheetList') ok = cssom.applySheetList(op)
      else if (op.op === 'cssomRuleList') ok = cssom.applyRuleList(op)
      else if (op.op === 'cssomPatch') ok = cssom.applyPatch(op)
      if (!ok) return
    }
  }

  private triggerDesync(reason: PageProjectionDesyncReason): void {
    this.desynced = true
    this.options.onDesync?.(reason, this.generation)
  }
}
