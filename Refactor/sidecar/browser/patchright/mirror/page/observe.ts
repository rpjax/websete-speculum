import type { NodeId } from './identity';

/**
 * §5.3.2 — per-frame dirty accumulation types, plus the glue that turns raw
 * mutation-observer-shaped records and state-sensor events into dirty marks.
 * Kept DOM-agnostic (generic `TNode`) and the observer itself is injected, so
 * this unit-tests without a real `window` (per the redesign's own directive).
 */

export type ScrollSample = { x: number; y: number };

/** Sentinel scrollDirty key for the document viewport — `0` is otherwise reserved as "no id". */
export const VIEWPORT_SCROLL_TARGET: NodeId = 0;

export type DirtyState = {
  newIds: Set<NodeId>;
  dirtyParents: Set<NodeId>;
  attrDirty: Set<NodeId>;
  textDirty: Set<NodeId>;
  stateDirty: Set<NodeId>;
  scrollDirty: Map<NodeId, ScrollSample>;
  detached: Set<NodeId>;
};

export function createDirtyState(): DirtyState {
  return {
    newIds: new Set(),
    dirtyParents: new Set(),
    attrDirty: new Set(),
    textDirty: new Set(),
    stateDirty: new Set(),
    scrollDirty: new Map(),
    detached: new Set(),
  };
}

export function resetDirtyState(state: DirtyState): void {
  state.newIds.clear();
  state.dirtyParents.clear();
  state.attrDirty.clear();
  state.textDirty.clear();
  state.stateDirty.clear();
  state.scrollDirty.clear();
  state.detached.clear();
}

// ---------------------------------------------------------------- mutation-record-like input

export type MutationKind = 'childList' | 'attributes' | 'characterData';

/** Duck-typed `MutationRecord` — real DOM records satisfy this without a `dom` lib import. */
export type MutationRecordLike<TNode extends object = object> = {
  type: MutationKind;
  target: TNode;
  addedNodes?: ArrayLike<TNode>;
  removedNodes?: ArrayLike<TNode>;
};

export type IdentityReader<TNode extends object = object> = {
  idOf(node: TNode): NodeId;
};

/**
 * §5.3.2 — "records for nodes F does not publish MUST be discarded at the top
 * of the callback, before any identity, addressing or payload work" (PP-FR-5).
 * `isPublishable` is the caller's placeholder/deny-list test (fmap-driven).
 */
export function discardNonPublished<TNode extends object>(
  target: TNode,
  isPublishable: (node: TNode) => boolean,
): boolean {
  return !isPublishable(target);
}

/**
 * Folds one mutation-record-like input into the dirty state. `newIds` /
 * `detached` for added/removed nodes are the caller's responsibility once it
 * has allocated (or looked up) ids for them — this function only marks what
 * it can resolve through the reverse map, per §5.1: a node never published
 * has no id and is silently skipped (it will surface as a `dirtyParents`
 * child once F actually publishes it).
 */
export function markMutation<TNode extends object>(
  state: DirtyState,
  identity: IdentityReader<TNode>,
  record: MutationRecordLike<TNode>,
): void {
  if (record.type === 'childList') {
    const parentId = identity.idOf(record.target);
    if (parentId !== 0) state.dirtyParents.add(parentId);
    return;
  }
  const nodeId = identity.idOf(record.target);
  if (nodeId === 0) return;
  if (record.type === 'attributes') state.attrDirty.add(nodeId);
  else if (record.type === 'characterData') state.textDirty.add(nodeId);
}

export function markNewId(state: DirtyState, id: NodeId): void {
  state.newIds.add(id);
}

export function markDetached(state: DirtyState, id: NodeId): void {
  state.detached.add(id);
}

export function markScroll(state: DirtyState, target: NodeId, sample: ScrollSample): void {
  state.scrollDirty.set(target, sample);
}

// ---------------------------------------------------------------- §5.2.1 state sensors

/**
 * "A sensor firing marks the node in `stateDirty` and nothing more — no
 * payload work in the event handler" (§5.2.1). The full snapshot is built
 * later, at flush, from the current live state.
 */
export function createStateSensor<TNode extends object>(
  state: DirtyState,
  identity: IdentityReader<TNode>,
): (node: TNode) => void {
  return (node: TNode) => {
    const id = identity.idOf(node);
    if (id !== 0) state.stateDirty.add(id);
  };
}

export type StateSensorEventName =
  | 'input'
  | 'change'
  | 'toggle'
  | 'close'
  | 'play'
  | 'pause'
  | 'volumechange'
  | 'timeupdate'
  | 'seeked';

/** §5.2.1 — the exhaustive sensor event list; extending it requires a demonstrated divergence case. */
export const STATE_SENSOR_EVENTS: readonly StateSensorEventName[] = [
  'input',
  'change',
  'toggle',
  'close',
  'play',
  'pause',
  'volumechange',
  'timeupdate',
  'seeked',
];

// ---------------------------------------------------------------- injectable observer install

export type MutationObserverInitLike = {
  childList?: boolean;
  attributes?: boolean;
  characterData?: boolean;
  subtree?: boolean;
};

export type MutationObserverLike<TNode extends object = object> = {
  observe(target: TNode, options: MutationObserverInitLike): void;
  disconnect(): void;
};

export type InstallMutationObserverOptions<TNode extends object = object> = {
  /** Injected so unit tests never need a real `window.MutationObserver`. */
  createObserver(
    callback: (records: ReadonlyArray<MutationRecordLike<TNode>>) => void,
  ): MutationObserverLike<TNode>;
  root: TNode;
  init?: MutationObserverInitLike;
};

const DEFAULT_OBSERVER_INIT: MutationObserverInitLike = {
  childList: true,
  attributes: true,
  characterData: true,
  subtree: true,
};

export function installMutationObserver<TNode extends object>(
  opts: InstallMutationObserverOptions<TNode>,
  onRecords: (records: ReadonlyArray<MutationRecordLike<TNode>>) => void,
): MutationObserverLike<TNode> {
  const observer = opts.createObserver(onRecords);
  observer.observe(opts.root, opts.init ?? DEFAULT_OBSERVER_INIT);
  return observer;
}
