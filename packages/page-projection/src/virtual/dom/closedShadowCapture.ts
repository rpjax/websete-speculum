/**
 * Capture closed ShadowRoot references at creation time — [shadow.md](shadow.md) closed extension.
 * Runs synchronously at virtual bundle load (before page scripts).
 */

import { registerClosedShadowRoot } from '../../core/closedShadowLookup';
import { defineNativeLike } from '../inject/defineNativeLike';

let installed = false;

export function installClosedShadowCapture(): void {
  if (installed) return;
  if (typeof Element === 'undefined') return;
  const proto = Element.prototype as Element & {
    attachShadow?: (init: ShadowRootInit) => ShadowRoot;
  };
  const orig = proto.attachShadow;
  if (typeof orig !== 'function') return;
  installed = true;

  defineNativeLike(
    proto,
    'attachShadow',
    function (this: Element, init: ShadowRootInit) {
      const root = orig.call(this, init);
      if (init?.mode === 'closed') {
        registerClosedShadowRoot(this, root);
      }
      return root;
    } as (...args: unknown[]) => unknown,
    orig as (...args: unknown[]) => unknown,
  );
}
