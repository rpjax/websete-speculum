/**
 * Unit coverage for F1 CDP pierce helpers (remap / XO attach / walk).
 */
import assert from 'node:assert/strict';
import {
  attachChildUnderIframe,
  collectXoIframeIds,
  maxRawNodeId,
  remapPierceTree,
  walkCdpClosedShadows,
  type PierceRawNode,
} from './cdpPierce';

export function runCdpPierceUnit(): void {
  const pairs: Array<{ hostId: number; shadowId: number }> = [];
  walkCdpClosedShadows(
    {
      nodeId: 1,
      shadowRoots: [{ nodeId: 2, shadowRootType: 'closed', children: [] }],
      children: [{ nodeId: 3, shadowRoots: [{ nodeId: 4, shadowRootType: 'open' }] }],
    },
    pairs,
  );
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0], { hostId: 1, shadowId: 2 });

  const child: PierceRawNode = {
    kind: 'element',
    id: 10,
    tag: 'html',
    attrs: [],
    children: [{ kind: 'text', id: 11, value: 'xo' }],
  };
  const idMap = new Map<number, number>();
  const remapped = remapPierceTree(child, { value: 100 }, idMap);
  assert.equal(remapped.id, 100);
  assert.equal(idMap.get(10), 100);
  assert.equal(idMap.get(11), 101);
  assert.equal(maxRawNodeId(remapped), 101);

  const root: PierceRawNode = {
    kind: 'element',
    id: 1,
    tag: 'html',
    attrs: [],
    children: [
      {
        kind: 'element',
        id: 2,
        tag: 'iframe',
        attrs: [],
        children: [],
        xo: true,
      },
    ],
  };
  assert.deepEqual(collectXoIframeIds(root), [2]);
  assert.equal(attachChildUnderIframe(root, 2, remapped), true);
  const iframe = root.children[0];
  assert.ok(iframe && iframe.kind === 'element');
  assert.equal(iframe.children.length, 1);
  assert.equal(collectXoIframeIds(root).length, 0);
}
