import assert from 'assert';
import type { BrowserScriptInjection } from '../../../BrowserSession';
import { resolveLaunchScripts } from './resolveLaunchScripts';

export async function runResolveLaunchScriptsUnitTests(): Promise<void> {
  const scripts: BrowserScriptInjection[] = [
    {
      position: 'HeaderTop',
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
  ];

  const resolved = await resolveLaunchScripts(scripts);
  assert.strictEqual(resolved.length, 1);
  assert.ok(resolved[0].wrappedSource.includes('__STORED=1'));
  assert.ok(resolved[0].wrappedSource.includes('__speculumLaunchUrlMatch'));

  console.log('[unit] resolveLaunchScripts ok');
}
