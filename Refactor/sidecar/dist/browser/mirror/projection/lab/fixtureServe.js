"use strict";
/**
 * Lab fixture HTTP — CSP header + meta for locale-popup repro (Binance-class).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSP_NAV_LOCALE_POLICY = void 0;
exports.fixtureServeHeaders = fixtureServeHeaders;
exports.pipeFixtureFile = pipeFixtureFile;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** Matches csp-nav-locale-*.html meta + unit runSingleTabLocaleCspPlaneUnitTests. */
exports.CSP_NAV_LOCALE_POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.binance.com; img-src 'self' https: data: blob:";
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.woff2': 'font/woff2',
};
function fixtureServeHeaders(filePath) {
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    const headers = {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
    };
    const base = node_path_1.default.basename(filePath);
    if (base.startsWith('csp-nav-locale-')) {
        headers['Content-Security-Policy'] = exports.CSP_NAV_LOCALE_POLICY;
        headers['Cache-Control'] = 'no-store';
    }
    return headers;
}
function pipeFixtureFile(res, filePath) {
    if (!node_fs_1.default.existsSync(filePath) || !node_fs_1.default.statSync(filePath).isFile()) {
        res.writeHead(404).end('not found');
        return;
    }
    res.writeHead(200, fixtureServeHeaders(filePath));
    node_fs_1.default.createReadStream(filePath).pipe(res);
}
//# sourceMappingURL=fixtureServe.js.map