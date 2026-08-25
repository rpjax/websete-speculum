"use strict";
/**
 * Aggressive unit coverage for virtual-asset URL rewrite helpers (D-SPEC-7 / virtual-assets.md).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testVirtualAssetUrlForms = testVirtualAssetUrlForms;
exports.testVirtualAssetUrlFormsStress = testVirtualAssetUrlFormsStress;
const strict_1 = __importDefault(require("node:assert/strict"));
const urlForms_1 = require("./urlForms");
function testVirtualAssetUrlForms() {
    const img = (0, urlForms_1.classifyAndRewriteUrl)('https://cdn.example.com/a.png?v=1', 'https://www.example.com/');
    strict_1.default.equal(img.kind, 'http');
    if (img.kind === 'http') {
        strict_1.default.equal(img.value, `${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png?v=1`);
        strict_1.default.equal(img.key, 'cdn.example.com/a.png?v=1');
        strict_1.default.equal(img.passThrough, false);
    }
    const rel = (0, urlForms_1.classifyAndRewriteUrl)('/img/x.png', 'https://www.example.com/app/');
    strict_1.default.equal(rel.kind, 'http');
    if (rel.kind === 'http') {
        strict_1.default.ok(rel.value.startsWith(urlForms_1.VIRTUAL_ASSETS_PREFIX));
        strict_1.default.ok(rel.key.includes('www.example.com/img/x.png'));
    }
    const data = (0, urlForms_1.classifyAndRewriteUrl)('data:text/plain;base64,YQ==', 'https://x/');
    strict_1.default.equal(data.kind, 'data');
    if (data.kind === 'data') {
        strict_1.default.ok(data.value.startsWith(urlForms_1.VIRTUAL_DATA_PREFIX));
        strict_1.default.equal(data.body.toString('utf8'), 'a');
    }
    const blob = (0, urlForms_1.classifyAndRewriteUrl)('blob:https://x/abc', 'https://x/');
    strict_1.default.equal(blob.kind, 'blob');
    if (blob.kind === 'blob') {
        strict_1.default.ok(blob.value.startsWith(urlForms_1.VIRTUAL_BLOB_PREFIX));
    }
    strict_1.default.equal((0, urlForms_1.classifyAndRewriteUrl)('javascript:alert(1)', 'https://x/').kind, 'deny');
    strict_1.default.equal((0, urlForms_1.classifyAndRewriteUrl)('mailto:a@b.c', 'https://x/').kind, 'deny');
    strict_1.default.equal((0, urlForms_1.httpUrlToVirtual)('https://cdn.example.com/'), null);
    const srcset = (0, urlForms_1.rewriteAttrValue)('srcset', 'https://cdn.example.com/a.png 1x, https://cdn.example.com/b.png 2x', 'https://www.example.com/', () => { });
    strict_1.default.ok(srcset.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png`));
    strict_1.default.ok(srcset.includes('1x'));
    const css = (0, urlForms_1.rewriteCssText)('body{background:url(/bg.png)} @import "https://cdn.example.com/x.css";', 'https://www.example.com/', () => { });
    strict_1.default.ok(css.includes(urlForms_1.VIRTUAL_ASSETS_PREFIX));
    strict_1.default.ok(css.includes('cdn.example.com/x.css') || css.includes('www.example.com/bg.png'));
    const manifest = (0, urlForms_1.rewriteManifestUrls)('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="seg.key"\nsegment0.ts\n', 'https://cdn.example.com/v/');
    strict_1.default.ok(manifest.includes(urlForms_1.VIRTUAL_ASSETS_PREFIX));
    strict_1.default.ok(manifest.includes('URI="'));
    console.log('[unit] virtual asset urlForms ok');
}
/** Stress: query order, percent-encoding, ports, pass-through, deny matrix, CSS edge cases. */
function testVirtualAssetUrlFormsStress() {
    const q = 'https://cdn.example.com/x.png?b=2&a=1&token=site';
    strict_1.default.equal((0, urlForms_1.virtualAssetKeyFromUrl)(q), 'cdn.example.com/x.png?b=2&a=1&token=site');
    const v = (0, urlForms_1.httpUrlToVirtual)(q);
    strict_1.default.equal(v, `${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/x.png?b=2&a=1&token=site`);
    const enc = 'https://cdn.example.com/a%20b.png?q=%2Fpath';
    strict_1.default.equal((0, urlForms_1.virtualAssetKeyFromUrl)(enc), 'cdn.example.com/a%20b.png?q=%2Fpath');
    const port = (0, urlForms_1.classifyAndRewriteUrl)('https://cdn.example.com:8443/f.png', 'https://www.example.com/');
    strict_1.default.equal(port.kind, 'http');
    if (port.kind === 'http') {
        strict_1.default.ok(port.key.startsWith('cdn.example.com:8443/'));
    }
    const already = `${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png`;
    strict_1.default.equal((0, urlForms_1.classifyAndRewriteUrl)(already, 'https://x/').kind, 'unchanged');
    strict_1.default.equal((0, urlForms_1.isPassThroughUrl)('https://cdn.example.com/v.mp4'), true);
    strict_1.default.equal((0, urlForms_1.isPassThroughUrl)('https://cdn.example.com/a.m3u8'), true);
    strict_1.default.equal((0, urlForms_1.isPassThroughUrl)('https://cdn.example.com/a.png'), false);
    strict_1.default.equal((0, urlForms_1.isPassThroughUrl)('https://cdn.example.com/x', 'video/mp4'), true);
    const video = (0, urlForms_1.classifyAndRewriteUrl)('https://cdn.example.com/clip.webm', 'https://www.example.com/');
    strict_1.default.equal(video.kind, 'http');
    if (video.kind === 'http')
        strict_1.default.equal(video.passThrough, true);
    strict_1.default.equal((0, urlForms_1.isManifestUrl)('https://x/a.m3u8'), true);
    strict_1.default.equal((0, urlForms_1.isManifestUrl)('https://x/a.mpd'), true);
    strict_1.default.equal((0, urlForms_1.isManifestUrl)('https://x/a.css', 'text/css'), false);
    strict_1.default.equal((0, urlForms_1.guessContentType)('https://x/a.woff2'), 'font/woff2');
    const dataUtf = (0, urlForms_1.parseDataUrl)('data:text/plain;charset=utf-8,hello%20world');
    strict_1.default.ok(dataUtf);
    strict_1.default.equal(dataUtf.body.toString('utf8'), 'hello world');
    strict_1.default.equal((0, urlForms_1.classifyAndRewriteUrl)('data:not-a-data-url', 'https://x/').kind, 'deny');
    strict_1.default.equal((0, urlForms_1.classifyAndRewriteUrl)('data:', 'https://x/').kind, 'deny');
    strict_1.default.equal((0, urlForms_1.createInlineId)('data:text/plain,a'), (0, urlForms_1.createInlineId)('data:text/plain,a'));
    strict_1.default.equal((0, urlForms_1.absolutizeUrl)('../img.png', 'https://www.example.com/app/page/'), 'https://www.example.com/app/img.png');
    strict_1.default.equal((0, urlForms_1.absolutizeUrl)('../../img.png', 'https://www.example.com/app/page/'), 'https://www.example.com/img.png');
    strict_1.default.equal((0, urlForms_1.absolutizeUrl)('//cdn.example.com/x.png', 'https://www.example.com/').startsWith('https:'), true);
    const absCss = (0, urlForms_1.absolutizeCssUrls)(`@import "./nested.css"; body{background:url(../bg.png)} .x{background:url("/root.png")}`, 'https://cdn.example.com/css/app.css');
    strict_1.default.ok(absCss.includes('https://cdn.example.com/css/nested.css'), absCss);
    strict_1.default.ok(absCss.includes('https://cdn.example.com/bg.png'), absCss);
    strict_1.default.ok(absCss.includes('https://cdn.example.com/root.png'), absCss);
    const rewrites = [];
    const rewritten = (0, urlForms_1.rewriteCssText)(`@import "./nested.css"; body{background:url(fonts/a.woff2)}`, 'https://cdn.example.com/css/app.css', (r) => {
        if (r.kind === 'http')
            rewrites.push(r.key);
    });
    strict_1.default.ok(rewritten.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/css/nested.css`), rewritten);
    strict_1.default.ok(rewritten.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/css/fonts/a.woff2`), rewritten);
    strict_1.default.ok(rewrites.includes('cdn.example.com/css/nested.css'));
    strict_1.default.ok(rewrites.includes('cdn.example.com/css/fonts/a.woff2'));
    const iset = (0, urlForms_1.rewriteCssUrlsToVirtual)(`div{background:image-set(url("https://cdn.example.com/a.png") 1x, "https://cdn.example.com/b.png" 2x)}`);
    strict_1.default.ok(iset.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png`));
    strict_1.default.ok(iset.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/b.png`));
    const hls = (0, urlForms_1.rewriteManifestUrls)([
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/keys/k.bin",IV=0x1',
        '#EXTINF:4.0,',
        'seg0.ts',
        '#EXTINF:4.0,',
        'https://cdn.example.com/v/seg1.ts',
        '#EXT-X-ENDLIST',
        '',
    ].join('\n'), 'https://cdn.example.com/v/master.m3u8');
    strict_1.default.ok(hls.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/keys/k.bin`));
    strict_1.default.ok(hls.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/v/seg0.ts`));
    strict_1.default.ok(hls.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/v/seg1.ts`));
    strict_1.default.ok(hls.includes('#EXT-X-VERSION:3'));
    const dashLine = (0, urlForms_1.rewriteManifestUrls)('https://cdn.example.com/dash/init.mp4\n', 'https://cdn.example.com/dash/manifest.mpd');
    strict_1.default.ok(dashLine.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/dash/init.mp4`));
    const style = (0, urlForms_1.rewriteAttrValue)('style', 'background:url(/x.png)', 'https://www.example.com/', () => { });
    strict_1.default.ok(style.includes(urlForms_1.VIRTUAL_ASSETS_PREFIX));
    const poster = (0, urlForms_1.rewriteAttrValue)('poster', 'https://cdn.example.com/p.jpg', 'https://x/', () => { });
    strict_1.default.equal(poster, `${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/p.jpg`);
    const denied = (0, urlForms_1.rewriteAttrValue)('src', 'javascript:void(0)', 'https://x/', () => { });
    strict_1.default.equal(denied, '');
    for (let i = 0; i < 500; i++) {
        const u = `https://cdn.example.com/bulk/${i % 17}/f${i}.png?n=${i}`;
        const a = (0, urlForms_1.classifyAndRewriteUrl)(u, 'https://www.example.com/');
        const b = (0, urlForms_1.classifyAndRewriteUrl)(u, 'https://www.example.com/');
        strict_1.default.deepEqual(a, b);
        strict_1.default.equal(a.kind, 'http');
    }
    console.log('[unit] virtual asset urlForms stress ok');
}
//# sourceMappingURL=urlForms.unit.js.map