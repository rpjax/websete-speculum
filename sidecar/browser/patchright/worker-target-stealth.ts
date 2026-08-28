import type { BrowserContext, CDPSession } from 'patchright';

/** Chromium target types that expose navigator outside the main window. */
export const WORKER_TARGET_TYPES = new Set([
  'worker',
  'shared_worker',
  'service_worker',
]);

export type WorkerTargetStealthHandle = {
  updateSource: (source: string) => void;
  dispose: () => void;
};

type AttachedEvent = {
  sessionId: string;
  targetInfo: { type: string; url?: string };
  waitingForDebugger?: boolean;
};

type StealthState = {
  source: string;
  nextMsgId: number;
  pageCdp: CDPSession;
  browserCdp: CDPSession | null;
  pageHandler: (ev: AttachedEvent) => void | Promise<void>;
  browserHandler: ((ev: AttachedEvent) => void | Promise<void>) | null;
};

const byPageCdp = new WeakMap<CDPSession, StealthState>();

/**
 * Session-wide kit identity inject for every worker-like CDP target.
 * URL-agnostic: any origin that opens Worker / SharedWorker / ServiceWorker gets the kit.
 *
 * Uses Target.setAutoAttach with flatten:false + Target.sendMessageToTarget so child
 * sessions are reachable through Patchright's public CDPSession API.
 */
export async function ensureWorkerTargetStealth(args: {
  pageCdp: CDPSession;
  source: string;
  context?: BrowserContext | null;
}): Promise<WorkerTargetStealthHandle> {
  const { pageCdp, source, context } = args;
  let state = byPageCdp.get(pageCdp);
  if (!state) {
    state = {
      source,
      nextMsgId: 1,
      pageCdp,
      browserCdp: null,
      pageHandler: () => {},
      browserHandler: null,
    };
    state.pageHandler = (ev: AttachedEvent) => handleAttached(state!, pageCdp, ev);
    pageCdp.on('Target.attachedToTarget', state.pageHandler);
    await enableAutoAttach(pageCdp);
    byPageCdp.set(pageCdp, state);
  } else {
    state.source = source;
  }

  if (context && !state.browserCdp) {
    const browser = context.browser();
    if (browser) {
      try {
        const browserCdp = await browser.newBrowserCDPSession();
        state.browserCdp = browserCdp;
        state.browserHandler = (ev: AttachedEvent) => handleAttached(state!, browserCdp, ev);
        browserCdp.on('Target.attachedToTarget', state.browserHandler);
        await enableAutoAttach(browserCdp);
      } catch {
        /* browser CDP optional — page attach still covers in-page workers */
      }
    }
  }

  return {
    updateSource: (next: string) => {
      const s = byPageCdp.get(pageCdp);
      if (s) s.source = next;
    },
    dispose: () => {
      const s = byPageCdp.get(pageCdp);
      if (!s) return;
      try {
        pageCdp.off('Target.attachedToTarget', s.pageHandler);
      } catch {
        /* */
      }
      void pageCdp
        .send('Target.setAutoAttach', {
          autoAttach: false,
          waitForDebuggerOnStart: false,
          flatten: false,
        })
        .catch(() => {});
      if (s.browserCdp && s.browserHandler) {
        try {
          s.browserCdp.off('Target.attachedToTarget', s.browserHandler);
        } catch {
          /* */
        }
        void s.browserCdp
          .send('Target.setAutoAttach', {
            autoAttach: false,
            waitForDebuggerOnStart: false,
            flatten: false,
          })
          .catch(() => {});
        void s.browserCdp.detach().catch(() => {});
      }
      byPageCdp.delete(pageCdp);
    },
  };
}

async function enableAutoAttach(cdp: CDPSession): Promise<void> {
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: false,
  });
  // Dummy call — Chromium historically races autoAttach without a follow-up Target command.
  await cdp.send('Target.getTargets').catch(() => {});
}

async function handleAttached(
  state: StealthState,
  via: CDPSession,
  ev: AttachedEvent,
): Promise<void> {
  const sessionId = ev.sessionId;
  if (!sessionId) return;
  const waiting = !!ev.waitingForDebugger;
  const type = ev.targetInfo?.type ?? '';

  try {
    if (WORKER_TARGET_TYPES.has(type)) {
      await fireOnSession(via, state, sessionId, 'Runtime.evaluate', {
        expression: state.source,
        returnByValue: true,
      });
    }
  } catch {
    /* inject best-effort */
  }

  if (waiting) {
    try {
      await fireOnSession(via, state, sessionId, 'Runtime.runIfWaitingForDebugger', {});
    } catch {
      /* resume best-effort — never leave targets paused */
    }
  }
}

async function fireOnSession(
  via: CDPSession,
  state: StealthState,
  sessionId: string,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  const id = state.nextMsgId++;
  const message = JSON.stringify({ id, method, params });
  await via.send('Target.sendMessageToTarget', { sessionId, message });
}

/** Exposed for units — which target types receive kit inject. */
export function isWorkerLikeTargetType(type: string): boolean {
  return WORKER_TARGET_TYPES.has(type);
}
