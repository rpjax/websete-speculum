import type { BrowserSessionFactory } from '../BrowserSession';
import { DisplayAllocator } from './Display';
import { PatchrightBrowserSession } from './PatchrightBrowserSession';

export function createPatchrightFactory(
  displays = new DisplayAllocator(),
): BrowserSessionFactory {
  return {
    create(sessionId, events) {
      return new PatchrightBrowserSession(sessionId, events, displays);
    },
  };
}
