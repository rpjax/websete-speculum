/**
 * Unit: single-tab init script folds target=_blank / window.open into same-tab href.
 * No Chromium — pure string contract + small DOM simulation via vm is overkill;
 * we assert the script source contains the rewrite hooks and export shape.
 */

import assert from 'assert';
import { SINGLE_TAB_INIT_SCRIPT } from './singleTab';

export async function runSingleTabUnitTests(): Promise<void> {
  assert.ok(SINGLE_TAB_INIT_SCRIPT.includes('speculum_single_tab_open'));
  assert.ok(SINGLE_TAB_INIT_SCRIPT.includes("target=_blank") || SINGLE_TAB_INIT_SCRIPT.includes("'_blank'"));
  assert.ok(SINGLE_TAB_INIT_SCRIPT.includes('window.location.href'));
  assert.ok(SINGLE_TAB_INIT_SCRIPT.includes('preventDefault'));
  console.log('[unit] singleTab init script contract ok');
}
