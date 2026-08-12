"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.walkCdpClosedShadows = walkCdpClosedShadows;
exports.adoptClosedShadowPair = adoptClosedShadowPair;
exports.adoptAllClosedShadowsFromCdp = adoptAllClosedShadowsFromCdp;
exports.remapPierceTree = remapPierceTree;
exports.maxRawNodeId = maxRawNodeId;
exports.collectXoIframeIds = collectXoIframeIds;
exports.attachChildUnderIframe = attachChildUnderIframe;
function walkCdpClosedShadows(node, out) {
    const hostId = node.nodeId;
    if (hostId != null && Array.isArray(node.shadowRoots)) {
        for (const sr of node.shadowRoots) {
            if (sr.shadowRootType === 'closed' && sr.nodeId != null) {
                out.push({ hostId, shadowId: sr.nodeId });
            }
            walkCdpClosedShadows(sr, out);
        }
    }
    if (node.contentDocument)
        walkCdpClosedShadows(node.contentDocument, out);
    if (Array.isArray(node.children)) {
        for (const child of node.children)
            walkCdpClosedShadows(child, out);
    }
}
/** Inject host+closed ShadowRoot into the V2 in-page WeakMap via Runtime.callFunctionOn. */
async function adoptClosedShadowPair(cdp, hostNodeId, shadowNodeId) {
    try {
        const hostResolved = (await cdp.send('DOM.resolveNode', { nodeId: hostNodeId }));
        const shadowResolved = (await cdp.send('DOM.resolveNode', { nodeId: shadowNodeId }));
        const hostId = hostResolved.object?.objectId;
        const shadowId = shadowResolved.object?.objectId;
        if (!hostId || !shadowId)
            return;
        await cdp.send('Runtime.callFunctionOn', {
            objectId: hostId,
            arguments: [{ objectId: shadowId }],
            functionDeclaration: `function(shadow) {
        var api = window.__speculumPageProjectionV2;
        if (!api || typeof api.adoptClosedShadow !== 'function') {
          try {
            if (window.top && window.top.__speculumPageProjectionV2
              && typeof window.top.__speculumPageProjectionV2.adoptClosedShadow === 'function') {
              api = window.top.__speculumPageProjectionV2;
            }
          } catch (e) {}
        }
        return api && typeof api.adoptClosedShadow === 'function' && api.adoptClosedShadow(this, shadow);
      }`,
            returnByValue: true,
        });
    }
    catch {
        /* node may have been collected mid-flight */
    }
}
/** Walk the pierced CDP document and adopt every closed shadow root. */
async function adoptAllClosedShadowsFromCdp(cdp) {
    const doc = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true }));
    if (!doc.root)
        return 0;
    const pairs = [];
    walkCdpClosedShadows(doc.root, pairs);
    for (const pair of pairs) {
        await adoptClosedShadowPair(cdp, pair.hostId, pair.shadowId);
    }
    return pairs.length;
}
/** Remap a child-frame raw tree into a fresh id space that does not collide with the parent. */
function remapPierceTree(node, nextId, idMap) {
    const mappedId = nextId.value++;
    idMap.set(node.id, mappedId);
    if (node.kind === 'text' || node.kind === 'comment') {
        return { kind: node.kind, id: mappedId, value: node.value };
    }
    return {
        kind: 'element',
        id: mappedId,
        tag: node.tag,
        attrs: node.attrs,
        children: node.children.map((c) => remapPierceTree(c, nextId, idMap)),
        shadowRoot: node.shadowRoot,
        shadowClosed: node.shadowClosed,
        state: node.state,
    };
}
function maxRawNodeId(node) {
    if (!node)
        return 0;
    let max = node.id;
    if (node.kind === 'element') {
        for (const c of node.children)
            max = Math.max(max, maxRawNodeId(c));
    }
    return max;
}
function collectXoIframeIds(node, out = []) {
    if (!node || node.kind !== 'element')
        return out;
    if (node.tag === 'iframe' && (node.xo || node.children.length === 0))
        out.push(node.id);
    for (const c of node.children)
        collectXoIframeIds(c, out);
    return out;
}
function attachChildUnderIframe(root, iframeId, child) {
    if (root.kind !== 'element')
        return false;
    if (root.id === iframeId) {
        root.children = [child];
        delete root.xo;
        return true;
    }
    for (const c of root.children) {
        if (attachChildUnderIframe(c, iframeId, child))
            return true;
    }
    return false;
}
//# sourceMappingURL=cdpPierce.js.map