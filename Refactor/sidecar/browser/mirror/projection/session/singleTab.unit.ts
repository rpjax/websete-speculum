/**
 * Unit: single-tab body folds target=_blank / window.open into same-tab href.
 */

import assert from 'assert';
import { SINGLE_TAB_BODY } from '../inject/injectScriptBodies';

export async function runSingleTabUnitTests(): Promise<void> {
  assert.ok(SINGLE_TAB_BODY.includes('speculum_single_tab_open'));
  assert.ok(SINGLE_TAB_BODY.includes("target=_blank") || SINGLE_TAB_BODY.includes("'_blank'"));
  assert.ok(SINGLE_TAB_BODY.includes('window.location.href'));
  assert.ok(SINGLE_TAB_BODY.includes('preventDefault'));
  console.log('[unit] singleTab init script contract ok');
}
