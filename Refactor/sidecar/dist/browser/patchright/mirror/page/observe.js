"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATE_SENSOR_EVENTS = exports.VIEWPORT_SCROLL_TARGET = void 0;
exports.createDirtyState = createDirtyState;
exports.resetDirtyState = resetDirtyState;
exports.discardNonPublished = discardNonPublished;
exports.markMutation = markMutation;
exports.markNewId = markNewId;
exports.markDetached = markDetached;
exports.markScroll = markScroll;
exports.createStateSensor = createStateSensor;
exports.installMutationObserver = installMutationObserver;
/** Sentinel scrollDirty key for the document viewport — `0` is otherwise reserved as "no id". */
exports.VIEWPORT_SCROLL_TARGET = 0;
function createDirtyState() {
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
function resetDirtyState(state) {
    state.newIds.clear();
    state.dirtyParents.clear();
    state.attrDirty.clear();
    state.textDirty.clear();
    state.stateDirty.clear();
    state.scrollDirty.clear();
    state.detached.clear();
}
/**
 * §5.3.2 — "records for nodes F does not publish MUST be discarded at the top
 * of the callback, before any identity, addressing or payload work" (PP-FR-5).
 * `isPublishable` is the caller's placeholder/deny-list test (fmap-driven).
 */
function discardNonPublished(target, isPublishable) {
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
function markMutation(state, identity, record) {
    if (record.type === 'childList') {
        const parentId = identity.idOf(record.target);
        if (parentId !== 0)
            state.dirtyParents.add(parentId);
        return;
    }
    const nodeId = identity.idOf(record.target);
    if (nodeId === 0)
        return;
    if (record.type === 'attributes')
        state.attrDirty.add(nodeId);
    else if (record.type === 'characterData')
        state.textDirty.add(nodeId);
}
function markNewId(state, id) {
    state.newIds.add(id);
}
function markDetached(state, id) {
    state.detached.add(id);
}
function markScroll(state, target, sample) {
    state.scrollDirty.set(target, sample);
}
// ---------------------------------------------------------------- §5.2.1 state sensors
/**
 * "A sensor firing marks the node in `stateDirty` and nothing more — no
 * payload work in the event handler" (§5.2.1). The full snapshot is built
 * later, at flush, from the current live state.
 */
function createStateSensor(state, identity) {
    return (node) => {
        const id = identity.idOf(node);
        if (id !== 0)
            state.stateDirty.add(id);
    };
}
/** §5.2.1 — the exhaustive sensor event list; extending it requires a demonstrated divergence case. */
exports.STATE_SENSOR_EVENTS = [
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
const DEFAULT_OBSERVER_INIT = {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
};
function installMutationObserver(opts, onRecords) {
    const observer = opts.createObserver(onRecords);
    observer.observe(opts.root, opts.init ?? DEFAULT_OBSERVER_INIT);
    return observer;
}
//# sourceMappingURL=observe.js.map