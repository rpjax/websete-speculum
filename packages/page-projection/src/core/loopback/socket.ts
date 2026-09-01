/**
 * Loopback transport socket — WebSocket-shaped API for page WS or extension plane.
 */

export const LOOPBACK_SOCKET_CONNECTING = 0;
export const LOOPBACK_SOCKET_OPEN = 1;
export const LOOPBACK_SOCKET_CLOSING = 2;
export const LOOPBACK_SOCKET_CLOSED = 3;

export type LoopbackSocketEventMap = {
  open: Event;
  message: MessageEvent<ArrayBuffer>;
  close: CloseEvent;
  error: Event;
};

export type LoopbackSocketListener<K extends keyof LoopbackSocketEventMap> = (
  ev: LoopbackSocketEventMap[K],
) => void;

export interface LoopbackSocket {
  readonly bufferedAmount: number;
  readonly readyState: number;
  binaryType: 'arraybuffer';
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener<K extends keyof LoopbackSocketEventMap>(
    type: K,
    listener: LoopbackSocketListener<K>,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof LoopbackSocketEventMap>(
    type: K,
    listener: LoopbackSocketListener<K>,
    options?: boolean | EventListenerOptions,
  ): void;
}

export type LoopbackSocketFactory = (url: string) => LoopbackSocket;
