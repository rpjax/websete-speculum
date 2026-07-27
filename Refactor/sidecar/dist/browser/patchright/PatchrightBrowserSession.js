"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatchrightBrowserSession = void 0;
const ChromeRuntime_1 = require("./ChromeRuntime");
const Display_1 = require("./Display");
const device_emulation_1 = require("./device-emulation");
const EditableFocus_1 = require("./EditableFocus");
const Evaluate_1 = require("./Evaluate");
const Input_1 = require("./Input");
const contextCrash_1 = require("./contextCrash");
const MediaIngress_1 = require("./MediaIngress");
const Navigation_1 = require("./Navigation");
const PageState_1 = require("./PageState");
const Probe_1 = require("./Probe");
const Screencast_1 = require("./Screencast");
const Viewport_1 = require("./Viewport");
const viewport_bounds_1 = require("./viewport-bounds");
/**
 * Production BrowserSession: composes Patchright capabilities.
 * No transport / WS / wire codecs.
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
    /** When true, context 'close' is an intentional teardown — do not emit onCrash. */
    suppressContextCrash = false;
    /** Bumped to retire stale context 'close' listeners across stop/recreate. */
    crashEpoch = 0;
    constructor(sessionId, events, displays) {
        this.sessionId = sessionId;
        this.events = events;
        this.displays = displays;
        this.navigation = new Navigation_1.Navigation(sessionId, events);
        this.evaluateCap = new Evaluate_1.Evaluate(events);
        this.editableFocus = new EditableFocus_1.EditableFocus(events);
        this.media = new MediaIngress_1.MediaIngress(sessionId, events);
    }
    async launch(options) {
        this.ensureNotDisposed();
        this.launchOptions = options;
        const validated = (0, viewport_bounds_1.validateLaunchViewport)(options.width, options.height);
        if (!validated.ok) {
            throw Object.assign(new Error(validated.message), {
                code: 'FAILED_PRECONDITION',
                errorCode: validated.errorCode,
                phase: 'validate',
            });
        }
        const { width, height } = validated;
        const displayNum = this.displays.allocate();
        this.display = await Display_1.Display.start(displayNum, width, height);
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
        this.viewport = new Viewport_1.Viewport(width, height, options.device);
        await this.navigation.setupSingleTab(this.chrome.context);
        this.navigation.setupTabInterception(this.chrome.context, this.chrome.page);
        this.navigation.setupLocationSync(this.chrome.page);
        await this.navigation.setupFetchGuard(this.chrome.cdp, options.scripts ?? [], options.allowedNavigationDomains);
        const chromeVp = await (0, device_emulation_1.readChromeViewport)(this.chrome.page);
        const active = await this.display.readActiveGeometry();
        if (active.width !== width || active.height !== height) {
            throw new Error(`display ${active.width}×${active.height} != ${width}×${height}`);
        }
        if (chromeVp.width !== width || chromeVp.height !== height) {
            // Soft confirm: some Chrome builds report off-by-one until fullscreen settles
            console.warn(`[${this.sessionId}] chrome viewport ${chromeVp.width}×${chromeVp.height} vs ${width}×${height}`);
        }
        this.viewport.confirm(width, height, options.device);
        this.input = new Input_1.InputController(this.chrome.page, this.chrome.cdp);
        this.input.setTouchPrimary(touchPrimary(options.device));
        this.evaluateCap.attachConsole(this.chrome.page);
        this.editableFocus.start(this.chrome.page);
        this.screencast = await Screencast_1.Screencast.start(this.chrome.cdp, width, height, (jpeg) => this.events.onVideoFrame(jpeg));
        if (this.pendingState) {
            await this.pageState.restore(this.chrome.cdp, this.chrome.page, this.pendingState);
            this.pendingState = null;
        }
        this.open = true;
        this.bindCrashHandler(this.chrome.context);
        return { width, height };
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
        return {
            isOpen: this.open && !this.disposed,
            tabCount: this.chrome?.context.pages().length ?? 0,
            url: this.chrome ? safeUrl(this.chrome.page) : this.url,
            resizing: this.viewport?.isResizing ?? false,
            width: this.viewport?.width ?? 0,
            height: this.viewport?.height ?? 0,
        };
    }
    async restoreState(state) {
        this.pendingState = state;
        if (!this.chrome)
            return;
        await this.pageState.restore(this.chrome.cdp, this.chrome.page, state);
    }
    async exportState() {
        if (!this.chrome) {
            return { cookies: [], localStorage: [], idbRecords: [], history: [] };
        }
        return this.pageState.export(this.chrome.cdp, this.chrome.page);
    }
    async navigate(url) {
        this.ensureLive();
        this.editableFocus.stop();
        this.input?.setSuspended(true);
        try {
            await this.chrome.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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
            this.input?.setSuspended(false);
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
    }
    async refresh() {
        this.ensureLive();
        this.editableFocus.stop();
        this.input?.setSuspended(true);
        try {
            await this.chrome.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
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
            this.input?.setSuspended(false);
            if (this.open && this.chrome) {
                this.editableFocus.start(this.chrome.page);
            }
        }
    }
    async resize(request) {
        this.ensureLive();
        const validated = (0, viewport_bounds_1.validateResizeViewport)(request.width, request.height);
        if (!validated.ok) {
            return {
                ok: false,
                width: this.viewport.width,
                height: this.viewport.height,
                errorCode: validated.errorCode,
                phase: 'validate',
                message: validated.message,
            };
        }
        const device = request.device;
        const nextW = validated.width;
        const nextH = validated.height;
        const sameSize = nextW === this.viewport.width && nextH === this.viewport.height;
        if (this.viewport.isResizing) {
            return {
                ok: false,
                width: this.viewport.width,
                height: this.viewport.height,
                errorCode: 'resize_busy',
                phase: 'validate',
                message: 'another resize is in progress',
            };
        }
        this.viewport.setResizing(true);
        const previous = {
            width: this.viewport.width,
            height: this.viewport.height,
            device: this.viewport.device,
        };
        let sizeChanged = false;
        try {
            if (sameSize) {
                if (device) {
                    await (0, device_emulation_1.applyDeviceEmulation)(this.chrome.cdp, nextW, nextH, device);
                    this.viewport.confirm(nextW, nextH, device);
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
            const nextDevice = device ?? previous.device ?? undefined;
            await this.recreateAtSize(nextW, nextH, nextDevice);
            this.viewport.confirm(nextW, nextH, nextDevice);
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
        catch (err) {
            if (sizeChanged) {
                try {
                    await this.recreateAtSize(previous.width, previous.height, previous.device ?? undefined);
                    this.viewport.confirm(previous.width, previous.height, previous.device ?? undefined);
                }
                catch (compErr) {
                    const message = compErr.message?.slice(0, 512) ?? 'compensation failed';
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
                message: err.message?.slice(0, 512),
            };
        }
        finally {
            this.viewport?.setResizing(false);
        }
    }
    /**
     * Tear down Chrome+display and relaunch at exact geometry, resuming the prior http(s) URL.
     */
    async recreateAtSize(width, height, deviceProfile) {
        const resumeUrl = this.chrome ? safeUrl(this.chrome.page) : this.url;
        const displayNum = this.display.number;
        // Intentional teardown for resize — must not enqueue onCrash (same contract as stop()).
        this.suppressContextCrash = true;
        this.crashEpoch++;
        this.open = false;
        this.editableFocus.stop();
        this.input?.setSuspended(true);
        if (this.screencast) {
            await this.screencast.stop();
            this.screencast = null;
        }
        if (this.chrome) {
            await (0, ChromeRuntime_1.closeChrome)(this.chrome, { removeUserDataDir: false });
            this.chrome = null;
        }
        this.input = null;
        if (this.display) {
            await this.display.dispose();
            this.display = null;
        }
        const launchOptions = this.launchOptions;
        if (!launchOptions) {
            throw new Error('cannot recreate Chrome before launch options are captured');
        }
        this.display = await Display_1.Display.start(displayNum, width, height);
        this.chrome = await (0, ChromeRuntime_1.launchChrome)({
            sessionId: this.sessionId,
            displayEnv: this.display.displayEnv,
            width,
            height,
            locale: launchOptions.locale,
            language: launchOptions.language,
            timeZoneId: launchOptions.timeZoneId,
            colorScheme: launchOptions.colorScheme,
            geolocation: launchOptions.geolocation,
            device: deviceProfile,
            preserveUserDataDir: true,
        });
        await this.navigation.setupSingleTab(this.chrome.context);
        this.navigation.setupTabInterception(this.chrome.context, this.chrome.page);
        this.navigation.setupLocationSync(this.chrome.page);
        await this.navigation.setupFetchGuard(this.chrome.cdp, this.launchOptions?.scripts ?? [], this.launchOptions?.allowedNavigationDomains);
        this.input = new Input_1.InputController(this.chrome.page, this.chrome.cdp);
        this.input.setTouchPrimary(touchPrimary(deviceProfile));
        this.input.setSuspended(true);
        this.evaluateCap.attachConsole(this.chrome.page);
        this.editableFocus.rebind(this.chrome.page);
        // Do not start EditableFocus until after resume goto (same contract as navigate).
        this.screencast = await Screencast_1.Screencast.start(this.chrome.cdp, width, height, (jpeg) => this.events.onVideoFrame(jpeg));
        this.open = true;
        this.bindCrashHandler(this.chrome.context);
        try {
            if (resumeUrl && /^https?:\/\//i.test(resumeUrl)) {
                await this.chrome.page.goto(resumeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                this.url = resumeUrl;
            }
        }
        finally {
            this.input?.setSuspended(false);
            if (this.open && this.chrome) {
                this.editableFocus.start(this.chrome.page);
            }
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
    /** Stop screencast/Chrome/display and clear handles — no Xvfb leak. */
    async teardownBrowserResources(options) {
        // Stay suppressed after teardown so a deferred context 'close' cannot emit a false onCrash.
        // Cleared only when bindCrashHandler runs for a new live context.
        this.suppressContextCrash = true;
        this.crashEpoch++;
        this.open = false;
        this.editableFocus.stop();
        if (this.screencast) {
            try {
                await this.screencast.stop();
            }
            catch {
                /* */
            }
            this.screencast = null;
        }
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
            try {
                await this.display.dispose();
            }
            catch {
                /* */
            }
            this.display = null;
        }
        this.input = null;
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
    async pushCameraFrame(frame) {
        await this.media.pushCameraFrame(frame);
    }
    async pushMicrophoneAudio(chunk) {
        await this.media.pushMicrophoneAudio(chunk);
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