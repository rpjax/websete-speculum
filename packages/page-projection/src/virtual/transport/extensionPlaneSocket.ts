/**
 * Extension-plane loopback socket — delegates to main-world shim factory.
 */

import type { LoopbackSocket } from '../../core/loopback/socket';

export const EXTENSION_PLANE_SOCKET_FACTORY_GLOBAL =
  '__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__: ((url: string) => LoopbackSocket) | undefined;
}

export function createExtensionPlaneLoopbackSocket(url: string): LoopbackSocket {
  const factory = globalThis.__SPECULUM_EXTENSION_PLANE_SOCKET_FACTORY__;
  if (typeof factory !== 'function') {
    throw new Error(
      'Extension plane factory missing — inject extensionPlaneMainShim before virtual.js',
    );
  }
  return factory(url);
}
