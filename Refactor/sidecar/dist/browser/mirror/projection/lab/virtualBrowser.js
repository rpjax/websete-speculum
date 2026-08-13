"use strict";
/**
 * Patchright Chromium for Virtual — injects real virtual.js + config pre-script.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchVirtualBrowser = launchVirtualBrowser;
exports.labAssetRoots = labAssetRoots;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const patchright_1 = require("patchright");
const buildConfigPreScript_1 = require("../inject/buildConfigPreScript");
const loadInpageScript_1 = require("../inject/loadInpageScript");
const telemetry_1 = require("../models/telemetry");
function chromeArgs() {
    // Parent §5.3.4 — background timer throttling must be off for Virtual.
    return [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--no-first-run',
        '--no-default-browser-check',
    ];
}
async function launchVirtualBrowser(opts) {
    // Ensure bundle exists (clear message if build:virtual was skipped).
    (0, loadInpageScript_1.loadInpageScript)();
    const configPre = (0, buildConfigPreScript_1.buildConfigPreScript)({
        transport: 'loopback',
        dataPlaneUrl: opts.dataPlaneUrl,
        frameRateHz: opts.frameRateHz ?? 60,
        telemetry: (opts.telemetry ?? telemetry_1.LAB_TELEMETRY_DEFAULTS),
    });
    const mainScript = (0, loadInpageScript_1.loadInpageScript)();
    const browser = await patchright_1.chromium.launch({
        headless: opts.headless,
        args: chromeArgs(),
    });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    await page.addInitScript({ content: configPre });
    await page.addInitScript({ content: mainScript });
    await page.goto(opts.startUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    return {
        page,
        async navigate(url) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        },
        async close() {
            await browser.close();
        },
    };
}
/** Resolve lab static / fixture roots for both ts-node and compiled dist layouts. */
function labAssetRoots() {
    const candidates = [
        node_path_1.default.join(__dirname, 'static'),
        node_path_1.default.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static'),
        node_path_1.default.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', 'lab', 'static'),
    ];
    const staticDir = candidates.find((p) => node_fs_1.default.existsSync(p)) ??
        node_path_1.default.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static');
    return {
        staticDir,
        fixturesDir: node_path_1.default.join(staticDir, 'fixtures'),
    };
}
//# sourceMappingURL=virtualBrowser.js.map