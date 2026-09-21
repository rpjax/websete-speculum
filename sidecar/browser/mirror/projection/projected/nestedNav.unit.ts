import {
  applyNestedHostSandboxAttr,
  ensureNestedHostSandboxAccess,
  isNestedHostNavAttr,
  isNestedHostSandboxAttr,
  nestedHostSandboxAttrValue,
} from '@speculum/page-projection/core/nestedNav';
import {
  PROJECTED_STANDARDS_SRCDOC,
  reincarnateProjectedStandardsSrcdoc,
  stampProjectedStandardsSrcdoc,
} from '@speculum/page-projection/projected/projectedBlankIframe';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function stubIframe(sandbox: string | null = null): HTMLIFrameElement & { srcdocWrites: string[] } {
  const attrs: Record<string, string> = {};
  if (sandbox !== null) attrs.sandbox = sandbox;
  let srcdoc = '';
  const srcdocWrites: string[] = [];
  return {
    localName: 'iframe',
    srcdocWrites,
    get srcdoc() {
      return srcdoc;
    },
    set srcdoc(v: string) {
      srcdoc = v;
      srcdocWrites.push(v);
    },
    getAttribute(name: string) {
      if (name === 'sandbox') {
        return Object.prototype.hasOwnProperty.call(attrs, 'sandbox') ? attrs.sandbox! : null;
      }
      return null;
    },
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
    removeAttribute(name: string) {
      delete attrs[name];
    },
  } as HTMLIFrameElement & { srcdocWrites: string[] };
}

export function runNestedNavUnitTests(): void {
  const iframe = stubIframe('allow-scripts allow-popups');
  const wroteFirst = ensureNestedHostSandboxAccess(iframe);
  assert(wroteFirst === true, 'first ensure must write');
  assert(
    iframe.getAttribute('sandbox') === 'allow-popups allow-same-origin',
    `expected allow-same-origin without allow-scripts, got ${iframe.getAttribute('sandbox')}`,
  );
  const sandboxAfterFirst = iframe.getAttribute('sandbox');
  const wroteSecond = ensureNestedHostSandboxAccess(iframe);
  assert(wroteSecond === false, 'second ensure must not rewrite (would orphan after srcdoc)');
  assert(
    iframe.getAttribute('sandbox') === sandboxAfterFirst,
    'idempotent ensure must leave the attribute string unchanged',
  );

  iframe.setAttribute('sandbox', 'allow-forms');
  const wroteForms = ensureNestedHostSandboxAccess(iframe);
  assert(wroteForms === true, 'token-set change must write');
  assert(
    iframe.getAttribute('sandbox') === 'allow-forms allow-same-origin',
    `append same-origin: ${iframe.getAttribute('sandbox')}`,
  );

  const equivalent = applyNestedHostSandboxAttr(iframe, 'allow-same-origin allow-forms');
  assert(equivalent === false, 'same token set in different order must not write');
  assert(
    iframe.getAttribute('sandbox') === 'allow-forms allow-same-origin',
    'equivalent sandbox must keep the live attribute',
  );

  iframe.removeAttribute('sandbox');
  const wroteAbsent = ensureNestedHostSandboxAccess(iframe);
  assert(wroteAbsent === false, 'no sandbox attr unchanged');
  assert(iframe.getAttribute('sandbox') === null, 'no sandbox attr unchanged');

  const added = applyNestedHostSandboxAttr(iframe, 'allow-popups');
  assert(added === true, 'adding sandbox must write');
  const removed = applyNestedHostSandboxAttr(iframe, null);
  assert(removed === true, 'removing sandbox must write');
  assert(iframe.getAttribute('sandbox') === null, 'sandbox attr removed');

  assert(isNestedHostNavAttr('src') === true, 'src is nav');
  assert(isNestedHostSandboxAttr('sandbox') === true, 'sandbox is sandbox');
  assert(isNestedHostSandboxAttr('src') === false, 'src is not sandbox');
  assert(nestedHostSandboxAttrValue('allow-forms') === 'allow-forms allow-same-origin', 'canonicalize');
  assert(nestedHostSandboxAttrValue(null) === null, 'null stays null');

  stampProjectedStandardsSrcdoc(iframe);
  assert(iframe.srcdoc === PROJECTED_STANDARDS_SRCDOC, 'birth stamp');
  const writesBefore = iframe.srcdocWrites.length;
  reincarnateProjectedStandardsSrcdoc(iframe);
  assert(iframe.srcdoc === PROJECTED_STANDARDS_SRCDOC, 'reincarnate ends on skeleton');
  const reincarnateWrites = iframe.srcdocWrites.slice(writesBefore);
  assert(reincarnateWrites.length === 2, `reincarnate must write twice, got ${reincarnateWrites.length}`);
  assert(reincarnateWrites[0] === '', 'reincarnate must clear srcdoc first (same-value is a no-op)');
  assert(reincarnateWrites[1] === PROJECTED_STANDARDS_SRCDOC, 'reincarnate then stamps skeleton');

  console.log('[unit] nestedNav ok');
}
