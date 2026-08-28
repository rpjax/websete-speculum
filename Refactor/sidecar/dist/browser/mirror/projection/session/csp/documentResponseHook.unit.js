"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDocumentResponseHookUnitTests = runDocumentResponseHookUnitTests;
const assert_1 = __importDefault(require("assert"));
const documentResponseHook_1 = require("./documentResponseHook");
/**
 * Unit: root Fetch.enable + OOPIF frame gets its own CDPSession Fetch.enable
 * (option A via context.newCDPSession(frame)).
 */
async function runDocumentResponseHookUnitTests() {
    const calls = [];
    const handlers = new Map();
    const makeSession = (label) => {
        const sessionCalls = [];
        const session = {
            label,
            send: async (method, params) => {
                calls.push({ method, params, label });
                sessionCalls.push({ method, params });
                return {};
            },
            on: (event, fn) => {
                const list = handlers.get(`${label}:${event}`) ?? [];
                list.push(fn);
                handlers.set(`${label}:${event}`, list);
            },
            sessionCalls,
        };
        return session;
    };
    const root = makeSession('root');
    const frameSession = makeSession('frame');
    const childFrame = { url: () => 'https://challenges.cloudflare.com/turnstile' };
    const mainFrame = { url: () => 'https://www.eneba.com/' };
    const frameListeners = [];
    const page = {
        mainFrame: () => mainFrame,
        frames: () => [mainFrame, childFrame],
        on: (event, fn) => {
            if (event === 'frameattached' || event === 'framenavigated') {
                frameListeners.push(fn);
            }
        },
    };
    const context = {
        newCDPSession: async (target) => {
            assert_1.default.strictEqual(target, childFrame);
            return frameSession;
        },
    };
    await (0, documentResponseHook_1.installDocumentResponseHook)(root, {
        storedScripts: [{ file: '/__speculum/virtual.js', content: 'window.__OK=1' }],
        mutators: [(ctx) => ({ headers: ctx.headers, bodyHtml: ctx.bodyHtml, changed: false })],
        page,
        context,
    });
    assert_1.default.ok(root.sessionCalls.some((c) => c.method === 'Fetch.enable'), 'must Fetch.enable on page session');
    assert_1.default.ok(frameSession.sessionCalls.some((c) => c.method === 'Fetch.enable'), 'must Fetch.enable on OOPIF frame session');
    assert_1.default.ok(handlers.has('root:Fetch.requestPaused'), 'must listen Fetch.requestPaused on root');
    assert_1.default.ok(handlers.has('frame:Fetch.requestPaused'), 'must listen Fetch.requestPaused on frame');
    // Script fulfill on frame session.
    const onPaused = handlers.get('frame:Fetch.requestPaused')[0];
    const pausedP = onPaused({
        requestId: 'req-1',
        request: { url: 'https://challenges.cloudflare.com/__speculum/virtual.js' },
        resourceType: 'Script',
    });
    await pausedP;
    assert_1.default.ok(frameSession.sessionCalls.some((c) => c.method === 'Fetch.fulfillRequest' &&
        c.params.responseCode === 200), 'frame Script /__speculum/virtual.js must be fulfilled');
    console.log('[unit] documentResponseHook OOPIF frame CDPSession fulfill ok');
    await runDocumentResponseHookHeaderFallbackUnitTests();
}
/** getResponseBody failure must still continue with relaxed enforcing CSP headers. */
async function runDocumentResponseHookHeaderFallbackUnitTests() {
    const strictCsp = "default-src 'self'; connect-src 'self' https://*.binance.com; script-src 'self'";
    const calls = [];
    const send = async (method, params) => {
        calls.push({ method, params });
        if (method === 'Fetch.getResponseBody') {
            throw new Error('simulated huge body CDP limit');
        }
        return {};
    };
    await (0, documentResponseHook_1.handleDocumentResponsePausedForTest)(send, {
        requestId: 'doc-huge-1',
        responseStatusCode: 200,
        responseHeaders: [
            { name: 'Content-Type', value: 'text/html; charset=utf-8' },
            { name: 'Content-Security-Policy', value: strictCsp },
        ],
        request: { url: 'https://www.binance.com/' },
    }, new Map(), [documentResponseHook_1.cspDocumentMutator]);
    const continued = calls.filter((c) => c.method === 'Fetch.continueResponse');
    assert_1.default.strictEqual(continued.length, 1, JSON.stringify(calls.map((c) => c.method)));
    const hdrs = (continued[0].params?.responseHeaders ?? []);
    const csp = hdrs.find((h) => h.name.toLowerCase() === 'content-security-policy')?.value ?? '';
    assert_1.default.ok(/\bconnect-src\b[^;]*\*/.test(csp), `connect-src widened in header fallback: ${csp}`);
    assert_1.default.ok(/\bws:/.test(csp), `ws: in header fallback: ${csp}`);
    assert_1.default.ok(!calls.some((c) => c.method === 'Fetch.continueResponse' && !c.params?.responseHeaders));
    console.log('[unit] documentResponseHook header fallback on getResponseBody fail ok');
}
//# sourceMappingURL=documentResponseHook.unit.js.map