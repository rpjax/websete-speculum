import assert from 'assert';
import { META_CSP_NEUTRALIZE_BODY, SINGLE_TAB_BODY } from './injectScriptBodies';

export async function runInjectScriptBodiesUnitTests(): Promise<void> {
  assert.ok(META_CSP_NEUTRALIZE_BODY.includes('speculum_setAttribute'));
  assert.ok(META_CSP_NEUTRALIZE_BODY.includes('appendChild'));
  assert.ok(SINGLE_TAB_BODY.includes('speculum_single_tab_open'));
  console.log('[unit] injectScriptBodies ok');
}
