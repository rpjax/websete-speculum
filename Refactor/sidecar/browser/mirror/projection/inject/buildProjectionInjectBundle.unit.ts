import assert from 'assert';
import { INJECT_SENTINEL_COMMENT, INJECT_SENTINEL_MARKER } from './injectSentinel';
import { buildProjectionInjectBundle } from './buildProjectionInjectBundle';
import { META_CSP_NEUTRALIZE_BODY, SINGLE_TAB_BODY } from './injectScriptBodies';

export async function runBuildProjectionInjectBundleUnitTests(): Promise<void> {
  const bundle = buildProjectionInjectBundle({
    config: {
      sessionId: 'sess-1',
      transport: 'loopback',
      dataPlaneUrl: 'ws://127.0.0.1:40133/',
      planeBridgeToken: '550e8400-e29b-41d4-a716-446655440000',
      generation: 1,
    },
    includeCspDiag: false,
  });

  assert.ok(bundle.startsWith(INJECT_SENTINEL_COMMENT));
  assert.ok(bundle.includes(INJECT_SENTINEL_MARKER));
  assert.ok(bundle.includes('__speculumScrubInjectScripts'));
  assert.ok(bundle.includes(META_CSP_NEUTRALIZE_BODY.slice(0, 40)));
  assert.ok(bundle.includes(SINGLE_TAB_BODY.slice(0, 30)));
  assert.ok(bundle.includes('globalThis.__SPECULUM_PROJECTION__'));
  assert.ok(bundle.includes('speculum_pp_inject_boot'));
  assert.ok(bundle.includes('speculum_extension_plane_shim'));
  assert.ok(!bundle.includes('<script'));

  const withDiag = buildProjectionInjectBundle({
    config: {
      sessionId: 'sess-1',
      transport: 'loopback',
      dataPlaneUrl: 'ws://127.0.0.1:40133/',
      planeBridgeToken: '550e8400-e29b-41d4-a716-446655440000',
    },
    includeCspDiag: true,
  });
  assert.ok(withDiag.includes('speculum_csp_diag_probe'));

  console.log('[unit] buildProjectionInjectBundle ok');
}
