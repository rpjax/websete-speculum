import assert from 'assert';
import {
  parseCspPolicy,
  relaxCspPolicy,
  rewriteCspMetasInHtml,
  rewriteCspResponseHeaders,
  serializeCspPolicy,
} from './relaxCsp';

export function runRelaxCspUnitTests(): void {
  assert.strictEqual(
    relaxCspPolicy("default-src 'self'; img-src https:"),
    "default-src 'self'; img-src https:; connect-src 'self' * data: blob: ws: wss:; script-src 'self' 'unsafe-inline'",
  );

  const withConnect = relaxCspPolicy("default-src 'self'; connect-src 'self'");
  assert.ok(withConnect.includes("connect-src 'self' * data: blob: ws: wss:"));
  assert.ok(withConnect.includes("script-src 'self' 'unsafe-inline'"));
  assert.ok(withConnect.includes("default-src 'self'"));

  // No nonce → only unsafe-inline on script; no network compensation.
  const noNonce = relaxCspPolicy("script-src 'self'; img-src https:");
  assert.ok(noNonce.includes("script-src 'self' 'unsafe-inline'"));
  assert.ok(!/\bscript-src[^;]* \*/.test(noNonce), `must not force * without strip: ${noNonce}`);
  assert.ok(!/\bscript-src[^;]* blob:/.test(noNonce), `must not force blob: without strip: ${noNonce}`);
  assert.ok(noNonce.includes('img-src https:'));

  // Nonce + strict-dynamic → strip + compensation on script-src.
  const withNonce = relaxCspPolicy(
    "script-src 'self' 'nonce-abc' 'strict-dynamic'; img-src https:",
  );
  assert.ok(!withNonce.includes("'nonce-abc'"), `nonce stripped: ${withNonce}`);
  assert.ok(!withNonce.includes("'strict-dynamic'"), `strict-dynamic stripped: ${withNonce}`);
  assert.ok(withNonce.includes("'unsafe-inline'"));
  assert.ok(/\bscript-src[^;]*\*/.test(withNonce), `* compensation: ${withNonce}`);
  assert.ok(/\bscript-src[^;]*blob:/.test(withNonce), `blob: compensation: ${withNonce}`);
  assert.ok(/\bscript-src[^;]*data:/.test(withNonce), `data: compensation: ${withNonce}`);
  assert.ok(withNonce.includes('img-src https:'), `img-src preserved: ${withNonce}`);
  assert.ok(withNonce.includes("'self'"), `host preserved: ${withNonce}`);

  // Hash triggers same compensation.
  const withHash = relaxCspPolicy("script-src 'sha256-deadbeef=' 'self'");
  assert.ok(!withHash.includes("'sha256-deadbeef='"), `hash stripped: ${withHash}`);
  assert.ok(/\bscript-src[^;]*\*/.test(withHash));
  assert.ok(withHash.includes("'unsafe-inline'"));

  // unsafe-eval preserved; still gets compensation when nonce stripped.
  const withEval = relaxCspPolicy("script-src 'nonce-x' 'unsafe-eval'");
  assert.ok(!withEval.includes("'nonce-x'"));
  assert.ok(withEval.includes("'unsafe-eval'"), `unsafe-eval kept: ${withEval}`);
  assert.ok(/\bscript-src[^;]*\*/.test(withEval));

  // script-src-attr: strip + inline only — no * / blob: / data: on attr.
  const attrOnly = relaxCspPolicy("script-src-attr 'nonce-z' 'unsafe-inline'");
  assert.ok(!attrOnly.includes("'nonce-z'"));
  assert.ok(attrOnly.includes('script-src-attr'));
  assert.ok(attrOnly.includes("'unsafe-inline'"));
  const attrDir = parseCspPolicy(attrOnly).find((d) => d.name === 'script-src-attr');
  assert.ok(attrDir && !attrDir.values.includes('*'), `attr must not get *: ${attrOnly}`);
  assert.ok(attrDir && !attrDir.values.includes('blob:'), `attr must not get blob: ${attrOnly}`);
  // Strip on attr-only creates script-src with network compensation.
  const createdSrc = parseCspPolicy(attrOnly).find((d) => d.name === 'script-src');
  assert.ok(createdSrc, `script-src created after attr strip: ${attrOnly}`);
  assert.ok(createdSrc!.values.includes('*'));

  const headers = rewriteCspResponseHeaders([
    { name: 'Content-Type', value: 'text/html' },
    { name: 'Content-Security-Policy', value: "default-src 'self'" },
    { name: 'Content-Security-Policy-Report-Only', value: "default-src 'none'" },
    { name: 'Content-Length', value: '9' },
    { name: 'Content-Encoding', value: 'gzip' },
  ]);
  assert.strictEqual(headers.cspChanged, true);
  assert.ok(!headers.headers.some((h) => h.name.toLowerCase() === 'content-length'));
  assert.ok(!headers.headers.some((h) => h.name.toLowerCase() === 'content-encoding'));
  const ro = headers.headers.find((h) => h.name.toLowerCase() === 'content-security-policy-report-only');
  assert.strictEqual(ro?.value, "default-src 'none'");

  const meta = rewriteCspMetasInHtml(
    `<html><head><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-meta' 'strict-dynamic'; img-src https:"></head></html>`,
  );
  assert.strictEqual(meta.changed, true);
  assert.ok(!meta.html.includes("'nonce-meta'"), meta.html);
  assert.ok(!meta.html.includes("'strict-dynamic'"), meta.html);
  assert.ok(meta.html.includes("'unsafe-inline'"));
  assert.ok(meta.html.includes('*'));
  assert.ok(meta.html.includes('img-src https:'));

  const round = serializeCspPolicy(parseCspPolicy("img-src 'self'; style-src 'self'"));
  assert.strictEqual(round, "img-src 'self'; style-src 'self'");

  console.log('[unit] relaxCsp surgical merge ok');
}
