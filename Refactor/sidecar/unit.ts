import assert from 'assert';
import * as fs from 'fs';
import {
  domainMatches,
  injectPermissiveMainFrameCsp,
  matchesAllowedDomain,
  pathMatches,
  relaxMainFrameCspHeaders,
  scriptMatchesUrl,
} from './browser/patchright/Navigation';
import type { BrowserScriptInjection } from './browser/BrowserSession';
import { isInputTouchPrimary, resolveDeviceProfile, deviceProfilesEqual, touchEmulationParams, DEFAULT_DESKTOP_DEVICE, applyLogicalViewport, proveLogicalViewport, readChromeViewport, viewportMetricsClose } from './browser/patchright/device-emulation';
import { kitStealthInitSource, kitNavigatorSpoofSource, resolveDeviceKit } from './browser/patchright/device-kits';
import {
  ensureWorkerTargetStealth,
  isWorkerLikeTargetType,
} from './browser/patchright/worker-target-stealth';
import { buildChromeArgs, webglSpoofExtensionPath } from './browser/patchright/ChromeRuntime';
import { validateLaunchViewport, validateResizeViewport, requireViewportPolicy } from './browser/patchright/viewport-bounds';
import { shouldEmitContextCrash } from './browser/patchright/contextCrash';
import { toLaunchOptions } from './grpc/mappers';
import { computeScreencastEncodeSize } from './browser/patchright/screencast-encode';
import { EventBridge } from './host/EventBridge';
import { DropOldestQueue } from './host/DropOldestQueue';
import { isBenignBrowserRace } from './host/browserRace';
import type { CDPSession } from 'patchright';
import {
  sanitizeCookieForCdp,
  sanitizeCookieBatch,
} from './browser/patchright/PageState';
import { DomAssetCache } from './browser/patchright/mirror/dom/DomAssetCache';
import {
  decodeDomBody,
  encodeDomBody,
  PAGE_PROJECTION_PAGE_SCRIPT,
} from './browser/patchright/mirror/dom/DomTreeSerializer';
import { mapSrcset, parseSrcset } from './browser/patchright/mirror/dom/srcsetParse';
import { parseDataUrl } from './browser/patchright/mirror/dom/PageProjection';
import type { BrowserCookieState } from './browser/BrowserSession';
import { collectTelemetry } from './telemetry/collectTelemetry';
import { applyHostResources } from './host/hostResources';

/** Test stand-in for Sessions.ViewportPolicy — production gets this on Launch. */
const POLICY = {
  minWidth: 100,
  minHeight: 100,
  maxWidth: 4096,
  maxHeight: 2160,
} as const;

function testDomainMatch(): void {
  assert.strictEqual(matchesAllowedDomain('example.com', ['example.com']), true);
  assert.strictEqual(matchesAllowedDomain('www.example.com', ['*.example.com']), true);
  assert.strictEqual(matchesAllowedDomain('evil.com', ['example.com']), false);
  assert.strictEqual(matchesAllowedDomain('example.com', ['*.example.com']), false);
  console.log('[unit] domain match ok');
}

function testScriptTargetRuleMatch(): void {
  const anyAny: BrowserScriptInjection = {
    position: 'HeaderTop',
    type: 'Classic',
    file: '/s.js',
    content: '1',
    targetRules: [{
      domain: { scope: 'Any', labels: [] },
      path: { scope: 'Any', matchType: 'Prefix', segments: [] },
    }],
  };
  assert.strictEqual(scriptMatchesUrl(anyAny, new URL('https://a.example.com/x')), true);

  const emptyRules: BrowserScriptInjection = {
    position: 'HeaderTop',
    type: 'Classic',
    file: '/s.js',
    content: '1',
    targetRules: [],
  };
  assert.strictEqual(scriptMatchesUrl(emptyRules, new URL('https://a.example.com/x')), false);

  const wildcard = {
    scope: 'Pattern',
    labels: [
      { match: 'Any', value: '' },
      { match: 'Exact', value: 'example' },
      { match: 'Exact', value: 'com' },
    ],
  };
  assert.strictEqual(domainMatches(wildcard, 'www.example.com'), true);
  assert.strictEqual(domainMatches(wildcard, 'a.b.example.com'), true);
  assert.strictEqual(domainMatches(wildcard, 'example.com'), false);
  assert.strictEqual(domainMatches(wildcard, 'evil.com'), false);

  const exact = {
    scope: 'Pattern',
    labels: [
      { match: 'Exact', value: 'www' },
      { match: 'Exact', value: 'example' },
      { match: 'Exact', value: 'com' },
    ],
  };
  assert.strictEqual(domainMatches(exact, 'www.example.com'), true);
  assert.strictEqual(domainMatches(exact, 'a.www.example.com'), false);

  const midWildcard = {
    scope: 'Pattern',
    labels: [
      { match: 'Exact', value: 'api' },
      { match: 'Any', value: '' },
      { match: 'Exact', value: 'com' },
    ],
  };
  assert.strictEqual(domainMatches(midWildcard, 'api.x.com'), false);

  assert.strictEqual(
    pathMatches({ scope: 'Pattern', matchType: 'Prefix', segments: [{ match: 'Exact', value: 'app' }] }, '/app/x'),
    true,
  );
  assert.strictEqual(
    pathMatches({ scope: 'Pattern', matchType: 'Exact', segments: [{ match: 'Exact', value: 'app' }] }, '/app/x'),
    false,
  );
  assert.strictEqual(
    pathMatches({ scope: 'Pattern', matchType: 'Exact', segments: [{ match: 'Exact', value: 'app' }] }, '/app'),
    true,
  );

  // camelCase wire tolerance
  assert.strictEqual(
    domainMatches({ scope: 'any', labels: [] } as never, 'x.com'),
    true,
  );
  console.log('[unit] script target rule match ok');
}

function testPermissiveMainFrameCspRewrite(): void {
  const headers = relaxMainFrameCspHeaders([
    { name: 'Content-Type', value: 'text/html; charset=utf-8' },
    { name: 'Content-Security-Policy', value: "default-src 'self'" },
    { name: 'Content-Security-Policy-Report-Only', value: "script-src 'none'" },
  ]);
  assert.strictEqual(headers.some((h) => h.name.toLowerCase() === 'content-security-policy-report-only'), false);
  assert.strictEqual(headers.filter((h) => h.name.toLowerCase() === 'content-security-policy').length, 1);
  assert.ok(headers.some((h) => h.name === 'Content-Security-Policy' && h.value.includes('connect-src *')));

  const html = '<html><head><title>x</title></head><body>ok</body></html>';
  const patched = injectPermissiveMainFrameCsp(html);
  assert.ok(patched.includes('http-equiv="Content-Security-Policy"'));
  assert.ok(patched.includes("script-src * data: blob: 'unsafe-inline' 'unsafe-eval'"));
  assert.ok(patched.includes('connect-src * data: blob: ws: wss:'));
  console.log('[unit] permissive main-frame csp rewrite ok');
}

function testViewportBounds(): void {
  const invalidLaunch = validateLaunchViewport(0, 0, POLICY);
  assert.strictEqual(invalidLaunch.ok, false);

  const validLaunch = validateLaunchViewport(800, 600, POLICY);
  assert.strictEqual(validLaunch.ok, true);
  if (validLaunch.ok) {
    assert.strictEqual(validLaunch.width, 800);
    assert.strictEqual(validLaunch.height, 600);
  }

  const ok = validateResizeViewport(800, 600, POLICY);
  assert.strictEqual(ok.ok, true);

  const tooSmall = validateResizeViewport(10, 10, POLICY);
  assert.strictEqual(tooSmall.ok, false);

  const tooBig = validateResizeViewport(9000, 9000, POLICY);
  assert.strictEqual(tooBig.ok, false);

  const tight = { minWidth: 300, minHeight: 200, maxWidth: 1600, maxHeight: 1200 };
  assert.strictEqual(validateResizeViewport(299, 600, tight).ok, false);
  assert.strictEqual(validateResizeViewport(800, 600, tight).ok, true);

  assert.throws(
    () => requireViewportPolicy({}),
    /ViewportPolicy bounds/,
  );
  assert.deepStrictEqual(
    requireViewportPolicy({
      minWidth: 100,
      minHeight: 100,
      displayWidth: 2048,
      displayHeight: 1080,
    }),
    { minWidth: 100, minHeight: 100, maxWidth: 2048, maxHeight: 1080 },
  );
  console.log('[unit] viewport bounds ok');
}

function testResolveDeviceProfileDefaults(): void {
  assert.deepStrictEqual(resolveDeviceProfile(null), DEFAULT_DESKTOP_DEVICE);
  assert.deepStrictEqual(resolveDeviceProfile(undefined), DEFAULT_DESKTOP_DEVICE);
  const partial = resolveDeviceProfile({ mobile: true, touch: true, deviceScaleFactor: 2, maxTouchPoints: 5 });
  assert.strictEqual(partial.mobile, true);
  assert.strictEqual(partial.deviceScaleFactor, 2);
  assert.strictEqual(partial.maxTouchPoints, 5);
  assert.strictEqual(partial.deviceCategory, 'phone');
  const tablet = resolveDeviceProfile({
    deviceCategory: 'tablet',
    deviceScaleFactor: 2,
    maxTouchPoints: 1,
  });
  assert.strictEqual(tablet.deviceCategory, 'tablet');
  assert.strictEqual(tablet.mobile, true);
  assert.strictEqual(tablet.touch, true);
  assert.ok((tablet.maxTouchPoints ?? 0) >= 5, 'tablet kit floors mtp');
  const missingDpr = resolveDeviceProfile({ mobile: false, touch: false });
  assert.strictEqual(missingDpr.deviceScaleFactor, 1);
  assert.strictEqual(missingDpr.maxTouchPoints, 0);
  assert.strictEqual(missingDpr.deviceCategory, 'pc');
  assert.strictEqual(deviceProfilesEqual(null, undefined), true);
  assert.strictEqual(
    deviceProfilesEqual(
      { mobile: false, touch: false, deviceScaleFactor: 1, maxTouchPoints: 0 },
      DEFAULT_DESKTOP_DEVICE,
    ),
    true,
  );
  assert.strictEqual(
    deviceProfilesEqual(
      { mobile: true, touch: true, deviceScaleFactor: 2, maxTouchPoints: 5 },
      DEFAULT_DESKTOP_DEVICE,
    ),
    false,
  );
  console.log('[unit] resolve device profile defaults ok');
}

async function testApplyLogicalViewportUsesBoundsAndMetrics(): Promise<void> {
  const calls: Array<{ method: string; params: unknown }> = [];
  const cdp = {
    send: async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === 'Browser.getWindowForTarget') return { windowId: 7 };
      if (method === 'Browser.getWindowBounds') {
        return { bounds: { windowState: 'normal', left: 0, top: 0, width: 1024, height: 768 } };
      }
      if (method === 'Browser.getVersion') {
        return { product: 'Chrome/120.0.0.0', userAgent: 'Mozilla/5.0 Desktop' };
      }
      if (method === 'Target.getTargets') return { targetInfos: [] };
      return {};
    },
    on: () => {},
    off: () => {},
  } as unknown as CDPSession;

  const profile = await applyLogicalViewport(cdp, 1024, 768, null);
  assert.strictEqual(profile.deviceScaleFactor, 1);
  assert.strictEqual(profile.mobile, false);

  const bounds = calls.find((c) => c.method === 'Browser.setWindowBounds');
  assert.ok(bounds, 'soft logical viewport must set native window bounds');
  const b = (bounds!.params as { bounds: { windowState: string; width: number; height: number; left: number; top: number } }).bounds;
  assert.strictEqual(b.windowState, 'normal');
  assert.strictEqual(b.width, 1024);
  assert.strictEqual(b.height, 768);
  assert.strictEqual(b.left, 0);
  assert.strictEqual(b.top, 0);
  assert.ok(
    !calls.some((c) =>
      c.method === 'Browser.setWindowBounds'
      && (c.params as { bounds?: { windowState?: string } })?.bounds?.windowState === 'fullscreen',
    ),
    'must not use fullscreen for logical viewport',
  );

  const metrics = calls.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  assert.ok(metrics, 'must apply device metrics');
  assert.strictEqual((metrics!.params as { width: number }).width, 1024);
  assert.strictEqual((metrics!.params as { height: number }).height, 768);
  assert.strictEqual((metrics!.params as { deviceScaleFactor: number }).deviceScaleFactor, 1);
  assert.strictEqual((metrics!.params as { screenWidth: number }).screenWidth, 1024);
  assert.strictEqual((metrics!.params as { screenHeight: number }).screenHeight, 768);

  // Desktop apply must clear UA (even after prior mobile) — no early-return skip.
  const ua = calls.find((c) => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(ua, 'desktop apply must set/clear user agent');
  assert.strictEqual((ua!.params as { userAgent: string }).userAgent, 'Mozilla/5.0 Desktop');
  assert.strictEqual(
    (ua!.params as { platform?: string }).platform,
    'Linux x86_64',
    'pc kit must set navigator platform',
  );
  const meta = (ua!.params as { userAgentMetadata?: { mobile?: boolean; platform?: string; brands?: unknown[] } })
    .userAgentMetadata;
  assert.ok(meta, 'desktop apply must send userAgentMetadata');
  assert.strictEqual(meta!.mobile, false);
  assert.strictEqual(meta!.platform, 'Linux');
  assert.ok(Array.isArray(meta!.brands) && meta!.brands.length >= 3, 'greasy brands required');
  assert.ok(
    calls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument'),
    'kit hardware spoof must register on new documents',
  );
  const hwInit = calls.find((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument');
  const hwSource = String((hwInit!.params as { source?: string }).source);
  assert.ok(hwSource.includes('hardwareConcurrency'), 'hardwareConcurrency spoof required');
  assert.ok(hwSource.includes('webglUnmaskedVendor') || hwSource.includes('UNMASKED_VENDOR'), 'WebGL UNMASKED spoof required');
  assert.ok(hwSource.includes('0x1f00') || hwSource.includes('0x1F00') || hwSource.includes('GL_VENDOR'), 'WebGL VENDOR spoof required');
  assert.ok(hwSource.includes('WebKit WebGL'), 'masked RENDERER must be WebKit WebGL');
  assert.ok(hwSource.includes('Intel') || hwSource.includes('Mesa Intel'), 'pc kit WebGL must be Linux Intel');
  assert.ok(!hwSource.includes('Mesa/X.org'), 'pc kit must not claim Mesa/X.org');
  assert.ok(!hwSource.includes('Direct3D'), 'pc kit must not claim D3D11/Windows');
  assert.ok(hwSource.includes('window.Worker'), 'Worker wrap required');
  assert.ok(hwSource.includes('SharedWorker'), 'SharedWorker wrap required');
  assert.ok(
    calls.some((c) => c.method === 'Target.setAutoAttach'),
    'worker-target stealth must enable Target.setAutoAttach',
  );

  const boundsIdx = calls.findIndex((c) => c.method === 'Browser.setWindowBounds');
  const metricsIdx = calls.findIndex((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  const uaIdx = calls.findIndex((c) => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(boundsIdx >= 0 && uaIdx > boundsIdx, 'window bounds before UA');
  assert.ok(uaIdx >= 0 && metricsIdx > uaIdx, 'device metrics must apply after user-agent override');

  await assert.rejects(
    () =>
      applyLogicalViewport(
        {
          send: async (method: string) => {
            if (method === 'Browser.getWindowForTarget') return { windowId: 1 };
            if (method === 'Browser.getVersion') return { product: 'Chrome/120.0.0.0' };
            return {};
          },
        } as unknown as CDPSession,
        800,
        600,
        null,
      ),
    /did not return userAgent/,
  );
  console.log('[unit] apply logical viewport uses bounds and metrics ok');
}

async function testProveLogicalViewportUsesCssLayoutMetrics(): Promise<void> {
  const calls: Array<{ method: string; params: unknown }> = [];
  let href = 'about:blank';
  let cssW = 980;
  let cssH = 1688;
  const cdp = {
    send: async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === 'Browser.getWindowForTarget') return { windowId: 3 };
      if (method === 'Browser.getWindowBounds') {
        return { bounds: { windowState: 'normal', left: 0, top: 0, width: 414, height: 713 } };
      }
      if (method === 'Browser.getVersion') {
        return {
          product: 'Chrome/120.0.0.0',
          userAgent:
            'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        };
      }
      if (method === 'Runtime.evaluate') {
        return { result: { value: href } };
      }
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'frame-1' } } };
      }
      if (method === 'Page.setDocumentContent') {
        href = 'about:blank#seeded';
        cssW = 414;
        cssH = 713;
        return {};
      }
      if (method === 'Page.getLayoutMetrics') {
        return {
          cssLayoutViewport: { clientWidth: cssW, clientHeight: cssH },
          layoutViewport: { clientWidth: cssW, clientHeight: cssH },
        };
      }
      if (method === 'Target.getTargets') return { targetInfos: [] };
      return {};
    },
    on: () => {},
    off: () => {},
  } as unknown as CDPSession;

  const proven = await proveLogicalViewport(
    cdp,
    414,
    713,
    { mobile: true, touch: true, deviceScaleFactor: 2, maxTouchPoints: 5 },
    { phase: 'launch' },
  );
  assert.strictEqual(proven.width, 414);
  assert.strictEqual(proven.height, 713);
  assert.strictEqual(proven.device.deviceScaleFactor, 2);
  assert.ok(calls.some((c) => c.method === 'Browser.setWindowBounds'));
  assert.ok(calls.some((c) => c.method === 'Page.setDocumentContent'), 'about:blank must seed viewport meta');
  assert.ok(calls.some((c) => c.method === 'Emulation.setDeviceMetricsOverride'));
  assert.ok(calls.some((c) => c.method === 'Page.getLayoutMetrics'));
  const metricsIdx = calls.findIndex((c) => c.method === 'Emulation.setDeviceMetricsOverride');
  const uaIdx = calls.findIndex((c) => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(uaIdx >= 0 && metricsIdx > uaIdx, 'mobile metrics must apply after UA (avoid 980px trap)');
  const mobileUa = calls[uaIdx]!;
  assert.strictEqual(
    (mobileUa.params as { platform?: string }).platform,
    'Linux armv8l',
    'phone kit navigator.platform must be Linux armv8l',
  );
  assert.ok(
    String((mobileUa.params as { userAgent?: string }).userAgent).includes('Android 13; Pixel 7'),
    'phone kit UA',
  );

  await assert.rejects(
    () =>
      proveLogicalViewport(
        {
          send: async (method: string) => {
            if (method === 'Browser.getWindowForTarget') return { windowId: 1 };
            if (method === 'Browser.getWindowBounds') {
              return { bounds: { windowState: 'normal', width: 414, height: 713 } };
            }
            if (method === 'Browser.getVersion') {
              return { product: 'Chrome/120.0.0.0', userAgent: 'Mozilla/5.0 Desktop' };
            }
            if (method === 'Runtime.evaluate') {
              return { result: { value: 'https://fixture.test/' } };
            }
            if (method === 'Page.getLayoutMetrics') {
              return { cssLayoutViewport: { clientWidth: 980, clientHeight: 1688 } };
            }
            return {};
          },
          on: () => {},
          off: () => {},
        } as unknown as CDPSession,
        414,
        713,
        null,
      ),
    /css layout viewport 980×1688 != logical 414×713/,
  );

  await assert.rejects(
    () =>
      readChromeViewport({
        send: async () => ({}),
      } as unknown as CDPSession),
    /did not return cssLayoutViewport/,
  );

  assert.ok(viewportMetricsClose(414, 713, 415, 712));
  assert.ok(!viewportMetricsClose(414, 713, 980, 1688));
  console.log('[unit] prove logical viewport uses css layout metrics ok');
}

function testBuildChromeArgsIncludesWebglSpoof(): void {
  const extensionPath = webglSpoofExtensionPath();
  assert.ok(fs.existsSync(extensionPath), `extension must exist at ${extensionPath}`);
  const args = buildChromeArgs(1280, 720);
  assert.ok(args.includes('--use-gl=angle'), 'ANGLE required for HW-or-software path');
  assert.ok(args.includes('--enable-webgl'), 'webgl must be enabled');
  assert.ok(args.includes('--ignore-gpu-blocklist'), 'gpu blocklist bypass required');
  assert.ok(args.includes('--enable-unsafe-swiftshader'), 'software fallback must be allowed');
  assert.ok(
    !args.includes('--use-gl=swiftshader'),
    'must not force swiftshader (blocks real GPU)',
  );
  assert.ok(
    !args.includes('--use-angle=swiftshader'),
    'must not force angle=swiftshader (blocks real GPU)',
  );
  assert.ok(
    args.some((a) => a.startsWith('--load-extension=') && a.includes('webgl-spoof')),
    'load-extension webgl-spoof required',
  );
  assert.ok(
    args.some((a) => a.includes('DisableLoadExtensionCommandLineSwitch')),
    'Chrome ≥137 load-extension feature flag required',
  );
  // Product path must not gate on SPECULUM_GL* env.
  process.env['SPECULUM_GL_FALLBACK'] = '0';
  const stillOn = buildChromeArgs(800, 600);
  assert.ok(stillOn.includes('--enable-webgl'), 'GL must stay on without env knobs');
  delete process.env['SPECULUM_GL_FALLBACK'];
  console.log('[unit] buildChromeArgs webgl spoof ok');
}

function testKitStealthInitSource(): void {
  const phone = resolveDeviceKit({ deviceCategory: 'phone' });
  const phoneSrc = kitStealthInitSource({
    kit: phone,
    userAgent: phone.buildUserAgent('120.0.0.0'),
  });
  assert.ok(phoneSrc.includes('Adreno'), 'phone WebGL must claim Adreno');
  assert.ok(phoneSrc.includes('WebKit WebGL'), 'phone masked RENDERER');
  assert.ok(phoneSrc.includes('0x1F00') || phoneSrc.includes('GL_VENDOR'), 'phone must spoof VENDOR');
  assert.ok(!phoneSrc.includes('Mesa/X.org'), 'phone must not claim Mesa/X.org');
  assert.ok(phoneSrc.includes('Linux armv8l'), 'phone platform in init');
  assert.ok(phoneSrc.includes('Android 13'), 'phone UA in worker wrap');
  assert.ok(phoneSrc.includes('importScripts'), 'worker wrap must use importScripts');
  assert.ok(phoneSrc.includes('spoof(self.navigator)'), 'worker must spoof live navigator');
  assert.ok(phoneSrc.includes('JSON.stringify(platform)'), 'worker preamble must quote platform');
  assert.ok(phoneSrc.includes('JSON.stringify(ua)'), 'worker preamble must quote ua');
  assert.ok(phoneSrc.includes('window.Worker'), 'Worker wrap');
  assert.ok(!phoneSrc.includes('Direct3D'), 'never D3D11');

  const pc = resolveDeviceKit({ deviceCategory: 'pc' });
  const pcSrc = kitStealthInitSource({
    kit: pc,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  assert.ok(pcSrc.includes('Intel') || pcSrc.includes('Mesa Intel'), 'pc WebGL Linux GPU story');
  assert.ok(pcSrc.includes('WebKit WebGL'), 'pc masked RENDERER');
  assert.ok(!pcSrc.includes('Mesa/X.org'), 'pc never Mesa/X.org');
  assert.ok(pcSrc.includes('Linux x86_64'), 'pc platform');
  assert.ok(!pcSrc.includes('Direct3D'), 'pc never D3D11/Windows');
  const extJs = fs.readFileSync(
    require('path').join(webglSpoofExtensionPath(), 'content.js'),
    'utf8',
  );
  assert.ok(extJs.includes('WebKit WebGL'), 'extension masked RENDERER');
  assert.ok(extJs.includes('0x1F00') || extJs.includes('GL_VENDOR'), 'extension spoofs VENDOR');
  assert.ok(!extJs.includes('Mesa/X.org'), 'extension never Mesa/X.org');

  const nav = kitNavigatorSpoofSource({
    kit: phone,
    userAgent: phone.buildUserAgent('120.0.0.0'),
  });
  assert.ok(nav.includes('hardwareConcurrency'), 'nav spoof cores');
  assert.ok(nav.includes('Linux armv8l'), 'nav spoof platform');
  assert.ok(!nav.includes('window.Worker'), 'nav spoof must not wrap Worker ctor');
  assert.ok(nav.includes('0x1F00') || nav.includes('GL_VENDOR'), 'worker-realm source must spoof WebGL VENDOR');
  assert.ok(nav.includes('Adreno'), 'worker-realm WebGL must claim Adreno for phone');
  assert.ok(nav.includes('WebKit WebGL'), 'worker-realm masked RENDERER');
  assert.ok(!nav.includes('Mesa/X.org'), 'worker-realm must not claim Mesa/X.org');
  console.log('[unit] kitStealthInitSource ok');
}

async function testWorkerTargetStealthAutoAttach(): Promise<void> {
  assert.ok(isWorkerLikeTargetType('worker'));
  assert.ok(isWorkerLikeTargetType('shared_worker'));
  assert.ok(isWorkerLikeTargetType('service_worker'));
  assert.ok(!isWorkerLikeTargetType('page'));
  assert.ok(!isWorkerLikeTargetType('iframe'));

  const calls: Array<{ method: string; params: unknown }> = [];
  const handlers = new Map<string, Function>();
  const cdp = {
    send: async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === 'Target.getTargets') return { targetInfos: [] };
      return {};
    },
    on: (event: string, fn: Function) => {
      handlers.set(event, fn);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
  };

  const phone = resolveDeviceKit({ deviceCategory: 'phone' });
  const source = kitNavigatorSpoofSource({
    kit: phone,
    userAgent: phone.buildUserAgent('120.0.0.0'),
  });
  const handle = await ensureWorkerTargetStealth({
    pageCdp: cdp as never,
    source,
  });

  assert.ok(
    calls.some(
      (c) =>
        c.method === 'Target.setAutoAttach'
        && (c.params as { autoAttach?: boolean; waitForDebuggerOnStart?: boolean; flatten?: boolean })
          .autoAttach === true
        && (c.params as { waitForDebuggerOnStart?: boolean }).waitForDebuggerOnStart === true
        && (c.params as { flatten?: boolean }).flatten === false,
    ),
    'must autoAttach workers with waitForDebugger, flatten false',
  );
  assert.ok(handlers.has('Target.attachedToTarget'), 'must listen for attachedToTarget');

  const onAttached = handlers.get('Target.attachedToTarget')!;
  await onAttached({
    sessionId: 'sess-worker-1',
    waitingForDebugger: true,
    targetInfo: { type: 'service_worker', url: 'https://example.invalid/sw.js' },
  });

  const sent = calls.filter((c) => c.method === 'Target.sendMessageToTarget');
  assert.ok(sent.length >= 2, 'must evaluate + resume on worker target');
  const payloads = sent.map((c) => JSON.parse((c.params as { message: string }).message));
  assert.ok(
    payloads.some((p) => p.method === 'Runtime.evaluate' && String(p.params.expression).includes('hardwareConcurrency')),
    'must inject navigator spoof into worker session',
  );
  assert.ok(
    payloads.some((p) => p.method === 'Runtime.runIfWaitingForDebugger'),
    'must resume paused worker target',
  );

  // Non-worker paused target must still resume (never hang iframes).
  calls.length = 0;
  await onAttached({
    sessionId: 'sess-other',
    waitingForDebugger: true,
    targetInfo: { type: 'iframe', url: 'https://example.invalid/' },
  });
  const other = calls.filter((c) => c.method === 'Target.sendMessageToTarget');
  assert.ok(other.length >= 1, 'non-worker must resume');
  assert.ok(
    !other.some((c) => JSON.parse((c.params as { message: string }).message).method === 'Runtime.evaluate'),
    'must not inject kit into non-worker targets',
  );

  handle.dispose();
  console.log('[unit] worker target stealth autoAttach ok');
}

async function testScreencastRestartThrowsAfterStop(): Promise<void> {
  const { Screencast } = await import('./browser/patchright/Screencast');
  const cdp = {
    on: () => {},
    off: () => {},
    send: async () => ({}),
  } as unknown as CDPSession;
  const sc = await Screencast.start(cdp, 100, 100, () => {});
  await sc.stop();
  await assert.rejects(
    () => sc.restart(200, 200, () => {}),
    /restart after stop/,
  );
  console.log('[unit] screencast restart throws after stop ok');
}

function testLaunchEnvironmentIsRequired(): void {
  assert.throws(
    () => toLaunchOptions({ width: 800, height: 600 }),
    /ViewportPolicy bounds|locale is required/,
  );

  assert.throws(
    () =>
      toLaunchOptions({
        width: 800,
        height: 600,
        minWidth: 100,
        minHeight: 100,
        displayWidth: 4096,
        displayHeight: 2160,
      }),
    /locale is required/,
  );

  const options = toLaunchOptions({
    width: 800,
    height: 600,
    minWidth: 100,
    minHeight: 100,
    displayWidth: 2048,
    displayHeight: 1080,
    locale: 'pt-BR',
    language: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    geolocation: {
      latitude: -23.55,
      longitude: -46.63,
      accuracy: 10,
    },
  });
  assert.strictEqual(options.locale, 'pt-BR');
  assert.strictEqual(options.geolocation?.accuracy, 10);
  assert.deepStrictEqual(options.viewportPolicy, {
    minWidth: 100,
    minHeight: 100,
    maxWidth: 2048,
    maxHeight: 1080,
  });
  assert.strictEqual(options.screencastMaxEncodeScale, 2);
  assert.strictEqual(options.mirrorMode, 'videoStreaming');
  assert.strictEqual(options.pageProjectionDiffQueueCapacity, 8192);

  const scaled = toLaunchOptions({
    width: 800,
    height: 600,
    minWidth: 100,
    minHeight: 100,
    displayWidth: 2048,
    displayHeight: 1080,
    locale: 'en-US',
    language: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    screencastMaxEncodeScale: 1,
  });
  assert.strictEqual(scaled.screencastMaxEncodeScale, 1);
  assert.strictEqual(scaled.mirrorMode, 'videoStreaming');

  const dom = toLaunchOptions({
    width: 800,
    height: 600,
    minWidth: 100,
    minHeight: 100,
    displayWidth: 2048,
    displayHeight: 1080,
    locale: 'en-US',
    language: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    mirrorMode: 'pageProjection',
    page_projection_diff_queue_capacity: 4096,
  });
  assert.strictEqual(dom.mirrorMode, 'pageProjection');
  assert.strictEqual(dom.pageProjectionDiffQueueCapacity, 4096);
  console.log('[unit] launch environment ok');
}

function testScreencastEncodeSize(): void {
  const cssOnly = computeScreencastEncodeSize({
    cssWidth: 1280,
    cssHeight: 720,
    deviceScaleFactor: 2,
    displayWidth: 4096,
    displayHeight: 2160,
    maxEncodeScale: 1,
  });
  assert.strictEqual(cssOnly.scale, 1);
  assert.strictEqual(cssOnly.width, 1280);
  assert.strictEqual(cssOnly.height, 720);

  const retina = computeScreencastEncodeSize({
    cssWidth: 1280,
    cssHeight: 720,
    deviceScaleFactor: 2,
    displayWidth: 4096,
    displayHeight: 2160,
    maxEncodeScale: 2,
  });
  assert.strictEqual(retina.scale, 2);
  assert.strictEqual(retina.width, 2560);
  assert.strictEqual(retina.height, 1440);

  const dprCapped = computeScreencastEncodeSize({
    cssWidth: 1280,
    cssHeight: 720,
    deviceScaleFactor: 3,
    displayWidth: 4096,
    displayHeight: 2160,
    maxEncodeScale: 2,
  });
  assert.strictEqual(dprCapped.scale, 2);
  assert.strictEqual(dprCapped.width, 2560);

  const xvfbCap = computeScreencastEncodeSize({
    cssWidth: 1920,
    cssHeight: 1080,
    deviceScaleFactor: 2,
    displayWidth: 2560,
    displayHeight: 1440,
    maxEncodeScale: 2,
  });
  assert.ok(xvfbCap.scale < 2);
  assert.strictEqual(xvfbCap.width, 2560);
  assert.strictEqual(xvfbCap.height, 1440);
  console.log('[unit] screencast encode size ok');
}

async function testScreencastAcceptsCssOrEncodeJpeg(): Promise<void> {
  const { Screencast } = await import('./browser/patchright/Screencast');
  const { readJpegDimensions } = await import('./browser/patchright/jpeg-geometry');

  // Minimal 2×2 JPEG (SOF0) — write a tiny buffer with known dims via canvas-less fixture.
  // Build SOF0 manually: FF D8 … FF C0 … height/width …
  function jpegWithSize(width: number, height: number): Buffer {
    // Minimal valid-ish JPEG for readJpegDimensions (SOF0 only path).
    const sof = Buffer.alloc(19);
    sof[0] = 0xff;
    sof[1] = 0xc0;
    sof.writeUInt16BE(17, 2); // segment length
    sof[4] = 8; // precision
    sof.writeUInt16BE(height, 5);
    sof.writeUInt16BE(width, 7);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
  }

  const cdp = {
    on: () => {},
    off: () => {},
    send: async () => ({}),
  } as unknown as CDPSession;
  const sc = await Screencast.start(cdp, 2560, 1440, () => {}, 1280, 720);
  assert.deepStrictEqual(readJpegDimensions(jpegWithSize(1280, 720)), { width: 1280, height: 720 });
  assert.strictEqual(sc._jpegMatchesExpected(jpegWithSize(1280, 720)), true, 'CSS-sized frames must pass');
  assert.strictEqual(sc._jpegMatchesExpected(jpegWithSize(2560, 1440)), true, 'encode-sized frames must pass');
  assert.strictEqual(sc._jpegMatchesExpected(jpegWithSize(800, 600)), false, 'stale size must drop');
  await sc.stop();
  console.log('[unit] screencast accepts css or encode jpeg ok');
}

function testTouchEmulationParams(): void {
  assert.deepStrictEqual(
    touchEmulationParams({ touch: false, mobile: false, maxTouchPoints: 0 }),
    { enabled: false },
  );
  // Hybrid desktop (Galaxy Book / Surface): touch capable but mouse-primary —
  // must NOT enable CDP touch emulation or :hover dies.
  assert.deepStrictEqual(
    touchEmulationParams({ touch: true, mobile: false, maxTouchPoints: 5 }),
    { enabled: false },
  );
  assert.deepStrictEqual(
    touchEmulationParams({ touch: true, mobile: true, maxTouchPoints: 5 }),
    { enabled: true, maxTouchPoints: 5 },
  );
  assert.throws(
    () => touchEmulationParams({ touch: true, mobile: true, maxTouchPoints: 0 }),
    /between 1 and 16/,
  );
  // Hybrid desktop: touch capability must NOT suppress mouse input.
  assert.strictEqual(isInputTouchPrimary({ mobile: false }), false);
  assert.strictEqual(isInputTouchPrimary({ mobile: true }), true);
  assert.strictEqual(isInputTouchPrimary(null), false);
  console.log('[unit] touch emulation params ok');
}

function applyContextClose(
  bridge: EventBridge,
  args: { listenerEpoch: number; currentEpoch: number; suppress: boolean },
  session: { open: boolean },
): void {
  if (!shouldEmitContextCrash(args)) return;
  session.open = false;
  bridge.onCrash({
    errorCode: 'browser_closed',
    message: 'Chrome context closed unexpectedly',
    phase: 'runtime',
  });
}

function testStopDoesNotEnqueueCrash(): void {
  const bridge = new EventBridge('s1');
  const session = { open: true };
  // stop/teardown: bump epoch + suppress before close
  applyContextClose(bridge, { listenerEpoch: 1, currentEpoch: 2, suppress: true }, session);
  assert.strictEqual(bridge.crash.pendingCount, 0);
  assert.strictEqual(session.open, true, 'suppressed/stale close must not clear open');
  console.log('[unit] stop_does_not_enqueue_crash ok');
}

function testUnexpectedContextCloseEnqueuesCrash(): void {
  const bridge = new EventBridge('s2');
  const session = { open: true };
  applyContextClose(bridge, { listenerEpoch: 3, currentEpoch: 3, suppress: false }, session);
  assert.strictEqual(bridge.crash.pendingCount, 1);
  assert.strictEqual(session.open, false);
  console.log('[unit] unexpected_context_close_enqueues_crash ok');
}

function testRecreateKeepsOpenAcrossStaleClose(): void {
  const bridge = new EventBridge('s4');
  const session = { open: true };
  // Intentional teardown: invalidate epoch + suppress before old context close
  applyContextClose(bridge, { listenerEpoch: 1, currentEpoch: 2, suppress: true }, session);
  assert.strictEqual(bridge.crash.pendingCount, 0);
  assert.strictEqual(session.open, true);
  // bind new context (epoch 3), session marked open again
  session.open = true;
  // deferred stale close from old context after new bind
  applyContextClose(bridge, { listenerEpoch: 1, currentEpoch: 3, suppress: false }, session);
  assert.strictEqual(bridge.crash.pendingCount, 0);
  assert.strictEqual(session.open, true);
  // real crash on current context
  applyContextClose(bridge, { listenerEpoch: 3, currentEpoch: 3, suppress: false }, session);
  assert.strictEqual(bridge.crash.pendingCount, 1);
  assert.strictEqual(session.open, false);
  console.log('[unit] stale_context_close_epoch ok');
}

async function testStopKeepsBridgeQueuesOpen(): Promise<void> {
  const bridge = new EventBridge('s3');
  bridge.onVideoFrame(new Uint8Array([1, 2, 3]));
  // stop() must not call bridge.close — queues stay open for Watch*
  assert.strictEqual(bridge.video.isClosed, false);
  const frame = await bridge.video.read();
  assert.ok(frame);
  assert.strictEqual(frame!.length, 3);

  const pending = bridge.video.read();
  const raced = await Promise.race([
    pending.then(() => 'read' as const),
    new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 40)),
  ]);
  assert.strictEqual(raced, 'timeout', 'read must block while bridge is open and empty');

  bridge.close();
  const afterClose = await pending;
  assert.strictEqual(afterClose, null, 'only bridge.close() ends Watch* reads with null');
  assert.strictEqual(bridge.video.isClosed, true);
  console.log('[unit] stop_keeps_bridge_queues_open ok');
}

function testBenignBrowserRaceNarrow(): void {
  assert.strictEqual(isBenignBrowserRace(new Error('Frame was detached')), true);
  assert.strictEqual(isBenignBrowserRace(new Error('Target closed')), true);
  assert.strictEqual(isBenignBrowserRace(new Error('Protocol error (Runtime.callFunctionOn)')), false);
  assert.strictEqual(isBenignBrowserRace(new Error('Session closed')), false);
  assert.strictEqual(isBenignBrowserRace(new Error('Target page, context or browser has been closed')), true);
  console.log('[unit] benign browser race narrow ok');
}

async function testAbortDoesNotStealQueuedCrash(): Promise<void> {
  const q = new DropOldestQueue<{ errorCode: string }>(4);
  q.tryWrite({ errorCode: 'browser_closed' });
  const ac = new AbortController();
  ac.abort();
  const stolen = await q.read(ac.signal);
  assert.strictEqual(stolen, null, 'aborted read must not dequeue');
  assert.strictEqual(q.pendingCount, 1, 'crash must remain for WatchCrash reopen');
  const next = await q.read();
  assert.deepStrictEqual(next, { errorCode: 'browser_closed' });
  console.log('[unit] abort_does_not_steal_queued_crash ok');
}

function testDropOldestQueueTracksDroppedCount(): void {
  const q = new DropOldestQueue<number>(2);
  q.tryWrite(1);
  q.tryWrite(2);
  q.tryWrite(3);
  q.tryWrite(4);
  assert.strictEqual(q.pendingCount, 2);
  assert.strictEqual(q.droppedCount, 2);
  console.log('[unit] drop_oldest_queue_tracks_dropped_count ok');
}

function testDropAllOnOverflowForSequencedDiffs(): void {
  const q = new DropOldestQueue<{ sequence: number }>(2);
  q.tryWriteDropAllOnOverflow({ sequence: 1 });
  q.tryWriteDropAllOnOverflow({ sequence: 2 });
  const overflow = q.tryWriteDropAllOnOverflow({ sequence: 3 });
  assert.strictEqual(q.pendingCount, 1);
  assert.strictEqual(q.droppedCount, 2);
  assert.strictEqual(overflow.dropped, 2);
  assert.strictEqual(overflow.lowestSequence, 1);
  assert.strictEqual(overflow.highestSequence, 2);
  console.log('[unit] drop_all_on_overflow_for_sequenced_diffs ok');
}

async function testTryWriteFrontPreservesFifoAsync(): Promise<void> {
  const q = new DropOldestQueue<number>(4);
  q.tryWrite(2);
  q.tryWrite(3);
  assert.strictEqual(q.tryWriteFront(1), true);
  assert.strictEqual(await q.read(), 1);
  assert.strictEqual(await q.read(), 2);
  assert.strictEqual(await q.read(), 3);
  console.log('[unit] try_write_front_preserves_fifo ok');
}

async function testTryWriteFrontRejectsWhenFull(): Promise<void> {
  const q = new DropOldestQueue<number>(2);
  q.tryWrite(1);
  q.tryWrite(2);
  assert.strictEqual(q.tryWriteFront(0), false);
  assert.strictEqual(q.pendingCount, 2);
  assert.strictEqual(await q.read(), 1);
  console.log('[unit] try_write_front_rejects_when_full ok');
}

async function testPumpQueueAwaitsDrainWithoutSkipping(): Promise<void> {
  const { EventEmitter } = await import('events');
  const { pumpQueue } = await import('./grpc/pumpQueue');
  const q = new DropOldestQueue<{ sequence: number }>(8);
  for (let i = 1; i <= 5; i++) q.tryWrite({ sequence: i });
  q.close();

  const written: number[] = [];
  let writes = 0;
  let drainWaits = 0;
  const call = Object.assign(new EventEmitter(), {
    cancelled: false,
    write(chunk: unknown): boolean {
      writes += 1;
      const seq = (chunk as { sequence: number }).sequence;
      written.push(seq);
      // Seq 2 congests the buffer — chunk is still accepted; drain before next.
      if (seq === 2) {
        queueMicrotask(() => {
          drainWaits += 1;
          call.emit('drain');
        });
        return false;
      }
      return true;
    },
  });

  const ac = new AbortController();
  await pumpQueue(q, call, (item) => item, ac.signal);
  assert.deepStrictEqual(written, [1, 2, 3, 4, 5], 'each seq written exactly once');
  assert.strictEqual(writes, 5, 'must not rewrite after drain');
  assert.ok(drainWaits >= 1, 'must await drain after false write');
  console.log('[unit] pump_queue_awaits_drain_without_skipping ok');
}

async function testPumpQueueAbortRequeuesFront(): Promise<void> {
  const { EventEmitter } = await import('events');
  const { pumpQueue } = await import('./grpc/pumpQueue');
  const q = new DropOldestQueue<{ sequence: number }>(8);
  q.tryWrite({ sequence: 10 });
  q.tryWrite({ sequence: 11 });

  // Abort before write — dequeued item must return to the front.
  const ac = new AbortController();
  ac.abort();
  const call = Object.assign(new EventEmitter(), {
    cancelled: true,
    write(_chunk: unknown): boolean {
      throw new Error('write must not run when already aborted');
    },
  });

  await pumpQueue(q, call, (item) => item, ac.signal);
  assert.deepStrictEqual(await q.read(), { sequence: 10 }, 'aborted item restored at front');
  assert.deepStrictEqual(await q.read(), { sequence: 11 });
  console.log('[unit] pump_queue_abort_requeues_front ok');
}

async function testPumpQueueAbortAfterWriteDoesNotRequeue(): Promise<void> {
  const { EventEmitter } = await import('events');
  const { pumpQueue } = await import('./grpc/pumpQueue');
  const q = new DropOldestQueue<{ sequence: number }>(8);
  q.tryWrite({ sequence: 10 });
  q.tryWrite({ sequence: 11 });

  const ac = new AbortController();
  const lost: Array<{ sequence: number }> = [];
  const call = Object.assign(new EventEmitter(), {
    cancelled: false,
    write(_chunk: unknown): boolean {
      // write()===false still accepted the chunk — abort must not requeue it.
      ac.abort();
      call.cancelled = true;
      return false;
    },
  });

  await pumpQueue(q, call, (item) => item, ac.signal, {
    onInflightLost: (item) => lost.push(item),
  });
  assert.deepStrictEqual(lost, [{ sequence: 10 }]);
  assert.deepStrictEqual(await q.read(), { sequence: 11 }, 'accepted chunk must not requeue');
  console.log('[unit] pump_queue_abort_after_write_does_not_requeue ok');
}

async function testEventBridgeQueueDroppedLifecycle(): Promise<void> {
  const bridge = new EventBridge('s-drop');
  const body = new Uint8Array([1]);
  const cap = bridge.dom.maxCapacity;
  // Fill to capacity then one more → DropAll + lifecycle queue_dropped.
  for (let i = 0; i < cap; i++) {
    bridge.onPageProjectionDiff({
      sequence: i + 1,
      generation: 1,
      plane: 'dom',
      operation: 'patch',
      timestampMs: i,
      body,
    });
  }
  bridge.onPageProjectionDiff({
    sequence: 2000,
    generation: 1,
    plane: 'cssom',
    operation: 'install',
    timestampMs: 999,
    body,
  });
  const ev = await bridge.pageProjectionLifecycle.read();
  assert.ok(ev);
  assert.strictEqual(ev!.kind, 'queue_dropped');
  assert.strictEqual(ev!.reason, 'sidecar_bridge');
  assert.strictEqual(ev!.url, 'cssom');
  assert.strictEqual(ev!.diffKind, 'install');
  assert.strictEqual(ev!.sequence, 2000);
  assert.strictEqual(ev!.toGeneration, 1);
  assert.ok((ev!.droppedCount ?? 0) >= cap);
  assert.strictEqual(ev!.capacity, cap);
  assert.strictEqual(ev!.lowestDroppedSequence, 1);
  assert.strictEqual(ev!.highestDroppedSequence, cap);
  assert.strictEqual(bridge.dom.pendingCount, 1);
  bridge.close();
  console.log('[unit] event_bridge_queue_dropped_lifecycle ok');
}

async function testPermissionClearRespectsEpoch(): Promise<void> {
  const bridge = new EventBridge('s-perm');
  const sinkA = (): void => {};
  const sinkB = (): void => {};
  const epochA = bridge.setPermissionSink(sinkA);
  const epochB = bridge.setPermissionSink(sinkB);
  // Waiter created under sink B must survive old Control A's cleanup.
  const pending = bridge.onCameraPermissionRequested();
  bridge.clearPermissionSink(sinkA, epochA);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(settled, false, 'waiter from epoch B must not be denied by epoch A clear');
  bridge.resolvePermission(1, true);
  assert.strictEqual(await pending, 'allow');
  bridge.clearPermissionSink(sinkB, epochB);
  console.log('[unit] permission_clear_respects_epoch ok');
}

async function testInputFireAndForgetAndMoveCoalesce(): Promise<void> {
  const ops: string[] = [];
  let resolveSlow: (() => void) | null = null;
  const slow = new Promise<void>((r) => { resolveSlow = r; });

  let moveCount = 0;
  let lastMoveX = 0;
  let lastMoveY = 0;

  const page = {
    mouse: {
      move: async () => { throw new Error('page.mouse must not be used'); },
      down: async () => { throw new Error('page.mouse must not be used'); },
      up:   async () => { throw new Error('page.mouse must not be used'); },
      wheel: async () => { throw new Error('page.mouse must not be used'); },
    },
    keyboard: {
      down: async (_k: string) => { ops.push('kdown'); },
      up:   async (_k: string) => { ops.push('kup'); },
      type: async () => { throw new Error('keyboard.type must not be used'); },
    },
    goBack:    () => Promise.reject(new Error('should not block')),
    goForward: () => Promise.reject(new Error('should not block')),
    evaluate:  async () => null,
  };
  const cdp = {
    send: async (method: string, params?: { type?: string; x?: number; y?: number }) => {
      if (method !== 'Input.dispatchMouseEvent') return;
      if (params?.type === 'mouseMoved') {
        ops.push('move');
        moveCount++;
        lastMoveX = params.x ?? 0;
        lastMoveY = params.y ?? 0;
        return;
      }
      if (params?.type === 'mousePressed') {
        ops.push('down');
        await slow;
        return;
      }
      if (params?.type === 'mouseReleased') {
        ops.push('up');
      }
    },
  };

  const { InputController } = await import('./browser/patchright/Input');
  const { PatchrightInputBackend } = await import('./browser/patchright/input/PatchrightInputBackend');
  const input = new InputController(page as never, new PatchrightInputBackend(page as never, cdp as never));

  input.enqueue({ type: 'mousedown', x: 1, y: 2, button: 0 });
  input.enqueue({ type: 'mouseup',   x: 1, y: 2, button: 0 });
  input.enqueue({ type: 'keydown',   key: 'a' });

  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.ok(ops.includes('down'), 'mousedown must have started');
  assert.ok(!ops.includes('up'),  'mouseup must be held behind slow mousedown');

  input.enqueue({ type: 'mousemove', x: 10, y: 10 });
  input.enqueue({ type: 'mousemove', x: 20, y: 20 });
  input.enqueue({ type: 'mousemove', x: 30, y: 30 });
  const movesBeforeFlush = moveCount;
  await new Promise<void>((r) => setImmediate(r));
  assert.strictEqual(moveCount, movesBeforeFlush, 'coalesced move must not flush while chain is held');

  input.enqueue({ type: 'goback' });
  input.enqueue({ type: 'goforward' });

  resolveSlow!();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise<void>((r) => setImmediate(r));
  for (let i = 0; i < 30; i++) await Promise.resolve();

  assert.ok(ops.indexOf('down') < ops.indexOf('up'),   'down before up');
  assert.ok(ops.indexOf('up')   < ops.indexOf('kdown'), 'up before keydown');
  assert.ok(moveCount > movesBeforeFlush, 'coalesced move must flush after chain drains');
  assert.strictEqual(lastMoveX, 30, 'coalesced to last move x=30');
  assert.strictEqual(lastMoveY, 30, 'coalesced to last move y=30');
  assert.strictEqual(input.pendingCount, 0, 'pendingCount must drain after completion');
  console.log('[unit] input admit-sync + chain + move coalesce ok');
}

async function testInputKeyDefsIncludeEditingKeys(): Promise<void> {
  const downs: string[] = [];
  const ups: string[] = [];
  const inserts: string[] = [];

  const page = {
    mouse: { move: async () => {}, down: async () => {}, up: async () => {}, wheel: async () => {} },
    keyboard: {
      down: async (k: string) => { downs.push(k); },
      up:   async (k: string) => { ups.push(k); },
      type: async () => { throw new Error('keyboard.type must not be used'); },
    },
    goBack:    () => Promise.resolve(null),
    goForward: () => Promise.resolve(null),
    evaluate:  async () => null,
  };
  const cdp = {
    send: async (method: string, params?: { text?: string }) => {
      if (method === 'Input.insertText' && params?.text) inserts.push(params.text);
    },
  };
  const { InputController } = await import('./browser/patchright/Input');
  const { PatchrightInputBackend } = await import('./browser/patchright/input/PatchrightInputBackend');
  const input = new InputController(page as never, new PatchrightInputBackend(page as never, cdp as never));

  input.enqueue({ type: 'keydown', key: 'Backspace' });
  input.enqueue({ type: 'keyup',   key: 'Backspace' });
  input.enqueue({ type: 'keydown', key: 'Delete' });
  input.enqueue({ type: 'keydown', key: 'ArrowLeft' });
  input.enqueue({ type: 'keydown', key: 'Home' });
  input.enqueue({ type: 'keydown', key: 'Enter' });
  input.enqueue({ type: 'keydown', key: 'ã' });
  input.enqueue({ type: 'text', text: 'olá' });
  await new Promise<void>((r) => setTimeout(r, 30));

  assert.ok(downs.includes('Backspace'), 'Backspace routed to keyboard.down');
  assert.ok(ups.includes('Backspace'),   'Backspace keyup routed to keyboard.up');
  assert.ok(downs.includes('Delete'),    'Delete routed');
  assert.ok(downs.includes('ArrowLeft'), 'ArrowLeft routed');
  assert.ok(downs.includes('Home'),      'Home routed');
  assert.ok(downs.includes('Enter'),     'Enter routed');
  assert.ok(inserts.includes('ã'),       'non-ASCII keydown via Input.insertText');
  assert.ok(inserts.includes('olá'),     'text via Input.insertText');

  const upsBefore = ups.length;
  input.enqueue({ type: 'keyup', key: 'ã' });
  await new Promise<void>((r) => setTimeout(r, 20));
  assert.strictEqual(ups.length, upsBefore, 'keyup of non-ASCII must be ignored');

  console.log('[unit] input key routing (keyboard.down/up + insertText) ok');
}

async function testTouchMoveCoalesceAndStormWrites(): Promise<void> {
  const { InputController } = await import('./browser/patchright/Input');
  const { TouchMoveCoalescer } = await import('./browser/patchright/input/TouchMoveCoalescer');

  let flushes = 0;
  let lastLen = 0;
  const coalescer = new TouchMoveCoalescer((pts) => {
    flushes++;
    lastLen = pts.length;
  });
  coalescer.queue([{ id: 1, x: 1, y: 1 }]);
  coalescer.queue([{ id: 1, x: 2, y: 2 }, { id: 2, x: 3, y: 3 }]);
  coalescer.queue([{ id: 1, x: 9, y: 9 }]);
  await new Promise<void>((r) => setImmediate(r));
  assert.strictEqual(flushes, 1, 'touchmove must coalesce to one flush per turn');
  assert.strictEqual(lastLen, 1, 'latest touchmove sample wins');

  const stolen = (() => {
    const c = new TouchMoveCoalescer(() => {
      throw new Error('cancelled flush must not run');
    });
    c.queue([{ id: 1, x: 1, y: 1 }]);
    const pending = c.takePending();
    assert.ok(pending && pending[0]!.x === 1);
    return pending;
  })();
  await new Promise<void>((r) => setImmediate(r));
  assert.ok(stolen);

  let moves = 0;
  let downs = 0;
  let evaluates = 0;
  const page = {
    mouse: { move: async () => {}, down: async () => {}, up: async () => {}, wheel: async () => {} },
    keyboard: { down: async () => {}, up: async () => {}, type: async () => {} },
    goBack: () => Promise.resolve(null),
    goForward: () => Promise.resolve(null),
    evaluate: async () => {
      evaluates++;
      return null;
    },
  };
  const backend = {
    move: async () => {
      moves++;
    },
    down: async () => {
      downs++;
    },
    up: async () => {},
    wheel: async () => {},
    keyDown: async () => {},
    keyUp: async () => {},
    typeText: async () => {},
    touch: async () => {},
    dispose: async () => {},
  };
  const input = new InputController(page as never, backend);
  for (let i = 0; i < 200; i++) {
    input.enqueue({ type: 'mousemove', x: i, y: i });
  }
  input.enqueue({ type: 'mousedown', x: 1, y: 1, button: 0 });
  assert.strictEqual(moves, 0, 'admit path must stay sync (no await on enqueue)');
  assert.strictEqual(downs, 0, 'admit path must not await inject');
  await new Promise<void>((r) => setImmediate(r));
  for (let i = 0; i < 40; i++) await Promise.resolve();
  assert.ok(moves <= 2, `move storm must coalesce (got ${moves} writes)`);
  assert.strictEqual(downs, 1, 'mousedown still injects once');
  assert.strictEqual(evaluates, 0, 'production hot path must not page.evaluate');
  console.log('[unit] touch coalesce + move-storm write bound ok');
}

async function testInputMousePressReleaseOrdered(): Promise<void> {
  const order: string[] = [];
  let resolveDown: (() => void) | null = null;
  const slowDown = new Promise<void>((r) => { resolveDown = r; });

  const page = {
    mouse: {
      move: async () => { throw new Error('page.mouse must not be used'); },
      down: async () => { throw new Error('page.mouse must not be used'); },
      up:   async () => { throw new Error('page.mouse must not be used'); },
      wheel: async () => {},
    },
    keyboard: { down: async () => {}, up: async () => {}, type: async () => {} },
    goBack:    () => Promise.resolve(null),
    goForward: () => Promise.resolve(null),
    evaluate:  async () => null,
  };
  const cdp = {
    send: async (_method: string, params?: { type?: string }) => {
      if (params?.type === 'mousePressed') {
        order.push('down');
        await slowDown;
        return;
      }
      if (params?.type === 'mouseReleased') order.push('up');
    },
  };
  const { InputController } = await import('./browser/patchright/Input');
  const { PatchrightInputBackend } = await import('./browser/patchright/input/PatchrightInputBackend');
  const input = new InputController(page as never, new PatchrightInputBackend(page as never, cdp as never));

  input.enqueue({ type: 'mousedown', x: 10, y: 10, button: 0 });
  input.enqueue({ type: 'mouseup',   x: 10, y: 10, button: 0 });

  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.ok(order.includes('down'), 'mousedown must have started');
  assert.ok(!order.includes('up'),  'mouseup must be held until mousedown completes');

  resolveDown!();
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(order.indexOf('down') < order.indexOf('up'), 'down must precede up');
  console.log('[unit] input mouse press/release order ok');
}

async function testInputPendingCountIncludesChainDepth(): Promise<void> {
  let resolveDown: (() => void) | null = null;
  const slowDown = new Promise<void>((r) => { resolveDown = r; });
  const page = {
    mouse: { move: async () => {}, down: async () => {}, up: async () => {}, wheel: async () => {} },
    keyboard: { down: async () => {}, up: async () => {}, type: async () => {} },
    goBack: () => Promise.resolve(null),
    goForward: () => Promise.resolve(null),
    evaluate: async () => null,
  };
  const backend = {
    move: async () => {},
    down: async () => { await slowDown; },
    up: async () => {},
    wheel: async () => {},
    keyDown: async () => {},
    keyUp: async () => {},
    typeText: async () => {},
    touch: async () => {},
    dispose: async () => {},
  };
  const { InputController } = await import('./browser/patchright/Input');
  const input = new InputController(page as never, backend);
  input.enqueue({ type: 'mousedown', x: 1, y: 1, button: 0 });
  input.enqueue({ type: 'mouseup', x: 1, y: 1, button: 0 });
  await Promise.resolve();
  assert.strictEqual(input.pendingCount, 2, 'pendingCount must include queued chain work');
  assert.strictEqual(input.chainDepth, 2, 'chainDepth must reflect queued inject operations');
  resolveDown!();
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(input.pendingCount, 0, 'pendingCount must drain after inject completes');
  console.log('[unit] input pending count includes chain depth ok');
}

async function testTelemetryToggleOmission(): Promise<void> {
  const registry = { list: () => [] };
  const empty = await collectTelemetry({}, registry as never);
  assert.deepStrictEqual(empty, {});

  const processOnly = await collectTelemetry({ includeProcess: true }, registry as never);
  assert.ok(processOnly.process);
  assert.strictEqual(processOnly.eventLoop, undefined);
  assert.strictEqual(processOnly.chrome, undefined);
  assert.strictEqual(processOnly.queues, undefined);
  assert.strictEqual(processOnly.sessions, undefined);

  const sectioned = await collectTelemetry({ includeChrome: true, includeQueues: true }, registry as never) as {
    chrome?: { totalJsHeapUsed?: number };
    queues?: { inputDepth?: number; inputChainDepth?: number; droppedTotal?: number };
  };
  assert.ok(sectioned.chrome);
  assert.ok(sectioned.queues);
  assert.strictEqual('totalJsHeapUsed' in sectioned.chrome!, false);
  assert.strictEqual(sectioned.queues!.inputDepth, 0);
  assert.strictEqual(sectioned.queues!.inputChainDepth, 0);
  assert.strictEqual(sectioned.queues!.droppedTotal, 0);
  console.log('[unit] telemetry toggles omit sections ok');
}

async function testTelemetryQueuesReportInputDepthAndDrops(): Promise<void> {
  const bridge = new EventBridge('telemetry-session');
  bridge.video.tryWrite(new Uint8Array([1]));
  bridge.video.tryWrite(new Uint8Array([2]));
  bridge.video.tryWrite(new Uint8Array([3]));
  const registry = {
    list: () => [
      {
        bridge,
        session: {
          sessionId: 'telemetry-session',
          getStatus: async () => ({
            isOpen: true,
            tabCount: 1,
            url: 'about:blank',
            resizing: false,
            width: 390,
            height: 844,
            displayWidth: 4096,
            displayHeight: 2160,
            chromeWidth: 390,
            chromeHeight: 844,
          }),
          getTelemetrySnapshot: () => ({
            inputPendingCount: 2,
            inputChainDepth: 1,
            displayAllocated: true,
            displayWidth: 4096,
            displayHeight: 2160,
            logicalWidth: 390,
            logicalHeight: 844,
            chromeWidth: 390,
            chromeHeight: 844,
            inputBackend: 'os',
            touchPrimary: true,
            userDataDirPresent: true,
          }),
        },
      },
    ],
  };
  const sample = await collectTelemetry({ includeQueues: true }, registry as never) as {
    queues?: { videoDepth: number; inputDepth?: number; inputChainDepth?: number; droppedTotal?: number };
  };
  assert.deepStrictEqual(sample.queues, {
    videoDepth: 2,
    audioDepth: 0,
    consoleDepth: 0,
    inputDepth: 2,
    inputChainDepth: 1,
    droppedTotal: 1,
  });
  console.log('[unit] telemetry queues report input depth and drops ok');
}

async function testTelemetryFaultStateSurvivesCrashConsumption(): Promise<void> {
  const bridge = new EventBridge('faulted-session');
  bridge.onCrash({
    errorCode: 'browser_closed',
    message: 'Chrome context closed unexpectedly',
    phase: 'runtime',
  });
  const consumed = await bridge.crash.read();
  assert.ok(consumed);
  assert.strictEqual(bridge.crash.pendingCount, 0);

  const registry = {
    list: () => [{
      bridge,
      session: {
        sessionId: 'faulted-session',
        getStatus: async () => ({ isOpen: false, tabCount: 0 }),
      },
    }],
  };

  const telemetry = await collectTelemetry(
    { includeSessionsSummary: true, includeFaultedIds: true },
    registry as never,
  ) as {
    sessions?: { faulted: number; faultedSessionIds: string[] };
  };

  assert.strictEqual(telemetry.sessions?.faulted, 1);
  assert.deepStrictEqual(telemetry.sessions?.faultedSessionIds, ['faulted-session']);
  console.log('[unit] telemetry fault state survives crash consumption ok');
}

async function testTelemetryAllocationsSummaryAndSessions(): Promise<void> {
  const bridge = new EventBridge('alloc-session');
  const registry = {
    list: () => [{
      bridge,
      session: {
        sessionId: 'alloc-session',
        getStatus: async () => ({
          isOpen: true,
          tabCount: 1,
          url: 'about:blank',
          resizing: false,
          width: 390,
          height: 844,
          displayWidth: 4096,
          displayHeight: 2160,
          chromeWidth: 390,
          chromeHeight: 844,
        }),
        getTelemetrySnapshot: () => ({
          displayAllocated: true,
          displayWidth: 4096,
          displayHeight: 2160,
          logicalWidth: 390,
          logicalHeight: 844,
          chromeWidth: 390,
          chromeHeight: 844,
          inputBackend: 'os',
          touchPrimary: false,
          userDataDirPresent: true,
        }),
      },
    }],
  };

  const summaryOnly = await collectTelemetry(
    { includeAllocationsSummary: true },
    registry as never,
  ) as {
    allocations?: {
      summary?: {
        allocatedSessions: number;
        allocatedDisplayPixels: number;
        osInputSessions: number;
      };
      sessions?: unknown[];
    };
  };
  assert.strictEqual(summaryOnly.allocations?.summary?.allocatedSessions, 1);
  assert.strictEqual(summaryOnly.allocations?.summary?.allocatedDisplayPixels, 4096 * 2160);
  assert.strictEqual(summaryOnly.allocations?.summary?.osInputSessions, 1);
  assert.strictEqual(summaryOnly.allocations?.sessions, undefined);

  const withSessions = await collectTelemetry(
    { includeAllocationsSummary: true, includeAllocationSessions: true },
    registry as never,
  ) as {
    allocations?: {
      sessions?: Array<{ sessionId: string; displayAllocated: boolean; inputBackend: string }>;
    };
  };
  assert.strictEqual(withSessions.allocations?.sessions?.length, 1);
  assert.strictEqual(withSessions.allocations?.sessions?.[0]?.sessionId, 'alloc-session');
  assert.strictEqual(withSessions.allocations?.sessions?.[0]?.displayAllocated, true);
  assert.strictEqual(withSessions.allocations?.sessions?.[0]?.inputBackend, 'os');
  console.log('[unit] telemetry allocations summary and sessions ok');
}

function testLogicalToDeviceTransform(): void {
  const { createLogicalWindowTransform, mapLogicalToAbs } = require('./browser/patchright/input/logical-to-device') as typeof import('./browser/patchright/input/logical-to-device');
  // 1:1 into logical window region (absMax = logical-1), not stretch-to-display.
  const t = createLogicalWindowTransform(414, 711);
  assert.strictEqual(t.logicalWidth, 414);
  assert.strictEqual(t.logicalHeight, 711);
  assert.strictEqual(t.absMaxX, 413);
  assert.strictEqual(t.absMaxY, 710);
  assert.deepStrictEqual(mapLogicalToAbs(t, 0, 0), { x: 0, y: 0 });
  assert.deepStrictEqual(mapLogicalToAbs(t, 414, 711), { x: 413, y: 710 });
  assert.deepStrictEqual(mapLogicalToAbs(t, 200, 350), { x: 200, y: 350 });
  assert.deepStrictEqual(mapLogicalToAbs(t, -10, 5000), { x: 0, y: 710 });
  // Must not stretch mid-canvas toward Xvfb capacity (4096×2160).
  assert.notDeepStrictEqual(mapLogicalToAbs(t, 207, 355), { x: 2048, y: 1080 });
  assert.throws(() => createLogicalWindowTransform(0, 100), /positive/);
  console.log('[unit] logical-to-device transform ok');
}

function testKeycodeResolve(): void {
  const { resolveKeyStroke, KEY } = require('./browser/patchright/input/keycodes') as typeof import('./browser/patchright/input/keycodes');
  assert.strictEqual(resolveKeyStroke('Enter')?.code, KEY.ENTER);
  assert.strictEqual(resolveKeyStroke('a')?.code, KEY.A);
  assert.strictEqual(resolveKeyStroke('A')?.shift, true);
  assert.strictEqual(resolveKeyStroke(''), null);
  assert.strictEqual(resolveKeyStroke('Unobtanium'), null);
  console.log('[unit] keycode resolve ok');
}

function testXorgInputIsolationFlags(): void {
  const { buildXorgDummyConfigForTest } = require('./browser/patchright/Display') as typeof import('./browser/patchright/Display');
  const hotplug = buildXorgDummyConfigForTest(1280, 720);
  assert.ok(hotplug.includes('Option "AutoAddDevices" "true"'), 'patchright path keeps AutoAdd');
  assert.ok(hotplug.includes('Option "AutoEnableDevices" "false"'), 'foreign devices not auto-enable');

  const bound = buildXorgDummyConfigForTest(1280, 720, {
    pointerEventPath: '/dev/input/event4',
    keyboardEventPath: '/dev/input/event6',
    touchEventPath: '/dev/input/event5',
    pointerName: 'speculum-ptr-test',
    keyboardName: 'speculum-kbd-test',
    touchName: 'speculum-mt-test',
  });
  assert.ok(bound.includes('Option "AutoAddDevices" "false"'), 'os path disables AutoAdd');
  assert.ok(bound.includes('Driver "evdev"'), 'os path binds evdev');
  assert.ok(bound.includes('Option "Device" "/dev/input/event4"'), 'pointer event bound');
  assert.ok(bound.includes('Option "Device" "/dev/input/event6"'), 'keyboard event bound');
  assert.ok(bound.includes('Option "Device" "/dev/input/event5"'), 'touch event bound');
  assert.ok(bound.includes('InputDevice "speculum-ptr-test" "CorePointer"'), 'pointer in layout');
  assert.ok(
    bound.includes('InputDevice "speculum-kbd-test" "CoreKeyboard"'),
    'keyboard in layout',
  );
  const ptrSection = bound
    .split(/Section "InputDevice"/)
    .find((s) => s.includes('Identifier "speculum-ptr-test"'));
  assert.ok(ptrSection && !ptrSection.includes('Mode" "Absolute"'), 'pointer is relative');
  assert.ok(
    ptrSection.includes('AccelerationScheme" "none"'),
    'pointer acceleration disabled for software cursor',
  );
  console.log('[unit] xorg input isolation flags ok');
}

/** Regression: koffi variadic ioctl(fd, req, arg) throws; fixed 3-arg prototype must not. */
function testIoctlKoffiPrototype(): void {
  if (process.platform !== 'linux') {
    console.log('[unit] ioctl koffi prototype skip (non-linux)');
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi');
  const libc = koffi.load('libc.so.6');
  const bad = libc.func('int ioctl(int fd, unsigned long request, ...)');
  assert.throws(
    () => bad(0, 0x5501, 0),
    (err: unknown) =>
      err instanceof Error && /Missing value argument for variadic call/.test(err.message),
  );
  const good = libc.func('int ioctl(int fd, unsigned long request, int arg)');
  const rc = good(0, 0x5501, 0);
  assert.strictEqual(typeof rc, 'number');
  console.log('[unit] ioctl koffi prototype ok');
}

async function main(): Promise<void> {
  // Debug instrumentation posts to the ingest server; don't hang unit runs on it.
  (globalThis as { fetch: typeof fetch }).fetch = (async () =>
    new Response('{}', { status: 204 })) as typeof fetch;

  testDomainMatch();
  testScriptTargetRuleMatch();
  testPermissiveMainFrameCspRewrite();
  testViewportBounds();
  testResolveDeviceProfileDefaults();
  await testApplyLogicalViewportUsesBoundsAndMetrics();
  await testProveLogicalViewportUsesCssLayoutMetrics();
  testBuildChromeArgsIncludesWebglSpoof();
  testKitStealthInitSource();
  await testWorkerTargetStealthAutoAttach();
  await testScreencastRestartThrowsAfterStop();
  testLaunchEnvironmentIsRequired();
  testScreencastEncodeSize();
  await testScreencastAcceptsCssOrEncodeJpeg();
  testTouchEmulationParams();
  testStopDoesNotEnqueueCrash();
  testUnexpectedContextCloseEnqueuesCrash();
  testRecreateKeepsOpenAcrossStaleClose();
  await testStopKeepsBridgeQueuesOpen();
  testBenignBrowserRaceNarrow();
  await testAbortDoesNotStealQueuedCrash();
  testDropOldestQueueTracksDroppedCount();
  testDropAllOnOverflowForSequencedDiffs();
  await testTryWriteFrontPreservesFifoAsync();
  await testTryWriteFrontRejectsWhenFull();
  await testPumpQueueAwaitsDrainWithoutSkipping();
  await testPumpQueueAbortRequeuesFront();
  await testPumpQueueAbortAfterWriteDoesNotRequeue();
  await testEventBridgeQueueDroppedLifecycle();
  await testPermissionClearRespectsEpoch();
  testLogicalToDeviceTransform();
  testKeycodeResolve();
  testXorgInputIsolationFlags();
  testIoctlKoffiPrototype();
  await testInputFireAndForgetAndMoveCoalesce();
  await testInputKeyDefsIncludeEditingKeys();
  await testTouchMoveCoalesceAndStormWrites();
  await testInputMousePressReleaseOrdered();
  await testInputPendingCountIncludesChainDepth();
  await testTelemetryToggleOmission();
  await testTelemetryQueuesReportInputDepthAndDrops();
  await testTelemetryFaultStateSurvivesCrashConsumption();
  await testTelemetryAllocationsSummaryAndSessions();
  testHostResourcesApplySkipsRemountOffLinux();
  testCookieSanitizeMatrix();
  testDomAssetCacheAndBodyCodec();
  testSrcsetParseCloudinary();
  testParseDataUrlHardening();
  await testPublishedAnchorsLedgerOmitsAndRetires();
  await testPublishedAnchorsTransitiveUnpublishOnAncestorWipe();
  await testEmitChildListSkipsAfterPendingHostRetire();
  await testUnpublishedWrapperWipeUnpublishesDescendants();
  await testMapDocumentRemintsConnectedDuplicateAnchors();
  console.log('[unit] all passed');
}

/**
 * SoftNav ancestor wipe must unpublish the whole publishedParent subtree so
 * later childList cannot claim orphan anchors (address_miss cascade).
 */
async function testPublishedAnchorsTransitiveUnpublishOnAncestorWipe(): Promise<void> {
  const { chromium } = await import('patchright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.exposeFunction('__speculumDomEmit', () => {});
    await page.setContent(
      '<!doctype html><html><head></head><body>'
      + '<div id="keep"><div id="mid"><span id="leaf">x</span></div></div>'
      + '</body></html>',
    );
    await page.evaluate(PAGE_PROJECTION_PAGE_SCRIPT);
    const anchors = await page.evaluate(`(() => {
      const r = window.__speculumDomMapAndArmEstablish();
      return {
        mid: document.getElementById('mid').getAttribute('speculum-anchor'),
        leaf: document.getElementById('leaf').getAttribute('speculum-anchor'),
        keep: document.getElementById('keep').getAttribute('speculum-anchor'),
        rootTag: r && r.root && r.root.tag,
      };
    })()`) as { mid: string; leaf: string; keep: string; rootTag: string };
    assert.ok(anchors.mid && anchors.leaf && anchors.keep, 'anchors stamped');
    assert.strictEqual(
      await page.evaluate(`window.__speculumDomPublishedHas(${JSON.stringify(anchors.mid)})`),
      true,
    );
    assert.strictEqual(
      await page.evaluate(`window.__speculumDomPublishedHas(${JSON.stringify(anchors.leaf)})`),
      true,
    );

    await page.evaluate(`(() => { document.getElementById('mid').remove(); })()`);
    await page.waitForTimeout(80);

    assert.strictEqual(
      await page.evaluate(`window.__speculumDomPublishedHas(${JSON.stringify(anchors.mid)})`),
      false,
      'removed ancestor must leave the ledger',
    );
    assert.strictEqual(
      await page.evaluate(`window.__speculumDomPublishedHas(${JSON.stringify(anchors.leaf)})`),
      false,
      'descendant under wiped ancestor must unpublish transitively',
    );
    assert.strictEqual(
      await page.evaluate(`window.__speculumDomPublishedHas(${JSON.stringify(anchors.keep)})`),
      true,
      'untouched ancestor stays published',
    );
    assert.ok(
      PAGE_PROJECTION_PAGE_SCRIPT.includes('unpublishPublishedSubtree'),
      'page script must define transitive unpublish',
    );
    console.log('[unit] publishedAnchors transitive unpublish on ancestor wipe ok');
  } finally {
    await browser.close();
  }
}

/**
 * SoftNav retire race: pending retire of host flushed before childList must not
 * emit against the unpublished host (phase=parent address_miss).
 */
async function testEmitChildListSkipsAfterPendingHostRetire(): Promise<void> {
  const { chromium } = await import('patchright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const emits: Array<{ operation: string; payload: Record<string, unknown> }> = [];
    await page.exposeFunction('__speculumDomEmit', (msg: {
      operation?: string;
      payload?: Record<string, unknown>;
    }) => {
      emits.push({
        operation: String(msg?.operation ?? ''),
        payload: (msg?.payload ?? {}) as Record<string, unknown>,
      });
    });
    await page.setContent(
      '<!doctype html><html><head></head><body>'
      + '<div id="host"><span id="leaf">x</span></div>'
      + '</body></html>',
    );
    await page.evaluate(PAGE_PROJECTION_PAGE_SCRIPT);
    const hostA = await page.evaluate(`(() => {
      window.__speculumDomMapAndArmEstablish();
      return document.getElementById('host').getAttribute('speculum-anchor');
    })()`) as string;
    assert.ok(hostA, 'host published');
    emits.length = 0;

    await page.evaluate(`((hostA) => {
      window.__speculumDomScheduleRetire(hostA);
      const leaf = document.getElementById('leaf');
      leaf.textContent = 'mutated';
      const host = document.getElementById('host');
      const span = document.createElement('span');
      span.id = 'late';
      span.textContent = 'late';
      host.appendChild(span);
    })(${JSON.stringify(hostA)})`);
    await page.waitForTimeout(80);

    const againstHost = emits.filter((e) => {
      const sel = (e.payload as { selector?: { query?: string } }).selector;
      return String(sel?.query ?? '').includes(hostA);
    });
    // Retire emits remove(host) under body — that selector is body, not host.
    // childList/patch targeting host as parent must be zero after pending retire.
    const hostAsParent = againstHost.filter((e) => {
      const sel = (e.payload as { selector?: { query?: string } }).selector;
      return String(sel?.query ?? '') === `[speculum-anchor="${hostA}"]`
        || String(sel?.query ?? '') === `[speculum-anchor='${hostA}']`;
    });
    assert.strictEqual(
      hostAsParent.length,
      0,
      'no childList/patch may target a host that was pending-retired',
    );
    assert.strictEqual(
      await page.evaluate(`window.__speculumDomPublishedHas(${JSON.stringify(hostA)})`),
      false,
      'retired host must leave the ledger',
    );
    assert.ok(
      PAGE_PROJECTION_PAGE_SCRIPT.includes('emitWire'),
      'emit path must validate after flush via emitWire',
    );
    assert.ok(
      PAGE_PROJECTION_PAGE_SCRIPT.includes('sweepDisconnectedPublished'),
      'page script must sweep disconnected published identities',
    );
    console.log('[unit] emitChildList skips after pending host retire ok');
  } finally {
    await browser.close();
  }
}

/**
 * Removing a never-published wrapper must still unpublish published descendants
 * found under the DOM subtree (ledger gap SoftNav wipe).
 */
async function testUnpublishedWrapperWipeUnpublishesDescendants(): Promise<void> {
  const { chromium } = await import('patchright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.exposeFunction('__speculumDomEmit', () => {});
    await page.setContent(
      '<!doctype html><html><head></head><body>'
      + '<div id="keep"><div id="wrap"><span id="leaf">x</span></div></div>'
      + '</body></html>',
    );
    await page.evaluate(PAGE_PROJECTION_PAGE_SCRIPT);
    const leafA = await page.evaluate(`(() => {
      window.__speculumDomMapAndArmEstablish();
      const wrap = document.getElementById('wrap');
      const leaf = document.getElementById('leaf');
      const leafA = leaf.getAttribute('speculum-anchor');
      const wrapA = wrap.getAttribute('speculum-anchor');
      // Ledger gap: wrap leaves the wire identity set without transitive wipe.
      if (wrapA) window.__speculumDomForgetPublished(wrapA);
      wrap.removeAttribute('speculum-anchor');
      return leafA;
    })()`) as string;
    await page.waitForTimeout(50);
    assert.ok(leafA, 'leaf was published');
    assert.strictEqual(
      await page.evaluate(`window.__speculumDomPublishedHas(${JSON.stringify(leafA)})`),
      true,
      'leaf still published before wrapper remove',
    );

    await page.evaluate(`(() => { document.getElementById('wrap').remove(); })()`);
    await page.waitForTimeout(80);

    assert.strictEqual(
      await page.evaluate(`window.__speculumDomPublishedHas(${JSON.stringify(leafA)})`),
      false,
      'DOM-walk unpublish must clear published descendants under unpublished wrapper',
    );
    assert.ok(
      PAGE_PROJECTION_PAGE_SCRIPT.includes('unpublishPublishedUnderElement'),
      'page script must DOM-walk unpublished wrappers',
    );
    console.log('[unit] unpublished wrapper wipe unpublishes descendants ok');
  } finally {
    await browser.close();
  }
}

function testSrcsetParseCloudinary(): void {
  const raw =
    'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_1920/hero.jpg 1920w, '
    + 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/hero.jpg 800w';
  const parsed = parseSrcset(raw);
  assert.deepStrictEqual(parsed, [
    {
      url: 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_1920/hero.jpg',
      descriptor: '1920w',
    },
    {
      url: 'https://res.cloudinary.com/demo/image/upload/f_avif,q_auto,w_800/hero.jpg',
      descriptor: '800w',
    },
  ]);
  const mapped = mapSrcset(raw, (u) => `/w7s/virtual-assets/${u}`);
  assert.ok(mapped.includes('f_avif,q_auto,w_1920'));
  assert.ok(!mapped.includes('/f_avif 1920w'));
  console.log('[unit] srcsetParse Cloudinary ok');
}

function testParseDataUrlHardening(): void {
  const png =
    'data:image/png;charset=utf-8;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const ok = parseDataUrl(png);
  assert.ok(ok, 'charset before base64 must parse');
  assert.ok(ok!.body.length > 0);
  assert.ok(ok!.contentType.includes('image/png'));
  assert.strictEqual(parseDataUrl('data:image/png;base64'), null, 'missing comma must fail');
  assert.strictEqual(parseDataUrl('not-a-data-url'), null);
  assert.strictEqual(parseDataUrl('data:text/plain,hello')?.body.toString('utf8'), 'hello');
  console.log('[unit] parseDataUrl hardening contract ok');
}

/**
 * Connected clones that share speculum-anchor must remint before document map
 * so the wire tree never violates T7 (qSA===1) — BZ4.
 */
async function testMapDocumentRemintsConnectedDuplicateAnchors(): Promise<void> {
  const { chromium } = await import('patchright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.exposeFunction('__speculumDomEmit', () => {});
    await page.setContent(
      '<!doctype html><html><head></head><body><div id="a">one</div><div id="b">two</div></body></html>',
    );
    await page.evaluate(PAGE_PROJECTION_PAGE_SCRIPT);
    await page.evaluate(`(() => {
      const a = document.getElementById('a');
      const b = document.getElementById('b');
      a.setAttribute('speculum-anchor', 'dup-shared');
      b.setAttribute('speculum-anchor', 'dup-shared');
    })()`);
    const mapped = await page.evaluate(`(() => {
      const r = window.__speculumDomMapAndArmEstablish();
      const anchors = [];
      function walk(n) {
        if (!n || typeof n !== 'object') return;
        if (n.tag === '#text' || n.tag === '#comment') return;
        const a = n.anchor || (n.attrs && n.attrs['speculum-anchor']);
        if (a) anchors.push(a);
        const kids = n.children || [];
        for (let i = 0; i < kids.length; i++) walk(kids[i]);
      }
      walk(r.root);
      const counts = {};
      for (const a of anchors) counts[a] = (counts[a] || 0) + 1;
      const dups = Object.keys(counts).filter((k) => counts[k] > 1);
      const liveA = document.getElementById('a').getAttribute('speculum-anchor');
      const liveB = document.getElementById('b').getAttribute('speculum-anchor');
      return { dups, liveA, liveB, anchorCount: anchors.length };
    })()`) as {
      dups: string[];
      liveA: string | null;
      liveB: string | null;
      anchorCount: number;
    };
    assert.strictEqual(mapped.dups.length, 0, 'mapped document must not contain duplicate anchors');
    assert.ok(mapped.liveA && mapped.liveB, 'live nodes must keep anchors');
    assert.notStrictEqual(mapped.liveA, mapped.liveB, 'connected duplicate attrs must remint one node');
    assert.ok(mapped.anchorCount >= 4, 'html/head/body + leaves');
    assert.ok(
      PAGE_PROJECTION_PAGE_SCRIPT.includes('remintDuplicateConnectedAnchors'),
      'establish path must call remintDuplicateConnectedAnchors',
    );
    assert.ok(
      PAGE_PROJECTION_PAGE_SCRIPT.includes('Re-adding the same published identity'),
      'childList must skip already-published same-node adds (BZ4)',
    );
    console.log('[unit] MapDocument remint connected duplicate anchors ok');
  } finally {
    await browser.close();
  }
}

/**
 * Writer identity ledger: omit remove of never-published anchors; remint clone
 * of a detached published identity only after scheduling wire retire.
 */
async function testPublishedAnchorsLedgerOmitsAndRetires(): Promise<void> {
  const { chromium } = await import('patchright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const emits: Array<{ operation: string; payload: Record<string, unknown> }> = [];
    await page.exposeFunction('__speculumDomEmit', (msg: {
      operation?: string;
      payload?: Record<string, unknown>;
    }) => {
      emits.push({
        operation: String(msg?.operation ?? ''),
        payload: (msg?.payload ?? {}) as Record<string, unknown>,
      });
    });
    await page.setContent('<!doctype html><html><head></head><body><div id="host"><p id="p">x</p></div></body></html>');
    await page.evaluate(PAGE_PROJECTION_PAGE_SCRIPT);

    // Before establish liveEmit is false / ledger empty — remove must not hit the wire.
    await page.evaluate(`(() => {
      const host = document.getElementById('host');
      const ghost = document.createElement('span');
      ghost.id = 'ghost';
      ghost.setAttribute('speculum-anchor', 'ghost-never-published');
      host.appendChild(ghost);
      ghost.remove();
    })()`);
    await page.waitForTimeout(30);
    assert.strictEqual(
      emits.some((e) => JSON.stringify(e.payload).includes('ghost-never-published')),
      false,
      'unpublished remove must be omitted',
    );

    emits.length = 0;
    await page.evaluate(`window.__speculumDomMapAndArmEstablish()`);

    // Publish a node, detach it, then clone with the same anchor — expect retire + remint.
    await page.evaluate(`(() => {
      const host = document.getElementById('host');
      const live = document.createElement('span');
      live.id = 'live';
      live.textContent = 'a';
      host.appendChild(live);
    })()`);
    await page.waitForTimeout(50);
    const addEmits = emits.filter((e) => e.operation === 'childList');
    assert.ok(addEmits.length >= 1, 'expected publish add for live span');
    let addedNode: string | null = null;
    for (const e of addEmits) {
      const added = e.payload.added as Array<{ node?: { anchor?: string } }> | undefined;
      const hit = (added ?? []).find((a) => a.node?.anchor);
      if (hit?.node?.anchor) {
        addedNode = hit.node.anchor;
        break;
      }
    }
    assert.ok(addedNode, 'added span must carry published anchor');

    emits.length = 0;
    const cloneInfo = await page.evaluate(`((publishedAnchor) => {
      const host = document.getElementById('host');
      const live = document.getElementById('live');
      if (!live || !host) return null;
      live.remove();
      const clone = document.createElement('span');
      clone.id = 'clone';
      clone.setAttribute('speculum-anchor', publishedAnchor);
      host.appendChild(clone);
      return { cloneAnchor: clone.getAttribute('speculum-anchor') };
    })(${JSON.stringify(addedNode)})`) as { cloneAnchor: string | null } | null;
    await page.waitForTimeout(50);
    assert.ok(cloneInfo?.cloneAnchor, 'clone must have an anchor');
    const removeOfPublished = emits.filter((e) => {
      if (e.operation !== 'childList') return false;
      const removed = e.payload.removed as Array<{ selector?: { query?: string } }> | undefined;
      return (removed ?? []).some((r) => String(r.selector?.query ?? '').includes(addedNode!));
    });
    assert.ok(removeOfPublished.length >= 1, 'expected wire remove of published detached anchor');
    assert.ok(
      PAGE_PROJECTION_PAGE_SCRIPT.includes('scheduleRetirePublishedAnchor'),
      'detached published remint must retire before reassignment',
    );
    assert.ok(
      PAGE_PROJECTION_PAGE_SCRIPT.includes('!mapped.isConnected && publishedAnchors.has(a)'),
      'ensureAnchor must gate detached published collisions',
    );
    console.log('[unit] publishedAnchors ledger omit+retire ok');
  } finally {
    await browser.close();
  }
}

function testDomAssetCacheAndBodyCodec(): void {
  const cache = new DomAssetCache(1024, 2);
  const a = cache.put('k1', Buffer.from('aaa'), 'text/css');
  const b = cache.put('k2', Buffer.from('bbb'), 'image/png');
  assert.ok(a);
  assert.ok(b);
  assert.strictEqual(cache.get('k1')?.contentType, 'text/css');
  const c = cache.put('k3', Buffer.from('ccc'), 'font/woff2');
  assert.ok(c);
  assert.strictEqual(cache.size, 2);
  assert.strictEqual(cache.get('k1'), undefined);

  const body = encodeDomBody({
    root: {
      anchor: 'html1',
      tag: 'html',
      children: [{ tag: '#text', text: 'hi' }],
    },
  });
  const decoded = decodeDomBody(body) as { root?: { tag?: string; children?: Array<{ text?: string }> } };
  assert.ok(decoded && typeof decoded === 'object' && 'root' in decoded);
  assert.strictEqual(decoded.root?.tag, 'html');
  assert.strictEqual(decoded.root?.children?.[0]?.text, 'hi');
  const cssomBody = encodeDomBody({
    sheets: [{ id: 's1', scope: { kind: 'main' }, rules: [{ id: 'r1', cssText: 'body{color:red}' }] }],
  });
  const cssomDecoded = decodeDomBody(cssomBody) as { sheets?: Array<{ id: string }> };
  assert.ok(cssomDecoded && typeof cssomDecoded === 'object' && Array.isArray(cssomDecoded.sheets));
  assert.strictEqual(cssomDecoded.sheets?.[0]?.id, 's1');
  console.log('[unit] DomAssetCache + PageProjection body codec ok');
}

function testCookieSanitizeMatrix(): void {
  const dirty: BrowserCookieState = {
    name: 'sf_marker',
    value: 'state-cookie',
    domain: 'fixture.test',
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: true,
    sameSite: '',
  };
  const clean = sanitizeCookieForCdp(dirty);
  assert.ok(clean);
  assert.strictEqual(clean!.name, 'sf_marker');
  assert.strictEqual('expires' in clean!, false);
  assert.strictEqual('sameSite' in clean!, false);

  const ms = sanitizeCookieForCdp({
    name: 'ms',
    value: 'v',
    domain: 'd.com',
    path: '/',
    expires: 1_700_000_000_000,
  });
  assert.strictEqual(ms!.expires, 1_700_000_000);

  const none = sanitizeCookieForCdp({
    name: 'x',
    value: '1',
    domain: 'd.com',
    path: '/',
    secure: false,
    sameSite: 'none',
  });
  assert.strictEqual(none!.sameSite, 'None');
  assert.strictEqual(none!.secure, true);

  assert.strictEqual(sanitizeCookieForCdp({
    name: '',
    value: '1',
    domain: 'd.com',
    path: '/',
  }), null);

  const batch = sanitizeCookieBatch([
    { name: 'good', value: '1', domain: 'd.com', path: '/' },
    { name: '', value: 'bad', domain: 'd.com', path: '/' },
    { name: 'ok', value: '2', domain: 'd.com', path: '/', sameSite: 'LAX', expires: -1 },
  ]);
  assert.strictEqual(batch.valid.length, 2);
  assert.strictEqual(batch.skippedCount, 1);
  assert.ok(batch.normalizedCount >= 1);
  console.log('[unit] cookie sanitize ok');
}

function testHostResourcesApplySkipsRemountOffLinux(): void {
  if (process.platform === 'linux') {
    console.log('[unit] host resources remount skip (linux — exercised in container)');
    return;
  }
  const result = applyHostResources({
    shmSizeBytes: 4 * 1024 * 1024 * 1024,
    raiseUlimits: true,
    nofile: 4096,
    nproc: 1024,
  });
  assert.ok(result.warnings.some((w) => /shm remount skipped/i.test(w)));
  assert.strictEqual(result.ulimitsRaised, false);
  console.log('[unit] host resources apply skip off-linux ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
