/**
 * Loopback socket factory for Virtual (managed Chrome).
 * Sole product carrier = extension plane (EP-08). Unit tests inject mock sockets
 * via LoopbackDataPlaneOptions.createSocket — they do not use this factory.
 */

import type { LoopbackCarrier } from '../config/projectionConfig';
import type { LoopbackSocketFactory } from '../../core/loopback/socket';
import { createExtensionPlaneLoopbackSocket } from './extensionPlaneSocket';

export function createLoopbackSocketFactory(carrier: LoopbackCarrier): LoopbackSocketFactory {
  if (carrier !== 'extension') {
    throw new Error(
      `createLoopbackSocketFactory: unsupported carrier ${String(carrier)}; managed path is extension-only`,
    );
  }
  return (url: string) => createExtensionPlaneLoopbackSocket(url);
}
