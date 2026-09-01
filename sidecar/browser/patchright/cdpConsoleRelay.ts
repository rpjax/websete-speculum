/**
 * Patchright `page.on('console')` / `pageerror` deliver nothing (verified 2026-08-28).
 * Relay Virtual/page console + uncaught errors through CDP Runtime events instead.
 */

import type { CDPSession } from 'patchright';

export type ConsoleRelaySink = (level: number, text: string) => void;

/** Lab UI treats level ≥ 3 as console error (see lab client `console` handler). */
export function consoleApiLevel(type: string): number {
  if (type === 'error' || type === 'assert') return 3;
  if (type === 'warning' || type === 'warn') return 2;
  return 1;
}

type RemoteObjectLike = {
  type?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
};

export function formatConsoleRemoteObject(arg: RemoteObjectLike): string {
  if (arg.value !== undefined) {
    if (typeof arg.value === 'string') return arg.value;
    try {
      return JSON.stringify(arg.value);
    } catch {
      return String(arg.value);
    }
  }
  if (arg.unserializableValue != null && arg.unserializableValue !== '') {
    return String(arg.unserializableValue);
  }
  if (arg.description != null && arg.description !== '') return arg.description;
  return arg.type ?? '';
}

export function formatConsoleApiArgs(args: readonly RemoteObjectLike[] | undefined): string {
  if (!args || args.length === 0) return '';
  return args.map(formatConsoleRemoteObject).join(' ');
}

type ExceptionDetailsLike = {
  text?: string;
  exception?: RemoteObjectLike;
  lineNumber?: number;
  columnNumber?: number;
  url?: string;
};

export function formatExceptionDetails(details: ExceptionDetailsLike): string {
  const fromObj = details.exception
    ? formatConsoleRemoteObject(details.exception)
    : '';
  if (fromObj) return fromObj;
  const text = details.text?.trim() || 'Uncaught';
  const where =
    details.url || details.lineNumber != null
      ? ` (${details.url ?? ''}:${(details.lineNumber ?? 0) + 1}:${(details.columnNumber ?? 0) + 1})`
      : '';
  return `${text}${where}`;
}

const TEXT_CAP = 65_536;

function truncate(text: string): string {
  if (text.length <= TEXT_CAP) return text;
  return `${text.slice(0, TEXT_CAP)} … [truncated]`;
}

type ConsoleApiEv = { type?: string; args?: RemoteObjectLike[] };
type ExceptionEv = { exceptionDetails?: ExceptionDetailsLike };

type BoundHandlers = {
  onConsole: (ev: ConsoleApiEv) => void;
  onException: (ev: ExceptionEv) => void;
};

const boundByCdp = new WeakMap<object, BoundHandlers>();

/**
 * Enable Runtime and forward console API + uncaught exceptions to `sink`.
 * Safe to call more than once on the same session (handler is replaced).
 */
export async function attachCdpConsoleRelay(
  cdp: CDPSession,
  sink: ConsoleRelaySink,
): Promise<void> {
  const prev = boundByCdp.get(cdp);
  if (prev) {
    cdp.removeListener('Runtime.consoleAPICalled', prev.onConsole);
    cdp.removeListener('Runtime.exceptionThrown', prev.onException);
  }

  const onConsole = (ev: ConsoleApiEv) => {
    const text = truncate(formatConsoleApiArgs(ev.args));
    if (!text) return;
    sink(consoleApiLevel(String(ev.type ?? 'log')), text);
  };
  const onException = (ev: ExceptionEv) => {
    const details = ev.exceptionDetails;
    if (!details) return;
    sink(3, truncate(formatExceptionDetails(details)));
  };

  boundByCdp.set(cdp, { onConsole, onException });
  cdp.on('Runtime.consoleAPICalled', onConsole);
  cdp.on('Runtime.exceptionThrown', onException);
  await cdp.send('Runtime.enable');
}
