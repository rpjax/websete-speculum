/**
 * Replace a prototype method with a wrapper that preserves native-looking `name`/`length`/`toString`.
 * Original stored in closure — never as an own property on the prototype.
 */

const nativeToString = Function.prototype.toString;
const patchedFns = new WeakSet<(...args: unknown[]) => unknown>();
let toStringHookInstalled = false;

function installToStringHook(): void {
  if (toStringHookInstalled) return;
  toStringHookInstalled = true;
  const replacement = function (this: unknown): string {
    if (patchedFns.has(this as (...args: unknown[]) => unknown)) {
      const name = (this as { name?: string }).name || 'anonymous';
      return `function ${name}() { [native code] }`;
    }
    return nativeToString.call(this);
  };
  patchedFns.add(replacement as (...args: unknown[]) => unknown);
  Object.defineProperty(Function.prototype, 'toString', {
    value: replacement,
    writable: true,
    configurable: true,
  });
}

export function markNativeLike(fn: (...args: unknown[]) => unknown): void {
  patchedFns.add(fn);
}

export function defineNativeLike(
  target: object,
  key: string,
  impl: (...args: unknown[]) => unknown,
  original?: (...args: unknown[]) => unknown,
): void {
  const wrapped = function (this: unknown, ...args: unknown[]) {
    return impl.apply(this, args);
  };
  if (original) {
    try {
      Object.defineProperty(wrapped, 'name', { value: original.name, configurable: true });
      Object.defineProperty(wrapped, 'length', { value: original.length, configurable: true });
    } catch {
      /* best effort */
    }
  }
  markNativeLike(wrapped);
  installToStringHook();
  Object.defineProperty(target, key, {
    value: wrapped,
    writable: true,
    configurable: true,
  });
}
