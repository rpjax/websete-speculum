/**
 * Lab virtual-asset serve helpers — reserved query strip + relative CSS lift.
 */

import assert from 'node:assert/strict';
import {
  absolutizeRelativeCssUrlsToVirtual,
  stripReservedFromQuery,
} from './labVirtualAssets';
import {
  SessionAuthQueryParam,
  SessionCacheBustQueryParam,
  stampAuthInServedBody,
  stampSrcsetAuth,
  appendSessionAuth,
} from '@speculum/page-projection/projected/sessionBindingAuth';
import { VIRTUAL_ASSETS_PREFIX } from '../../assets/urlForms';

export function testLabVirtualAssetsServeHelpers(): void {
  assert.equal(stripReservedFromQuery(''), '');
  assert.equal(
    stripReservedFromQuery(`?${SessionAuthQueryParam}=tok&a=1&${SessionCacheBustQueryParam}=9`),
    '?a=1',
  );
  assert.equal(stripReservedFromQuery('?token=site&b=2'), '?token=site&b=2');
  assert.equal(
    stripReservedFromQuery(`?B=1&${SessionAuthQueryParam.toUpperCase()}=x&A=2`),
    '?B=1&A=2',
  );

  const key = 'cdn.example.com/css/app.css';
  const lifted = absolutizeRelativeCssUrlsToVirtual(
    `@import "./nested.css"; body{background:url(fonts/a.woff2)} .r{background:url(/root.png)}`,
    key,
  );
  assert.ok(lifted.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/css/nested.css`), lifted);
  assert.ok(lifted.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/css/fonts/a.woff2`), lifted);
  assert.ok(lifted.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/root.png`), lifted);

  const leave = absolutizeRelativeCssUrlsToVirtual(
    `url(data:image/png;base64,aa) url(https://cdn.example.com/x.png) url(/w7s/virtual-assets/cdn.example.com/y.png)`,
    key,
  );
  assert.ok(leave.includes('data:image/png'));
  assert.ok(leave.includes('https://cdn.example.com/x.png'));
  assert.ok(leave.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/y.png`));

  const cssBody = `body{background:url(${VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png?token=site)}`;
  const stamped = stampAuthInServedBody(cssBody, 'text/css', 'sess-1');
  assert.ok(stamped.includes(`${SessionAuthQueryParam}=sess-1`));
  assert.ok(stamped.includes('token=site'));
  const twice = stampAuthInServedBody(stamped, 'text/css', 'sess-1');
  const count = (twice.match(new RegExp(SessionAuthQueryParam, 'g')) ?? []).length;
  assert.equal(count, 1, 'stamp must replace reserved param, not duplicate');

  const m3u8 = `#EXTM3U\n${VIRTUAL_ASSETS_PREFIX}cdn.example.com/v/seg0.ts\n`;
  const stampedM = stampAuthInServedBody(m3u8, 'application/vnd.apple.mpegurl', 'tok');
  assert.ok(stampedM.includes(`${SessionAuthQueryParam}=tok`));

  const ugly = appendSessionAuth(`${VIRTUAL_ASSETS_PREFIX}h/a.png`, 'a&=b', '');
  assert.ok(ugly.includes(`${SessionAuthQueryParam}=a%26%3Db`));

  // Cloudinary transforms use commas inside the URL — must not become candidate separators.
  const belezaSrcset =
    'https://res.cloudinary.com/beleza-na-web/image/upload/f_avif,fl_progressive,q_auto:eco,w_iw/v1/banner/hero.jpg 1220w, '
    + 'https://res.cloudinary.com/beleza-na-web/image/upload/f_avif,fl_progressive,q_auto:eco,w_800/v1/banner/hero.jpg 800w';
  const stampedBeleza = stampSrcsetAuth(belezaSrcset, 'tok', '');
  assert.ok(
    stampedBeleza.includes('f_avif,fl_progressive,q_auto:eco,w_iw'),
    `Cloudinary commas must stay inside URL: ${stampedBeleza}`,
  );
  assert.ok(!stampedBeleza.includes('f_avif, fl_progressive'), stampedBeleza);
  assert.ok(!stampedBeleza.includes('/f_avif 1220w'), stampedBeleza);
  assert.equal(stampedBeleza, belezaSrcset, 'non-virtual candidates leave auth untouched');

  const virtualSrcset =
    `${VIRTUAL_ASSETS_PREFIX}res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_400/icon.png 1x, `
    + `${VIRTUAL_ASSETS_PREFIX}res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/icon.png 2x`;
  const stampedVirtual = stampSrcsetAuth(virtualSrcset, 'sess-9', '');
  assert.ok(stampedVirtual.includes('f_avif,q_auto,w_400'), stampedVirtual);
  assert.ok(stampedVirtual.includes('f_avif,q_auto,w_800'), stampedVirtual);
  assert.ok(!stampedVirtual.includes('f_avif, q_auto'), stampedVirtual);
  assert.ok(stampedVirtual.includes(`${SessionAuthQueryParam}=sess-9`), stampedVirtual);
  assert.ok(stampedVirtual.includes(' 1x, '), stampedVirtual);
  assert.ok(stampedVirtual.endsWith(' 2x'), stampedVirtual);

  console.log('[unit] lab virtual assets serve helpers ok');
}
