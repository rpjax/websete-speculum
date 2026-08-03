import type {
  AllocationLifecycleSignal,
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
  BrowserTelemetrySnapshot,
  CookieNormalizeStats,
} from '../BrowserSession';
import { closeChrome, launchChrome, type ChromeHandle } from './ChromeRuntime';
import { Display, type DisplayAllocator } from './Display';
import {
  deviceProfilesEqual,
  installMobileViewportMetaInit,
  isInputTouchPrimary,
  proveLogicalViewport,
  reassertLogicalViewportAfterNavigation,
  resolveDeviceProfile,
} from './device-emulation';
import { EditableFocus } from './EditableFocus';
import { Evaluate } from './Evaluate';
import { InputController } from './Input';
import { OsInputBackend } from './input/OsInputBackend';
import { PatchrightInputBackend } from './input/PatchrightInputBackend';
import type { InputBackend } from './input/InputBackend';
import { shouldEmitContextCrash } from './contextCrash';
import { MediaIngress } from './MediaIngress';
import { Navigation } from './Navigation';
import { PageState } from './PageState';
import { Probe as ProbeCapability } from './Probe';
import { Screencast } from './Screencast';
import { Viewport } from './Viewport';
import {
  validateLaunchViewport,
  validateResizeViewport,
  type ViewportPolicyBounds,
} from './viewport-bounds';

/**
 * Production BrowserSession: composes Patchright capabilities.
 * No transport / WS / wire codecs.
 *
 * Display is allocated at policy max (from Launch / Sessions.ViewportPolicy);
 * logical viewport follows the client via window bounds + CDP metrics +
 * screencast encode size (never recreate on resize).
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
  /** Sessions.ViewportPolicy bounds from Launch — set before Display.start. */
  private viewportPolicy: ViewportPolicyBounds | null = null;
  /** When true, context 'close' is an intentional teardown — do not emit onCrash. */
  private suppressContextCrash = false;
  /** Bumped to retire stale context 'close' listeners across stop. */
  private crashEpoch = 0;
  private inputBackend: 'os' | 'patchright' | null = null;
  private chromeWidth = 0;
  private chromeHeight = 0;
  /**
   * Serializes navigate / refresh / soft resize so CDP metrics and page.goto
   * cannot interleave. Settles even when the op rejects.
   */
  private browserOpTail: Promise<void> = Promise.resolve();

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

  private displayDims(): { displayWidth: number; displayHeight: number } {
    const policy = this.viewportPolicy;
    if (!policy) {
      throw Object.assign(new Error('viewport policy missing'), {
        code: 'FAILED_PRECONDITION',
      });
    }
    return { displayWidth: policy.maxWidth, displayHeight: policy.maxHeight };
  }

  /** Run exclusive browser mutation (navigate / refresh / resize). */
  private runBrowserOp<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.browserOpTail.then(fn, fn);
    this.browserOpTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async launch(options: BrowserLaunchOptions): Promise<BrowserReadyInfo> {
    this.ensureNotDisposed();
    this.launchOptions = options;
    this.viewportPolicy = options.viewportPolicy;
    const validated = validateLaunchViewport(
      options.width,
      options.height,
      options.viewportPolicy,
    );
    if (!validated.ok) {
      throw Object.assign(new Error(validated.message), {
        code: 'FAILED_PRECONDITION',
        errorCode: validated.errorCode,
        phase: 'validate',
      });
    }
    const { width, height } = validated;
    const displayNum = this.displays.allocate();
    const maxW = options.viewportPolicy.maxWidth;
    const maxH = options.viewportPolicy.maxHeight;
    let osInput: OsInputBackend | null = null;

    try {
      const inputMode = (process.env['SPECULUM_INPUT_BACKEND'] ?? 'os').trim().toLowerCase();
      if (inputMode === 'os') {
        // uinput nodes must exist before Xorg starts (no reliable hotplug without logind).
        osInput = await OsInputBackend.open({
          sessionId: this.sessionId,
          displayWidth: maxW,
          displayHeight: maxH,
          logicalWidth: width,
          logicalHeight: height,
        });
      }

      // Capacity only — logical client size applied via Chrome window + metrics.
      const displayInputs = osInput
        ? {
            ...osInput.resolveEventPaths(),
            pointerName: osInput.deviceNames[0]!,
            keyboardName: osInput.deviceNames[1]!,
            touchName: osInput.deviceNames[2]!,
          }
        : undefined;
      this.display = await Display.start(displayNum, maxW, maxH, displayInputs);
      this.emitAllocationLifecycle({
        kind: 'display_allocated',
        displayWidth: maxW,
        displayHeight: maxH,
        logicalWidth: width,
        logicalHeight: height,
      });
      if (osInput) {
        await osInput.attachToDisplay(this.display.displayEnv);
      }
      this.chrome = await launchChrome({
        sessionId: this.sessionId,
        displayEnv: this.display.displayEnv,
        width,
        height,
        locale: options.locale,
        language: options.language,
        timeZoneId: options.timeZoneId,
        colorScheme: options.colorScheme,
        geolocation: options.geolocation,
        device: options.device,
      });

      const device = resolveDeviceProfile(options.device);
      this.viewport = new Viewport(width, height, device);
      if (device.mobile) {
        await installMobileViewportMetaInit(this.chrome.page);
      }
      await this.navigation.setupSingleTab(this.chrome.context);
      this.navigation.setupTabInterception(this.chrome.context, this.chrome.page);
      this.navigation.setupLocationSync(this.chrome.page);
      await this.navigation.setupFetchGuard(
        this.chrome.cdp,
        options.scripts ?? [],
        options.allowedNavigationDomains,
      );

      // Re-prove after tab/guard setup — bounds + metrics must stick for mobile.
      // proveLogicalViewport uses CDP cssLayoutViewport after fresh apply.
      const proven = await proveLogicalViewport(this.chrome.cdp, width, height, device, {
        phase: 'launch',
        context: this.chrome.context,
      });
      const active = await this.display.readActiveGeometry();
      if (active.width !== maxW || active.height !== maxH) {
        throw new Error(`display ${active.width}×${active.height} != allocated ${maxW}×${maxH}`);
      }
      this.viewport.confirm(width, height, proven.device);

      const inputBackend = await this.createInputBackend({
        maxW,
        maxH,
        width,
        height,
        preopenedOs: osInput,
      });
      this.inputBackend = inputBackend instanceof OsInputBackend ? 'os' : 'patchright';
      this.input = new InputController(this.chrome.page, inputBackend);
      this.input.setTouchPrimary(touchPrimary(device));
      this.chromeWidth = width;
      this.chromeHeight = height;
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
    } catch (err) {
      const fault = err as Error & { errorCode?: string; phase?: string };
      this.emitAllocationLifecycle({
        kind: 'allocation_faulted',
        displayWidth: maxW,
        displayHeight: maxH,
        logicalWidth: width,
        logicalHeight: height,
        inputBackend: this.inputBackend ?? undefined,
        errorCode: fault.errorCode ?? 'launch_failed',
        phase: fault.phase ?? 'launch',
        reason: fault.message?.slice(0, 256),
      });
      // Partial launch must not leak Xvfb/Chrome — API may keep the session id until dispose.
      if (osInput && !this.input) {
        try {
          await osInput.dispose();
        } catch {
          /* best-effort */
        }
      }
      await this.teardownBrowserResources({ removeUserDataDir: true });
      this.viewport = null;
      throw err;
    }
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
    const dims = this.displayDimsOrZero();
    return {
      isOpen: this.open && !this.disposed,
      tabCount: this.chrome?.context.pages().length ?? 0,
      url: this.chrome ? safeUrl(this.chrome.page) : this.url,
      resizing: this.viewport?.isResizing ?? false,
      width: this.viewport?.width ?? 0,
      height: this.viewport?.height ?? 0,
      displayWidth: dims.displayWidth,
      displayHeight: dims.displayHeight,
      chromeWidth: this.chromeWidth,
      chromeHeight: this.chromeHeight,
    };
  }

  getTelemetrySnapshot(): BrowserTelemetrySnapshot {
    const dims = this.displayDimsOrZero();
    const device = this.viewport?.device ?? null;
    return {
      inputPendingCount: this.input?.pendingCount ?? 0,
      inputChainDepth: this.input?.chainDepth ?? 0,
      displayAllocated: this.display !== null,
      displayWidth: dims.displayWidth,
      displayHeight: dims.displayHeight,
      logicalWidth: this.viewport?.width ?? 0,
      logicalHeight: this.viewport?.height ?? 0,
      chromeWidth: this.chromeWidth,
      chromeHeight: this.chromeHeight,
      inputBackend: this.inputBackend ?? undefined,
      touchPrimary: touchPrimary(device),
      userDataDirPresent: Boolean(this.chrome?.userDataDir),
    };
  }

  async restoreState(state: BrowserState): Promise<CookieNormalizeStats> {
    this.pendingState = state;
    if (!this.chrome) {
      return this.pageState.normalizeStats(state);
    }
    return this.pageState.restore(this.chrome.cdp, this.chrome.page, state);
  }

  async exportState(): Promise<BrowserState> {
    if (!this.chrome) {
      return { cookies: [], localStorage: [], idbRecords: [], history: [] };
    }
    return this.pageState.export(this.chrome.cdp, this.chrome.page);
  }

  async navigate(url: string): Promise<void> {
    this.ensureLive();
    await this.runBrowserOp(async () => {
      this.ensureLive();
      this.editableFocus.stop();
      try {
        await this.chrome!.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        // Navigation can drop mobile CSS layout back to the legacy ~980px width
        // when the page lacks viewport meta — reinject + re-apply metrics.
        await reassertLogicalViewportAfterNavigation(
          this.chrome!.cdp,
          this.viewport!.width,
          this.viewport!.height,
          this.viewport!.device,
          this.chrome!.context,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Detached frames / closed targets are session faults, not process crashes.
        if (/frame was detached|target closed|has been closed|navigation interrupted|navigating.*interrupted/i.test(message)) {
          throw Object.assign(new Error(`navigate failed: ${message}`), {
            code: 'ABORTED',
            errorCode: 'navigate_failed',
            phase: 'goto',
          });
        }
        throw err;
      } finally {
        if (this.open && this.chrome) {
          this.editableFocus.start(this.chrome.page);
        }
      }
      this.url = url;
      if (this.pendingState) {
        try {
          await this.pageState.importLocalStorage(this.chrome!.page, this.pendingState);
          await this.pageState.importIndexedDbForPage(this.chrome!.page, this.pendingState);
        } catch {
          /* page may navigate away again before import finishes */
        }
      }
    });
  }

  async refresh(): Promise<void> {
    this.ensureLive();
    await this.runBrowserOp(async () => {
      this.ensureLive();
      this.editableFocus.stop();
      try {
        await this.chrome!.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        await reassertLogicalViewportAfterNavigation(
          this.chrome!.cdp,
          this.viewport!.width,
          this.viewport!.height,
          this.viewport!.device,
          this.chrome!.context,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Same class as navigate: detached frames / closed targets are session faults.
        if (/frame was detached|target closed|has been closed|navigation interrupted|navigating.*interrupted/i.test(message)) {
          throw Object.assign(new Error(`refresh failed: ${message}`), {
            code: 'ABORTED',
            errorCode: 'refresh_failed',
            phase: 'reload',
          });
        }
        throw err;
      } finally {
        if (this.open && this.chrome) {
          this.editableFocus.start(this.chrome.page);
        }
      }
    });
  }

  async resize(request: BrowserResizeRequest): Promise<BrowserResizeResult> {
    this.ensureLive();
    const validated = validateResizeViewport(
      request.width,
      request.height,
      this.viewportPolicy!,
    );
    if (!validated.ok) {
      return {
        ok: false,
        width: this.viewport!.width,
        height: this.viewport!.height,
        errorCode: validated.errorCode,
        phase: 'validate',
        message: validated.message,
        ...this.displayDims(),
      };
    }

    const nextW = validated.width;
    const nextH = validated.height;
    const nextDevice = resolveDeviceProfile(request.device ?? this.viewport!.device);

    // Fast no-op outside the op lock when already at target (avoids queueing behind navigate).
    if (
      nextW === this.viewport!.width
      && nextH === this.viewport!.height
      && deviceProfilesEqual(this.viewport!.device, nextDevice)
      && !this.viewport!.isResizing
    ) {
      return {
        ok: true,
        width: nextW,
        height: nextH,
        chromeWidth: nextW,
        chromeHeight: nextH,
        ...this.displayDims(),
      };
    }

    if (this.viewport!.isResizing) {
      return {
        ok: false,
        width: this.viewport!.width,
        height: this.viewport!.height,
        errorCode: 'resize_busy',
        phase: 'validate',
        message: 'another resize is in progress',
        ...this.displayDims(),
      };
    }

    return this.runBrowserOp(() => this.resizeExclusive(nextW, nextH, nextDevice));
  }

  private async resizeExclusive(
    nextW: number,
    nextH: number,
    nextDevice: BrowserDeviceProfile,
  ): Promise<BrowserResizeResult> {
    this.ensureLive();
    const previous = {
      width: this.viewport!.width,
      height: this.viewport!.height,
      device: this.viewport!.device,
    };

    // Re-check after waiting behind navigate/refresh/prior resize.
    if (
      nextW === previous.width
      && nextH === previous.height
      && deviceProfilesEqual(previous.device, nextDevice)
    ) {
      return {
        ok: true,
        width: previous.width,
        height: previous.height,
        chromeWidth: previous.width,
        chromeHeight: previous.height,
        ...this.displayDims(),
      };
    }

    if (this.viewport!.isResizing) {
      return {
        ok: false,
        width: previous.width,
        height: previous.height,
        errorCode: 'resize_busy',
        phase: 'validate',
        message: 'another resize is in progress',
        ...this.displayDims(),
      };
    }

    this.viewport!.setResizing(true);
    let screencastTouched = false;
    const sizeChanged = nextW !== previous.width || nextH !== previous.height;
    try {
      // Pause encode before metrics so old-size frames are not filtered into a black gap.
      if (sizeChanged) {
        if (!this.screencast) {
          throw new Error('screencast missing during resize');
        }
        screencastTouched = true;
        await this.screencast.pauseForRestart();
      }
      await proveLogicalViewport(this.chrome!.cdp, nextW, nextH, nextDevice, {
        phase: 'resize_apply',
        context: this.chrome!.context,
      });
      if (sizeChanged) {
        await this.screencast!.completeRestart(
          nextW,
          nextH,
          (jpeg) => this.events.onVideoFrame(jpeg),
          this.chrome!.cdp,
        );
      }
      this.viewport!.confirm(nextW, nextH, nextDevice);
      this.input?.setTouchPrimary(touchPrimary(nextDevice));
      this.chromeWidth = nextW;
      this.chromeHeight = nextH;
      const backend = this.input?.backend;
      if (backend instanceof OsInputBackend) {
        backend.setLogicalSize(nextW, nextH);
      }
      return {
        ok: true,
        width: nextW,
        height: nextH,
        chromeWidth: nextW,
        chromeHeight: nextH,
        ...this.displayDims(),
      };
    } catch (err) {
      // Soft compensate — never recreate Chrome/Xvfb. If compensate fails, fault the session.
      if (!this.chrome || !this.open) {
        return {
          ok: false,
          width: previous.width,
          height: previous.height,
          errorCode: 'session_gone',
          phase: 'resize_apply',
          message: (err as Error).message?.slice(0, 512) ?? 'session gone during resize',
          ...this.displayDims(),
        };
      }
      try {
        await proveLogicalViewport(
          this.chrome.cdp,
          previous.width,
          previous.height,
          previous.device,
          { phase: 'compensate', context: this.chrome.context },
        );
        // Only reattach screencast if the forward path already paused it.
        if (screencastTouched && this.screencast) {
          await this.screencast.completeRestart(
            previous.width,
            previous.height,
            (jpeg) => this.events.onVideoFrame(jpeg),
            this.chrome.cdp,
          );
        }
        this.viewport!.confirm(previous.width, previous.height, previous.device ?? undefined);
        this.input?.setTouchPrimary(touchPrimary(previous.device));
        const backend = this.input?.backend;
        if (backend instanceof OsInputBackend) {
          backend.setLogicalSize(previous.width, previous.height);
        }
        this.chromeWidth = previous.width;
        this.chromeHeight = previous.height;
      } catch (compErr) {
        const message = (compErr as Error).message?.slice(0, 512) ?? 'compensate failed';
        await this.teardownBrowserResources({ removeUserDataDir: true });
        this.viewport = null;
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
          ...this.displayDims(),
        };
      }
      return {
        ok: false,
        width: previous.width,
        height: previous.height,
        errorCode: 'resize_apply_failed',
        phase: 'resize_apply',
        message: (err as Error).message?.slice(0, 512),
        ...this.displayDims(),
      };
    } finally {
      this.viewport?.setResizing(false);
    }
  }

  private bindCrashHandler(context: { on(event: 'close', listener: () => void): void }): void {
    // New live context — unexpected closes must emit onCrash again.
    const epoch = ++this.crashEpoch;
    this.suppressContextCrash = false;
    context.on('close', () => {
      if (
        !shouldEmitContextCrash({
          listenerEpoch: epoch,
          currentEpoch: this.crashEpoch,
          suppress: this.suppressContextCrash,
        })
      ) {
        return;
      }
      this.open = false;
      this.events.onCrash({
        errorCode: 'browser_closed',
        message: 'Chrome context closed unexpectedly',
        phase: 'runtime',
      });
    });
  }

  /**
   * Production default is OS uinput (fail closed).
   * SPECULUM_INPUT_BACKEND=patchright is an explicit lab escape for hosts
   * without /dev/uinput (e.g. Docker Desktop WSL2) — never a silent fallback.
   */
  private async createInputBackend(args: {
    maxW: number;
    maxH: number;
    width: number;
    height: number;
    preopenedOs: OsInputBackend | null;
  }): Promise<InputBackend> {
    const mode = (process.env['SPECULUM_INPUT_BACKEND'] ?? 'os').trim().toLowerCase();
    if (mode === 'patchright') {
      console.warn(
        `[sidecar] SPECULUM_INPUT_BACKEND=patchright — using CDP input (lab only; not production OS path)`,
      );
      return new PatchrightInputBackend(this.chrome!.page, this.chrome!.cdp);
    }
    if (mode !== 'os') {
      throw Object.assign(
        new Error(`SPECULUM_INPUT_BACKEND must be "os" or "patchright" (got "${mode}")`),
        { code: 'FAILED_PRECONDITION', errorCode: 'invalid_input_backend', phase: 'launch' },
      );
    }
    const backend =
      args.preopenedOs ??
      (await OsInputBackend.create({
        sessionId: this.sessionId,
        displayEnv: this.display!.displayEnv,
        displayWidth: args.maxW,
        displayHeight: args.maxH,
        logicalWidth: args.width,
        logicalHeight: args.height,
      }));
    backend.setInsertText(async (text) => {
      await this.chrome!.cdp.send('Input.insertText', { text });
    });
    return backend;
  }

  /** Stop screencast/Chrome/display and clear handles — no Xvfb leak. */
  private async teardownBrowserResources(options?: {
    removeUserDataDir?: boolean;
  }): Promise<void> {
    // Stay suppressed after teardown so a deferred context 'close' cannot emit a false onCrash.
    // Cleared only when bindCrashHandler runs for a new live context.
    this.suppressContextCrash = true;
    this.crashEpoch++;
    this.open = false;
    this.editableFocus.stop();
    if (this.input) {
      try {
        await this.input.dispose();
      } catch {
        /* */
      }
      this.input = null;
    }
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
      const dims = this.displayDimsOrZero();
      this.emitAllocationLifecycle({
        kind: 'display_released',
        displayWidth: dims.displayWidth,
        displayHeight: dims.displayHeight,
        logicalWidth: this.viewport?.width,
        logicalHeight: this.viewport?.height,
        inputBackend: this.inputBackend ?? undefined,
      });
      try {
        await this.display.dispose();
      } catch {
        /* */
      }
      this.display = null;
    }
    this.inputBackend = null;
    this.chromeWidth = 0;
    this.chromeHeight = 0;
    this.viewportPolicy = null;
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

  private displayDimsOrZero(): { displayWidth: number; displayHeight: number } {
    if (this.display) {
      return { displayWidth: this.display.width, displayHeight: this.display.height };
    }
    try {
      return this.displayDims();
    } catch {
      return { displayWidth: 0, displayHeight: 0 };
    }
  }

  private emitAllocationLifecycle(signal: AllocationLifecycleSignal): void {
    this.events.onAllocationLifecycle?.(signal);
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
  return isInputTouchPrimary(device);
}

function safeUrl(page: { url(): string }): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}
