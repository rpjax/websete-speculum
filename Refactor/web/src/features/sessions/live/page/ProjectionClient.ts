/**
 * Orchestration only — wires decode → registry → apply → surface →
 * interaction. docs/page-projection-engine-redesign.md §5 end to end.
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
import type { AssembledFrame, CssomInstallOp, DecodedOp, EstablishEndOp } from './decode'
import { decodeFramePart, FramePartAssembler } from './decode'
import { PageProjectionRegistry } from './registry'
import { DomFrameApplier } from './applyDom'
import { CssomApplier } from './applyCssom'
import type { SurfaceBuildHandle, SurfaceHostHandle } from './surface'
import { attachPageProjectionInteraction, attachVisibilityReporter } from './interaction'
import type { PageProjectionIntentSender } from './interaction'
import { ClientStateTracker } from './clientState'
import type { PageProjectionClientStateSender } from './clientState'

/** Every §5.7.1 trigger this orchestrator can raise. */
export type PageProjectionDesyncReason =
  | 'unknown_version'
  | 'malformed'
  | 'missing_part'
  | 'sequence_gap'
  | 'generation_mismatch'
  | 'address_miss'
  | 'establish_mismatch'

export interface ProjectionClientOptions {
  sendIntent: PageProjectionIntentSender
  sendClientState: PageProjectionClientStateSender
  getViewportSize: () => { width: number; height: number }
  /** Default 1000 — §5.16 `clientStateMs`. */
  clientStateMs?: number
  /** Default 4 — §5.16 `applyBudgetMs` (E9). */
  applyBudgetMs?: number
  /** Consumer issues the OOB `PageProjection.Resync` request; feed the response back into `ingest`. */
  onDesync?: (reason: PageProjectionDesyncReason, generation: number) => void
}

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
      getGeneration: () => this.generation,
      getViewportSize: this.options.getViewportSize,
      isArmed: () => this.isArmed(),
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
    if (assembled.establish || assembled.resync) this.applyEstablish(assembled)
    else this.applyLive(assembled)
  }

  private applyEstablish(frame: AssembledFrame): void {
    if (!this.surface) return
    if (!this.build) this.beginBuild()
    for (const op of frame.ops) {
      if (op.op === 'cssomInstall') this.applyBuildCssomInstall(op)
      else if (op.op === 'establishBegin') this.generation = op.generation
      else if (op.op === 'establishChunk') this.build?.writeChunk(op.html)
      else if (op.op === 'establishEnd') this.finishEstablish(op)
    }
  }

  private beginBuild(): void {
    this.build = this.surface!.beginBuild()
    this.buildRegistry = new PageProjectionRegistry()
    this.buildCssom = new CssomApplier(this.build.document, this.buildRegistry, () => this.triggerDesync('address_miss'))
    void this.build.swap().catch(() => {})
  }

  private applyBuildCssomInstall(op: CssomInstallOp): void {
    if (!this.build || !this.buildCssom) return
    this.buildCssom.applyInstall(op)
    this.build.markCssomReady()
  }

  /** Walks the parsed document once, verifies `nodeCount`/`checksum`, then promotes the build (§5.6.4). */
  private finishEstablish(op: EstablishEndOp): void {
    const build = this.build
    const registry = this.buildRegistry
    const cssom = this.buildCssom
    if (!build || !registry || !cssom) return
    build.markEstablishEnd()

    const { nodeCount, checksum } = registry.buildFromDocument(build.document.documentElement)
    if (nodeCount !== op.nodeCount || checksum !== op.checksum) {
      this.triggerDesync('establish_mismatch')
      build.cancel()
      this.clearBuild()
      return
    }

    this.domApplier?.reset()
    this.cssomApplier?.reset()
    this.registry = registry
    this.cssomApplier = cssom
    this.domApplier = new DomFrameApplier(build.document, registry, {
      applyBudgetMs: this.options.applyBudgetMs,
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
      if (op.op === 'cssomInstall') cssom.applyInstall(op)
      else if (op.op === 'cssomSheetList') cssom.applySheetList(op)
      else if (op.op === 'cssomRuleList') cssom.applyRuleList(op)
      else if (op.op === 'cssomPatch') cssom.applyPatch(op)
    }
  }

  private triggerDesync(reason: PageProjectionDesyncReason): void {
    this.desynced = true
    this.options.onDesync?.(reason, this.generation)
  }
}
