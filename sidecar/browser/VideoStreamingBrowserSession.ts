/**
 * VideoStreamingBrowserSession — sealed video mirror mode.
 * Lifts {@link PatchrightBrowserSession} (Xvfb + screencast + OS/Patchright input).
 * PageProjection must not use this class.
 */

import { PatchrightBrowserSession } from './patchright/PatchrightBrowserSession';
import type { DisplayAllocator } from './patchright/Display';
import type { BrowserSessionEvents } from './BrowserSession';

export class VideoStreamingBrowserSession extends PatchrightBrowserSession {
  constructor(sessionId: string, events: BrowserSessionEvents, displays: DisplayAllocator) {
    super(sessionId, events, displays);
  }
}

export { createPatchrightFactory as createVideoStreamingBrowserSessionFactory } from './patchright/createPatchrightFactory';
