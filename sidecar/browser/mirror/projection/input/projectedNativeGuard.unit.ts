import assert from 'node:assert';
import {
  attachProjectedNativeGuard,
  eventTargetElement,
  isProjectedNavigable,
  suppressProjectedDefault,
} from '@speculum/page-projection/projected/input/projectedNativeGuard';

type Handler = (event: Event) => void;

type ListenerReg = {
  type: string;
  handler: Handler;
  opts: boolean | AddEventListenerOptions | undefined;
};

function el(tag: string, attrs: Record<string, string> = {}): Element {
  const node: Record<string, unknown> = {
    nodeType: 1,
    localName: tag,
    parentElement: null,
    closest(sel: string) {
      if (sel.includes('a[href]') && tag === 'a' && attrs.href) return node;
      return null;
    },
    ...attrs,
  };
  return node as unknown as Element;
}

function fakeDoc() {
  const listeners = new Map<string, Set<Handler>>();
  const registrations: ListenerReg[] = [];
  const doc = {
    documentElement: { style: {} as CSSStyleDeclaration },
    body: { style: {} as CSSStyleDeclaration },
    defaultView: { innerWidth: 800, innerHeight: 600 },
    addEventListener(
      type: string,
      handler: Handler,
      opts?: boolean | AddEventListenerOptions,
    ): void {
      registrations.push({ type, handler, opts });
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(handler);
    },
    removeEventListener(type: string, handler: Handler, _opts?: unknown): void {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type: string, event: Event): void {
      for (const h of listeners.get(type) ?? []) h(event);
    },
  };
  return {
    doc: doc as unknown as Document & { dispatch(type: string, event: Event): void },
    registrations,
  };
}

function optsRecord(opts: boolean | AddEventListenerOptions | undefined): {
  capture: boolean;
  passive: boolean | undefined;
} {
  if (opts == null || typeof opts === 'boolean') {
    return { capture: opts === true, passive: undefined };
  }
  return {
    capture: opts.capture === true,
    passive: opts.passive,
  };
}

export function runProjectedNativeGuardUnitTests(): void {
  assert.strictEqual(isProjectedNavigable(el('a', { href: '/escape' })), true);
  assert.strictEqual(isProjectedNavigable(el('span')), false);
  const span = el('span');
  assert.strictEqual(eventTargetElement(span), span);

  const { doc, registrations } = fakeDoc();
  let submitPrevented = false;
  let navClickPrevented = false;
  attachProjectedNativeGuard(doc);

  const touchStartReg = registrations.find((r) => r.type === 'touchstart');
  const touchEndReg = registrations.find((r) => r.type === 'touchend');
  assert.ok(touchStartReg, 'touchstart must be registered');
  assert.ok(touchEndReg, 'touchend must be registered');
  assert.deepStrictEqual(
    optsRecord(touchStartReg.opts),
    { capture: true, passive: true },
    'touchstart must be { capture: true, passive: true } — non-passive reintroduces scroll latency / pan cancel risk',
  );
  assert.deepStrictEqual(
    optsRecord(touchEndReg.opts),
    { capture: true, passive: false },
    'touchend must be { capture: true, passive: false } — cancelamento real de ativação',
  );

  const submitEvent = new Event('submit', { cancelable: true, bubbles: true });
  Object.defineProperty(submitEvent, 'target', { value: el('form') });
  doc.addEventListener(
    'submit',
    (event) => {
      submitPrevented = event.defaultPrevented;
    },
    false,
  );
  doc.dispatch('submit', submitEvent);
  assert.strictEqual(submitPrevented, true, 'submit must be suppressed on Projected surface');

  const link = el('a', { href: 'https://example.com' });
  const clickEvent = new Event('click', { cancelable: true, bubbles: true });
  Object.defineProperty(clickEvent, 'target', { value: link });
  doc.addEventListener(
    'click',
    (event) => {
      navClickPrevented = event.defaultPrevented;
    },
    false,
  );
  doc.dispatch('click', clickEvent);
  assert.strictEqual(navClickPrevented, true, 'navigable click must be suppressed');

  const plainClick = new Event('click', { cancelable: true, bubbles: true });
  Object.defineProperty(plainClick, 'target', { value: el('button') });
  let plainPrevented = false;
  doc.addEventListener(
    'click',
    (event) => {
      plainPrevented = event.defaultPrevented;
    },
    false,
  );
  doc.dispatch('click', plainClick);
  assert.strictEqual(plainPrevented, true, 'capture-phase click guard suppresses all clicks');

  const cancelable = new Event('auxclick', { cancelable: true, bubbles: true });
  suppressProjectedDefault(cancelable);
  assert.strictEqual(cancelable.defaultPrevented, true);

  const linkTouch = el('a', { href: 'https://example.com' });
  const touchStart = new Event('touchstart', { cancelable: true, bubbles: true });
  Object.defineProperty(touchStart, 'target', { value: linkTouch });
  let touchStartPrevented = false;
  doc.addEventListener(
    'touchstart',
    (event) => {
      touchStartPrevented = event.defaultPrevented;
    },
    false,
  );
  doc.dispatch('touchstart', touchStart);
  assert.strictEqual(
    touchStartPrevented,
    false,
    'touchstart on navigable must not preventDefault (native pan)',
  );

  const touchEnd = new Event('touchend', { cancelable: true, bubbles: true });
  Object.defineProperty(touchEnd, 'target', { value: linkTouch });
  let touchEndPrevented = false;
  doc.addEventListener(
    'touchend',
    (event) => {
      touchEndPrevented = event.defaultPrevented;
    },
    false,
  );
  doc.dispatch('touchend', touchEnd);
  assert.strictEqual(touchEndPrevented, true, 'touchend on navigable must suppress activation');

  console.log('[unit] projectedNativeGuard ok');
}
