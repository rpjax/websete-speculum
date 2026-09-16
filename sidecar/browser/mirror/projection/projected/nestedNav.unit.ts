import { ensureNestedHostSandboxAccess } from '@speculum/page-projection/core/nestedNav';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function runNestedNavUnitTests(): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts allow-popups');
  ensureNestedHostSandboxAccess(iframe);
  assert(
    iframe.getAttribute('sandbox') === 'allow-popups allow-same-origin',
    `expected allow-same-origin without allow-scripts, got ${iframe.getAttribute('sandbox')}`,
  );

  iframe.setAttribute('sandbox', 'allow-forms');
  ensureNestedHostSandboxAccess(iframe);
  assert(
    iframe.getAttribute('sandbox') === 'allow-forms allow-same-origin',
    `append same-origin: ${iframe.getAttribute('sandbox')}`,
  );

  iframe.removeAttribute('sandbox');
  ensureNestedHostSandboxAccess(iframe);
  assert(iframe.getAttribute('sandbox') === null, 'no sandbox attr unchanged');

  console.log('[unit] nestedNav ok');
}
