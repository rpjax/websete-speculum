import assert from 'assert';
import {
  decodeCspMetaContent,
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

  // --- Eneba / Cloudflare regressions ---

  // &#39; embeds `;` — naive split(';') shredded nonce into a directive *name*.
  assert.strictEqual(decodeCspMetaContent("default-src &#39;none&#39;"), "default-src 'none'");
  assert.strictEqual(
    decodeCspMetaContent("script-src &#39;nonce-s1gdf7pgtgxmxlisiypfvp&#39;"),
    "script-src 'nonce-s1gdf7pgtgxmxlisiypfvp'",
  );

  const entityMetaIn =
    `<html><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;nonce-s1gdf7pgtgxmxlisiypfvp&#39;"></head></html>`;
  const entityMeta = rewriteCspMetasInHtml(entityMetaIn);
  assert.strictEqual(entityMeta.changed, true);
  assert.ok(
    !/nonce-s1gdf7pgtgxmxlisiypfvp/.test(entityMeta.html),
    `nonce must be stripped after entity decode: ${entityMeta.html}`,
  );
  assert.ok(
    !/&#39;\s/.test(entityMeta.html) && !/default-src &#39; none/.test(entityMeta.html),
    `must not emit shredded &#39; tokens: ${entityMeta.html}`,
  );
  assert.ok(entityMeta.html.includes("'unsafe-inline'"), entityMeta.html);
  assert.ok(/\*/.test(entityMeta.html), `network compensation after nonce strip: ${entityMeta.html}`);
  // Always double-quoted content= so CSP quotes stay raw.
  assert.ok(/content="/.test(entityMeta.html), entityMeta.html);
  assert.ok(!/content='/.test(entityMeta.html), `must not use single-quoted content=: ${entityMeta.html}`);

  // Same shredding must not appear when entities are already decoded in the attribute.
  const decodedChallenge = relaxCspPolicy(
    "default-src 'none'; script-src 'nonce-s1gdf7pgtgxmxlisiypfvp' 'unsafe-inline'",
  );
  assert.ok(!decodedChallenge.includes("'nonce-s1gdf7pgtgxmxlisiypfvp'"), decodedChallenge);
  assert.ok(decodedChallenge.includes("'unsafe-inline'"));
  assert.ok(/\bscript-src[^;]*\*/.test(decodedChallenge), decodedChallenge);
  assert.ok(decodedChallenge.includes("default-src 'none'"), `default-src preserved: ${decodedChallenge}`);

  // 'none' is exclusive — never leave 'none' beside other sources after merge.
  const noneOnly = relaxCspPolicy("default-src 'none'");
  const noneScript = parseCspPolicy(noneOnly).find((d) => d.name === 'script-src');
  assert.ok(noneScript, noneOnly);
  assert.ok(!noneScript!.values.includes("'none'"), `script-src must drop exclusive none: ${noneOnly}`);
  assert.ok(noneScript!.values.includes("'unsafe-inline'"), noneOnly);
  const noneConnect = parseCspPolicy(noneOnly).find((d) => d.name === 'connect-src');
  assert.ok(noneConnect && !noneConnect.values.includes("'none'"), `connect-src must drop none: ${noneOnly}`);
  assert.ok(noneConnect!.values.includes('*'), noneOnly);

  const attrNone = relaxCspPolicy("script-src-attr 'none'");
  const attrAfter = parseCspPolicy(attrNone).find((d) => d.name === 'script-src-attr');
  assert.ok(attrAfter, attrNone);
  assert.ok(!attrAfter!.values.includes("'none'"), `attr none + inline must drop none: ${attrNone}`);
  assert.ok(attrAfter!.values.includes("'unsafe-inline'"), attrNone);

  // Single-quoted meta with raw CSP quotes truncates at first ' — still must not leave shreds.
  const sqBroken = rewriteCspMetasInHtml(
    `<html><head><meta http-equiv="Content-Security-Policy" content='default-src 'none'; script-src 'nonce-abc''></head></html>`,
  );
  assert.ok(sqBroken.changed);
  assert.ok(/content="/.test(sqBroken.html), sqBroken.html);
  assert.ok(!/nonce-abc/.test(sqBroken.html) || sqBroken.html.includes("'unsafe-inline'"), sqBroken.html);

  // &apos; / &#x27; forms
  assert.strictEqual(decodeCspMetaContent('&#x27;none&#x27;'), "'none'");
  assert.strictEqual(decodeCspMetaContent("&apos;self&apos;"), "'self'");

  // Comma-separated multi-policy (CSP3 AND) — each policy relaxed independently.
  const multi = relaxCspPolicy("default-src 'none', script-src 'nonce-abc'");
  assert.ok(multi.includes(','), `must preserve multi-policy separator: ${multi}`);
  assert.ok(!multi.includes("'nonce-abc'"), `nonce stripped in second policy: ${multi}`);
  assert.ok(!/script-src 'none',/.test(multi), `must not treat comma as token glue: ${multi}`);
  const multiParts = multi.split(',').map((s) => s.trim());
  assert.ok(multiParts.length >= 2, multi);
  assert.ok(multiParts.some((p) => p.startsWith('default-src')), multi);
  assert.ok(multiParts.some((p) => /\bscript-src\b/.test(p) && p.includes("'unsafe-inline'")), multi);

  console.log('[unit] relaxCsp surgical merge ok');
}
