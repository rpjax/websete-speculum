import type {
  BrowserDeviceProfile,
  BrowserEvalResult,
  BrowserInput,
  BrowserLaunchOptions,
  BrowserProbeRequest,
  BrowserProbeResult,
  BrowserReadyInfo,
  BrowserResizeRequest,
  BrowserResizeResult,
  BrowserSession,
  BrowserSessionEvents,
  BrowserState,
  BrowserStatus,
} from '../BrowserSession';
import { closeChrome, launchChrome, type ChromeHandle } from './ChromeRuntime';
import { Display, type DisplayAllocator } from './Display';
import { applyDeviceEmulation, readChromeViewport } from './device-emulation';
import { EditableFocus } from './EditableFocus';
import { Evaluate } from './Evaluate';
import { InputController } from './Input';
import { MediaIngress } from './MediaIngress';
import { Navigation } from './Navigation';
import { PageState } from './PageState';
import { Probe as ProbeCapability } from './Probe';
import { Screencast } from './Screencast';
import { Viewport } from './Viewport';
import { validateLaunchViewport, validateResizeViewport } from './viewport-bounds';

/**
 * Production BrowserSession: composes Patchright capabilities.
 * No transport / WS / wire codecs.
 */
export class PatchrightBrowserSession implements BrowserSession {
  private open = false;
  private disposed = false;
  private display: Display | null = null;
  private chrome: ChromeHandle | null = null;
  private viewport: Viewport | null = null;
  private screencast: Screencast | null = null;
  private input: InputController | null = null;
  private navigation: Navigation;
  private pageState = new PageState();
  private readonly probeCapability = new ProbeCapability();
  private evaluateCap: Evaluate;
  private editableFocus: EditableFocus;
  private media: MediaIngress;
  private url = 'about:blank';
  private pendingState: BrowserState | null = null;
  private launchOptions: BrowserLaunchOptions | null = null;

  constructor(
    readonly sessionId: string,
    private readonly events: BrowserSessionEvents,
    private readonly displays: DisplayAllocator,
  ) {
    this.navigation = new Navigation(sessionId, events);
    this.evaluateCap = new Evaluate(events);
    this.editableFocus = new EditableFocus(events);
    this.media = new MediaIngress(sessionId, events);
  }

  async launch(options: BrowserLaunchOptions): Promise<BrowserReadyInfo> {
    this.ensureNotDisposed();
    this.launchOptions = options;
    const validated = validateLaunchViewport(options.width, options.height);
    if (!validated.ok) {
      throw Object.assign(new Error(validated.message), {
        code: 'FAILED_PRECONDITION',
        errorCode: validated.errorCode,
        phase: 'validate',
      });
    }
    const { width, height } = validated;
    const displayNum = this.displays.allocate();

    this.display = await Display.start(displayNum, width, height);
    this.chrome = await launchChrome({
      sessionId: this.sessionId,
      displayEnv: this.display.displayEnv,
      width,
      height,
      device: options.device,
    });

    this.viewport = new Viewport(width, height, options.device);
    await this.navigation.setupSingleTab(this.chrome.context);
    this.navigation.setupTabInterception(this.chrome.context, this.chrome.page);
    this.navigation.setupLocationSync(this.chrome.page);
    await this.navigation.setupFetchGuard(
      this.chrome.cdp,
      options.scripts ?? [],
      options.allowedNavigationDomains,
    );

    const chromeVp = await readChromeViewport(this.chrome.page);
    const active = await this.display.readActiveGeometry();
    if (active.width !== width || active.height !== height) {
      throw new Error(`display ${active.width}×${active.height} != ${width}×${height}`);
    }
    if (chromeVp.width !== width || chromeVp.height !== height) {
      // Soft confirm: some Chrome builds report off-by-one until fullscreen settles
      console.warn(
        `[${this.sessionId}] chrome viewport ${chromeVp.width}×${chromeVp.height} vs ${width}×${height}`,
      );
    }
    this.viewport.confirm(width, height, options.device);

    this.input = new InputController(this.chrome.page, this.chrome.cdp);
    this.input.setTouchPrimary(touchPrimary(options.device));
    this.evaluateCap.attachConsole(this.chrome.page);
    this.editableFocus.start(this.chrome.page);

    this.screencast = await Screencast.start(
      this.chrome.cdp,
      width,
      height,
      (jpeg) => this.events.onVideoFrame(jpeg),
    );

    if (this.pendingState) {
      await this.pageState.restore(this.chrome.cdp, this.chrome.page, this.pendingState);
      this.pendingState = null;
    }

    this.open = true;
    this.bindCrashHandler(this.chrome.context);

    return { width, height };
  }

  async stop(): Promise<void> {
    await this.teardownBrowserResources({ removeUserDataDir: true });
    this.viewport = null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.stop();
    await this.media.dispose();
  }

  async getStatus(): Promise<BrowserStatus> {
    return {
      isOpen: this.open && !this.disposed,
      tabCount: this.chrome?.context.pages().length ?? 0,
      url: this.chrome ? safeUrl(this.chrome.page) : this.url,
      resizing: this.viewport?.isResizing ?? false,
      width: this.viewport?.width ?? 0,
      height: this.viewport?.height ?? 0,
    };
  }

  async restoreState(state: BrowserState): Promise<void> {
    this.pendingState = state;
    if (!this.chrome) return;
    await this.pageState.restore(this.chrome.cdp, this.chrome.page, state);
  }

  async exportState(): Promise<BrowserState> {
    if (!this.chrome) {
      return { cookies: [], localStorage: [], idbRecords: [], history: [] };
    }
    return this.pageState.export(this.chrome.cdp, this.chrome.page);
  }

  async navigate(url: string): Promise<void> {
    this.ensureLive();
    await this.chrome!.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    this.url = url;
    if (this.pendingState) {
      await this.pageState.importLocalStorage(this.chrome!.page, this.pendingState);
      await this.pageState.importIndexedDbForPage(this.chrome!.page, this.pendingState);
    }
  }

  async refresh(): Promise<void> {
    this.ensureLive();
    await this.chrome!.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  async resize(request: BrowserResizeRequest): Promise<BrowserResizeResult> {
    this.ensureLive();
    const validated = validateResizeViewport(request.width, request.height);
    if (!validated.ok) {
      return {
        ok: false,
        width: this.viewport!.width,
        height: this.viewport!.height,
        errorCode: validated.errorCode,
        phase: 'validate',
        message: validated.message,
      };
    }

    const device = request.device;
    const nextW = validated.width;
    const nextH = validated.height;
    const sameSize = nextW === this.viewport!.width && nextH === this.viewport!.height;

    if (this.viewport!.isResizing) {
      return {
        ok: false,
        width: this.viewport!.width,
        height: this.viewport!.height,
        errorCode: 'resize_busy',
        phase: 'validate',
        message: 'another resize is in progress',
      };
    }

    this.viewport!.setResizing(true);
    const previous = {
      width: this.viewport!.width,
      height: this.viewport!.height,
      device: this.viewport!.device,
    };
    let sizeChanged = false;
    try {
      if (sameSize) {
        if (device) {
          await applyDeviceEmulation(this.chrome!.cdp, nextW, nextH, device);
          this.viewport!.confirm(nextW, nextH, device);
          this.input?.setTouchPrimary(touchPrimary(device));
        }
        return {
          ok: true,
          width: nextW,
          height: nextH,
          chromeWidth: nextW,
          chromeHeight: nextH,
          displayWidth: nextW,
          displayHeight: nextH,
        };
      }

      sizeChanged = true;
      await this.recreateAtSize(nextW, nextH, request.device);
      this.viewport!.confirm(nextW, nextH, request.device);
      return {
        ok: true,
        width: nextW,
        height: nextH,
        chromeWidth: nextW,
        chromeHeight: nextH,
        displayWidth: nextW,
        displayHeight: nextH,
      };
    } catch (err) {
      if (sizeChanged) {
        try {
          await this.recreateAtSize(previous.width, previous.height, previous.device ?? undefined);
          this.viewport!.confirm(previous.width, previous.height, previous.device ?? undefined);
        } catch (compErr) {
          const message = (compErr as Error).message?.slice(0, 512) ?? 'compensation failed';
          await this.teardownBrowserResources({ removeUserDataDir: true });
          this.events.onCrash({
            errorCode: 'resize_session_faulted',
            message,
            phase: 'compensate',
          });
          return {
            ok: false,
            width: previous.width,
            height: previous.height,
            errorCode: 'resize_session_faulted',
            phase: 'compensate',
            message,
          };
        }
      }
      return {
        ok: false,
        width: this.viewport?.width ?? previous.width,
        height: this.viewport?.height ?? previous.height,
        errorCode: 'resize_apply_failed',
        phase: 'resize_apply',
        message: (err as Error).message?.slice(0, 512),
      };
    } finally {
      this.viewport?.setResizing(false);
    }
  }

  /**
   * Tear down Chrome+display and relaunch at exact geometry, resuming the prior http(s) URL.
   */
  private async recreateAtSize(
    width: number,
    height: number,
    deviceProfile: BrowserDeviceProfile | undefined,
  ): Promise<void> {
    const resumeUrl = this.chrome ? safeUrl(this.chrome.page) : this.url;
    const displayNum = this.display!.number;

    if (this.screencast) {
      await this.screencast.stop();
      this.screencast = null;
    }
    if (this.chrome) {
      await closeChrome(this.chrome, { removeUserDataDir: false });
      this.chrome = null;
    }
    if (this.display) {
      await this.display.dispose();
      this.display = null;
    }

    this.display = await Display.start(displayNum, width, height);
    this.chrome = await launchChrome({
      sessionId: this.sessionId,
      displayEnv: this.display.displayEnv,
      width,
      height,
      device: deviceProfile,
      preserveUserDataDir: true,
    });

    await this.navigation.setupSingleTab(this.chrome.context);
    this.navigation.setupTabInterception(this.chrome.context, this.chrome.page);
    this.navigation.setupLocationSync(this.chrome.page);
    await this.navigation.setupFetchGuard(
      this.chrome.cdp,
      this.launchOptions?.scripts ?? [],
      this.launchOptions?.allowedNavigationDomains,
    );
    this.input = new InputController(this.chrome.page, this.chrome.cdp);
    this.input.setTouchPrimary(touchPrimary(deviceProfile));
    this.evaluateCap.attachConsole(this.chrome.page);
    this.editableFocus.rebind(this.chrome.page);
    this.editableFocus.start(this.chrome.page);

    this.screencast = await Screencast.start(
      this.chrome.cdp,
      width,
      height,
      (jpeg) => this.events.onVideoFrame(jpeg),
    );

    if (resumeUrl && /^https?:\/\//i.test(resumeUrl)) {
      await this.chrome.page.goto(resumeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      this.url = resumeUrl;
    }

    this.bindCrashHandler(this.chrome.context);
  }

  private bindCrashHandler(context: { on(event: 'close', listener: () => void): void }): void {
    context.on('close', () => {
      this.open = false;
      this.events.onCrash({
        errorCode: 'browser_closed',
        message: 'Chrome context closed',
        phase: 'runtime',
      });
    });
  }

  /** Stop screencast/Chrome/display and clear handles — no Xvfb leak. */
  private async teardownBrowserResources(options?: {
    removeUserDataDir?: boolean;
  }): Promise<void> {
    this.open = false;
    this.editableFocus.stop();
    if (this.screencast) {
      try {
        await this.screencast.stop();
      } catch {
        /* */
      }
      this.screencast = null;
    }
    if (this.chrome) {
      try {
        await closeChrome(this.chrome, {
          removeUserDataDir: options?.removeUserDataDir !== false,
        });
      } catch {
        /* */
      }
      this.chrome = null;
    }
    if (this.display) {
      try {
        await this.display.dispose();
      } catch {
        /* */
      }
      this.display = null;
    }
    this.input = null;
  }

  async probe(request: BrowserProbeRequest): Promise<BrowserProbeResult> {
    this.ensureLive();
    return this.probeCapability.run(request, {
      context: this.chrome!.context,
      page: this.chrome!.page,
      cdp: this.chrome!.cdp,
      display: this.display,
      userDataDir: this.chrome!.userDataDir,
    });
  }

  async evaluate(code: string): Promise<BrowserEvalResult> {
    this.ensureLive();
    return this.evaluateCap.run(this.chrome!.page, code);
  }

  async pushInput(input: BrowserInput): Promise<void> {
    this.ensureLive();
    this.input!.enqueue(input);
  }

  async pushCameraFrame(frame: Uint8Array): Promise<void> {
    await this.media.pushCameraFrame(frame);
  }

  async pushMicrophoneAudio(chunk: Uint8Array): Promise<void> {
    await this.media.pushMicrophoneAudio(chunk);
  }

  private ensureLive(): void {
    this.ensureNotDisposed();
    if (!this.open || !this.chrome || !this.viewport) {
      throw Object.assign(new Error('browser session is not open'), { code: 'FAILED_PRECONDITION' });
    }
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw Object.assign(new Error('browser session disposed'), { code: 'FAILED_PRECONDITION' });
    }
  }
}

function touchPrimary(device?: BrowserDeviceProfile | null): boolean {
  return !!(device?.touch || device?.mobile);
}

function safeUrl(page: { url(): string }): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}
