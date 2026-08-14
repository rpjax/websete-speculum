/**
 * FrameTransport that does nothing — always accepts, never copies or logs the bytes.
 * Isolates producer CPU (build+encode) from any transport confound; used by the
 * `discard` transport kind for CDP profiling runs (`scripts/profile-virtual.js`), never by a
 * real session.
 */

import type { FrameTransport, FrameTransportResult } from './frameTransport';

export class NullFrameTransport implements FrameTransport {
  send(_bytes: Uint8Array): FrameTransportResult {
    return 'accepted';
  }
}
