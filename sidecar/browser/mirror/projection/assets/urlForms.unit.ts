/**
 * Aggressive unit coverage for virtual-asset URL rewrite helpers (D-SPEC-7 / virtual-assets.md).
 */

import assert from 'node:assert/strict';
import {
  absolutizeCssUrls,
  absolutizeUrl,
  classifyAndRewriteUrl,
  createInlineId,
  guessContentType,
  httpUrlToVirtual,
  isManifestUrl,
  isPassThroughUrl,
  parseDataUrl,
  rewriteAttrValue,
  rewriteCssText,
  rewriteCssUrlsToVirtual,
  rewriteManifestUrls,
  virtualAssetKeyFromUrl,
  VIRTUAL_ASSETS_PREFIX,
  VIRTUAL_BLOB_PREFIX,
  VIRTUAL_DATA_PREFIX,
} from './urlForms';

export function testVirtualAssetUrlForms(): void {
  const img = classifyAndRewriteUrl('https://cdn.example.com/a.png?v=1', 'https://www.example.com/');
  assert.equal(img.kind, 'http');
  if (img.kind === 'http') {
    assert.equal(img.value, `${VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png?v=1`);
    assert.equal(img.key, 'cdn.example.com/a.png?v=1');
    assert.equal(img.passThrough, false);
  }

  const rel = classifyAndRewriteUrl('/img/x.png', 'https://www.example.com/app/');
  assert.equal(rel.kind, 'http');
  if (rel.kind === 'http') {
    assert.ok(rel.value.startsWith(VIRTUAL_ASSETS_PREFIX));
    assert.ok(rel.key.includes('www.example.com/img/x.png'));
  }

  const data = classifyAndRewriteUrl('data:text/plain;base64,YQ==', 'https://x/');
  assert.equal(data.kind, 'data');
  if (data.kind === 'data') {
    assert.ok(data.value.startsWith(VIRTUAL_DATA_PREFIX));
    assert.equal(data.body.toString('utf8'), 'a');
  }

  const blob = classifyAndRewriteUrl('blob:https://x/abc', 'https://x/');
  assert.equal(blob.kind, 'blob');
  if (blob.kind === 'blob') {
    assert.ok(blob.value.startsWith(VIRTUAL_BLOB_PREFIX));
  }

  assert.equal(classifyAndRewriteUrl('javascript:alert(1)', 'https://x/').kind, 'deny');
  assert.equal(classifyAndRewriteUrl('mailto:a@b.c', 'https://x/').kind, 'deny');
  assert.equal(httpUrlToVirtual('https://cdn.example.com/'), null);

  const srcset = rewriteAttrValue(
    'srcset',
    'https://cdn.example.com/a.png 1x, https://cdn.example.com/b.png 2x',
    'https://www.example.com/',
    () => {},
  );
  assert.ok(srcset.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png`));
  assert.ok(srcset.includes('1x'));

  const css = rewriteCssText(
    'body{background:url(/bg.png)} @import "https://cdn.example.com/x.css";',
    'https://www.example.com/',
    () => {},
  );
  assert.ok(css.includes(VIRTUAL_ASSETS_PREFIX));
  assert.ok(css.includes('cdn.example.com/x.css') || css.includes('www.example.com/bg.png'));

  const manifest = rewriteManifestUrls(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="seg.key"\nsegment0.ts\n',
    'https://cdn.example.com/v/',
  );
  assert.ok(manifest.includes(VIRTUAL_ASSETS_PREFIX));
  assert.ok(manifest.includes('URI="'));

  console.log('[unit] virtual asset urlForms ok');
}

/** Stress: query order, percent-encoding, ports, pass-through, deny matrix, CSS edge cases. */
export function testVirtualAssetUrlFormsStress(): void {
  const q = 'https://cdn.example.com/x.png?b=2&a=1&token=site';
  assert.equal(virtualAssetKeyFromUrl(q), 'cdn.example.com/x.png?b=2&a=1&token=site');
  const v = httpUrlToVirtual(q);
  assert.equal(v, `${VIRTUAL_ASSETS_PREFIX}cdn.example.com/x.png?b=2&a=1&token=site`);

  const enc = 'https://cdn.example.com/a%20b.png?q=%2Fpath';
  assert.equal(virtualAssetKeyFromUrl(enc), 'cdn.example.com/a%20b.png?q=%2Fpath');

  const port = classifyAndRewriteUrl('https://cdn.example.com:8443/f.png', 'https://www.example.com/');
  assert.equal(port.kind, 'http');
  if (port.kind === 'http') {
    assert.ok(port.key.startsWith('cdn.example.com:8443/'));
  }

  const already = `${VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png`;
  assert.equal(classifyAndRewriteUrl(already, 'https://x/').kind, 'unchanged');

  assert.equal(isPassThroughUrl('https://cdn.example.com/v.mp4'), true);
  assert.equal(isPassThroughUrl('https://cdn.example.com/a.m3u8'), true);
  assert.equal(isPassThroughUrl('https://cdn.example.com/a.png'), false);
  assert.equal(isPassThroughUrl('https://cdn.example.com/x', 'video/mp4'), true);
  const video = classifyAndRewriteUrl('https://cdn.example.com/clip.webm', 'https://www.example.com/');
  assert.equal(video.kind, 'http');
  if (video.kind === 'http') assert.equal(video.passThrough, true);

  assert.equal(isManifestUrl('https://x/a.m3u8'), true);
  assert.equal(isManifestUrl('https://x/a.mpd'), true);
  assert.equal(isManifestUrl('https://x/a.css', 'text/css'), false);
  assert.equal(guessContentType('https://x/a.woff2'), 'font/woff2');

  const dataUtf = parseDataUrl('data:text/plain;charset=utf-8,hello%20world');
  assert.ok(dataUtf);
  assert.equal(dataUtf!.body.toString('utf8'), 'hello world');
  assert.equal(classifyAndRewriteUrl('data:not-a-data-url', 'https://x/').kind, 'deny');
  assert.equal(classifyAndRewriteUrl('data:', 'https://x/').kind, 'deny');
  assert.equal(createInlineId('data:text/plain,a'), createInlineId('data:text/plain,a'));

  assert.equal(
    absolutizeUrl('../img.png', 'https://www.example.com/app/page/'),
    'https://www.example.com/app/img.png',
  );
  assert.equal(
    absolutizeUrl('../../img.png', 'https://www.example.com/app/page/'),
    'https://www.example.com/img.png',
  );
  assert.equal(absolutizeUrl('//cdn.example.com/x.png', 'https://www.example.com/').startsWith('https:'), true);

  const absCss = absolutizeCssUrls(
    `@import "./nested.css"; body{background:url(../bg.png)} .x{background:url("/root.png")}`,
    'https://cdn.example.com/css/app.css',
  );
  assert.ok(absCss.includes('https://cdn.example.com/css/nested.css'), absCss);
  assert.ok(absCss.includes('https://cdn.example.com/bg.png'), absCss);
  assert.ok(absCss.includes('https://cdn.example.com/root.png'), absCss);

  const rewrites: string[] = [];
  const rewritten = rewriteCssText(
    `@import "./nested.css"; body{background:url(fonts/a.woff2)}`,
    'https://cdn.example.com/css/app.css',
    (r) => {
      if (r.kind === 'http') rewrites.push(r.key);
    },
  );
  assert.ok(rewritten.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/css/nested.css`), rewritten);
  assert.ok(rewritten.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/css/fonts/a.woff2`), rewritten);
  assert.ok(rewrites.includes('cdn.example.com/css/nested.css'));
  assert.ok(rewrites.includes('cdn.example.com/css/fonts/a.woff2'));

  const iset = rewriteCssUrlsToVirtual(
    `div{background:image-set(url("https://cdn.example.com/a.png") 1x, "https://cdn.example.com/b.png" 2x)}`,
  );
  assert.ok(iset.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png`));
  assert.ok(iset.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/b.png`));

  const hls = rewriteManifestUrls(
    [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/keys/k.bin",IV=0x1',
      '#EXTINF:4.0,',
      'seg0.ts',
      '#EXTINF:4.0,',
      'https://cdn.example.com/v/seg1.ts',
      '#EXT-X-ENDLIST',
      '',
    ].join('\n'),
    'https://cdn.example.com/v/master.m3u8',
  );
  assert.ok(hls.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/keys/k.bin`));
  assert.ok(hls.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/v/seg0.ts`));
  assert.ok(hls.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/v/seg1.ts`));
  assert.ok(hls.includes('#EXT-X-VERSION:3'));

  const dashLine = rewriteManifestUrls(
    'https://cdn.example.com/dash/init.mp4\n',
    'https://cdn.example.com/dash/manifest.mpd',
  );
  assert.ok(dashLine.includes(`${VIRTUAL_ASSETS_PREFIX}cdn.example.com/dash/init.mp4`));

  const style = rewriteAttrValue('style', 'background:url(/x.png)', 'https://www.example.com/', () => {});
  assert.ok(style.includes(VIRTUAL_ASSETS_PREFIX));
  const poster = rewriteAttrValue('poster', 'https://cdn.example.com/p.jpg', 'https://x/', () => {});
  assert.equal(poster, `${VIRTUAL_ASSETS_PREFIX}cdn.example.com/p.jpg`);
  const denied = rewriteAttrValue('src', 'javascript:void(0)', 'https://x/', () => {});
  assert.equal(denied, '');

  for (let i = 0; i < 500; i++) {
    const u = `https://cdn.example.com/bulk/${i % 17}/f${i}.png?n=${i}`;
    const a = classifyAndRewriteUrl(u, 'https://www.example.com/');
    const b = classifyAndRewriteUrl(u, 'https://www.example.com/');
    assert.deepEqual(a, b);
    assert.equal(a.kind, 'http');
  }

  console.log('[unit] virtual asset urlForms stress ok');
}

