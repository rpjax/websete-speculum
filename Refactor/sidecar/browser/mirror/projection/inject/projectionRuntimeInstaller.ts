/**
 * CDP-only projection runtime installer — one bundle per target via
 * Page.addScriptToEvaluateOnNewDocument (+ late frame.evaluate when needed).
 */

import type { BrowserContext, CDPSession, Frame, Page } from 'patchright';
import type { ProjectionConfigPreScriptOptions } from './buildConfigPreScript';
import { buildProjectionInjectBundle } from './buildProjectionInjectBundle';
import {
  resolveLaunchScripts,
  type ResolvedLaunchScript,
} from './resolveLaunchScripts';
import {
  attachFrameCdp,
  createFrameCdpAttachState,
  wireFrameCdpLifecycle,
} from '../session/frameCdpSession';

const HAS_PROJECTION_PROBE =
  '() => !!(globalThis.__speculumProjection || globalThis.__speculumProjectionBoot)';

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

  constructor(opts: ProjectionRuntimeInstallerOptions) {
    this.context = opts.context;
    this.page = opts.page;
    this.rootCdp = opts.rootCdp;
    this.config = opts.config;
    this.launchScripts = opts.launchScripts;
    this.includeCspDiag = opts.includeCspDiag ?? false;
  }

  buildFrameBundle(_frameUrl: string): string {
    return buildProjectionInjectBundle({
      config: this.config,
      launchScripts: this.launchScripts,
      includeCspDiag: this.includeCspDiag,
    });
  }

  private async registerOnCdpSession(session: CDPSession, source: string): Promise<void> {
    if (this.registeredSessions.has(session)) return;
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source });
    this.registeredSessions.add(session);
  }

  private async lateBootIfNeeded(frame: Frame, source: string): Promise<void> {
    try {
      const url = frame.url();
      if (!url || url === 'about:blank') return;
      const hasProjection = await frame.evaluate(HAS_PROJECTION_PROBE);
      if (hasProjection) return;
      await frame.evaluate(source);
    } catch {
      /* detached / sandboxed without scripts */
    }
  }

  private async onFrameSession(frame: Frame, session: CDPSession): Promise<void> {
    const bundle = this.buildFrameBundle(frame.url());
    await this.registerOnCdpSession(session, bundle);
    await this.lateBootIfNeeded(frame, bundle);
  }

  async install(): Promise<void> {
    const mainBundle = this.buildFrameBundle(this.page.mainFrame().url());
    await this.registerOnCdpSession(this.rootCdp, mainBundle);
    await this.lateBootIfNeeded(this.page.mainFrame(), mainBundle);

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
        await this.lateBootIfNeeded(this.page.mainFrame(), bundle);
      },
    });
  }

  /** @internal Test hook — attach inject to a child frame CDP session. */
  async attachFrameForTest(frame: Frame): Promise<void> {
    const session = await attachFrameCdp(frame, this.page, this.context, this.frameState);
    if (session) await this.onFrameSession(frame, session);
  }
}
