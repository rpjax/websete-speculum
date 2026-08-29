/**
 * Unit: single-tab body folds target=_blank / window.open into same-tab href.
 * Plus: freshPage replace must suspend the orphan closer (browse.navigate crash).
 */

import assert from 'assert';
import { EventEmitter } from 'node:events';
import type { BrowserContext, Page } from 'patchright';
import { SINGLE_TAB_BODY } from '../inject/injectScriptBodies';
import {
  beginPrimaryPageReplace,
  commitPrimaryPageReplace,
  installSingleTabAdoption,
} from './singleTab';

export async function runSingleTabUnitTests(): Promise<void> {
  assert.ok(SINGLE_TAB_BODY.includes('speculum_single_tab_open'));
  assert.ok(SINGLE_TAB_BODY.includes("target=_blank") || SINGLE_TAB_BODY.includes("'_blank'"));
  assert.ok(SINGLE_TAB_BODY.includes('window.location.href'));
  assert.ok(SINGLE_TAB_BODY.includes('preventDefault'));

  const context = new EventEmitter() as EventEmitter & BrowserContext;
  const primary = { url: () => 'http://127.0.0.1/a' } as Page;
  let closed = 0;
  const orphan = {
    url: () => 'about:blank',
    waitForURL: async () => {
      throw new Error('timeout');
    },
    close: async () => {
      closed += 1;
    },
  } as unknown as Page;

  installSingleTabAdoption({
    page: primary,
    context,
    adoptUrlOnPrimary: async () => {
      throw new Error('should not adopt during replace');
    },
  });

  // Armed: second page is closed.
  context.emit('page', orphan);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(closed, 1, 'orphan tab must close when not replacing');

  // Suspended (freshPage): second page kept.
  closed = 0;
  beginPrimaryPageReplace(context);
  const replacement = {
    url: () => 'about:blank',
    waitForURL: async () => {
      throw new Error('timeout');
    },
    close: async () => {
      closed += 1;
    },
  } as unknown as Page;
  context.emit('page', replacement);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(closed, 0, 'replacement primary must not be closed during freshPage');

  commitPrimaryPageReplace(context, replacement, async () => {});
  const stray = {
    url: () => 'https://example.com/popup',
    waitForURL: async () => 'https://example.com/popup',
    close: async () => {
      closed += 1;
    },
  } as unknown as Page;
  let adopted: string | null = null;
  commitPrimaryPageReplace(context, replacement, async (url) => {
    adopted = url;
  });
  context.emit('page', stray);
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(closed, 1, 'after commit, orphan tabs close again');
  assert.strictEqual(adopted, 'https://example.com/popup');

  console.log('[unit] singleTab init script contract ok');
}
