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
    // --- Eneba / Cloudflare regressions ---
    // &#39; embeds `;` — naive split(';') shredded nonce into a directive *name*.
    assert_1.default.strictEqual((0, relaxCsp_1.decodeCspMetaContent)("default-src &#39;none&#39;"), "default-src 'none'");
    assert_1.default.strictEqual((0, relaxCsp_1.decodeCspMetaContent)("script-src &#39;nonce-s1gdf7pgtgxmxlisiypfvp&#39;"), "script-src 'nonce-s1gdf7pgtgxmxlisiypfvp'");
    const entityMetaIn = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;nonce-s1gdf7pgtgxmxlisiypfvp&#39;"></head></html>`;
    const entityMeta = (0, relaxCsp_1.rewriteCspMetasInHtml)(entityMetaIn);
    assert_1.default.strictEqual(entityMeta.changed, true);
    assert_1.default.ok(!/nonce-s1gdf7pgtgxmxlisiypfvp/.test(entityMeta.html), `nonce must be stripped after entity decode: ${entityMeta.html}`);
    assert_1.default.ok(!/&#39;\s/.test(entityMeta.html) && !/default-src &#39; none/.test(entityMeta.html), `must not emit shredded &#39; tokens: ${entityMeta.html}`);
    assert_1.default.ok(entityMeta.html.includes("'unsafe-inline'"), entityMeta.html);
    assert_1.default.ok(/\*/.test(entityMeta.html), `network compensation after nonce strip: ${entityMeta.html}`);
    // Always double-quoted content= so CSP quotes stay raw.
    assert_1.default.ok(/content="/.test(entityMeta.html), entityMeta.html);
    assert_1.default.ok(!/content='/.test(entityMeta.html), `must not use single-quoted content=: ${entityMeta.html}`);
    // Same shredding must not appear when entities are already decoded in the attribute.
    const decodedChallenge = (0, relaxCsp_1.relaxCspPolicy)("default-src 'none'; script-src 'nonce-s1gdf7pgtgxmxlisiypfvp' 'unsafe-inline'");
    assert_1.default.ok(!decodedChallenge.includes("'nonce-s1gdf7pgtgxmxlisiypfvp'"), decodedChallenge);
    assert_1.default.ok(decodedChallenge.includes("'unsafe-inline'"));
    assert_1.default.ok(/\bscript-src[^;]*\*/.test(decodedChallenge), decodedChallenge);
    assert_1.default.ok(decodedChallenge.includes("default-src 'none'"), `default-src preserved: ${decodedChallenge}`);
    // 'none' is exclusive — never leave 'none' beside other sources after merge.
    const noneOnly = (0, relaxCsp_1.relaxCspPolicy)("default-src 'none'");
    const noneScript = (0, relaxCsp_1.parseCspPolicy)(noneOnly).find((d) => d.name === 'script-src');
    assert_1.default.ok(noneScript, noneOnly);
    assert_1.default.ok(!noneScript.values.includes("'none'"), `script-src must drop exclusive none: ${noneOnly}`);
    assert_1.default.ok(noneScript.values.includes("'unsafe-inline'"), noneOnly);
    const noneConnect = (0, relaxCsp_1.parseCspPolicy)(noneOnly).find((d) => d.name === 'connect-src');
    assert_1.default.ok(noneConnect && !noneConnect.values.includes("'none'"), `connect-src must drop none: ${noneOnly}`);
    assert_1.default.ok(noneConnect.values.includes('*'), noneOnly);
    const attrNone = (0, relaxCsp_1.relaxCspPolicy)("script-src-attr 'none'");
    const attrAfter = (0, relaxCsp_1.parseCspPolicy)(attrNone).find((d) => d.name === 'script-src-attr');
    assert_1.default.ok(attrAfter, attrNone);
    assert_1.default.ok(!attrAfter.values.includes("'none'"), `attr none + inline must drop none: ${attrNone}`);
    assert_1.default.ok(attrAfter.values.includes("'unsafe-inline'"), attrNone);
    // Single-quoted meta with raw CSP quotes truncates at first ' — still must not leave shreds.
    const sqBroken = (0, relaxCsp_1.rewriteCspMetasInHtml)(`<html><head><meta http-equiv="Content-Security-Policy" content='default-src 'none'; script-src 'nonce-abc''></head></html>`);
    assert_1.default.ok(sqBroken.changed);
    assert_1.default.ok(/content="/.test(sqBroken.html), sqBroken.html);
    assert_1.default.ok(!/nonce-abc/.test(sqBroken.html) || sqBroken.html.includes("'unsafe-inline'"), sqBroken.html);
    // &apos; / &#x27; forms
    assert_1.default.strictEqual((0, relaxCsp_1.decodeCspMetaContent)('&#x27;none&#x27;'), "'none'");
    assert_1.default.strictEqual((0, relaxCsp_1.decodeCspMetaContent)("&apos;self&apos;"), "'self'");
    // Comma-separated multi-policy (CSP3 AND) — each policy relaxed independently.
    const multi = (0, relaxCsp_1.relaxCspPolicy)("default-src 'none', script-src 'nonce-abc'");
    assert_1.default.ok(multi.includes(','), `must preserve multi-policy separator: ${multi}`);
    assert_1.default.ok(!multi.includes("'nonce-abc'"), `nonce stripped in second policy: ${multi}`);
    assert_1.default.ok(!/script-src 'none',/.test(multi), `must not treat comma as token glue: ${multi}`);
    const multiParts = multi.split(',').map((s) => s.trim());
    assert_1.default.ok(multiParts.length >= 2, multi);
    assert_1.default.ok(multiParts.some((p) => p.startsWith('default-src')), multi);
    assert_1.default.ok(multiParts.some((p) => /\bscript-src\b/.test(p) && p.includes("'unsafe-inline'")), multi);
    console.log('[unit] relaxCsp surgical merge ok');
}
//# sourceMappingURL=relaxCsp.unit.js.map