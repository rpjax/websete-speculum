"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatchrightBrowserSession = void 0;
const ChromeRuntime_1 = require("./ChromeRuntime");
const Display_1 = require("./Display");
const device_emulation_1 = require("./device-emulation");
const EditableFocus_1 = require("./EditableFocus");
const Evaluate_1 = require("./Evaluate");
const Input_1 = require("./Input");
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
        const { width, height } = (0, viewport_bounds_1.normalizeStartViewport)(options.width, options.height);
        const device = (0, device_emulation_1.normalizeDevice)(options.device);
        const displayNum = this.displays.allocate();
        this.display = await Display_1.Display.start(displayNum, width, height);
        this.chrome = await (0, ChromeRuntime_1.launchChrome)({
            sessionId: this.sessionId,
            displayEnv: this.display.displayEnv,
            width,
            height,
            device: options.device,
        });
        this.viewport = new Viewport_1.Viewport(width, height, device);
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
        this.viewport.confirm(width, height, device);
        this.input = new Input_1.InputController(this.chrome.page, this.chrome.cdp);
        this.input.setTouchPrimary(!!(device.touch || device.mobile));
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
        await this.chrome.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        this.url = url;
        if (this.pendingState) {
            await this.pageState.importLocalStorage(this.chrome.page, this.pendingState);
            await this.pageState.importIndexedDbForPage(this.chrome.page, this.pendingState);
        }
    }
    async refresh() {
        this.ensureLive();
        await this.chrome.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
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
        const device = (0, device_emulation_1.normalizeDevice)(request.device);
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
                await (0, device_emulation_1.applyDeviceEmulation)(this.chrome.cdp, nextW, nextH, device);
                this.viewport.confirm(nextW, nextH, device);
                this.input?.setTouchPrimary(!!(device.touch || device.mobile));
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
            this.viewport.confirm(nextW, nextH, device);
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
                    await this.recreateAtSize(previous.width, previous.height, previous.device);
                    this.viewport.confirm(previous.width, previous.height, previous.device);
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
        const device = (0, device_emulation_1.normalizeDevice)(deviceProfile);
        const resumeUrl = this.chrome ? safeUrl(this.chrome.page) : this.url;
        const displayNum = this.display.number;
        if (this.screencast) {
            await this.screencast.stop();
            this.screencast = null;
        }
        if (this.chrome) {
            await (0, ChromeRuntime_1.closeChrome)(this.chrome, { removeUserDataDir: false });
            this.chrome = null;
        }
        if (this.display) {
            await this.display.dispose();
            this.display = null;
        }
        this.display = await Display_1.Display.start(displayNum, width, height);
        this.chrome = await (0, ChromeRuntime_1.launchChrome)({
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
        await this.navigation.setupFetchGuard(this.chrome.cdp, this.launchOptions?.scripts ?? [], this.launchOptions?.allowedNavigationDomains);
        this.input = new Input_1.InputController(this.chrome.page, this.chrome.cdp);
        this.input.setTouchPrimary(!!(device.touch || device.mobile));
        this.evaluateCap.attachConsole(this.chrome.page);
        this.editableFocus.rebind(this.chrome.page);
        this.editableFocus.start(this.chrome.page);
        this.screencast = await Screencast_1.Screencast.start(this.chrome.cdp, width, height, (jpeg) => this.events.onVideoFrame(jpeg));
        if (resumeUrl && /^https?:\/\//i.test(resumeUrl)) {
            await this.chrome.page.goto(resumeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            this.url = resumeUrl;
        }
        this.bindCrashHandler(this.chrome.context);
    }
    bindCrashHandler(context) {
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
    async teardownBrowserResources(options) {
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
function safeUrl(page) {
    try {
        return page.url();
    }
    catch {
        return '';
    }
}
//# sourceMappingURL=PatchrightBrowserSession.js.map