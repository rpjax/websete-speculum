/**
 * Lab-only facade over {@link ProjectionClient}.
 * Browse/Run UI and inject folds use this; production/web never import it.
 */

import {
  createProjectionClient,
  type ProjectionClient,
  type ProjectionClientOptions,
} from '@speculum/page-projection/projected/ProjectionClient';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';
import type { ReplicatedTableDigest } from '@speculum/page-projection/core/tableDigest';

export type LabProjectedHarnessOptions = ProjectionClientOptions;

export class LabProjectedHarness {
  readonly client: ProjectionClient;

  constructor(opts: LabProjectedHarnessOptions) {
    this.client = createProjectionClient(opts);
  }

  ingest(bytes: Uint8Array): void {
    this.client.ingest(bytes);
  }

  flush(): void {
    this.client.flush();
  }

  /** @deprecated alias — prefer {@link flush} */
  flushNow(): void {
    this.client.flush();
  }

  reset(): void {
    this.client.reset();
  }

  /** @deprecated alias — prefer {@link reset} */
  resetSurface(): void {
    this.client.reset();
  }

  get isArmed(): boolean {
    return this.client.isArmed;
  }

  getGeneration(): number {
    return this.client.getGeneration();
  }

  get lastAcceptedSequence(): number {
    return this.client.lastAcceptedSequence;
  }

  get document(): Document {
    return this.client.document;
  }

  get desynced(): boolean {
    return this.client.desynced;
  }

  get applyError(): string | null {
    return this.client.applyError;
  }

  get resyncInFlight(): boolean {
    return this.client.resyncInFlight;
  }

  getLiveRegistry() {
    return this.client.getLiveRegistry();
  }

  getScrollableIndex() {
    return this.client.getScrollableIndex();
  }

  requestScrollCensus(fromContextId: number) {
    return this.client.requestScrollCensus(fromContextId);
  }

  /**
   * Lab diag — peek Projected input fabric (registry vs live buses vs nested hosts).
   * Ghost signature: id in `registry` but missing from `buses` (or nested already dropped).
   */
  peekProjectedInputRuntime(): {
    registry: number[];
    buses: number[];
    nested: number[];
    awaiting: number[];
    ghosts: number[];
  } {
    const c = this.client as unknown as {
      inputRuntime: {
        registry: Set<number>;
        contextBuses: Map<number, unknown>;
      };
      nested: Map<number, unknown>;
      nestedHostAwaitingLoad: Map<number, unknown>;
    };
    const registry = [...c.inputRuntime.registry].sort((a, b) => a - b);
    const buses = [...c.inputRuntime.contextBuses.keys()].sort((a, b) => a - b);
    const nested = [...c.nested.keys()].sort((a, b) => a - b);
    const awaiting = [...c.nestedHostAwaitingLoad.keys()].sort((a, b) => a - b);
    const busSet = new Set(buses);
    const nestedSet = new Set(nested);
    const ghosts = registry.filter((id) => id !== 1 && (!busSet.has(id) || !nestedSet.has(id)));
    return { registry, buses, nested, awaiting, ghosts };
  }

  forceLoadAfterDropRaceForDiag(contextId: number) {
    return this.client.forceLoadAfterDropRaceForDiag(contextId);
  }

  markPropDirty(id: number): void {
    this.client.markPropDirty(id);
  }

  forEachNestedInputSurface(
    fn: Parameters<ProjectionClient['forEachNestedInputSurface']>[0],
  ): void {
    this.client.forEachNestedInputSurface(fn);
  }

  snapshotTable(): {
    sequence: number;
    generation: number;
    table: ReturnType<typeof digestReplicatedTable>;
  } {
    return this.client.liveTableDigest();
  }

  snapshotContext(contextId: number): {
    contextId: number;
    sequence: number;
    generation: number;
    table: ReturnType<typeof digestReplicatedTable>;
    desynced: boolean;
    applyError: string | null;
    armed: boolean;
    resyncInFlight: boolean;
  } {
    this.client.flush();
    if (contextId === CONTEXT_ID_ROOT) {
      return {
        contextId,
        ...this.client.liveTableDigest(),
        desynced: this.client.desynced,
        applyError: this.client.applyError,
        armed: this.client.isArmed,
        resyncInFlight: this.client.resyncInFlight,
      };
    }
    const nested = this.client.getNestedApply(contextId);
    if (!nested) {
      return {
        contextId,
        sequence: 0,
        generation: 0,
        table: digestReplicatedTable(this.client.getLiveRegistry() as never),
        desynced: true,
        applyError: 'nested_context_missing',
        armed: false,
        resyncInFlight: false,
      };
    }
    return {
      contextId,
      ...nested.snapshotTable(),
      desynced: nested.desynced,
      applyError: nested.applyError,
      armed: nested.isArmed,
      resyncInFlight: nested.resyncInFlight,
    };
  }

  nestedDocument(contextId: number): Document | null {
    if (contextId === CONTEXT_ID_ROOT) return this.client.document;
    const nested = this.client.getNestedApply(contextId);
    return nested?.isArmed ? nested.document : null;
  }

  /**
   * SEAL-CSSOM-P0-EOF: extra live rule with no table row.
   * Honest producer never emits this; CHECK after this must desync at end-of-frame verify.
   */
  tamperGhostCssRule(): { ok: boolean; reason?: string } {
    const adopted = this.client.document.adoptedStyleSheets;
    const sheet = adopted.length > 0 ? adopted[adopted.length - 1] : undefined;
    if (!sheet) return { ok: false, reason: 'tamper missed constructed sheet' };
    try {
      sheet.insertRule('.lab-ghost-eof{color:red}', 0);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}
