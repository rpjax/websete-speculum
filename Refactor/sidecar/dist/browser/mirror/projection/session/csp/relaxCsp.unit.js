"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRelaxCspUnitTests = runRelaxCspUnitTests;
const assert_1 = __importDefault(require("assert"));
const relaxCsp_1 = require("./relaxCsp");
function runRelaxCspUnitTests() {
    assert_1.default.strictEqual((0, relaxCsp_1.relaxCspPolicy)("default-src 'self'; img-src https:"), "default-src 'self'; img-src https:; connect-src 'self' * data: blob: ws: wss:; script-src 'self' 'unsafe-inline'");
    const withConnect = (0, relaxCsp_1.relaxCspPolicy)("default-src 'self'; connect-src 'self'");
    assert_1.default.ok(withConnect.includes("connect-src 'self' * data: blob: ws: wss:"));
    assert_1.default.ok(withConnect.includes("script-src 'self' 'unsafe-inline'"));
    assert_1.default.ok(withConnect.includes("default-src 'self'"));
    // No nonce → only unsafe-inline on script; no network compensation.
    const noNonce = (0, relaxCsp_1.relaxCspPolicy)("script-src 'self'; img-src https:");
    assert_1.default.ok(noNonce.includes("script-src 'self' 'unsafe-inline'"));
    assert_1.default.ok(!/\bscript-src[^;]* \*/.test(noNonce), `must not force * without strip: ${noNonce}`);
    assert_1.default.ok(!/\bscript-src[^;]* blob:/.test(noNonce), `must not force blob: without strip: ${noNonce}`);
    assert_1.default.ok(noNonce.includes('img-src https:'));
    // Nonce + strict-dynamic → strip + compensation on script-src.
    const withNonce = (0, relaxCsp_1.relaxCspPolicy)("script-src 'self' 'nonce-abc' 'strict-dynamic'; img-src https:");
    assert_1.default.ok(!withNonce.includes("'nonce-abc'"), `nonce stripped: ${withNonce}`);
    assert_1.default.ok(!withNonce.includes("'strict-dynamic'"), `strict-dynamic stripped: ${withNonce}`);
    assert_1.default.ok(withNonce.includes("'unsafe-inline'"));
    assert_1.default.ok(/\bscript-src[^;]*\*/.test(withNonce), `* compensation: ${withNonce}`);
    assert_1.default.ok(/\bscript-src[^;]*blob:/.test(withNonce), `blob: compensation: ${withNonce}`);
    assert_1.default.ok(/\bscript-src[^;]*data:/.test(withNonce), `data: compensation: ${withNonce}`);
    assert_1.default.ok(withNonce.includes('img-src https:'), `img-src preserved: ${withNonce}`);
    assert_1.default.ok(withNonce.includes("'self'"), `host preserved: ${withNonce}`);
    // Hash triggers same compensation.
    const withHash = (0, relaxCsp_1.relaxCspPolicy)("script-src 'sha256-deadbeef=' 'self'");
    assert_1.default.ok(!withHash.includes("'sha256-deadbeef='"), `hash stripped: ${withHash}`);
    assert_1.default.ok(/\bscript-src[^;]*\*/.test(withHash));
    assert_1.default.ok(withHash.includes("'unsafe-inline'"));
    // unsafe-eval preserved; still gets compensation when nonce stripped.
    const withEval = (0, relaxCsp_1.relaxCspPolicy)("script-src 'nonce-x' 'unsafe-eval'");
    assert_1.default.ok(!withEval.includes("'nonce-x'"));
    assert_1.default.ok(withEval.includes("'unsafe-eval'"), `unsafe-eval kept: ${withEval}`);
    assert_1.default.ok(/\bscript-src[^;]*\*/.test(withEval));
    // script-src-attr: strip + inline only — no * / blob: / data: on attr.
    const attrOnly = (0, relaxCsp_1.relaxCspPolicy)("script-src-attr 'nonce-z' 'unsafe-inline'");
    assert_1.default.ok(!attrOnly.includes("'nonce-z'"));
    assert_1.default.ok(attrOnly.includes('script-src-attr'));
    assert_1.default.ok(attrOnly.includes("'unsafe-inline'"));
    const attrDir = (0, relaxCsp_1.parseCspPolicy)(attrOnly).find((d) => d.name === 'script-src-attr');
    assert_1.default.ok(attrDir && !attrDir.values.includes('*'), `attr must not get *: ${attrOnly}`);
    assert_1.default.ok(attrDir && !attrDir.values.includes('blob:'), `attr must not get blob: ${attrOnly}`);
    // Strip on attr-only creates script-src with network compensation.
    const createdSrc = (0, relaxCsp_1.parseCspPolicy)(attrOnly).find((d) => d.name === 'script-src');
    assert_1.default.ok(createdSrc, `script-src created after attr strip: ${attrOnly}`);
    assert_1.default.ok(createdSrc.values.includes('*'));
    const headers = (0, relaxCsp_1.rewriteCspResponseHeaders)([
        { name: 'Content-Type', value: 'text/html' },
        { name: 'Content-Security-Policy', value: "default-src 'self'" },
        { name: 'Content-Security-Policy-Report-Only', value: "default-src 'none'" },
        { name: 'Content-Length', value: '9' },
        { name: 'Content-Encoding', value: 'gzip' },
    ]);
    assert_1.default.strictEqual(headers.cspChanged, true);
    assert_1.default.ok(!headers.headers.some((h) => h.name.toLowerCase() === 'content-length'));
    assert_1.default.ok(!headers.headers.some((h) => h.name.toLowerCase() === 'content-encoding'));
    const ro = headers.headers.find((h) => h.name.toLowerCase() === 'content-security-policy-report-only');
    assert_1.default.strictEqual(ro?.value, "default-src 'none'");
    const meta = (0, relaxCsp_1.rewriteCspMetasInHtml)(`<html><head><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-meta' 'strict-dynamic'; img-src https:"></head></html>`);
    assert_1.default.strictEqual(meta.changed, true);
    assert_1.default.ok(!meta.html.includes("'nonce-meta'"), meta.html);
    assert_1.default.ok(!meta.html.includes("'strict-dynamic'"), meta.html);
    assert_1.default.ok(meta.html.includes("'unsafe-inline'"));
    assert_1.default.ok(meta.html.includes('*'));
    assert_1.default.ok(meta.html.includes('img-src https:'));
    const round = (0, relaxCsp_1.serializeCspPolicy)((0, relaxCsp_1.parseCspPolicy)("img-src 'self'; style-src 'self'"));
    assert_1.default.strictEqual(round, "img-src 'self'; style-src 'self'");
    console.log('[unit] relaxCsp surgical merge ok');
}
//# sourceMappingURL=relaxCsp.unit.js.map