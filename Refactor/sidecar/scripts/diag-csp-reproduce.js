'use strict';
/**
 * Reproduce CSP cases from Eneba Cloudflare console + producer inject needs.
 */
const {
  relaxCspPolicy,
  parseCspPolicy,
  rewriteCspMetasInHtml,
  rewriteCspResponseHeaders,
} = require('../dist/browser/mirror/projection/session/csp/relaxCsp.js');

function show(label, policy) {
  const out = relaxCspPolicy(policy);
  const dirs = parseCspPolicy(out);
  const script = dirs.find((d) => d.name === 'script-src' || d.name === 'script-src-elem');
  const hasStar = !!(script && script.values.includes('*'));
  const hasNone = !!(script && script.values.some((v) => v === "'none'"));
  console.log(`\n## ${label}`);
  console.log('IN :', policy);
  console.log('OUT:', out);
  console.log('script-src tokens:', script ? script.values : '(none)');
  console.log('allows /__speculum/virtual.js (needs * or host):', hasStar && !hasNone ? 'YES' : hasStar ? 'MAYBE(*+none)' : 'NO');
}

// CF-like: default-src none only (common challenge shell)
show('CF default-src none only', "default-src 'none'");

// CF with nonce on script-src
show(
  'CF challenge nonce',
  "default-src 'none'; script-src 'nonce-s1gdf7pgtgxmxlisiypfvp' 'unsafe-inline'; connect-src 'self'",
);

// script-src-attr none alone (console warned about none+others)
show('attr none + script nonce', "default-src 'none'; script-src 'nonce-x'; script-src-attr 'none'");

// Comma-separated multi-policy (CSP3)
show('comma multi-policy', "default-src 'none', script-src 'nonce-abc'");

// Single-quoted meta with embedded CSP quotes — regex truncation
const metaSq = `<meta http-equiv="Content-Security-Policy" content='default-src 'none'; script-src 'nonce-abc''>`;
const r1 = rewriteCspMetasInHtml(`<html><head>${metaSq}</head></html>`);
console.log('\n## META single-quoted with raw quotes inside');
console.log('IN :', metaSq);
console.log('OUT:', r1.html);
console.log('changed:', r1.changed);

// Proper double-quoted meta
const metaDq = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-abc'">`;
const r2 = rewriteCspMetasInHtml(`<html><head>${metaDq}</head></html>`);
console.log('\n## META double-quoted (correct)');
console.log('OUT:', r2.html);

// HTML entities in double-quoted content
const metaEnt = `<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;nonce-abc&#39;">`;
const r3 = rewriteCspMetasInHtml(`<html><head>${metaEnt}</head></html>`);
console.log('\n## META with &#39; entities');
console.log('OUT:', r3.html);
console.log('nonce still present?', r3.html.includes('nonce-abc') || r3.html.includes('&#39;nonce'));

// Header rewrite of default-src none
const hdr = rewriteCspResponseHeaders([
  { name: 'Content-Security-Policy', value: "default-src 'none'" },
]);
console.log('\n## HEADER default-src none');
console.log(hdr.headers.find((h) => h.name === 'Content-Security-Policy')?.value);
