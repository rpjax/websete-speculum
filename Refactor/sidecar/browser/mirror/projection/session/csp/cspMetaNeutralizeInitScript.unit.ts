import assert from 'assert';
import { META_CSP_NEUTRALIZE_BODY } from '../../inject/injectScriptBodies';

export async function runCspMetaNeutralizeInitScriptUnitTests(): Promise<void> {
  assert.ok(META_CSP_NEUTRALIZE_BODY.includes('speculum_setAttribute'));
  assert.ok(META_CSP_NEUTRALIZE_BODY.includes('appendChild'));
  assert.ok(META_CSP_NEUTRALIZE_BODY.includes('insertBefore'));
  assert.ok(META_CSP_NEUTRALIZE_BODY.includes('setAttribute'));
  assert.ok(META_CSP_NEUTRALIZE_BODY.includes('content-security-policy'));
  assert.ok(META_CSP_NEUTRALIZE_BODY.includes('isCspMeta'));
  console.log('[unit] cspMetaNeutralizeInitScript ok');
}
