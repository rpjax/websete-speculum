import patchright from '../../sidecar/node_modules/patchright/index.js';
import fs from 'node:fs';

const logo = fs.readFileSync('/tmp/logo.svg');
const avatar = fs.readFileSync('/tmp/avatar.svg');
const browser = await patchright.chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<!doctype html><img id=l><img id=a>');
const result = await page.evaluate(
  async ({ logoB64, avatarB64 }) => {
    const toBuf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    async function test(id, bytes, type) {
      const blob = new Blob([bytes], { type });
      const url = URL.createObjectURL(blob);
      const img = document.getElementById(id);
      await new Promise((res) => {
        img.onload = img.onerror = res;
        img.src = url;
      });
      return {
        complete: img.complete,
        nw: img.naturalWidth,
        nh: img.naturalHeight,
        broken: img.complete && img.naturalWidth === 0,
      };
    }
    const logoBytes = toBuf(logoB64);
    const avatarBytes = toBuf(avatarB64);
    return {
      logoSvg: await test('l', logoBytes, 'image/svg+xml'),
      logoEmptyType: await test('l', logoBytes, ''),
      logoOctet: await test('l', logoBytes, 'application/octet-stream'),
      avatarSvg: await test('a', avatarBytes, 'image/svg+xml'),
      avatarEmptyType: await test('a', avatarBytes, ''),
      sizes: { logo: logoBytes.length, avatar: avatarBytes.length },
    };
  },
  { logoB64: logo.toString('base64'), avatarB64: avatar.toString('base64') },
);
console.log(JSON.stringify(result, null, 2));
await browser.close();
