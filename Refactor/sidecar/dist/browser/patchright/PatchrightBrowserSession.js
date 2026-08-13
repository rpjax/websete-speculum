"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatchrightBrowserSession = void 0;
const ChromeRuntime_1 = require("./ChromeRuntime");
const Display_1 = require("./Display");
const BrowserPoolRegistry_1 = require("./BrowserPoolRegistry");
const device_emulation_1 = require("./device-emulation");
const EditableFocus_1 = require("./EditableFocus");
const Evaluate_1 = require("./Evaluate");
const Input_1 = require("./Input");
const OsInputBackend_1 = require("./input/OsInputBackend");
const PatchrightInputBackend_1 = require("./input/PatchrightInputBackend");
const contextCrash_1 = require("./contextCrash");
const MediaIngress_1 = require("./MediaIngress");
const Navigation_1 = require("./Navigation");
const PageState_1 = require("./PageState");
const Probe_1 = require("./Probe");
const screencast_encode_1 = require("./screencast-encode");
const Viewport_1 = require("./Viewport");
const viewport_bounds_1 = require("./viewport-bounds");
const liveAttach_1 = require("./mirror/page/liveAttach");
const DomElementInput_1 = require("./mirror/dom/DomElementInput");
const EventBridge_1 = require("../../host/EventBridge");
const VideoMirror_1 = require("./mirror/video/VideoMirror");
/**
 * Production BrowserSession: composes Patchright capabilities.
 * No transport / WS / wire codecs.
 *
 * Display is allocated at policy max (from Launch / Sessions.ViewportPolicy);
 * logical viewport follows the client via window bounds + CDP metrics +
 * screencast encode size (never recreate on resize).
 */
class PatchrightBrowserSession {
    sessionId;
    events;
    displays;
    open = false;
    disposed = false;
    display = null;
    chrome = null;
    /** Set when {@link display}/{@link chrome} came from {@link sharedBrowserPool}; teardown calls this instead of closeChrome/Display.dispose (PP-SESS-2 — release destroys, never recycles). */
    releasePooledBrowser = null;
    viewport = null;
    screencast = null;
    videoMirror = null;
    pageProjection = null;
    domElementInput = null;
    detachDomAssets = null;
    input = null;
    navigation;
    pageState = new PageState_1.PageState();
    probeCapability = new Probe_1.Probe();
    evaluateCap;
    editableFocus;
    media;
    url = 'about:blank';
    pendingState = null;
    launchOptions = null;
    /** Sessions.ViewportPolicy bounds from Launch — set before Display.start. */
    viewportPolicy = null;
    /** Sessions.ScreencastPolicy.MaxEncodeScale from Launch/Resize. */
    screencastMaxEncodeScale = 2;
    /** Sessions.MirrorMode from Launch — selects Video vs Dom mirror stack. */
    mirrorMode = 'videoStreaming';
    lastEncodeWidth = 0;
    lastEncodeHeight = 0;
    /** When true, context 'close' is an intentional teardown — do not emit onCrash. */
    suppressContextCrash = false;
    /** Bumped to retire stale context 'close' listeners across stop. */
    crashEpoch = 0;
    inputBackend = null;
    chromeWidth = 0;
    chromeHeight = 0;
    /** PageEpoch parity telemetry — Virtual clock origin, set at the top of {@link launch}. */
    browserLaunchedAtMs = Date.now();
    /**
     * Serializes navigate / refresh / soft resize so CDP metrics and page.goto
     * cannot interleave. Settles even when the op rejects.
     */
    browserOpTail = Promise.resolve();
    constructor(sessionId, events, displays) {
        this.sessionId = sessionId;
        this.events = events;
        this.displays = displays;
        this.navigation = new Navigation_1.Navigation(sessionId, events);
        this.evaluateCap = new Evaluate_1.Evaluate(events);
        this.editableFocus = new EditableFocus_1.EditableFocus(events);
        this.media = new MediaIngress_1.MediaIngress(sessionId, events);
    }
    displayDims() {
        const policy = this.viewportPolicy;
        if (!policy) {
            throw Object.assign(new Error('viewport policy missing'), {
                code: 'FAILED_PRECONDITION',
            });
        }
        return { displayWidth: policy.maxWidth, displayHeight: policy.maxHeight };
    }
    resolveEncodeSize(cssW, cssH, device) {
        const dims = this.displayDims();
        const enc = (0, screencast_encode_1.computeScreencastEncodeSize)({
            cssWidth: cssW,
            cssHeight: cssH,
            deviceScaleFactor: device.deviceScaleFactor ?? 1,
            displayWidth: dims.displayWidth,
            displayHeight: dims.displayHeight,
            maxEncodeScale: this.screencastMaxEncodeScale,
        });
        return { width: enc.width, height: enc.height };
    }
    /** Run exclusive browser mutation (navigate / refresh / resize). */
    runBrowserOp(fn) {
        const run = this.browserOpTail.then(fn, fn);
        this.browserOpTail = run.then(() => undefined, () => undefined);
        return run;
    }
    async launch(options) {
        this.ensureNotDisposed();
        this.browserLaunchedAtMs = Date.now();
        this.launchOptions = options;
        this.viewportPolicy = options.viewportPolicy;
        this.screencastMaxEncodeScale = options.screencastMaxEncodeScale;
        this.mirrorMode = options.mirrorMode;
        const validated = (0, viewport_bounds_1.validateLaunchViewport)(options.width, options.height, options.viewportPolicy);
        if (!validated.ok) {
            throw Object.assign(new Error(validated.message), {
                code: 'FAILED_PRECONDITION',
                errorCode: validated.errorCode,
                phase: 'validate',
            });
        }
        const { width, height } = validated;
        const maxW = options.viewportPolicy.maxWidth;
        const maxH = options.viewportPolicy.maxHeight;
        let osInput = null;
        const isDom = options.mirrorMode === 'pageProjection';
        try {
            const inputMode = (process.env['SPECULUM_INPUT_BACKEND'] ?? 'os').trim().toLowerCase();
            // Dom Projection never opens uinput — CDP element input only.
            if (!isDom && inputMode === 'os') {
                // uinput nodes must exist before Xorg starts (no reliable hotplug without logind).
                osInput = await OsInputBackend_1.OsInputBackend.open({
                    sessionId: this.sessionId,
                    displayWidth: maxW,
                    displayHeight: maxH,
                    logicalWidth: width,
                    logicalHeight: height,
                });
            }
            // §5.13, WP13 — a pre-warmed instance removes Chromium's ~3200ms boot from this
            // session's critical path. Gated to Dom Projection: it never opens OS input, so a
            // generic pre-warmed process (no uinput nodes bound at Xorg start) is always valid.
            const pooled = isDom && (options.browserPoolSize ?? 0) > 0
                ? await BrowserPoolRegistry_1.sharedBrowserPool.tryAcquire({
                    size: options.browserPoolSize,
                    refillPerSec: options.browserPoolRefillPerSec ?? 2,
                    maxWidth: maxW,
                    maxHeight: maxH,
                    displays: this.displays,
                })
                : null;
            if (pooled) {
                const waitMs = 0;
                this.events.onPageProjectionParity?.('parity_session_pool_acquired', {
                    maxWidth: maxW,
                    maxHeight: maxH,
                    poolSize: options.browserPoolSize ?? 0,
                    waitMs,
                });
                const acquiredAt = Date.now();
                const priorRelease = pooled.release.bind(pooled);
                pooled.release = async () => {
                    this.events.onPageProjectionParity?.('parity_session_pool_released', {
                        heldMs: Date.now() - acquiredAt,
                    });
                    await priorRelease();
                };
                await this.adoptPooledBrowser(pooled, options, { maxW, maxH, width, height });
            }
            else {
                // Capacity only — logical client size applied via Chrome window + metrics.
                const displayInputs = osInput
                    ? {
                        ...osInput.resolveEventPaths(),
                        pointerName: osInput.deviceNames[0],
                        keyboardName: osInput.deviceNames[1],
                        touchName: osInput.deviceNames[2],
                    }
                    : undefined;
                const displayNum = this.displays.allocate();
                this.display = await Display_1.Display.start(displayNum, maxW, maxH, displayInputs);
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
                this.chrome = await (0, ChromeRuntime_1.launchChrome)({
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
            }
            if (!this.chrome || !this.display) {
                // Unreachable: both branches above set them or throw first.
                throw Object.assign(new Error('browser launch produced no chrome/display handle'), {
                    code: 'FAILED_PRECONDITION',
                });
            }
            const device = (0, device_emulation_1.resolveDeviceProfile)(options.device);
            this.viewport = new Viewport_1.Viewport(width, height, device);
            if (device.mobile) {
                await (0, device_emulation_1.installMobileViewportMetaInit)(this.chrome.page);
            }
            await this.navigation.setupSingleTab(this.chrome.context);
            this.navigation.setupTabInterception(this.chrome.context, this.chrome.page);
            this.navigation.setupLocationSync(this.chrome.page);
            await this.navigation.setupFetchGuard(this.chrome.cdp, options.scripts ?? [], options.allowedNavigationDomains);
            // Re-prove after tab/guard setup — bounds + metrics must stick for mobile.
            // proveLogicalViewport uses CDP cssLayoutViewport after fresh apply.
            const proven = await (0, device_emulation_1.proveLogicalViewport)(this.chrome.cdp, width, height, device, {
                phase: 'launch',
                context: this.chrome.context,
            });
            const active = await this.display.readActiveGeometry();
            if (active.width !== maxW || active.height !== maxH) {
                throw new Error(`display ${active.width}×${active.height} != allocated ${maxW}×${maxH}`);
            }
            this.viewport.confirm(width, height, proven.device);
            const encode = this.resolveEncodeSize(width, height, proven.device);
            if (isDom) {
                const patchrightBackend = new PatchrightInputBackend_1.PatchrightInputBackend(this.chrome.page, this.chrome.cdp);
                this.inputBackend = 'patchright';
                this.input = new Input_1.InputController(this.chrome.page, patchrightBackend);
                if (this.events instanceof EventBridge_1.EventBridge) {
                    this.events.configureDomCapacity(options.pageProjectionDiffQueueCapacity);
                }
                this.pageProjection = await liveAttach_1.LivePageProjection.start(this.chrome.page, {
                    onPageProjectionDiff: (diff) => this.events.onPageProjectionDiff?.(diff),
                    onGenerationBumped: (event) => this.events.onPageProjectionGenerationBumped?.(event),
                    onSoftNavObserved: (event) => this.events.onPageProjectionSoftNavObserved?.(event),
                    onScrollEchoHit: (event) => this.events.onPageProjectionScrollEchoHit?.(event),
                    onParity: (kind, payload) => this.events.onPageProjectionParity?.(kind, payload),
                }, {
                    browserLaunchedAtMs: this.browserLaunchedAtMs,
                    frameRateHz: options.frameRateHz,
                    maxFrameBytes: options.maxFrameBytes,
                    establishChunkBytes: options.establishChunkBytes,
                    hiddenRateHz: options.hiddenRateHz,
                    rateRecoverMs: options.rateRecoverMs,
                    frameStallMs: options.frameStallMs,
                    rateLadder: options.frameRateLadder,
                    mirrorMaxBytes: options.mirrorMaxBytes,
                    assetCacheL1MaxBytes: options.assetCacheL1MaxBytes,
                    assetPriorityViewportPx: options.assetPriorityViewportPx,
                    aggregateIntervalMs: options.aggregateIntervalMs,
                });
                if (this.events instanceof EventBridge_1.EventBridge) {
                    this.events.setDomBackpressureHandler((paused) => {
                        void (async () => {
                            if (!this.pageProjection)
                                return;
                            if (paused)
                                await this.pageProjection.pauseLiveEmitForBackpressure();
                            else
                                await this.pageProjection.resumeLiveEmitAfterBackpressure();
                        })();
                    });
                }
                this.domElementInput = new DomElementInput_1.DomElementInput(this.chrome.page, this.pageProjection);
                // Asset Fetch intercept deferred — Navigation.setupFetchGuard owns Fetch.enable.
            }
            else {
                const inputBackend = await this.createInputBackend({
                    maxW,
                    maxH,
                    width,
                    height,
                    preopenedOs: osInput,
                });
                this.inputBackend = inputBackend instanceof OsInputBackend_1.OsInputBackend ? 'os' : 'patchright';
                this.input = new Input_1.InputController(this.chrome.page, inputBackend);
                this.videoMirror = await VideoMirror_1.VideoMirror.start(this.chrome.cdp, encode.width, encode.height, (jpeg) => this.events.onVideoFrame(jpeg), width, height);
                this.screencast = this.videoMirror.underlying;
                this.lastEncodeWidth = encode.width;
                this.lastEncodeHeight = encode.height;
            }
            this.input.setTouchPrimary(touchPrimary(device));
            this.chromeWidth = width;
            this.chromeHeight = height;
            this.evaluateCap.attachConsole(this.chrome.page);
            this.editableFocus.start(this.chrome.page);
            if (this.pendingState) {
                await this.pageState.restore(this.chrome.cdp, this.chrome.page, this.pendingState);
                this.pendingState = null;
            }
            this.open = true;
            this.bindCrashHandler(this.chrome.context);
            return { width, height };
        }
        catch (err) {
            const fault = err;
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
                }
                catch {
                    /* best-effort */
                }
            }
            await this.teardownBrowserResources({ removeUserDataDir: true });
            this.viewport = null;
            throw err;
        }
    }
    /**
     * Adopts a pre-warmed {Display, ChromeHandle} pair from {@link sharedBrowserPool} and
     * re-applies this session's real locale/timezone/colorScheme/geolocation/language —
     * the pool warmed with generic, credential-less defaults (never this session's
     * identity). Viewport/device metrics are re-applied unconditionally later in
     * {@link launch} via `proveLogicalViewport`, so they need no special handling here.
     */
    async adoptPooledBrowser(pooled, options, dims) {
        const proc = pooled.process;
        this.display = proc.display;
        this.chrome = proc.chrome;
        this.releasePooledBrowser = pooled.release;
        this.emitAllocationLifecycle({
            kind: 'display_allocated',
            displayWidth: dims.maxW,
            displayHeight: dims.maxH,
            logicalWidth: dims.width,
            logicalHeight: dims.height,
        });
        const { cdp, context } = this.chrome;
        // Pool launch may already have stamped locale/timezone (generic en-US/UTC). Clear
        // before re-applying the session's values — CDP rejects a second override otherwise.
        try {
            await cdp.send('Emulation.setLocaleOverride', { locale: '' });
        }
        catch {
            /* already clear / unsupported */
        }
        try {
            await cdp.send('Emulation.setLocaleOverride', { locale: options.locale });
        }
        catch {
            /* Accept-Language header below still carries language */
        }
        try {
            await cdp.send('Emulation.setTimezoneOverride', { timezoneId: '' });
        }
        catch {
            /* already clear */
        }
        try {
            await cdp.send('Emulation.setTimezoneOverride', { timezoneId: options.timeZoneId });
        }
        catch {
            /* keep pool default if CDP still blocks */
        }
        if (options.colorScheme === 'light' || options.colorScheme === 'dark') {
            try {
                await cdp.send('Emulation.setEmulatedMedia', {
                    features: [{ name: 'prefers-color-scheme', value: options.colorScheme }],
                });
            }
            catch {
                /* optional */
            }
        }
        if (options.geolocation) {
            try {
                await cdp.send('Emulation.setGeolocationOverride', {
                    latitude: options.geolocation.latitude,
                    longitude: options.geolocation.longitude,
                    accuracy: options.geolocation.accuracy,
                });
            }
            catch {
                /* optional */
            }
        }
        await context.setExtraHTTPHeaders({ 'Accept-Language': options.language });
    }
    async stop() {
        await this.teardownBrowserResources({ removeUserDataDir: true });
        this.viewport = null;
    }
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        await this.stop();
        await this.media.dispose();
    }
    async getStatus() {
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
    getTelemetrySnapshot() {
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
    async restoreState(state) {
        this.pendingState = state;
        if (!this.chrome) {
            return this.pageState.normalizeStats(state);
        }
        return this.pageState.restore(this.chrome.cdp, this.chrome.page, state);
    }
    async exportState() {
        if (!this.chrome) {
            return { cookies: [], localStorage: [], idbRecords: [], history: [] };
        }
        return this.pageState.export(this.chrome.cdp, this.chrome.page);
    }
    async navigate(url) {
        this.ensureLive();
        await this.runBrowserOp(async () => {
            this.ensureLive();
            this.editableFocus.stop();
            this.pageProjection?.notePendingNavigation('goto');
            try {
                await this.chrome.page.goto(url, { waitUntil: 'commit', timeout: 30_000 });
                // Navigation can drop mobile CSS layout back to the legacy ~980px width
                // when the page lacks viewport meta — reinject + re-apply metrics.
                await (0, device_emulation_1.reassertLogicalViewportAfterNavigation)(this.chrome.cdp, this.viewport.width, this.viewport.height, this.viewport.device, this.chrome.context);
            }
            catch (err) {
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
            }
            finally {
                if (this.open && this.chrome) {
                    this.editableFocus.start(this.chrome.page);
                }
            }
            this.url = url;
            if (this.pageProjection) {
                await this.pageProjection.establishBoot();
            }
            if (this.pendingState) {
                try {
                    await this.pageState.importLocalStorage(this.chrome.page, this.pendingState);
                    await this.pageState.importIndexedDbForPage(this.chrome.page, this.pendingState);
                }
                catch {
                    /* page may navigate away again before import finishes */
                }
            }
        });
    }
    async refresh() {
        this.ensureLive();
        await this.runBrowserOp(async () => {
            this.ensureLive();
            this.editableFocus.stop();
            this.pageProjection?.notePendingNavigation('reload');
            try {
                await this.chrome.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
                await (0, device_emulation_1.reassertLogicalViewportAfterNavigation)(this.chrome.cdp, this.viewport.width, this.viewport.height, this.viewport.device, this.chrome.context);
            }
            catch (err) {
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
            }
            finally {
                if (this.open && this.chrome) {
                    this.editableFocus.start(this.chrome.page);
                }
            }
        });
    }
    async resize(request) {
        this.ensureLive();
        if (request.screencastMaxEncodeScale !== undefined
            && Number.isFinite(request.screencastMaxEncodeScale)
            && request.screencastMaxEncodeScale > 0) {
            this.screencastMaxEncodeScale = Math.min(2, Math.max(1, request.screencastMaxEncodeScale));
        }
        const validated = (0, viewport_bounds_1.validateResizeViewport)(request.width, request.height, this.viewportPolicy);
        if (!validated.ok) {
            return {
                ok: false,
                width: this.viewport.width,
                height: this.viewport.height,
                errorCode: validated.errorCode,
                phase: 'validate',
                message: validated.message,
                ...this.displayDims(),
            };
        }
        const nextW = validated.width;
        const nextH = validated.height;
        const nextDevice = (0, device_emulation_1.resolveDeviceProfile)(request.device ?? this.viewport.device);
        // Fast no-op outside the op lock when already at target (avoids queueing behind navigate).
        if (nextW === this.viewport.width
            && nextH === this.viewport.height
            && (0, device_emulation_1.deviceProfilesEqual)(this.viewport.device, nextDevice)
            && !this.viewport.isResizing) {
            return {
                ok: true,
                width: nextW,
                height: nextH,
                chromeWidth: nextW,
                chromeHeight: nextH,
                ...this.displayDims(),
            };
        }
        if (this.viewport.isResizing) {
            return {
                ok: false,
                width: this.viewport.width,
                height: this.viewport.height,
                errorCode: 'resize_busy',
                phase: 'validate',
                message: 'another resize is in progress',
                ...this.displayDims(),
            };
        }
        return this.runBrowserOp(() => this.resizeExclusive(nextW, nextH, nextDevice));
    }
    async resizeExclusive(nextW, nextH, nextDevice) {
        this.ensureLive();
        const previous = {
            width: this.viewport.width,
            height: this.viewport.height,
            device: this.viewport.device,
        };
        // Re-check after waiting behind navigate/refresh/prior resize.
        if (nextW === previous.width
            && nextH === previous.height
            && (0, device_emulation_1.deviceProfilesEqual)(previous.device, nextDevice)) {
            return {
                ok: true,
                width: previous.width,
                height: previous.height,
                chromeWidth: previous.width,
                chromeHeight: previous.height,
                ...this.displayDims(),
            };
        }
        if (this.viewport.isResizing) {
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
        this.viewport.setResizing(true);
        let screencastTouched = false;
        const prevEncodeW = this.lastEncodeWidth;
        const prevEncodeH = this.lastEncodeHeight;
        const nextEncode = this.resolveEncodeSize(nextW, nextH, nextDevice);
        const sizeChanged = nextW !== previous.width || nextH !== previous.height;
        const encodeChanged = nextEncode.width !== prevEncodeW || nextEncode.height !== prevEncodeH;
        const screencastNeedsRestart = sizeChanged || encodeChanged;
        try {
            // Pause encode before metrics so old-size frames are not filtered into a black gap.
            // Dom Projection has no screencast — skip restart.
            if (screencastNeedsRestart && this.mirrorMode === 'videoStreaming') {
                if (!this.screencast) {
                    throw new Error('screencast missing during resize');
                }
                screencastTouched = true;
                await this.screencast.pauseForRestart();
            }
            await (0, device_emulation_1.proveLogicalViewport)(this.chrome.cdp, nextW, nextH, nextDevice, {
                phase: 'resize_apply',
                context: this.chrome.context,
            });
            if (screencastNeedsRestart && this.screencast) {
                await this.screencast.completeRestart(nextEncode.width, nextEncode.height, (jpeg) => this.events.onVideoFrame(jpeg), this.chrome.cdp, nextW, nextH);
                this.lastEncodeWidth = nextEncode.width;
                this.lastEncodeHeight = nextEncode.height;
            }
            this.viewport.confirm(nextW, nextH, nextDevice);
            this.input?.setTouchPrimary(touchPrimary(nextDevice));
            this.chromeWidth = nextW;
            this.chromeHeight = nextH;
            const backend = this.input?.backend;
            if (backend instanceof OsInputBackend_1.OsInputBackend) {
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
        }
        catch (err) {
            // Soft compensate — never recreate Chrome/Xvfb. If compensate fails, fault the session.
            if (!this.chrome || !this.open) {
                return {
                    ok: false,
                    width: previous.width,
                    height: previous.height,
                    errorCode: 'session_gone',
                    phase: 'resize_apply',
                    message: err.message?.slice(0, 512) ?? 'session gone during resize',
                    ...this.displayDims(),
                };
            }
            try {
                await (0, device_emulation_1.proveLogicalViewport)(this.chrome.cdp, previous.width, previous.height, previous.device, { phase: 'compensate', context: this.chrome.context });
                // Only reattach screencast if the forward path already paused it.
                if (screencastTouched && this.screencast) {
                    await this.screencast.completeRestart(prevEncodeW, prevEncodeH, (jpeg) => this.events.onVideoFrame(jpeg), this.chrome.cdp, previous.width, previous.height);
                    this.lastEncodeWidth = prevEncodeW;
                    this.lastEncodeHeight = prevEncodeH;
                }
                this.viewport.confirm(previous.width, previous.height, previous.device ?? undefined);
                this.input?.setTouchPrimary(touchPrimary(previous.device));
                const backend = this.input?.backend;
                if (backend instanceof OsInputBackend_1.OsInputBackend) {
                    backend.setLogicalSize(previous.width, previous.height);
                }
                this.chromeWidth = previous.width;
                this.chromeHeight = previous.height;
            }
            catch (compErr) {
                const message = compErr.message?.slice(0, 512) ?? 'compensate failed';
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
                message: err.message?.slice(0, 512),
                ...this.displayDims(),
            };
        }
        finally {
            this.viewport?.setResizing(false);
        }
    }
    bindCrashHandler(context) {
        // New live context — unexpected closes must emit onCrash again.
        const epoch = ++this.crashEpoch;
        this.suppressContextCrash = false;
        context.on('close', () => {
            if (!(0, contextCrash_1.shouldEmitContextCrash)({
                listenerEpoch: epoch,
                currentEpoch: this.crashEpoch,
                suppress: this.suppressContextCrash,
            })) {
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
    async createInputBackend(args) {
        const mode = (process.env['SPECULUM_INPUT_BACKEND'] ?? 'os').trim().toLowerCase();
        if (mode === 'patchright') {
            console.warn(`[sidecar] SPECULUM_INPUT_BACKEND=patchright — using CDP input (lab only; not production OS path)`);
            return new PatchrightInputBackend_1.PatchrightInputBackend(this.chrome.page, this.chrome.cdp);
        }
        if (mode !== 'os') {
            throw Object.assign(new Error(`SPECULUM_INPUT_BACKEND must be "os" or "patchright" (got "${mode}")`), { code: 'FAILED_PRECONDITION', errorCode: 'invalid_input_backend', phase: 'launch' });
        }
        const backend = args.preopenedOs ??
            (await OsInputBackend_1.OsInputBackend.create({
                sessionId: this.sessionId,
                displayEnv: this.display.displayEnv,
                displayWidth: args.maxW,
                displayHeight: args.maxH,
                logicalWidth: args.width,
                logicalHeight: args.height,
            }));
        backend.setInsertText(async (text) => {
            await this.chrome.cdp.send('Input.insertText', { text });
        });
        return backend;
    }
    /** Stop screencast/Chrome/display and clear handles — no Xvfb leak. */
    async teardownBrowserResources(options) {
        // Stay suppressed after teardown so a deferred context 'close' cannot emit a false onCrash.
        // Cleared only when bindCrashHandler runs for a new live context.
        this.suppressContextCrash = true;
        this.crashEpoch++;
        this.open = false;
        this.editableFocus.stop();
        if (this.input) {
            try {
                await this.input.dispose();
            }
            catch {
                /* */
            }
            this.input = null;
        }
        if (this.screencast) {
            try {
                await this.screencast.stop();
            }
            catch {
                /* */
            }
            this.screencast = null;
        }
        this.videoMirror = null;
        if (this.detachDomAssets) {
            try {
                await this.detachDomAssets();
            }
            catch {
                /* */
            }
            this.detachDomAssets = null;
        }
        if (this.pageProjection) {
            try {
                await this.pageProjection.stop();
            }
            catch {
                /* */
            }
            this.pageProjection = null;
        }
        this.domElementInput = null;
        if (this.releasePooledBrowser) {
            // PP-SESS-2 — release destroys this instance; it is never recycled or handed to
            // another session. Fires the same 'display_released' telemetry as the direct path.
            const dims = this.displayDimsOrZero();
            this.emitAllocationLifecycle({
                kind: 'display_released',
                displayWidth: dims.displayWidth,
                displayHeight: dims.displayHeight,
                logicalWidth: this.viewport?.width,
                logicalHeight: this.viewport?.height,
                inputBackend: this.inputBackend ?? undefined,
            });
            const release = this.releasePooledBrowser;
            this.releasePooledBrowser = null;
            try {
                await release();
            }
            catch {
                /* */
            }
            this.chrome = null;
            this.display = null;
        }
        else {
            if (this.chrome) {
                try {
                    await (0, ChromeRuntime_1.closeChrome)(this.chrome, {
                        removeUserDataDir: options?.removeUserDataDir !== false,
                    });
                }
                catch {
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
                }
                catch {
                    /* */
                }
                this.display = null;
            }
        }
        this.inputBackend = null;
        this.chromeWidth = 0;
        this.chromeHeight = 0;
        this.viewportPolicy = null;
    }
    async probe(request) {
        this.ensureLive();
        return this.probeCapability.run(request, {
            context: this.chrome.context,
            page: this.chrome.page,
            cdp: this.chrome.cdp,
            display: this.display,
            userDataDir: this.chrome.userDataDir,
        });
    }
    async evaluate(code) {
        this.ensureLive();
        return this.evaluateCap.run(this.chrome.page, code);
    }
    async pushInput(input) {
        this.ensureLive();
        if (input.type === 'goback' || input.type === 'goforward') {
            this.pageProjection?.notePendingNavigation('back_forward');
        }
        this.input.enqueue(input);
    }
    async pushDomInput(input) {
        this.ensureLive();
        if (this.mirrorMode !== 'pageProjection' || !this.domElementInput) {
            throw Object.assign(new Error('PageProjection input requires MirrorMode.PageProjection'), {
                code: 'FAILED_PRECONDITION',
                errorCode: 'mirror_mode_mismatch',
                phase: 'input',
            });
        }
        return await this.domElementInput.dispatch(input);
    }
    reportPageProjectionClientState(state) {
        if (this.mirrorMode !== 'pageProjection' || !this.pageProjection)
            return;
        this.pageProjection.reportClientState(state);
    }
    async getDomAsset(key, opts) {
        this.ensureLive();
        if (!this.pageProjection || !key)
            return null;
        let lookup = key;
        const kind = (opts?.kind ?? '').toLowerCase();
        if (kind === 'blob')
            lookup = key.startsWith('_blob/') ? key : `_blob/${key}`;
        else if (kind === 'data')
            lookup = key.startsWith('_data/') ? key : `_data/${key}`;
        else if (kind === '' || kind === 'asset') {
            // Align with DomAssetEndpoints serve key (`host/path?q`, no /w7s/virtual-assets/).
            const prefix = '/w7s/virtual-assets/';
            if (lookup.startsWith(prefix))
                lookup = lookup.slice(prefix.length);
        }
        // §5.12.2 — only a plain "asset" fetch (never blob/data, which are session-synthesized,
        // never origin subresources) is ever eligible for the API's SharedAssetCacheL2 tier.
        const isAssetKind = kind === '' || kind === 'asset';
        const hit = this.pageProjection.getAsset(lookup);
        if (hit && hit.body.byteLength > 0 && hit.mode === 'cache' && !opts?.rangeHeader) {
            return {
                body: hit.body,
                contentType: hit.contentType,
                statusCode: 200,
                ...(isAssetKind ? shareabilityFields(hit.shareability) : {}),
            };
        }
        if (hit?.mode === 'pass-through' || opts?.rangeHeader || (hit && hit.body.byteLength === 0)) {
            const pt = await this.pageProjection.fetchPassThrough(lookup, opts?.rangeHeader);
            if (!pt)
                return hit && hit.body.byteLength > 0
                    ? { body: hit.body, contentType: hit.contentType, statusCode: 200 }
                    : null;
            return {
                body: pt.body,
                contentType: pt.contentType,
                statusCode: pt.statusCode,
                contentRange: pt.contentRange,
                passThrough: pt.mode !== 'cache',
                ...(isAssetKind ? shareabilityFields(pt.shareability) : {}),
            };
        }
        if (hit && hit.body.byteLength > 0) {
            return { body: hit.body, contentType: hit.contentType, statusCode: 200 };
        }
        // Warm miss: try pass-through reconstruct from key as https URL.
        const pt = await this.pageProjection.fetchPassThrough(lookup, opts?.rangeHeader);
        if (!pt)
            return null;
        return {
            body: pt.body,
            contentType: pt.contentType,
            statusCode: pt.statusCode,
            contentRange: pt.contentRange,
            passThrough: pt.mode !== 'cache',
            ...(isAssetKind ? shareabilityFields(pt.shareability) : {}),
        };
    }
    async getPageProjectionResync(_hint) {
        this.ensureLive();
        if (!this.pageProjection)
            return null;
        const snap = await this.pageProjection.captureResyncSnapshot();
        if (!snap)
            return null;
        return {
            generation: snap.generation,
            coversThroughSequence: snap.coversThroughSequence,
            frameParts: snap.parts,
            pageEpochId: snap.pageEpochId,
            source: snap.source,
            domMapMs: snap.domMapMs,
            cssomCloneMs: snap.cssomCloneMs,
            rewriteMs: snap.rewriteMs,
            serializeMs: snap.serializeMs,
        };
    }
    async putDomUpload(id, body, contentType, name) {
        this.ensureLive();
        this.pageProjection?.putUpload(id, Buffer.from(body), contentType, name);
    }
    async pushCameraFrame(frame) {
        await this.media.pushCameraFrame(frame);
    }
    async pushMicrophoneAudio(chunk) {
        await this.media.pushMicrophoneAudio(chunk);
    }
    displayDimsOrZero() {
        if (this.display) {
            return { displayWidth: this.display.width, displayHeight: this.display.height };
        }
        try {
            return this.displayDims();
        }
        catch {
            return { displayWidth: 0, displayHeight: 0 };
        }
    }
    emitAllocationLifecycle(signal) {
        this.events.onAllocationLifecycle?.(signal);
    }
    ensureLive() {
        this.ensureNotDisposed();
        if (!this.open || !this.chrome || !this.viewport) {
            throw Object.assign(new Error('browser session is not open'), { code: 'FAILED_PRECONDITION' });
        }
    }
    ensureNotDisposed() {
        if (this.disposed) {
            throw Object.assign(new Error('browser session disposed'), { code: 'FAILED_PRECONDITION' });
        }
    }
}
exports.PatchrightBrowserSession = PatchrightBrowserSession;
function touchPrimary(device) {
    return (0, device_emulation_1.isInputTouchPrimary)(device);
}
function safeUrl(page) {
    try {
        return page.url();
    }
    catch {
        return '';
    }
}
/**
 * §5.12.2.1 — flattens the sidecar's `DomAssetShareability` into the wire-response shape
 * `GrpcSessionMappers.ToDomAsset` reads, so the API's `SharedAssetCacheL2` predicate always
 * sees the signals from the exact fetch that produced this body (never re-derived/guessed).
 */
function shareabilityFields(s) {
    if (!s)
        return {};
    return {
        requestHadCookie: s.requestHadCookie,
        requestHadAuthorization: s.requestHadAuthorization,
        cacheControl: s.cacheControl,
        vary: s.vary,
    };
}
//# sourceMappingURL=PatchrightBrowserSession.js.map