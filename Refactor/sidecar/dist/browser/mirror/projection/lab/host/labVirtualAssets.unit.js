"use strict";
/**
 * Lab virtual-asset serve helpers — reserved query strip + relative CSS lift.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testLabVirtualAssetsServeHelpers = testLabVirtualAssetsServeHelpers;
const strict_1 = __importDefault(require("node:assert/strict"));
const labVirtualAssets_1 = require("./labVirtualAssets");
const sessionBindingAuth_1 = require("@speculum/page-projection/projected/sessionBindingAuth");
const urlForms_1 = require("../../assets/urlForms");
function testLabVirtualAssetsServeHelpers() {
    strict_1.default.equal((0, labVirtualAssets_1.stripReservedFromQuery)(''), '');
    strict_1.default.equal((0, labVirtualAssets_1.stripReservedFromQuery)(`?${sessionBindingAuth_1.SessionAuthQueryParam}=tok&a=1&${sessionBindingAuth_1.SessionCacheBustQueryParam}=9`), '?a=1');
    strict_1.default.equal((0, labVirtualAssets_1.stripReservedFromQuery)('?token=site&b=2'), '?token=site&b=2');
    strict_1.default.equal((0, labVirtualAssets_1.stripReservedFromQuery)(`?B=1&${sessionBindingAuth_1.SessionAuthQueryParam.toUpperCase()}=x&A=2`), '?B=1&A=2');
    const key = 'cdn.example.com/css/app.css';
    const lifted = (0, labVirtualAssets_1.absolutizeRelativeCssUrlsToVirtual)(`@import "./nested.css"; body{background:url(fonts/a.woff2)} .r{background:url(/root.png)}`, key);
    strict_1.default.ok(lifted.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/css/nested.css`), lifted);
    strict_1.default.ok(lifted.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/css/fonts/a.woff2`), lifted);
    strict_1.default.ok(lifted.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/root.png`), lifted);
    const leave = (0, labVirtualAssets_1.absolutizeRelativeCssUrlsToVirtual)(`url(data:image/png;base64,aa) url(https://cdn.example.com/x.png) url(/w7s/virtual-assets/cdn.example.com/y.png)`, key);
    strict_1.default.ok(leave.includes('data:image/png'));
    strict_1.default.ok(leave.includes('https://cdn.example.com/x.png'));
    strict_1.default.ok(leave.includes(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/y.png`));
    const cssBody = `body{background:url(${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/a.png?token=site)}`;
    const stamped = (0, sessionBindingAuth_1.stampAuthInServedBody)(cssBody, 'text/css', 'sess-1');
    strict_1.default.ok(stamped.includes(`${sessionBindingAuth_1.SessionAuthQueryParam}=sess-1`));
    strict_1.default.ok(stamped.includes('token=site'));
    const twice = (0, sessionBindingAuth_1.stampAuthInServedBody)(stamped, 'text/css', 'sess-1');
    const count = (twice.match(new RegExp(sessionBindingAuth_1.SessionAuthQueryParam, 'g')) ?? []).length;
    strict_1.default.equal(count, 1, 'stamp must replace reserved param, not duplicate');
    const m3u8 = `#EXTM3U\n${urlForms_1.VIRTUAL_ASSETS_PREFIX}cdn.example.com/v/seg0.ts\n`;
    const stampedM = (0, sessionBindingAuth_1.stampAuthInServedBody)(m3u8, 'application/vnd.apple.mpegurl', 'tok');
    strict_1.default.ok(stampedM.includes(`${sessionBindingAuth_1.SessionAuthQueryParam}=tok`));
    const ugly = (0, sessionBindingAuth_1.appendSessionAuth)(`${urlForms_1.VIRTUAL_ASSETS_PREFIX}h/a.png`, 'a&=b', '');
    strict_1.default.ok(ugly.includes(`${sessionBindingAuth_1.SessionAuthQueryParam}=a%26%3Db`));
    console.log('[unit] lab virtual assets serve helpers ok');
}
//# sourceMappingURL=labVirtualAssets.unit.js.map