/**
 * Extension plane bridge envelopes (main world ↔ isolated content ↔ background).
 */

export const EXTENSION_PLANE_CHANNEL = 'speculum.extension.plane' as const;

export type ExtensionPlaneKind =
  | 'bind'
  | 'bind-ack'
  | 'open'
  | 'open-ok'
  | 'open-fail'
  | 'send'
  | 'message'
  | 'close'
  | 'error';

export type ExtensionPlaneEnvelope =
  | {
      channel: typeof EXTENSION_PLANE_CHANNEL;
      token: string;
      kind: 'bind';
    }
  | {
      channel: typeof EXTENSION_PLANE_CHANNEL;
      token: string;
      kind: 'bind-ack';
    }
  | {
      channel: typeof EXTENSION_PLANE_CHANNEL;
      token: string;
      kind: 'open';
      url: string;
      socketId: number;
    }
  | {
      channel: typeof EXTENSION_PLANE_CHANNEL;
      token: string;
      kind: 'open-ok';
      socketId: number;
    }
  | {
      channel: typeof EXTENSION_PLANE_CHANNEL;
      token: string;
      kind: 'open-fail';
      socketId: number;
      message: string;
    }
  | {
      channel: typeof EXTENSION_PLANE_CHANNEL;
      token: string;
      kind: 'send';
      socketId: number;
      bytes: Uint8Array;
    }
  | {
      channel: typeof EXTENSION_PLANE_CHANNEL;
      token: string;
      kind: 'message';
      socketId: number;
      bytes: Uint8Array;
    }
  | {
      channel: typeof EXTENSION_PLANE_CHANNEL;
      token: string;
      kind: 'close';
      socketId: number;
      code?: number;
      reason?: string;
    }
  | {
      channel: typeof EXTENSION_PLANE_CHANNEL;
      token: string;
      kind: 'error';
      socketId: number;
      message: string;
    };

function asUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((x) => typeof x === 'number')) {
    return Uint8Array.from(value);
  }
  return null;
}

export function isExtensionPlaneWireMessage(value: unknown): value is ExtensionPlaneEnvelope {
  return decodeExtensionPlaneEnvelope(value) !== null;
}

export function decodeExtensionPlaneEnvelope(value: unknown): ExtensionPlaneEnvelope | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.channel !== EXTENSION_PLANE_CHANNEL) return null;
  if (typeof raw.token !== 'string' || raw.token.length === 0) return null;
  if (typeof raw.kind !== 'string') return null;

  const token = raw.token;
  switch (raw.kind) {
    case 'bind':
    case 'bind-ack':
      return { channel: EXTENSION_PLANE_CHANNEL, token, kind: raw.kind };
    case 'open': {
      if (typeof raw.url !== 'string' || typeof raw.socketId !== 'number') return null;
      return {
        channel: EXTENSION_PLANE_CHANNEL,
        token,
        kind: 'open',
        url: raw.url,
        socketId: raw.socketId >>> 0,
      };
    }
    case 'open-ok':
    case 'open-fail': {
      if (typeof raw.socketId !== 'number') return null;
      if (raw.kind === 'open-ok') {
        return { channel: EXTENSION_PLANE_CHANNEL, token, kind: 'open-ok', socketId: raw.socketId >>> 0 };
      }
      if (typeof raw.message !== 'string') return null;
      return {
        channel: EXTENSION_PLANE_CHANNEL,
        token,
        kind: 'open-fail',
        socketId: raw.socketId >>> 0,
        message: raw.message,
      };
    }
    case 'send':
    case 'message': {
      if (typeof raw.socketId !== 'number') return null;
      const bytes = asUint8Array(raw.bytes);
      if (bytes === null) return null;
      return {
        channel: EXTENSION_PLANE_CHANNEL,
        token,
        kind: raw.kind,
        socketId: raw.socketId >>> 0,
        bytes,
      };
    }
    case 'close': {
      if (typeof raw.socketId !== 'number') return null;
      const code = raw.code === undefined ? undefined : Number(raw.code);
      const reason = raw.reason === undefined ? undefined : String(raw.reason);
      return {
        channel: EXTENSION_PLANE_CHANNEL,
        token,
        kind: 'close',
        socketId: raw.socketId >>> 0,
        code: code !== undefined && Number.isFinite(code) ? code : undefined,
        reason,
      };
    }
    case 'error': {
      if (typeof raw.socketId !== 'number' || typeof raw.message !== 'string') return null;
      return {
        channel: EXTENSION_PLANE_CHANNEL,
        token,
        kind: 'error',
        socketId: raw.socketId >>> 0,
        message: raw.message,
      };
    }
    default:
      return null;
  }
}
