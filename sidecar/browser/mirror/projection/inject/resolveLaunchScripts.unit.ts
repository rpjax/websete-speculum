import assert from 'assert';
import type { BrowserScriptInjection } from '../../../BrowserSession';
import { resolveLaunchScripts } from './resolveLaunchScripts';

export async function runResolveLaunchScriptsUnitTests(): Promise<void> {
  const scripts: BrowserScriptInjection[] = [
    {
      type: 'Classic',
      file: '/kit/stored.js',
      content: 'globalThis.__STORED=1;',
      targetRules: [
        {
          domain: { scope: 'Any', labels: [] },
          path: { scope: 'Any', matchType: 'Exact', segments: [] },
        },
      ],
    },
    {
      type: 'Classic',
      file: '/kit/bad.js',
      content: 'throw new Error("boom");',
      targetRules: [
        {
          domain: { scope: 'Any', labels: [] },
          path: { scope: 'Any', matchType: 'Exact', segments: [] },
        },
      ],
    },
  ];

  const resolved = await resolveLaunchScripts(scripts);
  assert.strictEqual(resolved.length, 2);
  assert.ok(resolved[0].wrappedSource.includes('__STORED=1'));
  assert.ok(resolved[0].wrappedSource.includes('__speculumLaunchUrlMatch'));
  assert.ok(resolved[0].wrappedSource.includes('catch (_e)'));
  assert.ok(resolved[1].wrappedSource.includes('throw new Error("boom")'));
  assert.ok(resolved[1].wrappedSource.includes('catch (_e)'));
  assert.ok(resolved[0].wrappedSource.includes('speculum_launch_'));
  assert.ok(resolved[1].wrappedSource.includes('speculum_launch_'));

  console.log('[unit] resolveLaunchScripts ok');
}
