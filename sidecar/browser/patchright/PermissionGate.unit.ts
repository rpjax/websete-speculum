import assert from 'assert';
import { attachPermissionGate } from './PermissionGate';
import type { BrowserContext, Page } from 'patchright';

export async function runPermissionGateUnitTests(): Promise<void> {
  const grants: Array<{ perms: string[]; origin: string }> = [];
  let cleared = 0;
  const context = {
    clearPermissions: async () => {
      cleared += 1;
    },
    grantPermissions: async (perms: string[], opts: { origin: string }) => {
      grants.push({ perms, origin: opts.origin });
    },
  } as unknown as BrowserContext;

  let cameraCalls = 0;
  let micCalls = 0;
  const frameHandlers: Array<(frame: unknown) => void> = [];
  let currentUrl = 'about:blank';
  const mainFrame = {};
  const page = {
    url: () => currentUrl,
    mainFrame: () => mainFrame,
    on: (event: string, fn: (frame: unknown) => void) => {
      if (event === 'framenavigated') frameHandlers.push(fn);
    },
  } as unknown as Page;

  const gate = attachPermissionGate({
    context,
    page,
    events: {
      onCameraPermissionRequested: async () => {
        cameraCalls += 1;
        return 'allow';
      },
      onMicrophonePermissionRequested: async () => {
        micCalls += 1;
        return 'deny';
      },
    },
    decisionTimeoutMs: 2_000,
  });

  // about:blank → no permission sync
  assert.strictEqual(cameraCalls, 0);
  assert.strictEqual(cleared, 0);

  currentUrl = 'https://app.example.com/home';
  for (const h of frameHandlers) h(mainFrame);
  await new Promise((r) => setTimeout(r, 50));

  assert.strictEqual(cameraCalls, 1);
  assert.strictEqual(micCalls, 1);
  assert.ok(cleared >= 1);
  assert.ok(
    grants.some((g) => g.origin === 'https://app.example.com' && g.perms.includes('camera')),
  );
  assert.ok(
    !grants.some((g) => g.perms.includes('microphone')),
    'mic deny must not grant microphone',
  );

  // Same origin → no re-ask
  const camBefore = cameraCalls;
  for (const h of frameHandlers) h(mainFrame);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(cameraCalls, camBefore);

  gate.dispose();
  console.log('[unit] PermissionGate origin sync ok');
}
