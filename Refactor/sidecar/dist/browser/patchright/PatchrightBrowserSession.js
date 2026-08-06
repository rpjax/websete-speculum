"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatchrightBrowserSession = void 0;
const ChromeRuntime_1 = require("./ChromeRuntime");
const Display_1 = require("./Display");
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
const DomProjection_1 = require("./mirror/dom/DomProjection");
const DomElementInput_1 = require("./mirror/dom/DomElementInput");
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
    viewport = null;
    screencast = null;
    videoMirror = null;
    domProjection = null;
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
        const displayNum = this.displays.allocate();
        const maxW = options.viewportPolicy.maxWidth;
        const maxH = options.viewportPolicy.maxHeight;
        let osInput = null;
        const isDom = options.mirrorMode === 'domProjection';
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
            // Capacity only — logical client size applied via Chrome window + metrics.
            const displayInputs = osInput
                ? {
                    ...osInput.resolveEventPaths(),
                    pointerName: osInput.deviceNames[0],
                    keyboardName: osInput.deviceNames[1],
                    touchName: osInput.deviceNames[2],
                }
                : undefined;
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
                this.domProjection = await DomProjection_1.DomProjection.start(this.chrome.page, {
                    onDomDiff: (diff) => this.events.onDomDiff?.(diff),
                    onGenerationBumped: (event) => this.events.onDomProjectionGenerationBumped?.(event),
                });
                this.domElementInput = new DomElementInput_1.DomElementInput(this.chrome.page, this.domProjection);
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
            try {
                await this.chrome.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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
        if (this.domProjection) {
            try {
                await this.domProjection.stop();
            }
            catch {
                /* */
            }
            this.domProjection = null;
        }
        this.domElementInput = null;
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
        this.input.enqueue(input);
    }
    async pushDomInput(input) {
        this.ensureLive();
        if (this.mirrorMode !== 'domProjection' || !this.domElementInput) {
            throw Object.assign(new Error('DomProjection input requires MirrorMode.DomProjection'), {
                code: 'FAILED_PRECONDITION',
                errorCode: 'mirror_mode_mismatch',
                phase: 'input',
            });
        }
        return await this.domElementInput.dispatch(input);
    }
    async getDomAsset(key, opts) {
        this.ensureLive();
        if (!this.domProjection || !key)
            return null;
        let lookup = key;
        const kind = (opts?.kind ?? '').toLowerCase();
        if (kind === 'blob')
            lookup = key.startsWith('_blob/') ? key : `_blob/${key}`;
        else if (kind === 'data')
            lookup = key.startsWith('_data/') ? key : `_data/${key}`;
        const hit = this.domProjection.getAsset(lookup);
        if (hit && hit.body.byteLength > 0 && hit.mode === 'cache' && !opts?.rangeHeader) {
            return { body: hit.body, contentType: hit.contentType, statusCode: 200 };
        }
        if (hit?.mode === 'pass-through' || opts?.rangeHeader || (hit && hit.body.byteLength === 0)) {
            const pt = await this.domProjection.fetchPassThrough(lookup, opts?.rangeHeader);
            if (!pt)
                return hit && hit.body.byteLength > 0
                    ? { body: hit.body, contentType: hit.contentType, statusCode: 200 }
                    : null;
            return {
                body: pt.body,
                contentType: pt.contentType,
                statusCode: pt.statusCode,
                contentRange: pt.contentRange,
                passThrough: true,
            };
        }
        if (hit && hit.body.byteLength > 0) {
            return { body: hit.body, contentType: hit.contentType, statusCode: 200 };
        }
        // Warm miss: try pass-through reconstruct from key as https URL.
        const pt = await this.domProjection.fetchPassThrough(lookup, opts?.rangeHeader);
        if (!pt)
            return null;
        return {
            body: pt.body,
            contentType: pt.contentType,
            statusCode: pt.statusCode,
            contentRange: pt.contentRange,
            passThrough: true,
        };
    }
    async putDomUpload(id, body, contentType, name) {
        this.ensureLive();
        this.domProjection?.putUpload(id, Buffer.from(body), contentType, name);
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
//# sourceMappingURL=PatchrightBrowserSession.js.map