/**
 * Temporary dual-boot / sequence diagnostics — console marker `[speculum-boot-diag]`.
 * Gated by inject config `diagBoot: true` (sidecar env `SPECULUM_DIAG_BOOT=1`).
 */

const MARKER = '[speculum-boot-diag]';

type BootDiagState = {
  bootId: string;
  startedAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __speculumBootDiag: BootDiagState | undefined;
}

export function isBootDiagEnabled(): boolean {
  const raw = globalThis.__SPECULUM_PROJECTION__ as { diagBoot?: unknown } | undefined;
  return raw?.diagBoot === true;
}

export function mintBootDiagId(): string {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return `${t.toFixed(3)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getBootDiagId(): string | null {
  return globalThis.__speculumBootDiag?.bootId ?? null;
}

export function beginBootDiag(bootId: string): void {
  globalThis.__speculumBootDiag = {
    bootId,
    startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
}

export type BootOutcome = {
  ok: boolean;
  reason: string;
  contextId?: number;
  t: number;
  href: string;
  isRoot: boolean;
  /** Extra facts for assertive lab probes (always set; not gated by diagBoot). */
  detail?: Record<string, unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __speculumBootOutcome: BootOutcome | undefined;
}

/** Always-on boot verdict for lab asserts — independent of diagBoot. */
export function setBootOutcome(
  reason: string,
  opts: { ok?: boolean; contextId?: number; detail?: Record<string, unknown> } = {},
): void {
  const outcome: BootOutcome = {
    ok: opts.ok === true,
    reason,
    contextId: opts.contextId,
    t: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    href: typeof location !== 'undefined' ? location.href : '',
    isRoot: typeof window !== 'undefined' ? window.parent === window : false,
    detail: opts.detail,
  };
  globalThis.__speculumBootOutcome = outcome;
}

export function bootDiagLog(event: string, fields: Record<string, unknown> = {}): void {
  if (!isBootDiagEnabled()) return;
  const payload = {
    side: 'virtual',
    event,
    bootId: getBootDiagId(),
    t: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    href: typeof location !== 'undefined' ? location.href : '',
    ...fields,
  };
  const line = `${MARKER} ${JSON.stringify(payload)}`;
  const bag = globalThis as { __speculumBootDiagLines?: string[] };
  if (!Array.isArray(bag.__speculumBootDiagLines)) bag.__speculumBootDiagLines = [];
  bag.__speculumBootDiagLines.push(line);
  // Prefer log over info — some sites stub console.info.
  try {
    console.log(line);
  } catch {
    /* */
  }
}
