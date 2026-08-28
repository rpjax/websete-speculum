/**
 * CDP-only projection runtime installer — one bundle per target via
 * Page.addScriptToEvaluateOnNewDocument (+ late main-world evaluate when needed).
 *
 * Happy path: onNewDocument (Chromium runs it on every new document).
 * lateBoot: miss-detect only — main-world probe (never Patchright isolate), sync
 * inject arm for idempotency, coalesce in-flight work, settle before inject on
 * navigate/frame so onNewDocument wins the race without a 200KB re-eval.
 */

import type { BrowserContext, CDPSession, Frame, Page } from 'patchright';
import type { ProjectionConfigPreScriptOptions } from './buildConfigPreScript';
import { buildProjectionInjectBundle } from './buildProjectionInjectBundle';
import {
  resolveLaunchScripts,
  type ResolvedLaunchScript,
} from './resolveLaunchScripts';
import {
  buildInjectRuntimePresentExpression,
  INJECT_ARM_GLOBAL,
} from './injectSentinel';
import {
  attachFrameCdp,
  createFrameCdpAttachState,
  wireFrameCdpLifecycle,
} from '../session/frameCdpSession';

/** Settle before late inject — lets onNewDocument arm the heap first. */
const LATE_BOOT_SETTLE_MS: Readonly<Record<string, number>> = {
  install: 0,
  navigate: 16,
  frame: 16,
};

const RUNTIME_PRESENT_EXPR = buildInjectRuntimePresentExpression();

const BOOT_PROBE_DETAIL = `() => ({
  hasProjection: !!globalThis.__speculumProjection,
  hasBootPromise: !!globalThis.__speculumProjectionBoot,
  injectArmed: !!globalThis.${INJECT_ARM_GLOBAL},
  bootId: (globalThis.__speculumBootDiag && globalThis.__speculumBootDiag.bootId) || null,
  href: typeof location !== 'undefined' ? location.href : '',
})`;

const BOOT_LINES_DETAIL =
  `() => Array.isArray(globalThis.__speculumBootDiagLines) ? globalThis.__speculumBootDiagLines.slice() : []`;

type BootProbeDetail = {
  hasProjection: boolean;
  hasBootPromise: boolean;
  injectArmed?: boolean;
  bootId: string | null;
  href: string;
  world?: string;
};

const DIAG_BOOT = process.env.SPECULUM_DIAG_BOOT === '1';

function bootDiagSidecar(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (!DIAG_BOOT) return;
  const payload = {
    side: 'sidecar',
    event,
    t: Date.now(),
    ...fields,
  };
  process.stderr.write(`[speculum-boot-diag] ${JSON.stringify(payload)}\n`);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ProjectionRuntimeInstallerOptions = {
  context: BrowserContext;
  page: Page;
  rootCdp: CDPSession;
  config: ProjectionConfigPreScriptOptions;
  launchScripts: readonly ResolvedLaunchScript[];
  includeCspDiag?: boolean;
};

export class ProjectionRuntimeInstaller {
  private readonly context: BrowserContext;
  private readonly page: Page;
  private readonly rootCdp: CDPSession;
  private readonly config: ProjectionConfigPreScriptOptions;
  private readonly launchScripts: readonly ResolvedLaunchScript[];
  private readonly includeCspDiag: boolean;
  private readonly frameState = createFrameCdpAttachState();
  private readonly registeredSessions = new WeakSet<CDPSession>();
  private readonly lateBootInflight = new WeakMap<Frame, Promise<void>>();
  /** One late inject attempt per document: `${generation}|${url}` per frame. */
  private readonly lateBootAttempts = new WeakMap<Frame, Set<string>>();
  private cachedBundle: string | null = null;

  constructor(opts: ProjectionRuntimeInstallerOptions) {
    this.context = opts.context;
    this.page = opts.page;
    this.rootCdp = opts.rootCdp;
    this.config = opts.config;
    this.launchScripts = opts.launchScripts;
    this.includeCspDiag = opts.includeCspDiag ?? false;
  }

  buildFrameBundle(_frameUrl?: string): string {
    if (this.cachedBundle === null) {
      this.cachedBundle = buildProjectionInjectBundle({
        config: this.config,
        launchScripts: this.launchScripts,
        includeCspDiag: this.includeCspDiag,
      });
    }
    return this.cachedBundle;
  }

  private async registerOnCdpSession(session: CDPSession, source: string): Promise<void> {
    if (this.registeredSessions.has(session)) return;
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source });
    this.registeredSessions.add(session);
  }

  /** CDP session that owns this frame's main world (root or OOPIF). */
  private cdpForFrame(frame: Frame): CDPSession | null {
    if (frame === this.page.mainFrame()) return this.rootCdp;
    return this.frameState.frameSessions.get(frame) ?? null;
  }

  /**
   * Evaluate an expression in the page/frame **main world** (where Virtual lives).
   * Never use Patchright's default isolated world for product lateBoot decisions.
   */
  private async evaluateMainWorldJson<T>(
    frame: Frame,
    expression: string,
    opts?: { awaitPromise?: boolean },
  ): Promise<T | null> {
    const awaitPromise = opts?.awaitPromise === true;
    const cdp = this.cdpForFrame(frame);
    if (cdp) {
      try {
        const result = (await cdp.send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise,
        })) as {
          result?: { value?: T };
          exceptionDetails?: { text?: string };
        };
        if (result.exceptionDetails) {
          bootDiagSidecar('lateBoot_cdp_eval_exception', {
            text: result.exceptionDetails.text ?? 'exception',
          });
          return null;
        }
        return (result.result?.value ?? null) as T | null;
      } catch (err) {
        bootDiagSidecar('lateBoot_cdp_eval_error', {
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }
    try {
      const evalWorld = frame.evaluate.bind(frame) as (
        pageFunction: string,
        arg?: unknown,
        isolatedContext?: boolean,
      ) => Promise<unknown>;
      return (await evalWorld(`() => (${expression})`, undefined, false)) as T;
    } catch {
      return null;
    }
  }

  /**
   * Run inject bundle in the frame main world.
   * awaitPromise=false: Virtual boots via void(async…); do not block CDP on establish.
   */
  private async evaluateMainWorldSource(frame: Frame, source: string): Promise<void> {
    const cdp = this.cdpForFrame(frame);
    if (cdp) {
      const result = (await cdp.send('Runtime.evaluate', {
        expression: source,
        awaitPromise: false,
      })) as { exceptionDetails?: { text?: string } };
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? 'Runtime.evaluate exception');
      }
      return;
    }
    const evalWorld = frame.evaluate.bind(frame) as (
      pageFunction: string,
      arg?: unknown,
      isolatedContext?: boolean,
    ) => Promise<unknown>;
    await evalWorld(source, undefined, false);
  }

  private async probeRuntimePresent(frame: Frame): Promise<boolean | null> {
    return this.evaluateMainWorldJson<boolean>(frame, RUNTIME_PRESENT_EXPR, {
      awaitPromise: false,
    });
  }

  private documentAttemptKey(url: string): string {
    const g = this.config.generation ?? 1;
    return `${g}|${url}`;
  }

  private hasLateBootAttempt(frame: Frame, key: string): boolean {
    return this.lateBootAttempts.get(frame)?.has(key) ?? false;
  }

  private markLateBootAttempt(frame: Frame, key: string): void {
    let set = this.lateBootAttempts.get(frame);
    if (!set) {
      set = new Set();
      this.lateBootAttempts.set(frame, set);
    }
    set.add(key);
  }

  private lateBootIfNeeded(frame: Frame, bundle: string, caller: string): Promise<void> {
    const existing = this.lateBootInflight.get(frame);
    if (existing) return existing;
    const run = this.lateBootIfNeededImpl(frame, bundle, caller).finally(() => {
      if (this.lateBootInflight.get(frame) === run) this.lateBootInflight.delete(frame);
    });
    this.lateBootInflight.set(frame, run);
    return run;
  }

  private async lateBootIfNeededImpl(
    frame: Frame,
    bundle: string,
    caller: string,
  ): Promise<void> {
    try {
      const url = frame.url();
      if (!url || url === 'about:blank') {
        bootDiagSidecar('lateBoot_skip', { caller, reason: 'blank_url', url: url || '' });
        return;
      }

      let present = await this.probeRuntimePresent(frame);

      if (DIAG_BOOT) {
        const mainRaw = await this.evaluateMainWorldJson<Omit<BootProbeDetail, 'world'>>(
          frame,
          `(${BOOT_PROBE_DETAIL})()`,
          { awaitPromise: false },
        );
        bootDiagSidecar('lateBoot_probe', {
          caller,
          url,
          present,
          mainProbe: mainRaw ? { ...mainRaw, world: 'main' } : null,
        });
      }

      if (present === true) {
        bootDiagSidecar('lateBoot_skip', { caller, reason: 'probe_true', url });
        return;
      }
      if (present === null) {
        // Fail-closed: never inject when main-world probe is unavailable.
        bootDiagSidecar('lateBoot_skip', { caller, reason: 'probe_null', url });
        return;
      }

      const settleMs = LATE_BOOT_SETTLE_MS[caller] ?? 0;
      if (settleMs > 0) {
        await sleep(settleMs);
        present = await this.probeRuntimePresent(frame);
        if (present === true) {
          bootDiagSidecar('lateBoot_skip', {
            caller,
            reason: 'probe_true_after_settle',
            url,
            settleMs,
          });
          return;
        }
        if (present === null) {
          bootDiagSidecar('lateBoot_skip', {
            caller,
            reason: 'probe_null',
            url,
            settleMs,
          });
          return;
        }
      }

      const attemptKey = this.documentAttemptKey(url);
      if (this.hasLateBootAttempt(frame, attemptKey)) {
        bootDiagSidecar('lateBoot_skip', {
          caller,
          reason: 'already_attempted',
          url,
          attemptKey,
        });
        return;
      }
      this.markLateBootAttempt(frame, attemptKey);

      bootDiagSidecar('lateBoot_evaluate', {
        caller,
        url,
        reason: 'probe_false',
        world: 'main',
        settleMs,
        attemptKey,
      });
      await this.evaluateMainWorldSource(frame, bundle);

      if (DIAG_BOOT) {
        const afterRaw = await this.evaluateMainWorldJson<Omit<BootProbeDetail, 'world'>>(
          frame,
          `(${BOOT_PROBE_DETAIL})()`,
          { awaitPromise: false },
        );
        const mainLineRaw = await this.evaluateMainWorldJson<string[]>(
          frame,
          `(${BOOT_LINES_DETAIL})()`,
          { awaitPromise: false },
        );
        bootDiagSidecar('lateBoot_evaluate_done', {
          caller,
          url,
          mainAfter: afterRaw ? { ...afterRaw, world: 'main' } : null,
          mainBootDiagLineCount: Array.isArray(mainLineRaw) ? mainLineRaw.length : 0,
          mainBootDiagLines: Array.isArray(mainLineRaw) ? mainLineRaw.slice(0, 80) : [],
        });
      }
    } catch (err) {
      if (DIAG_BOOT) {
        try {
          const mainLines = await this.evaluateMainWorldJson<string[]>(
            frame,
            `(${BOOT_LINES_DETAIL})()`,
            { awaitPromise: false },
          );
          bootDiagSidecar('lateBoot_error_main_lines', {
            caller,
            lineCount: Array.isArray(mainLines) ? mainLines.length : 0,
            lines: Array.isArray(mainLines) ? mainLines.slice(0, 80) : [],
          });
        } catch {
          /* */
        }
      }
      bootDiagSidecar('lateBoot_error', {
        caller,
        message: err instanceof Error ? err.message : String(err),
      });
      /* detached / sandboxed without scripts */
    }
  }

  private async onFrameSession(frame: Frame, session: CDPSession): Promise<void> {
    const bundle = this.buildFrameBundle(frame.url());
    await this.registerOnCdpSession(session, bundle);
    await this.lateBootIfNeeded(frame, bundle, 'frame');
  }

  async install(): Promise<void> {
    bootDiagSidecar('installer_config', {
      diagBoot: this.config.diagBoot === true,
      envDiagBoot: process.env.SPECULUM_DIAG_BOOT === '1',
      sessionId: this.config.sessionId ?? null,
      generation: this.config.generation ?? null,
    });
    const mainBundle = this.buildFrameBundle(this.page.mainFrame().url());
    bootDiagSidecar('installer_bundle_has_diagBoot', {
      hasDiagBootLiteral:
        mainBundle.includes('"diagBoot":true') || mainBundle.includes('"diagBoot": true'),
      hasBootDiagMarker: mainBundle.includes('[speculum-boot-diag]'),
      hasInjectArm: mainBundle.includes(INJECT_ARM_GLOBAL),
    });
    await this.registerOnCdpSession(this.rootCdp, mainBundle);
    await this.lateBootIfNeeded(this.page.mainFrame(), mainBundle, 'install');

    await wireFrameCdpLifecycle({
      page: this.page,
      context: this.context,
      state: this.frameState,
      onFrameSession: async (frame) => {
        const session = await attachFrameCdp(frame, this.page, this.context, this.frameState);
        if (session) await this.onFrameSession(frame, session);
      },
      onMainFrameNavigated: async () => {
        const bundle = this.buildFrameBundle(this.page.mainFrame().url());
        await this.registerOnCdpSession(this.rootCdp, bundle);
        await this.lateBootIfNeeded(this.page.mainFrame(), bundle, 'navigate');
      },
    });
  }

  /** @internal Test hook — attach inject to a child frame CDP session. */
  async attachFrameForTest(frame: Frame): Promise<void> {
    const session = await attachFrameCdp(frame, this.page, this.context, this.frameState);
    if (session) await this.onFrameSession(frame, session);
  }
}
