/**
 * V4 Virtual node resolve — maps (contextId, nodeId) to a live Element in the producer realm.
 * Input plane only; does not modify the projection algorithm.
 */

import type { ElementHandle, Frame, Page } from 'patchright';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';

export type VirtualTargetResolver = {
  resolve(targetId: number, contextId: number): Promise<ElementHandle | null>;
};

function resolveTargetExpr(contextId: number, targetId: number): string {
  const argsJson = JSON.stringify({ contextId, id: targetId });
  return `((args) => {
    const p = globalThis.__speculumProjection;
    if (!p || p.contextId !== args.contextId) return null;
    return p.domNodes.get(args.id) ?? null;
  })(${argsJson})`;
}

async function frameContextId(frame: Frame): Promise<number | null> {
  try {
    return await frame.evaluate(() => {
      const p = (globalThis as { __speculumProjection?: { contextId?: number } }).__speculumProjection;
      return typeof p?.contextId === 'number' ? p.contextId : null;
    });
  } catch {
    return null;
  }
}

export async function findFrameForContext(page: Page, contextId: number): Promise<Frame | null> {
  if (contextId === CONTEXT_ID_ROOT) return page.mainFrame();
  for (let attempt = 0; attempt < 120; attempt++) {
    for (const frame of page.frames()) {
      const id = await frameContextId(frame);
      if (id === contextId) return frame;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

export function createVirtualTargetResolver(page: Page): VirtualTargetResolver {
  return {
    async resolve(targetId: number, contextId: number): Promise<ElementHandle | null> {
      if (targetId <= 0) return null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const frame = await findFrameForContext(page, contextId);
        const frames = frame ? [frame] : page.frames();
        for (const f of frames) {
          try {
            const handle = await f.evaluateHandle(resolveTargetExpr(contextId, targetId));
            const element = handle.asElement() as ElementHandle | null;
            if (element) return element;
            await handle.dispose().catch(() => undefined);
          } catch {
            /* detached */
          }
        }
        await new Promise((r) => setTimeout(r, 16 * (attempt + 1)));
      }
      return null;
    },
  };
}
