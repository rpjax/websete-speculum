'use strict';
const {
  relaxCspPolicy,
  parseCspPolicy,
  rewriteCspMetasInHtml,
} = require('../dist/browser/mirror/projection/session/csp/relaxCsp.js');

const samples = [
  "default-src 'none'; script-src 'nonce-abc123' 'strict-dynamic' 'unsafe-inline'",
  "default-src 'none'; script-src 'nonce-s1gdf7pgtgxmxlisiypfvp' https://challenges.cloudflare.com",
  "default-src 'none'; script-src-elem 'nonce-x'; script-src-attr 'none'",
  "default-src 'none';script-src 'nonce-x'",
  "default-src ' none'; script-src ' 'unsafe-inline'",
];

for (const s of samples) {
  const out = relaxCspPolicy(s);
  console.log('IN ', s);
  console.log('OUT', out);
  console.log('TOK', JSON.stringify(parseCspPolicy(out)));
  console.log('---');
}

const html =
  '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-abc\' \'unsafe-inline\'"></head></html>';
const r = rewriteCspMetasInHtml(html);
console.log('META', r.html);
