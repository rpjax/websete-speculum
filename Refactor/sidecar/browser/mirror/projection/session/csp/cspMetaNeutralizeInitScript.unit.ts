import assert from 'assert';
import { CSP_META_NEUTRALIZE_INIT_SCRIPT } from './cspMetaNeutralizeInitScript';

export async function runCspMetaNeutralizeInitScriptUnitTests(): Promise<void> {
  assert.ok(CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('speculum_csp_meta_neutralize'));
  assert.ok(CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('appendChild'));
  assert.ok(CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('insertBefore'));
  assert.ok(CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('setAttribute'));
  assert.ok(CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('content-security-policy'));
  assert.ok(CSP_META_NEUTRALIZE_INIT_SCRIPT.includes('isCspMeta'));
  console.log('[unit] cspMetaNeutralize init script contract ok');
}
