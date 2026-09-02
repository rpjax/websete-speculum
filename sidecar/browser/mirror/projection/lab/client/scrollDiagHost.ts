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

export function installScrollDiagHostApis(): void {
  const api = window as unknown as {
    diagDump?: () => unknown;
    diagClear?: () => void;
  };

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
    const frames = collectDiagFrames();
    for (const f of frames) f.clear?.();
    console.log(`[diagClear] cleared ${frames.length} frame log(s)`);
  };
}
