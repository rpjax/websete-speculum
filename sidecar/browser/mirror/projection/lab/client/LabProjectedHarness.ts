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
import { digestReplicatedTable } from '@speculum/page-projection/core/tableDigest';
import {
  measureTurnstileRootRectsFromDocument,
  sampleTurnstileElement,
  sampleTurnstilePaint,
  type TurnstilePaintSample,
  type TurnstileRectSample,
} from '../probes/turnstilePierce';

export type LabProjectedHarnessOptions = ProjectionClientOptions;

export class LabProjectedHarness {
  readonly client: ProjectionClient;

  private constructor(client: ProjectionClient) {
    this.client = client;
  }

  static async create(opts: LabProjectedHarnessOptions): Promise<LabProjectedHarness> {
    const client = await createProjectionClient(opts);
    return new LabProjectedHarness(client);
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

  async reset(): Promise<void> {
    await this.client.reset();
  }

  /** @deprecated alias — prefer {@link reset} */
  async resetSurface(): Promise<void> {
    await this.client.reset();
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

  /**
   * Lab diag — registry-grounded materialization probe for nested apply.
   * Uses applier registry (has closed ShadowRoot refs), not body.childNodes —
   * body as shadow host legitimately has 0 light children.
   */
  probeNestedRegistry(
    contextId: number,
    nodeIds: number[],
  ): {
    contextId: number;
    ok: boolean;
    reason?: string;
    registrySize: number;
    applierSequence: number;
    applierGeneration: number;
    applierTableHash: string;
    applierTableRows: number;
    applierDesynced: boolean;
    bodyLightChildCount: number;
    nodes: Array<{
      id: number;
      present: boolean;
      nodeType: string | null;
      tagName: string | null;
      childCount: number | null;
      isShadowRoot: boolean;
      shadowHostId: number | null;
      hostMatchesId: number | null;
      rect: { x: number; y: number; width: number; height: number } | null;
    }>;
  } {
    if (contextId === CONTEXT_ID_ROOT) {
      return {
        contextId,
        ok: false,
        reason: 'use_root_snapshot_for_context_1',
        registrySize: 0,
        applierSequence: 0,
        applierGeneration: 0,
        applierTableHash: '0',
        applierTableRows: 0,
        applierDesynced: false,
        bodyLightChildCount: 0,
        nodes: [],
      };
    }
    const nested = this.client.getNestedApply(contextId);
    if (!nested) {
      return {
        contextId,
        ok: false,
        reason: 'nested_context_missing',
        registrySize: 0,
        applierSequence: 0,
        applierGeneration: 0,
        applierTableHash: '0',
        applierTableRows: 0,
        applierDesynced: true,
        bodyLightChildCount: 0,
        nodes: [],
      };
    }
    const registry = nested.registry;
    const snap = nested.snapshotTable();
    const doc = nested.document;
    const body = doc.body;
    const bodyLightChildCount = body?.childNodes.length ?? 0;

    const nodes = nodeIds.map((id) => {
      const node = registry.get(id);
      if (!node) {
        return {
          id,
          present: false,
          nodeType: null,
          tagName: null,
          childCount: null,
          isShadowRoot: false,
          shadowHostId: null,
          hostMatchesId: null,
          rect: null,
        };
      }
      const isShadowRoot = node.nodeType === Node.DOCUMENT_FRAGMENT_NODE;
      let shadowHostId: number | null = null;
      if (isShadowRoot) {
        const host = (node as ShadowRoot).host;
        shadowHostId = host ? (registry.idOf(host) ?? null) : null;
      }
      let rect: { x: number; y: number; width: number; height: number } | null = null;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const r = (node as Element).getBoundingClientRect();
        rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return {
        id,
        present: true,
        nodeType:
          node.nodeType === Node.ELEMENT_NODE
            ? 'ELEMENT'
            : node.nodeType === Node.TEXT_NODE
              ? 'TEXT'
              : node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
                ? 'SHADOW_ROOT'
                : String(node.nodeType),
        tagName: node.nodeType === Node.ELEMENT_NODE ? (node as Element).tagName.toLowerCase() : null,
        childCount: node.childNodes.length,
        isShadowRoot,
        shadowHostId,
        hostMatchesId: shadowHostId,
        rect,
      };
    });

    return {
      contextId,
      ok: true,
      registrySize: registry.size,
      applierSequence: snap.sequence,
      applierGeneration: snap.generation,
      applierTableHash: snap.table.tableHash,
      applierTableRows: snap.table.rowCount,
      applierDesynced: nested.desynced,
      bodyLightChildCount,
      nodes,
    };
  }

  /**
   * Lab diag — root Turnstile rects with closed-shadow pierce (symmetric to Virtual measureTurnstileRootRects).
   */
  measureTurnstileRootRects(): { ok: boolean; levels: TurnstileRectSample[] } {
    return { ok: true, levels: measureTurnstileRootRectsFromDocument(this.client.document) };
  }

  /** Lab diag — computed style on nested widget node (registry ref, not querySelector). */
  probeWidgetPaint(
    nestedContextId: number,
    widgetNodeId: number,
  ): { ok: boolean; reason?: string; paint: TurnstilePaintSample | null } {
    const nested = this.client.getNestedApply(nestedContextId);
    if (!nested) return { ok: false, reason: 'nested_context_missing', paint: null };
    const node = nested.registry.get(widgetNodeId);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return { ok: false, reason: 'widget_missing', paint: null };
    }
    return { ok: true, paint: sampleTurnstilePaint(node as Element) };
  }

  /**
   * Lab diag — rect ladder from nested widget up to root projected surface.
   * Root levels 3–5 use closed-shadow pierce (symmetric to Virtual).
   */
  probeRectLadder(
    nestedContextId: number,
    widgetNodeId: number,
  ): {
    contextId: number;
    ok: boolean;
    reason?: string;
    levels: Array<{
      level: number;
      name: string;
      ok: boolean;
      reason?: string;
      tagName?: string | null;
      rect: { x: number; y: number; width: number; height: number } | null;
      offsetWidth?: number | null;
      offsetHeight?: number | null;
      display?: string | null;
      visibility?: string | null;
      hasSrcAttr?: boolean | null;
      src?: string | null;
    }>;
  } {
    const toLevel = (sample: TurnstileRectSample, level: number) => ({
      level,
      name: sample.name,
      ok: sample.ok,
      reason: sample.reason,
      tagName: sample.tagName ?? null,
      rect: sample.rect ?? null,
      offsetWidth: sample.offsetWidth ?? null,
      offsetHeight: sample.offsetHeight ?? null,
      display: sample.display ?? null,
      visibility: sample.visibility ?? null,
      hasSrcAttr: sample.hasSrcAttr ?? null,
      src: sample.src ?? null,
    });

    const nested = this.client.getNestedApply(nestedContextId);
    if (!nested) {
      return { contextId: nestedContextId, ok: false, reason: 'nested_context_missing', levels: [] };
    }
    const widgetNode = nested.registry.get(widgetNodeId);
    const widgetEl =
      widgetNode && widgetNode.nodeType === Node.ELEMENT_NODE ? (widgetNode as Element) : null;

    const nestedLevels = [
      toLevel(sampleTurnstileElement(widgetEl, 'nested_widget_div'), 1),
      toLevel(sampleTurnstileElement(nested.document.documentElement, 'nested_documentElement'), 2),
    ];
    const rootLevels = this.measureTurnstileRootRects().levels.map((s, i) => toLevel(s, i + 3));
    return { contextId: nestedContextId, ok: true, levels: [...nestedLevels, ...rootLevels] };
  }

  /**
   * Lab diag — peek nested host bookkeeping (awaiting load vs bound nested).
   */
  peekNestedHosts(): {
    nested: number[];
    awaiting: number[];
    pendingFrames: Record<string, number>;
    sessions: Array<{
      contextId: number;
      armed: boolean;
      desynced: boolean;
      applyError: string | null;
      generation: number;
      compat: string | null;
      bodyLen: number;
      docIsLive: boolean | null;
      bodyChildCount: number | null;
      registryHasDocument: boolean | null;
      tableRowCount: number | null;
      tableHash: string | null;
    }>;
  } {
    const c = this.client as unknown as {
      nested: Map<
        number,
        {
          isArmed: boolean;
          desynced: boolean;
          applyError: string | null;
          getGeneration(): number;
          snapshotTable(): { table: { rowCount: number; tableHash: string } };
          hostIframe: HTMLIFrameElement;
          document: Document;
          registry: { get(id: number): Node | undefined };
        }
      >;
      nestedHostAwaitingLoad: Map<number, unknown>;
      pendingNestedFrames: Map<number, Uint8Array[]>;
    };
    const pendingFrames: Record<string, number> = {};
    for (const [id, q] of c.pendingNestedFrames) pendingFrames[String(id)] = q.length;
    const sessions = [...c.nested.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([contextId, s]) => {
        let compat: string | null = null;
        let bodyLen = 0;
        let docIsLive: boolean | null = null;
        let bodyChildCount: number | null = null;
        let registryHasDocument: boolean | null = null;
        let tableRowCount: number | null = null;
        let tableHash: string | null = null;
        try {
          const live = s.hostIframe.contentDocument;
          compat = live?.compatMode ?? null;
          bodyLen = live?.body?.innerHTML?.length ?? 0;
          bodyChildCount = live?.body?.childNodes?.length ?? 0;
          // Applier's document node (id 1) vs the iframe's current contentDocument.
          const regDoc = s.registry.get(1) ?? null;
          docIsLive = live != null && regDoc === live;
          registryHasDocument = regDoc != null;
          const snap = s.snapshotTable();
          tableRowCount = snap.table.rowCount;
          tableHash = snap.table.tableHash;
        } catch {
          compat = 'xo';
        }
        return {
          contextId,
          armed: s.isArmed,
          desynced: s.desynced,
          applyError: s.applyError,
          generation: s.getGeneration(),
          compat,
          bodyLen,
          docIsLive,
          bodyChildCount,
          registryHasDocument,
          tableRowCount,
          tableHash,
        };
      });
    return {
      nested: [...c.nested.keys()].sort((a, b) => a - b),
      awaiting: [...c.nestedHostAwaitingLoad.keys()].sort((a, b) => a - b),
      pendingFrames,
      sessions,
    };
  }

  /**
   * Lab diag — load-after-drop: drop must cancel the pending `load` bind so a later
   * navigation cannot leave a dangling awaiting-load entry. Relocated out of
   * {@link ProjectionClient} (product/web bundle) — same logic, driven through its private
   * nested-host bookkeeping via the same lab-only cast as {@link peekNestedHosts}.
   */
  forceLoadAfterDropRaceForDiag(contextId: number): {
    ok: boolean;
    reason?: string;
    afterInstallAwaiting: number[];
    afterDropAwaiting: number[];
  } {
    const c = this.client as unknown as {
      nested: Map<number, unknown>;
      nestedHostAwaitingLoad: Map<number, unknown>;
      installNestedHost(iframe: HTMLIFrameElement, contextId: number): void;
      dropNestedHost(contextId: number): void;
    };
    if (contextId === CONTEXT_ID_ROOT) {
      return {
        ok: false,
        reason: 'contextId_must_not_be_root',
        afterInstallAwaiting: [],
        afterDropAwaiting: [],
      };
    }
    if (c.nested.has(contextId) || c.nestedHostAwaitingLoad.has(contextId)) {
      return {
        ok: false,
        reason: 'contextId_in_use',
        afterInstallAwaiting: [...c.nestedHostAwaitingLoad.keys()].sort((a, b) => a - b),
        afterDropAwaiting: [],
      };
    }
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-lab-load-after-drop', String(contextId));
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    document.documentElement.appendChild(iframe);
    c.installNestedHost(iframe, contextId);
    const afterInstallAwaiting = [...c.nestedHostAwaitingLoad.keys()].sort((a, b) => a - b);
    c.dropNestedHost(contextId);
    const afterDropAwaiting = [...c.nestedHostAwaitingLoad.keys()].sort((a, b) => a - b);
    iframe.src = 'about:blank';
    return {
      ok: true,
      afterInstallAwaiting,
      afterDropAwaiting,
    };
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
