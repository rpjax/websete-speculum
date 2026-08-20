/**
 * Nested Projected apply — one instance per child contextId, targeting the blank host document.
 * Parent installs this after NODE_NEW of a nested host (same-origin blank iframe).
 */

import {
  decodeFramePart,
  FramePartAssembler,
  PersistentStringTable,
  type AssembledFrame,
} from '../models/decode';
import { DomFrameApplier } from './applyDom';
import { PageProjectionRegistry } from './registry';
import { DOCUMENT_ID } from '../models/frame';
import { OpCode } from '../models/opcodes';
import { digestReplicatedTable } from '../models/tableDigest';

export type NestedProjectedApplyOptions = {
  document: Document;
  contextId: number;
  onArmed?: () => void;
  onNestedHost?: (iframe: HTMLIFrameElement, childScopeId: number) => void;
  onNestedHostDrop?: (childScopeId: number) => void;
  onRequestResync?: (info: {
    contextId: number;
    generation: number;
    sequence: number;
    reason: string;
  }) => void;
};

export class NestedProjectedApply {
  readonly contextId: number;
  private persistent = new PersistentStringTable();
  private assembler = new FramePartAssembler();
  private registry: PageProjectionRegistry;
  private applier: DomFrameApplier;
  private generation = 1;
  private lastSequence = 0;
  private armed = false;
  private everArmed = false;
  private readonly onArmedCb?: () => void;
  private readonly onNestedHostCb?: NestedProjectedApplyOptions['onNestedHost'];
  private readonly onNestedHostDropCb?: NestedProjectedApplyOptions['onNestedHostDrop'];
  private readonly onRequestResyncCb?: NestedProjectedApplyOptions['onRequestResync'];

  constructor(opts: NestedProjectedApplyOptions) {
    this.contextId = opts.contextId;
    this.onArmedCb = opts.onArmed;
    this.onNestedHostCb = opts.onNestedHost;
    this.onNestedHostDropCb = opts.onNestedHostDrop;
    this.onRequestResyncCb = opts.onRequestResync;
    this.registry = new PageProjectionRegistry();
    this.registry.register(DOCUMENT_ID, opts.document);
    this.applier = this.createApplier(opts.document, this.registry);
  }

  get isArmed(): boolean {
    return this.armed;
  }

  get document(): Document {
    return this.registry.get(DOCUMENT_ID) as Document;
  }

  ingest(bytes: Uint8Array): void {
    const decoded = decodeFramePart(bytes, this.persistent);
    if (!decoded.ok) {
      this.desync(decoded.reason);
      return;
    }
    if (decoded.part.contextId !== this.contextId) return;
    const assembled = this.assembler.ingest(decoded.part);
    if (assembled === 'missing_part' || assembled === 'malformed') {
      this.desync(assembled);
      return;
    }
    if (assembled === null) return;
    this.applyAssembled(assembled);
    this.applier.flush();
  }

  flush(): void {
    this.applier.flush();
  }

  snapshotTable(): {
    sequence: number;
    generation: number;
    table: ReturnType<typeof digestReplicatedTable>;
  } {
    return {
      sequence: this.lastSequence,
      generation: this.generation,
      table: digestReplicatedTable(this.applier.replicatedTable),
    };
  }

  dispose(): void {
    this.applier.reset();
  }

  private createApplier(doc: Document, registry: PageProjectionRegistry): DomFrameApplier {
    return new DomFrameApplier(doc, registry, {
      onDesync: (info) => this.desync(info.reason),
      onNestedHost: (iframe, childScopeId) => this.onNestedHostCb?.(iframe, childScopeId),
      onNestedHostDrop: (childScopeId) => this.onNestedHostDropCb?.(childScopeId),
      onApplied: (frame) => {
        this.lastSequence = frame.sequence;
        this.generation = frame.generation;
        if (!this.armed) {
          this.armed = true;
          this.everArmed = true;
          this.onArmedCb?.();
        }
      },
    });
  }

  private applyAssembled(frame: AssembledFrame): void {
    if (frame.resync && this.everArmed) {
      const doc = this.registry.get(DOCUMENT_ID) as Document | undefined;
      if (!doc) {
        this.desync('missing_document');
        return;
      }
      this.applier.reset();
      this.assembler.reset();
      this.persistent = new PersistentStringTable();
      this.registry = new PageProjectionRegistry();
      this.registry.register(DOCUMENT_ID, doc);
      this.applier = this.createApplier(doc, this.registry);
      this.lastSequence = 0;
    }
    if (frame.generation !== this.generation) {
      const firstOp = frame.ops[0];
      const isEpochReset = firstOp !== undefined && firstOp.op === OpCode.EpochReset;
      if (!isEpochReset || firstOp.generation !== frame.generation) {
        this.desync('generation_mismatch');
        return;
      }
      this.generation = frame.generation;
      this.lastSequence = frame.sequence - 1;
    }
    this.applier.enqueue(frame);
  }

  private desync(reason: string): void {
    this.onRequestResyncCb?.({
      contextId: this.contextId,
      generation: this.generation,
      sequence: this.lastSequence,
      reason,
    });
  }
}
