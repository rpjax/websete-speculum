import assert from 'assert';
import { INJECT_SENTINEL_COMMENT, INJECT_SENTINEL_MARKER, INJECT_ARM_GLOBAL } from './injectSentinel';
import { buildProjectionInjectBundle } from './buildProjectionInjectBundle';
import { META_CSP_NEUTRALIZE_BODY, SINGLE_TAB_BODY } from './injectScriptBodies';
import type { ResolvedLaunchScript } from './resolveLaunchScripts';

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
  assert.ok(bundle.includes(INJECT_ARM_GLOBAL));
  assert.ok(bundle.includes('speculum_pp_inject_once'), 'inject must wrap in arm IIFE');
  const onceIdx = bundle.indexOf('speculum_pp_inject_once');
  const preludeIdx = bundle.indexOf('speculum_pp_inject_boot');
  assert.ok(onceIdx >= 0 && preludeIdx > onceIdx, 'arm wrapper must enclose prelude');
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
  assert.ok(!/new WebSocket\s*\(\s*cfg\.dataPlaneUrl\s*\)/.test(withDiag));

  const launchScripts: ResolvedLaunchScript[] = [
    {
      file: '/kit/bad.js',
      wrappedSource: `
(function speculum_launch_bad() {
  'use strict';
  try {
    if (!__speculumLaunchUrlMatch([], location.href)) return;
    throw new Error('boom');
  } catch (_e) {}
})();
`,
      targetRulesJson: '[]',
    },
    {
      file: '/kit/ok.js',
      wrappedSource: `
(function speculum_launch_ok() {
  'use strict';
  try {
    if (!__speculumLaunchUrlMatch([], location.href)) return;
    globalThis.__LAUNCH_OK=1;
  } catch (_e) {}
})();
`,
      targetRulesJson: '[]',
    },
  ];

  const withCustoms = buildProjectionInjectBundle({
    config: {
      sessionId: 'sess-1',
      transport: 'loopback',
      dataPlaneUrl: 'ws://127.0.0.1:40133/',
      planeBridgeToken: '550e8400-e29b-41d4-a716-446655440000',
      generation: 2,
    },
    launchScripts,
  });

  const bootIdx = withCustoms.indexOf('speculum_pp_inject_boot');
  const virtualBootIdx = withCustoms.indexOf('__speculumProjectionBoot');
  const firstLaunchIdx = withCustoms.indexOf('speculum_launch_');
  assert.ok(bootIdx >= 0, 'prelude boot present');
  assert.ok(virtualBootIdx > bootIdx, 'Virtual bootstrap must follow prelude');
  assert.ok(
    firstLaunchIdx > virtualBootIdx,
    'custom launch scripts must run after Virtual producer path',
  );
  assert.ok(withCustoms.includes('speculum_launch_bad'), 'broken custom still inlined');
  assert.ok(withCustoms.includes('speculum_launch_ok'), 'sibling custom still inlined');
  assert.ok(withCustoms.includes('__LAUNCH_OK=1'));
  assert.ok(withCustoms.includes('__speculumLaunchUrlMatch'));
  assert.match(withCustoms, /catch\s*\(_e\)\s*\{\s*\}/);

  console.log('[unit] buildProjectionInjectBundle ok');
}
