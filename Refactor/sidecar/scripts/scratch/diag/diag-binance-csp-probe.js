'use strict';
/** Probe live Binance Document CSP headers (shape only). */
const https = require('node:https');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } }, (res) => {
        const headers = res.headers;
        const csps = [];
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === 'content-security-policy') {
            if (Array.isArray(v)) csps.push(...v);
            else if (v) csps.push(v);
          }
        }
        let body = '';
        res.on('data', (c) => {
          if (body.length < 200_000) body += c.toString('utf8');
        });
        res.on('end', () => {
          const metas = [...body.matchAll(/<meta[^>]+http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi)].map(
            (m) => m[0].slice(0, 300),
          );
          resolve({
            url,
            status: res.statusCode,
            location: headers.location,
            cspCount: csps.length,
            cspLens: csps.map((c) => c.length),
            cspHasConnect: csps.map((c) => /\bconnect-src\b/i.test(c)),
            cspHasStar: csps.map((c) => /\bconnect-src\b[^;]*\*/i.test(c)),
            cspConnectSnips: csps.map((c) => {
              const m = c.match(/connect-src[^;]*/i);
              return m ? m[0].slice(0, 200) : null;
            }),
            metaCount: metas.length,
            metas,
            ct: headers['content-type'],
          });
        });
      })
      .on('error', reject);
  });
}

(async () => {
  for (const url of [
    'https://www.binance.com/',
    'https://www.binance.com/pt-BR',
    'https://www.binance.com/en',
  ]) {
    try {
      console.log(JSON.stringify(await get(url), null, 2));
    } catch (e) {
      console.log(url, String(e));
    }
  }
})();
