/**
 * TEMP-DIAG host helpers — top-frame dump of projected iframe __SCROLL_DIAG_LOG.
 */

type DiagWin = Window & {
  __SCROLL_DIAG_LOG?: unknown[];
  __SCROLL_DIAG_CLEAR?: () => void;
};

function walkFrames(win: Window, out: Window[]): void {
  out.push(win);
  let frames: HTMLCollectionOf<HTMLIFrameElement>;
  try {
    frames = win.document.getElementsByTagName('iframe');
  } catch {
    return;
  }
  for (let i = 0; i < frames.length; i++) {
    try {
      const child = frames[i]?.contentWindow;
      if (child) walkFrames(child, out);
    } catch {
      /* cross-origin */
    }
  }
}

function collectDiagFrames(): Array<{ href: string; log: unknown[]; clear?: () => void }> {
  const frames: Window[] = [];
  walkFrames(window, frames);
  const found: Array<{ href: string; log: unknown[]; clear?: () => void }> = [];
  for (const w of frames) {
    try {
      const dw = w as DiagWin;
      const log = dw.__SCROLL_DIAG_LOG;
      if (!Array.isArray(log)) continue;
      found.push({
        href: (() => {
          try {
            return w.location.href;
          } catch {
            return '(frame)';
          }
        })(),
        log: [...log],
        clear: typeof dw.__SCROLL_DIAG_CLEAR === 'function' ? () => dw.__SCROLL_DIAG_CLEAR!() : undefined,
      });
    } catch {
      /* */
    }
  }
  return found;
}

/**
 * Phone runs have no console and no usable clipboard round-trip, so gesture
 * records are POSTed to the host and land in `lab-runs/gesture-diag/`.
 * Sent-count per frame so a flush never re-sends what disk already has.
 */
const sentCounts = new WeakMap<Window, number>();
let diagSessionId: string | null = null;
let flushTimer: number | null = null;

function collectUnsent(): { entries: unknown[]; commit: () => void } {
  const frames: Window[] = [];
  walkFrames(window, frames);
  const entries: unknown[] = [];
  const commits: Array<() => void> = [];
  for (const w of frames) {
    try {
      const log = (w as DiagWin).__SCROLL_DIAG_LOG;
      if (!Array.isArray(log)) continue;
      const sent = sentCounts.get(w) ?? 0;
      if (log.length <= sent) continue;
      entries.push(...log.slice(sent));
      const total = log.length;
      commits.push(() => sentCounts.set(w, total));
    } catch {
      /* cross-origin */
    }
  }
  return { entries, commit: () => commits.forEach((c) => c()) };
}

async function flushDiag(): Promise<{ ok: boolean; sent: number; error?: string }> {
  const { entries, commit } = collectUnsent();
  if (entries.length === 0) return { ok: true, sent: 0 };
  try {
    const res = await fetch('/lab/diag/gesture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ sessionId: diagSessionId, entries }),
    });
    if (!res.ok) return { ok: false, sent: 0, error: `http ${res.status}` };
    commit();
    return { ok: true, sent: entries.length };
  } catch (err) {
    return { ok: false, sent: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export function setScrollDiagSessionId(id: string | null): void {
  diagSessionId = id;
}

export function installScrollDiagHostApis(): void {
  const api = window as unknown as {
    diagDump?: () => unknown;
    diagClear?: () => void;
    diagFlush?: () => Promise<unknown>;
    diagLabel?: (label: string) => void;
  };

  api.diagFlush = () => flushDiag();

  /** Tag the gestures that follow, so a phone run is readable without a console. */
  api.diagLabel = (label: string) => {
    const frames: Window[] = [];
    walkFrames(window, frames);
    for (const w of frames) {
      try {
        (w as Window & { __SCROLL_DIAG_LABEL?: string }).__SCROLL_DIAG_LABEL = label;
      } catch {
        /* cross-origin */
      }
    }
  };

  // Unattended flush: the phone is the operator, nobody is pressing buttons there.
  if (flushTimer === null) {
    flushTimer = window.setInterval(() => {
      // Re-stamp each tick: the projected iframe is replaced on resync/swap.
      const queryLabel = new URLSearchParams(location.search).get('diagLabel');
      if (queryLabel) api.diagLabel?.(queryLabel);
      void flushDiag();
    }, 2000);
    window.addEventListener('pagehide', () => {
      void flushDiag();
    });
  }

  api.diagDump = () => {
    const frames = collectDiagFrames();
    const payload =
      frames.length === 0
        ? { ok: false, message: 'no __SCROLL_DIAG_LOG in any frame yet — Connect + Start Virtual first', frames: [] }
        : {
            ok: true,
            dumpedAt: new Date().toISOString(),
            frameCount: frames.length,
            frames: frames.map((f) => ({ href: f.href, entries: f.log })),
            flat: frames.flatMap((f) => f.log),
          };
    const text = JSON.stringify(payload, null, 2);
    console.log('[diagDump]', payload);
    console.log(text);
    void navigator.clipboard.writeText(text).then(
      () => console.log('[diagDump] copied to clipboard'),
      (err) => console.warn('[diagDump] clipboard failed', err),
    );
    return payload;
  };

  api.diagClear = () => {
    const frames: Window[] = [];
    walkFrames(window, frames);
    for (const w of frames) {
      try {
        (w as DiagWin).__SCROLL_DIAG_CLEAR?.();
        sentCounts.set(w, 0);
      } catch {
        /* cross-origin */
      }
    }
    console.log(`[diagClear] cleared ${frames.length} frame(s)`);
  };
}
