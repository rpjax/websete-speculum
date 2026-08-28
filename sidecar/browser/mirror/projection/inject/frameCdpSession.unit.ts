import assert from 'assert';
import type { BrowserContext, Frame, Page } from 'patchright';
import {
  attachFrameCdp,
  createFrameCdpAttachState,
  wireFrameCdpLifecycle,
} from '../session/frameCdpSession';

export async function runFrameCdpSessionUnitTests(): Promise<void> {
  const state = createFrameCdpAttachState();
  const mainFrame = {} as Frame;
  const childFrame = {} as Frame;
  let sessionCount = 0;

  const page = {
    mainFrame: () => mainFrame,
    frames: () => [mainFrame, childFrame],
    on: () => {},
  } as unknown as Page;

  const context = {
    newCDPSession: async (frame: Frame) => {
      sessionCount += 1;
      assert.strictEqual(frame, childFrame);
      return { id: 'frame-cdp' } as never;
    },
  } as unknown as BrowserContext;

  const first = await attachFrameCdp(childFrame, page, context, state);
  const second = await attachFrameCdp(childFrame, page, context, state);
  assert.strictEqual(sessionCount, 1, 'attach must be idempotent');
  assert.strictEqual(first, second);

  const main = await attachFrameCdp(mainFrame, page, context, state);
  assert.strictEqual(main, null);

  let wired = 0;
  await wireFrameCdpLifecycle({
    page,
    context,
    state,
    onFrameSession: async (frame) => {
      if (frame === childFrame) wired += 1;
    },
  });
  assert.strictEqual(wired, 1, 'wire must attach existing child frame once');

  console.log('[unit] frameCdpSession ok');
}
