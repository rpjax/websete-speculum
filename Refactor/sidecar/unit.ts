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
import { runPageProjectionUnitTests } from './browser/patchright/mirror/page/page.unit';
import { runV4ProjectionSessionUnitTests } from './browser/mirror/projection/session/v4ProjectionSession.unit';
import { mapSrcset, parseSrcset } from './browser/patchright/mirror/dom/srcsetParse';
import { parseDataUrl } from './browser/patchright/mirror/page/parseDataUrl';
import type { BrowserCookieState } from './browser/BrowserSession';
import { collectTelemetry } from './telemetry/collectTelemetry';
import { applyHostResources } from './host/hostResources';
import {
  addMod64,
  computeRowHash,
  h64Bytes,
  h64Str,
  h64U32,
  hashAttr,
  hashName,
  hashValue,
  subMod64,
  TableHashTracker,
} from './browser/mirror/projection/models/rowHash';
import { ReplicatedTable } from './browser/mirror/projection/models/replicatedTable';
import { compareTableToLiveOrder } from './browser/mirror/projection/models/tableLiveOracle';
import {
  applyFrameToTable,
  applyFrameToTableChecked,
  applyOpToTable,
  applyOpsToTable,
} from './browser/mirror/projection/models/replicatedTableApply';
import { NodeKind, OpCode } from './browser/mirror/projection/models/opcodes';
import { CHECK_SCOPE_RANGE, CHECK_SCOPE_TABLE, type FrameOp, createFrame, INSERT_AT_END } from './browser/mirror/projection/models/frame';
import { digestReplicatedTable } from './browser/mirror/projection/models/tableDigest';
import { BinaryFrameEncoder } from './browser/mirror/projection/virtual/frame/binaryFrameEncoder';
import { NodeTableApplier } from './browser/mirror/projection/lab/nodeTableApply';
import { MAX_ROWS } from './browser/mirror/projection/models/limits';
import { fnv1a32 } from './browser/mirror/projection/virtual/cssom/fnv32';
import { diffRules } from './browser/mirror/projection/virtual/cssom/cssomReconcile';

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
  assert.ok(
    args.includes('--disable-background-timer-throttling'),
    '§5.3.4 frame clock must not be background-throttled',
  );
  assert.ok(args.includes('--disable-renderer-backgrounding'), '§5.3.4 renderer must not be backgrounded');
  assert.ok(
    args.includes('--disable-backgrounding-occluded-windows'),
    '§5.3.4 occluded window must not be backgrounded',
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

/** frame-protocol.md §1.5 Stage 1 gate — H64 primitives: deterministic, input-sensitive, mod-2^64-correct. */
function testRowHashPrimitives(): void {
  assert.strictEqual(h64Str('div'), h64Str('div'), 'h64Str must be deterministic');
  assert.notStrictEqual(h64Str('div'), h64Str('span'), 'different strings must (almost certainly) hash differently');
  assert.notStrictEqual(h64Str(''), 0n, 'empty string must not hash to the identity element');
  assert.strictEqual(h64Bytes(new Uint8Array([1, 2, 3])), h64Bytes(new Uint8Array([1, 2, 3])));
  assert.notStrictEqual(h64Bytes(new Uint8Array([1, 2, 3])), h64Bytes(new Uint8Array([3, 2, 1])), 'byte order must matter');

  assert.strictEqual(h64U32(0), h64U32(0));
  assert.notStrictEqual(h64U32(1), h64U32(2));
  assert.notStrictEqual(h64U32(0x100), h64U32(1), 'byte-shifted values must not collide');
  assert.notStrictEqual(h64U32(0xffffffff), h64U32(0), 'top bit must be mixed in');

  // Tag-prefixed content hashes must not collide across field kinds for the same underlying text.
  assert.notStrictEqual(hashName('x'), hashValue('x'), 'hashName/hashValue must not collide for equal text');
  assert.notStrictEqual(hashName('x'), hashAttr('x', ''), 'hashName/hashAttr must not collide for equal text');
  assert.notStrictEqual(hashAttr('a', 'b'), hashAttr('ab', ''), 'attr name/value separator must prevent splicing collisions');
  assert.notStrictEqual(hashAttr('a', 'b'), hashAttr('a', 'bx'), 'attr value must be part of the hash');

  // mod 2^64 wraparound — subMod64 must invert addMod64 for any operand pair, including near the mask boundary.
  const MASK64 = 0xffffffffffffffffn;
  assert.strictEqual(addMod64(MASK64, 1n), 0n, 'addMod64 must wrap at 2^64');
  assert.strictEqual(subMod64(0n, 1n), MASK64, 'subMod64 must wrap negative results to unsigned mod 2^64');
  const a = h64Str('alpha');
  const b = h64Str('beta');
  assert.strictEqual(subMod64(addMod64(a, b), b), a, 'subMod64 must invert addMod64');

  // computeRowHash must be sensitive to every one of its five fields independently.
  const base = computeRowHash(10, NodeKind.Element, 1, 0, 0n);
  assert.notStrictEqual(computeRowHash(11, NodeKind.Element, 1, 0, 0n), base, 'id must affect rowHash');
  assert.notStrictEqual(computeRowHash(10, NodeKind.Text, 1, 0, 0n), base, 'kind must affect rowHash');
  assert.notStrictEqual(computeRowHash(10, NodeKind.Element, 2, 0, 0n), base, 'parent must affect rowHash');
  assert.notStrictEqual(computeRowHash(10, NodeKind.Element, 1, 5, 0n), base, 'prevSibling must affect rowHash');
  assert.notStrictEqual(computeRowHash(10, NodeKind.Element, 1, 0, 1n), base, 'contentHash must affect rowHash');
  console.log('[unit] rowHash primitives (deterministic, sensitive, mod-2^64-correct) ok');
}

/** §1.5 — TableHashTracker's running sum must be order-independent and correctly reversible. */
function testTableHashTrackerOrderIndependence(): void {
  const rows = new Map<number, bigint>([
    [1, h64Str('a')],
    [2, h64Str('b')],
    [3, h64Str('c')],
  ]);

  const forward = new TableHashTracker();
  for (const [id, h] of rows) forward.upsert(id, h);

  const reversed = new TableHashTracker();
  for (const [id, h] of [...rows].reverse()) reversed.upsert(id, h);

  assert.strictEqual(forward.value, reversed.value, 'tableHash (a running sum mod 2^64) must not depend on upsert order');
  assert.strictEqual(forward.size, 3);

  // Replacing an existing row's hash must retract the old contribution, not add to it.
  const before = forward.value;
  forward.upsert(2, h64Str('b-updated'));
  assert.notStrictEqual(forward.value, before, 'replacing a row hash must change the total');
  forward.upsert(2, rows.get(2)!);
  assert.strictEqual(forward.value, before, 'restoring the original row hash must restore the original total');

  // remove() must exactly undo upsert() — final total after removing everything is the identity (0).
  forward.remove(1);
  forward.remove(2);
  forward.remove(3);
  assert.strictEqual(forward.value, 0n, 'removing every row must return the tracker to the zero identity');
  assert.strictEqual(forward.size, 0);
  console.log('[unit] TableHashTracker order-independent sum + exact remove ok');
}

/** §1.3/§1.5 — ReplicatedTable row construction: contentHash/rowHash formulas match the spec, ATTR_DEL absent-key is a no-op. */
function testReplicatedTableRowContentHash(): void {
  const table = new ReplicatedTable();
  table.createElementRow(10, 'div', [{ name: 'class', value: 'a' }]);
  const afterCreate = table.getRow(10);
  assert.ok(afterCreate);
  const expectedCreateContent = addMod64(hashName('div'), hashAttr('class', 'a'));
  assert.strictEqual(afterCreate!.contentHash, expectedCreateContent, '§1.3 element contentHash = Σ(tag name hash, attr hashes)');
  assert.strictEqual(afterCreate!.rowHash, computeRowHash(10, NodeKind.Element, 0, 0, expectedCreateContent));

  table.setAttrs(10, [{ name: 'id', value: 'root' }]);
  const expectedAfterSet = addMod64(expectedCreateContent, hashAttr('id', 'root'));
  assert.strictEqual(table.getRow(10)!.contentHash, expectedAfterSet, 'ATTR_SET must add the new attribute contribution');

  // §4.4 — deleting an attribute that was never set is a documented no-op, not an error.
  table.delAttrs(10, ['does-not-exist']);
  assert.strictEqual(table.getRow(10)!.contentHash, expectedAfterSet, 'absent-attribute ATTR_DEL must be a no-op');

  table.delAttrs(10, ['class']);
  const expectedAfterDel = subMod64(expectedAfterSet, hashAttr('class', 'a'));
  assert.strictEqual(table.getRow(10)!.contentHash, expectedAfterDel, 'ATTR_DEL must retract exactly that attribute\'s contribution');

  table.createLeafRow(20, NodeKind.Text, 'hello');
  assert.strictEqual(table.getRow(20)!.contentHash, hashValue('hello'), '§1.3 text/comment contentHash = hashValue(text)');
  table.setValue(20, 'world');
  assert.strictEqual(table.getRow(20)!.contentHash, hashValue('world'), 'TEXT_SET must replace, not accumulate, contentHash');

  table.createLeafRow(30, NodeKind.Doctype, 'html');
  assert.strictEqual(table.getRow(30)!.contentHash, hashValue('html'), 'doctype contentHash uses its name field as the single content string');
  console.log('[unit] ReplicatedTable row contentHash/rowHash formulas ok');
}

/** §4.3 — INSERT/REMOVE topology: exact prevSibling repair on link/unlink/move, without a table-wide scan. */
function testReplicatedTableTopologyRepair(): void {
  const table = new ReplicatedTable();
  const NONE = 0;
  for (const id of [10, 11, 12, 13]) table.createElementRow(id, 'div', []);

  table.insertBatch(1, NONE, [10]);
  table.insertBatch(10, NONE, [11, 12]);
  assert.strictEqual(table.getRow(11)!.prevSibling, NONE);
  assert.strictEqual(table.getRow(12)!.prevSibling, 11);

  // Insert 13 before 11 — must repair 11's prevSibling without touching 12.
  const beforeHash12 = table.getRow(12)!.rowHash;
  table.insertBatch(10, 11, [13]);
  assert.strictEqual(table.getRow(13)!.prevSibling, NONE, '13 lands first (before 11, which had no prevSibling)');
  assert.strictEqual(table.getRow(11)!.prevSibling, 13, '11 must be relinked after 13');
  assert.strictEqual(table.getRow(12)!.rowHash, beforeHash12, '12 must be untouched by an insert that does not neighbor it');

  // Remove 11 (the middle node) — 12 must be relinked directly after 13, skipping 11.
  table.removeBatch(10, [11]);
  assert.strictEqual(table.getRow(11)!.parent, NONE, 'removed row is detached');
  assert.strictEqual(table.getRow(11)!.prevSibling, NONE);
  assert.strictEqual(table.getRow(12)!.prevSibling, 13, '12 must skip over the removed 11 and relink to 13');

  // Re-insert 11 at the end (append) — must land after the current last child (12).
  table.insertBatch(10, NONE, [11]);
  assert.strictEqual(table.getRow(11)!.parent, 10);
  assert.strictEqual(table.getRow(11)!.prevSibling, 12, 're-inserted-at-end must link after the current last child');

  // Moving a node already attached elsewhere must unlink it from its old position first (§4.3 "a move").
  table.insertBatch(1, NONE, [12]); // move 12 out from under 10, to the end of parent 1 (after 10)
  assert.strictEqual(table.getRow(12)!.parent, 1);
  assert.strictEqual(table.getRow(11)!.prevSibling, 13, '11 must be relinked to 13 once 12 (its former follower) moves away');

  // dropRow (§4.2 NODE_DROP, Stage 3) must remove the row's contribution from tableHash entirely.
  const totalBeforeDrop = table.tableHash;
  const droppedRowHash = table.getRow(13)!.rowHash;
  table.dropRow(13);
  assert.strictEqual(table.has(13), false);
  assert.strictEqual(table.tableHash, subMod64(totalBeforeDrop, droppedRowHash));
  console.log('[unit] ReplicatedTable INSERT/REMOVE topology repair (prevSibling, move, drop) ok');
}

/**
 * OPEN-7 — insert-before-existing must set nextSiblingOf[last] = before so REMOVE of last
 * repairs hashed before.prevSibling. The topology test above removes a *middle* node whose
 * reverse link was already set by a prior append, so it cannot catch this.
 */
function testReplicatedTableInsertBeforeNextSiblingRepair(): void {
  const table = new ReplicatedTable();
  const NONE = 0;
  const P = 10;
  const X = 11;
  const A = 12;
  const L = 13;
  for (const id of [P, X, A, L]) table.createElementRow(id, 'div', []);

  table.insertBatch(1, NONE, [P]);
  table.insertBatch(P, NONE, [X]);
  table.insertBatch(P, X, [A, L]);
  assert.strictEqual(table.getRow(A)!.prevSibling, NONE);
  assert.strictEqual(table.getRow(L)!.prevSibling, A);
  assert.strictEqual(table.getRow(X)!.prevSibling, L);
  const xHashAfterInsert = table.getRow(X)!.rowHash;

  table.removeBatch(P, [L]);
  assert.strictEqual(table.getRow(L)!.parent, NONE);
  assert.strictEqual(table.getRow(A)!.prevSibling, NONE);
  assert.strictEqual(table.getRow(X)!.prevSibling, A, 'OPEN-7: REMOVE of last-inserted-before must relink X.prevSibling to A');
  assert.notStrictEqual(table.getRow(X)!.rowHash, xHashAfterInsert, 'hashed prevSibling on X must change when L is removed');

  const first = new ReplicatedTable();
  first.createElementRow(P, 'div', []);
  first.createElementRow(X, 'div', []);
  first.createElementRow(14, 'div', []);
  first.insertBatch(1, NONE, [P]);
  first.insertBatch(P, NONE, [X]);
  first.insertBatch(P, X, [14]);
  first.removeBatch(P, [14]);
  assert.strictEqual(first.getRow(X)!.prevSibling, NONE, 'OPEN-7: REMOVE of a single prepended id must restore first-child prevSibling=0');
  console.log('[unit] ReplicatedTable insert-before nextSiblingOf repair (OPEN-7) ok');
}

/**
 * prepend-stress shape at the table layer: INSERT-before-first batches + tail REMOVE + aged NODE_DROP.
 * Derived lastChildOf walk must stay identical to hashed parent (OPEN-8: live O2 failed this shape).
 */
function testReplicatedTablePrependEvictDerivedLinks(): void {
  const table = new ReplicatedTable();
  const LIST = 19;
  const BATCH = 50;
  const MAX_LIVE = 400;
  const AGE = 20;
  table.createElementRow(LIST, 'div', []);
  table.insertBatch(1, 0, [LIST]);
  let nextId = 100;
  const live: number[] = [];
  const detachedAt = new Map<number, number>();

  for (let seq = 1; seq <= 200; seq++) {
    table.setSequence(seq);
    const batch: number[] = [];
    for (let i = 0; i < BATCH; i++) {
      const id = nextId++;
      table.createElementRow(id, 'div', []);
      batch.push(id);
    }
    const before = live[0] ?? 0;
    table.insertBatch(LIST, before, batch);
    live.unshift(...batch);
    while (live.length > MAX_LIVE) {
      const old = live.pop()!;
      table.removeBatch(LIST, [old]);
      detachedAt.set(old, seq);
    }
    const droppable: number[] = [];
    for (const [id, at] of detachedAt) {
      if (seq - at >= AGE) droppable.push(id);
    }
    for (const id of droppable) {
      table.dropSubtree(id);
      detachedAt.delete(id);
    }
    const walked = table.orderedChildIds(LIST);
    const hashed = table.countAttachedChildren(LIST);
    if (walked.length !== hashed) {
      const lastId = table.lastChildId(LIST);
      const lastRow = table.getRow(lastId);
      assert.fail(
        `seq ${seq}: lastChildOf walk ${walked.length} !== hashed parent ${hashed}` +
          ` lastChildId=${lastId} lastRow=${lastRow ? `parent=${lastRow.parent} prev=${lastRow.prevSibling}` : 'missing'}` +
          ` liveFirst=${live[0]} liveLast=${live[live.length - 1]}`,
      );
    }
    assert.strictEqual(walked.length, live.length, `seq ${seq}: walk ${walked.length} !== live ${live.length}`);
    assert.deepStrictEqual(walked, live, `seq ${seq}: sibling order diverged from prepend+evict model`);
  }
  console.log('[unit] ReplicatedTable prepend+evict derived lastChildOf matches hashed parent ok');
}

function open7Table(): ReplicatedTable {
  const table = new ReplicatedTable();
  const NONE = 0;
  for (const id of [10, 11, 12, 13]) table.createElementRow(id, 'div', []);
  table.insertBatch(1, NONE, [10]);
  table.insertBatch(10, NONE, [11]);
  table.insertBatch(10, 11, [12, 13]);
  table.removeBatch(10, [13]);
  return table;
}

/** O2 local — table child order vs a synthetic live map (no DOM). */
function testTableLiveOracle(): void {
  const P = 10;
  const X = 11;
  const A = 12;
  const L = 13;
  const table = open7Table();

  const matching = new Map<number, readonly number[]>([
    [1, [P]],
    [P, [A, X]],
  ]);
  const ok = compareTableToLiveOrder(table, matching);
  assert.strictEqual(ok.identical, true, `expected identical, got ${JSON.stringify(ok.divergences)}`);

  const stale = new Map<number, readonly number[]>([
    [1, [P]],
    [P, [A, L, X]],
  ]);
  const staleResult = compareTableToLiveOrder(table, stale);
  assert.strictEqual(staleResult.identical, false);
  assert.ok(
    staleResult.divergences.some((d) => d.kind === 'child_order_mismatch'),
    `expected child_order_mismatch, got ${JSON.stringify(staleResult.divergences)}`,
  );

  const missingLive = new Map<number, readonly number[]>([[1, [P]]]);
  const extra = compareTableToLiveOrder(table, missingLive);
  assert.strictEqual(extra.identical, false);
  assert.ok(
    extra.divergences.some((d) => d.kind === 'extra_attached_in_table'),
    `expected extra_attached_in_table, got ${JSON.stringify(extra.divergences)}`,
  );

  const withDetached = new Map<number, readonly number[]>([
    [1, [P]],
    [P, [A, X]],
  ]);
  // L remains detached (parent=0) and omitted from live — OPEN-2, not a failure.
  const detachedOk = compareTableToLiveOrder(table, withDetached);
  assert.strictEqual(detachedOk.identical, true);

  // REMOVE leaves descendants attached to the detached row (§4.3) — not a live-tree failure.
  table.createLeafRow(99, NodeKind.Text, 'ghost');
  table.insertBatch(L, 0, [99]);
  const subtreeDetached = compareTableToLiveOrder(table, withDetached);
  assert.strictEqual(
    subtreeDetached.identical,
    true,
    `detached subtree under L must not fail O2: ${JSON.stringify(subtreeDetached.divergences)}`,
  );
  console.log('[unit] tableLiveOracle O2 local (OPEN-7 shape + mismatch + detached) ok');
}

/**
 * frame-protocol.md §1.5 Stage 1 GATE — "unit tests proving producer and client compute identical
 * rowHash/tableHash for the same sequence of mutations." Two independent `ReplicatedTable`
 * instances (standing in for the producer's table and the client's table) fed the exact same
 * `FrameOp` sequence through the one shared `applyOpsToTable` interpreter must end up byte-for-byte
 * identical — same `tableHash`, same per-row snapshot for every id — and a real divergence must be
 * detectable (tableHash actually changes), so this is not a vacuously-true comparison.
 */
function testReplicatedTableApplyOpsParity(): void {
  const ops: FrameOp[] = [
    { op: OpCode.NodeNew, id: 10, kind: NodeKind.Element, name: 'div', attrs: [{ name: 'class', value: 'a' }] },
    { op: OpCode.NodeNew, id: 11, kind: NodeKind.Element, name: 'span', attrs: [] },
    { op: OpCode.NodeNew, id: 12, kind: NodeKind.Text, value: 'hello' },
    { op: OpCode.Insert, parent: 1, before: 0, ids: [10] },
    { op: OpCode.Insert, parent: 10, before: 0, ids: [11, 12] },
    { op: OpCode.AttrSet, node: 10, attrs: [{ name: 'id', value: 'root' }] },
    { op: OpCode.NodeNew, id: 13, kind: NodeKind.Comment, value: 'c' },
    { op: OpCode.Insert, parent: 10, before: 11, ids: [13] },
    { op: OpCode.TextSet, node: 12, value: 'world' },
    { op: OpCode.AttrDel, node: 10, names: ['class'] },
    { op: OpCode.Remove, parent: 10, ids: [11] },
    { op: OpCode.Insert, parent: 10, before: 0, ids: [11] },
    { op: OpCode.NodeNew, id: 14, kind: NodeKind.Doctype, name: 'html' },
  ];

  const producerTable = new ReplicatedTable();
  const clientTable = new ReplicatedTable();
  applyOpsToTable(producerTable, ops);
  applyOpsToTable(clientTable, ops);

  assert.strictEqual(producerTable.size, clientTable.size);
  assert.strictEqual(producerTable.tableHash, clientTable.tableHash, 'independently-built producer/client tables must agree on tableHash for identical ops');
  for (const id of [10, 11, 12, 13, 14]) {
    assert.deepStrictEqual(clientTable.getRow(id), producerTable.getRow(id), `row ${id} must be identical across producer/client tables`);
  }

  // Correctness against the spec's own INSERT semantics, not just "the two sides agree with each other":
  // final expected order under 10 is [13, 12, 11] after the move/reorder/remove/reinsert sequence above.
  assert.strictEqual(producerTable.getRow(13)!.prevSibling, 0);
  assert.strictEqual(producerTable.getRow(12)!.prevSibling, 13);
  assert.strictEqual(producerTable.getRow(11)!.prevSibling, 12);
  assert.strictEqual(producerTable.getRow(12)!.contentHash, hashValue('world'), 'TEXT_SET must have taken effect');

  // A real divergence (client applies one extra, different mutation) must be a detectable tableHash change —
  // proves the equality above is a meaningful signal, not a test that would pass no matter what.
  clientTable.setValue(12, 'DIVERGED');
  assert.notStrictEqual(clientTable.tableHash, producerTable.tableHash, 'a genuine state divergence must change tableHash');
  console.log('[unit] ReplicatedTable producer/client hash parity across full op sequence (Stage 1 gate) ok');
}

/** §5.8 — a resync-flagged frame must wipe the table wholesale, not extend it. */
function testReplicatedTableResyncWholesaleReplace(): void {
  const table = new ReplicatedTable();
  applyOpsToTable(table, [
    { op: OpCode.NodeNew, id: 10, kind: NodeKind.Element, name: 'div', attrs: [] },
    { op: OpCode.Insert, parent: 1, before: 0, ids: [10] },
  ]);
  assert.strictEqual(table.has(10), true);

  const resyncOps: FrameOp[] = [
    { op: OpCode.NodeNew, id: 99, kind: NodeKind.Element, name: 'section', attrs: [] },
    { op: OpCode.Insert, parent: 1, before: 0, ids: [99] },
  ];
  applyFrameToTable(table, true, resyncOps);
  assert.strictEqual(table.has(10), false, 'resync must clear rows not re-described by the resync frame');
  assert.strictEqual(table.has(99), true);
  assert.strictEqual(table.size, 1);

  const expectedResyncTable = new ReplicatedTable();
  applyOpsToTable(expectedResyncTable, resyncOps);
  assert.strictEqual(table.tableHash, expectedResyncTable.tableHash, 'post-resync tableHash must equal a table built fresh from just the resync ops');
  console.log('[unit] ReplicatedTable resync wholesale replace ok');
}

const STAGE2_OPS: FrameOp[] = [
  { op: OpCode.NodeNew, id: 10, kind: NodeKind.Element, name: 'div', attrs: [{ name: 'class', value: 'a' }] },
  { op: OpCode.NodeNew, id: 11, kind: NodeKind.Text, value: 'hi' },
  { op: OpCode.Insert, parent: 1, before: 0, ids: [10] },
  { op: OpCode.Insert, parent: 10, before: 0, ids: [11] },
];

/**
 * frame-protocol.md §6/§4.1 Stage 2 GATE — a well-formed frame (real `preTableHash` +
 * whole-table `CHECK` computed from a table built the same way, e.g. by `resync.ts`)
 * must apply cleanly through `applyFrameToTableChecked`: `ok: true`, and the table ends up
 * in exactly the state a plain, unchecked `applyOpsToTable` would produce for the same ops.
 */
function testApplyFrameToTableCheckedAcceptsValidFrame(): void {
  const reference = new ReplicatedTable();
  applyOpsToTable(reference, STAGE2_OPS);

  const table = new ReplicatedTable();
  const ops: FrameOp[] = [
    ...STAGE2_OPS,
    { op: OpCode.Check, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: reference.tableHash },
  ];
  const result = applyFrameToTableChecked(table, false, ops);
  assert.strictEqual(result.ok, true, 'a CHECK matching the actual post-apply tableHash must pass');
  assert.strictEqual(table.tableHash, reference.tableHash);
  console.log('[unit] applyFrameToTableChecked accepts a valid preTableHash+CHECK frame ok');
}

/**
 * frame-protocol.md §6/§P3 Stage 2 GATE — "a deliberately-corrupted frame (wrong preTableHash,
 * or a mid-frame CHECK mismatch) touches zero DOM nodes and produces a precondition failure."
 * This proves the table-level half of that contract: `applyFrameToTableChecked` must report
 * `ok: false` with the exact expected/actual hashes on a CHECK mismatch, and the caller
 * (`client/applyDom.ts`) must be able to tell from the return value alone, without inspecting
 * the table, that phase 2 (the DOM) must never run for this frame.
 */
function testApplyFrameToTableCheckedRejectsCorruptedCheck(): void {
  const table = new ReplicatedTable();
  const wrongHash = 0xdeadbeefn;
  const ops: FrameOp[] = [
    ...STAGE2_OPS,
    { op: OpCode.Check, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: wrongHash },
  ];
  const result = applyFrameToTableChecked(table, false, ops);
  assert.strictEqual(result.ok, false, 'a CHECK whose hash disagrees with the table must fail, not silently pass');
  if (!result.ok && result.opName === 'check') {
    assert.strictEqual(result.expected, wrongHash, 'failure must report the CHECK op\'s claimed hash as "expected"');
    assert.notStrictEqual(result.actual, wrongHash, 'failure must report the table\'s real hash as "actual", distinct from the bogus claim');
    assert.strictEqual(result.failedOpIndex, ops.length - 1, 'the CHECK is the last op in this fixture');
    assert.strictEqual(result.scope, CHECK_SCOPE_TABLE);
  } else if (!result.ok) {
    assert.fail(`expected a CHECK failure, got opName=${result.opName}`);
  }
  console.log('[unit] applyFrameToTableChecked rejects a corrupted CHECK with expected/actual hashes ok');
}

/**
 * §4.1 `CHECK.scope = 1` (`CHECK_SCOPE_RANGE`) — a range CHECK must evaluate against exactly the
 * `[lo, hi]` rows (`ReplicatedTable.hashRange`), independent of rows outside that range: a
 * corruption outside `[lo, hi]` must not trip a range CHECK that covers a different, unaffected
 * span, and a corruption inside it must.
 */
function testApplyFrameToTableCheckedRangeScope(): void {
  const table = new ReplicatedTable();
  applyOpsToTable(table, STAGE2_OPS);
  const rangeHash = table.hashRange(10, 10);

  const okResult = applyFrameToTableChecked(table, false, [
    { op: OpCode.Check, scope: CHECK_SCOPE_RANGE, lo: 10, hi: 10, hash: rangeHash },
  ]);
  assert.strictEqual(okResult.ok, true, 'a range CHECK matching hashRange(lo, hi) must pass');

  // Mutate a row outside [10, 10] — must not affect a CHECK scoped only to id 10.
  table.setValue(11, 'changed-outside-range');
  const stillOk = applyFrameToTableChecked(table, false, [
    { op: OpCode.Check, scope: CHECK_SCOPE_RANGE, lo: 10, hi: 10, hash: rangeHash },
  ]);
  assert.strictEqual(stillOk.ok, true, 'a mutation outside [lo, hi] must not trip a range CHECK scoped elsewhere');

  // Mutate the row actually inside the range — must now trip the same CHECK hash.
  table.setAttrs(10, [{ name: 'id', value: 'changed-inside-range' }]);
  const nowFails = applyFrameToTableChecked(table, false, [
    { op: OpCode.Check, scope: CHECK_SCOPE_RANGE, lo: 10, hi: 10, hash: rangeHash },
  ]);
  assert.strictEqual(nowFails.ok, false, 'a mutation inside [lo, hi] must trip a range CHECK covering it');
  console.log('[unit] applyFrameToTableChecked CHECK_SCOPE_RANGE evaluates only [lo, hi] ok');
}

/**
 * frame-protocol.md §2 Stage 2 GATE — the client's own precondition check (`preTableHash`
 * against its table's current `tableHash`, `client/applyDom.ts` phase 1) is the first gate
 * *before* `applyFrameToTableChecked` ever runs; this proves the table-level primitive
 * `applyFrameToTableChecked` gates on, in isolation from the DOM-bound caller: ops before a
 * failing CHECK still mutate the table (§P3 — "phase 1 is pure memory, not DOM, and is not
 * rolled back"), which is exactly why the caller must treat any `ok: false` as "abort, and the
 * next frame's preTableHash — or a future resync — is what heals this", never "retry phase 1".
 */
function testApplyFrameToTableCheckedDoesNotRollBackPriorOps(): void {
  const table = new ReplicatedTable();
  const ops: FrameOp[] = [
    ...STAGE2_OPS,
    { op: OpCode.Check, scope: CHECK_SCOPE_TABLE, lo: 0, hi: 0, hash: 0n }, // deliberately wrong
  ];
  const result = applyFrameToTableChecked(table, false, ops);
  assert.strictEqual(result.ok, false);
  // The NODE_NEW/INSERT ops before the failing CHECK are NOT undone — table still reflects them.
  assert.strictEqual(table.has(10), true, 'ops before the failing CHECK must still have applied to the table (no rollback)');
  assert.strictEqual(table.getRow(10)!.parent, 1);
  console.log('[unit] applyFrameToTableChecked does not roll back ops preceding a failed CHECK (§P3) ok');
}

/**
 * frame-protocol.md §4.1 `EPOCH_RESET` Stage 3 GATE — its `Table` effect ("clear the table,
 * restart id allocation") must actually clear every row and derived index, not just report
 * `size === 0` — `tableHash` must also return to the fresh-table value (`0n`), proving the
 * `TableHashTracker` itself was cleared, not merely emptied of live rows one at a time.
 */
function testEpochResetClearsReplicatedTable(): void {
  const table = new ReplicatedTable();
  applyOpsToTable(table, STAGE2_OPS);
  assert.ok(table.size > 0, 'sanity: STAGE2_OPS must populate rows before EPOCH_RESET');
  assert.notStrictEqual(table.tableHash, 0n, 'sanity: a populated table must have a non-zero tableHash');

  applyOpToTable(table, { op: OpCode.EpochReset, generation: 2 });
  assert.strictEqual(table.size, 0, 'EPOCH_RESET must clear every row (frame-protocol.md §4.1)');
  assert.strictEqual(table.tableHash, 0n, 'EPOCH_RESET must reset tableHash to the fresh-table value');
  assert.strictEqual(table.has(10), false);

  // The table must still be fully usable afterwards — EPOCH_RESET is "restart id allocation",
  // not "table is now unusable".
  applyOpsToTable(table, STAGE2_OPS);
  assert.strictEqual(table.size, 2, 'table must accept new rows after EPOCH_RESET');
  console.log('[unit] EPOCH_RESET clears ReplicatedTable (rows + tableHash) ok');
}

/**
 * frame-protocol.md §4.2 `NODE_DROP` Stage 3 GATE (OPEN-1/OPEN-2) — dropping a detached
 * subtree's root must also drop every descendant (§4.2: "drops each row and all its
 * descendants — a detached row may still have children"), and `tableHash` must end up exactly
 * where a table that never had those rows would be — proving the O(1) subtract-per-row in
 * `dropSubtree`/`dropRow` is exact, not approximate.
 */
function testNodeDropRemovesSubtreeAndDescendants(): void {
  const table = new ReplicatedTable();
  // root(10) -> mid(11) -> leaf(12); root(10) also has a second child leaf(13).
  applyOpsToTable(table, [
    { op: OpCode.NodeNew, id: 10, kind: NodeKind.Element, name: 'div', attrs: [] },
    { op: OpCode.NodeNew, id: 11, kind: NodeKind.Element, name: 'span', attrs: [] },
    { op: OpCode.NodeNew, id: 12, kind: NodeKind.Text, value: 'leaf' },
    { op: OpCode.NodeNew, id: 13, kind: NodeKind.Text, value: 'leaf2' },
    { op: OpCode.Insert, parent: 10, before: 0, ids: [11] },
    { op: OpCode.Insert, parent: 11, before: 0, ids: [12] },
    { op: OpCode.Insert, parent: 10, before: 0, ids: [13] },
    // Detach the whole subtree at its root — NODE_DROP's own precondition (§4.2) requires
    // `parent = 0` before a row is droppable.
    { op: OpCode.Remove, parent: 1, ids: [10] },
  ]);
  assert.strictEqual(table.size, 4, 'sanity: all four rows present, root now detached');

  const ids = table.dropSubtree(10);
  assert.deepStrictEqual(new Set(ids), new Set([10, 11, 12, 13]), 'dropSubtree must return root + every descendant');
  assert.strictEqual(table.size, 0, 'all four rows must be gone after dropping the subtree root');
  assert.strictEqual(table.tableHash, 0n, 'tableHash must return to the fresh-table value once every row is dropped');
  for (const id of [10, 11, 12, 13]) assert.strictEqual(table.has(id), false, `row ${id} must no longer exist`);
  console.log('[unit] NODE_DROP dropSubtree removes root + all descendants, tableHash exact ok');
}

/**
 * frame-protocol.md §1.6/OPEN-2 Stage 3 GATE — `collectDroppableIds` must select only detached
 * (`parent === 0`) subtree roots whose `lms` is at least `maxAge` sequences stale, must never
 * select a non-root descendant of a detached subtree (those are collected transitively once
 * their root is chosen, §4.2), and must respect the `limit` bound (same family as
 * `MAX_DIRTY_NODES`, §8) rather than returning every eligible row in one sweep.
 */
function testCollectDroppableIdsAgeAndLimitBound(): void {
  const table = new ReplicatedTable();

  table.setSequence(1);
  applyOpsToTable(table, [
    { op: OpCode.NodeNew, id: 20, kind: NodeKind.Text, value: 'old-detached-root' },
    { op: OpCode.NodeNew, id: 21, kind: NodeKind.Element, name: 'div', attrs: [] },
  ]);
  table.insertBatch(21, 0, [20]); // 20 is now attached under 21 — not droppable
  table.removeBatch(21, [20]); // detach 20 again — its lms is still stamped at sequence=1

  table.setSequence(2);
  applyOpsToTable(table, [{ op: OpCode.NodeNew, id: 22, kind: NodeKind.Text, value: 'young-detached-root' }]);

  // At sequence 100 with maxAge=50: id 20 (lms=1, age=99) is eligible; id 22 (lms=2, age=98) is
  // also eligible by age but is attached to nothing and simply detached on its own — both are
  // legitimate detached roots, so both are eligible; id 21 is attached (Document is its parent
  // only via insertBatch's own bookkeeping — it was never actually inserted under 1, so recheck
  // via an explicit still-attached row for the "attached must never be selected" half below.
  applyOpsToTable(table, [{ op: OpCode.Insert, parent: 1, before: 0, ids: [21] }]); // 21 now genuinely attached
  table.setSequence(200);

  const unbounded = table.collectDroppableIds(200, 50, 1000);
  assert.ok(unbounded.includes(20), 'a detached root older than maxAge must be selected');
  assert.ok(unbounded.includes(22), 'every detached root past the age threshold is eligible, regardless of arrival order');
  assert.ok(!unbounded.includes(21), 'an attached row must never be selected, no matter its age');

  const tooYoung = table.collectDroppableIds(2, 50, 1000);
  assert.deepStrictEqual(tooYoung, [], 'nothing must be selected before any row has crossed the age threshold');

  const bounded = table.collectDroppableIds(200, 50, 1);
  assert.strictEqual(bounded.length, 1, 'the limit bound must cap the sweep result, same as MAX_DIRTY_NODES (§8)');
  console.log('[unit] collectDroppableIds respects age threshold + detached-only + limit bound (§1.6/OPEN-2) ok');
}

/**
 * frame-protocol.md §1.6/OPEN-2 Stage 3 GATE — the same-tick sibling of the subtree-resurrection
 * bug fixed in `emitNodeDropSweep`/`replicatedTable.ts` (2026-08-14): a row that crosses the GC
 * age threshold in the *same* tick a live reference reattaches it must never be selected by
 * `collectDroppableIds`, or the producer would emit a self-contradictory frame (an `INSERT`
 * reattaching an id and a `NODE_DROP` of that same id). `tableFrameBuilder.ts`'s `build()` avoids
 * this by folding this tick's own structural ops into the table *before* running the GC sweep —
 * this test locks in that ordering requirement directly against the shared
 * `ReplicatedTable`/`applyOpsToTable` primitives, independent of the DOM-coupled builder.
 */
function testCollectDroppableIdsExcludesSameTickReattach(): void {
  const table = new ReplicatedTable();

  table.setSequence(1);
  applyOpsToTable(table, [
    { op: OpCode.NodeNew, id: 1, kind: NodeKind.Element, name: 'div', attrs: [] }, // root
    { op: OpCode.NodeNew, id: 20, kind: NodeKind.Element, name: 'span', attrs: [] },
  ]);
  table.insertBatch(1, 0, [20]);
  table.removeBatch(1, [20]); // 20 is now a detached root, lms stamped at sequence=1

  // Sequence 100, maxAge 50: id 20's age (99) now crosses the threshold — but this tick's own
  // (not-yet-applied) ops reattach it. `ops` mirrors exactly what `TableFrameBuilder.build()`
  // would have queued from this tick's MutationRecords before the ordering fix's `applyOpsToTable`
  // call runs.
  const thisTicksOps: FrameOp[] = [{ op: OpCode.Insert, parent: 1, before: 0, ids: [20] }];

  const beforeApply = table.collectDroppableIds(100, 50, 1000);
  assert.ok(
    beforeApply.includes(20),
    'sanity: querying before this tick\'s own ops are applied still sees id 20 as stale-detached (the bug\'s precondition)',
  );

  // The fix: fold this tick's ops into the table first, exactly as `build()` now does.
  table.setSequence(100);
  applyOpsToTable(table, thisTicksOps);

  const afterApply = table.collectDroppableIds(100, 50, 1000);
  assert.ok(
    !afterApply.includes(20),
    'a row reattached by this tick\'s own ops must never be selected by the GC sweep that runs after them',
  );
  assert.strictEqual(table.getRow(20)!.parent, 1, 'id 20 must genuinely be attached under 1 after the INSERT');
  console.log('[unit] collectDroppableIds excludes a row reattached earlier in the same tick (same-tick GC race) ok');
}

/**
 * frame-protocol.md OPEN-1 Stage 3 GATE — "NODE_DROP of an absent id is malformed", now actually
 * enforced by `applyFrameToTableChecked` rather than left as a spec-only decision.
 */
function testApplyFrameToTableCheckedRejectsNodeDropAbsentId(): void {
  const table = new ReplicatedTable();
  const result = applyFrameToTableChecked(table, false, [{ op: OpCode.NodeDrop, ids: [999] }]);
  assert.strictEqual(result.ok, false, 'NODE_DROP of an id the table has never seen must fail');
  if (!result.ok && result.opName !== 'check') {
    assert.strictEqual(result.reason, 'malformed', 'an absent-id NODE_DROP is malformed, per OPEN-1');
    assert.strictEqual(result.opName, 'nodeDrop');
    assert.strictEqual(result.id, 999);
  } else {
    assert.fail(`expected a nodeDrop op failure, got ${JSON.stringify(result)}`);
  }
  console.log('[unit] applyFrameToTableChecked rejects NODE_DROP of an absent id as malformed (OPEN-1) ok');
}

/**
 * frame-protocol.md §4.2 Stage 3 GATE — "NODE_DROP of an attached row" is the instruction's own
 * documented precondition violation, distinct from OPEN-1's absent-id case: the row exists, but
 * dropping it while still attached would silently orphan whatever the wire still thinks is its
 * parent — a `precondition` failure, not `malformed`.
 */
function testApplyFrameToTableCheckedRejectsNodeDropAttachedId(): void {
  const table = new ReplicatedTable();
  applyOpsToTable(table, [
    { op: OpCode.NodeNew, id: 30, kind: NodeKind.Text, value: 'attached' },
    { op: OpCode.Insert, parent: 1, before: 0, ids: [30] },
  ]);
  assert.strictEqual(table.getRow(30)!.parent, 1, 'sanity: row 30 is attached to the Document');

  const result = applyFrameToTableChecked(table, false, [{ op: OpCode.NodeDrop, ids: [30] }]);
  assert.strictEqual(result.ok, false, 'NODE_DROP of a still-attached row must fail');
  if (!result.ok && result.opName !== 'check') {
    assert.strictEqual(result.reason, 'precondition', 'an attached-id NODE_DROP is a precondition violation (§4.2)');
    assert.strictEqual(result.opName, 'nodeDrop');
    assert.strictEqual(result.id, 30);
  } else {
    assert.fail(`expected a nodeDrop op failure, got ${JSON.stringify(result)}`);
  }
  assert.strictEqual(table.has(30), true, 'a rejected NODE_DROP must never actually drop the row');
  console.log('[unit] applyFrameToTableChecked rejects NODE_DROP of an attached row as precondition (§4.2) ok');
}

/**
 * frame-protocol.md §8 Stage 3 GATE — `MAX_ROWS` bounds table growth per session on the client's
 * defensive side; a `NODE_NEW` that would push a table already at the cap over it must fail
 * *before* the row is created (§8: "checked before any allocation"), not after.
 */
function testApplyFrameToTableCheckedEnforcesMaxRows(): void {
  const table = new ReplicatedTable();
  for (let id = 2; id < 2 + MAX_ROWS; id++) table.createLeafRow(id, NodeKind.Text, 'x');
  assert.strictEqual(table.size, MAX_ROWS, 'sanity: table pre-populated to exactly MAX_ROWS');

  const overflowId = 2 + MAX_ROWS;
  const result = applyFrameToTableChecked(table, false, [
    { op: OpCode.NodeNew, id: overflowId, kind: NodeKind.Text, value: 'overflow' },
  ]);
  assert.strictEqual(result.ok, false, 'a NODE_NEW that would exceed MAX_ROWS must fail');
  if (!result.ok && result.opName !== 'check') {
    assert.strictEqual(result.reason, 'precondition', 'MAX_ROWS overflow is a precondition violation (§8)');
    assert.strictEqual(result.opName, 'nodeNew');
    assert.strictEqual(result.id, overflowId);
  } else {
    assert.fail(`expected a nodeNew op failure, got ${JSON.stringify(result)}`);
  }
  assert.strictEqual(table.has(overflowId), false, 'the rejected row must never actually be created');

  // A NODE_NEW that merely re-describes an id the table already has (e.g. a resync-adjacent
  // re-announce) must never be blocked by MAX_ROWS — the check only guards net-new growth.
  const existingId = 2;
  const reannounce = applyFrameToTableChecked(table, false, [
    { op: OpCode.NodeNew, id: existingId, kind: NodeKind.Text, value: 'still-x' },
  ]);
  assert.strictEqual(reannounce.ok, true, 'MAX_ROWS must not block re-describing an id the table already holds');
  console.log('[unit] applyFrameToTableChecked enforces MAX_ROWS on net-new rows only (§8) ok');
}

function testNodeTableApplierDigestMatchesDirectApply(): void {
  const ops: FrameOp[] = [
    { op: OpCode.NodeNew, id: 2, kind: NodeKind.Element, name: 'div', attrs: [] },
    { op: OpCode.NodeNew, id: 3, kind: NodeKind.Text, value: 'hi' },
    { op: OpCode.Insert, parent: 1, before: INSERT_AT_END, ids: [2] },
    { op: OpCode.Insert, parent: 2, before: INSERT_AT_END, ids: [3] },
  ];
  const frame = createFrame({ generation: 1, sequence: 1, ops, preTableHash: 0n });
  const parts = new BinaryFrameEncoder().encode(frame);
  assert.ok(parts.length >= 1, 'encoder must emit at least one part');

  const expected = new ReplicatedTable();
  const direct = applyFrameToTableChecked(expected, false, ops, 1);
  assert.strictEqual(direct.ok, true);

  const applier = new NodeTableApplier();
  for (const part of parts) applier.observeFrameBytes(part);
  assert.strictEqual(applier.lastApplyError, null);
  assert.strictEqual(applier.sequence, 1);
  assert.deepStrictEqual(applier.digest(), digestReplicatedTable(expected));

  applier.observeFrameBytes(
    new BinaryFrameEncoder().encode(
      createFrame({
        generation: 1,
        sequence: 2,
        ops: [{ op: OpCode.NodeDrop, ids: [999] }],
        preTableHash: expected.tableHash,
      }),
    )[0]!,
  );
  assert.ok(applier.lastApplyError, 'absent NODE_DROP must fail apply');
  assert.strictEqual(applier.sequence, 1, 'failed apply must not advance sequence');
  console.log('[unit] NodeTableApplier digest matches direct applyFrameToTableChecked ok');
}

function testCssomFnvAndRuleDiff(): void {
  const a = fnv1a32('color: red');
  const b = fnv1a32('color: blue');
  assert.notStrictEqual(a, b);
  assert.strictEqual(fnv1a32('color: red'), a);

  const k1 = {};
  const k2 = {};
  const inplace = diffRules(
    [{ key: k1, contentHash: a }],
    [{ key: k1, contentHash: b }],
  );
  assert.strictEqual(inplace.rulesTextChangedInPlace, 1);
  assert.strictEqual(inplace.rulesAppeared, 0);
  assert.strictEqual(inplace.rulesDisappeared, 0);
  assert.strictEqual(inplace.ruleListChanged, false);

  const replace = diffRules(
    [{ key: k1, contentHash: a }],
    [{ key: k2, contentHash: a }],
  );
  assert.strictEqual(replace.ruleListChanged, true);
  assert.strictEqual(replace.rulesDisappeared, 1);
  assert.strictEqual(replace.rulesAppeared, 1);
  assert.strictEqual(replace.rulesTextChangedInPlace, 0);
  console.log('[unit] cssom fnv + rule diff ok');
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
  testDomAssetCache();
  testDomAssetCacheRespectsByteCap();
  await testBrowserPoolWarmUpAndAcquire();
  testBrowserPoolRefillThrottle();
  await testBrowserPoolExhaustionFallsBackToOnDemandLaunch();
  await testBrowserPoolRegistryPolicy();
  testSrcsetParseCloudinary();
  testParseDataUrlHardening();
  testRowHashPrimitives();
  testTableHashTrackerOrderIndependence();
  testReplicatedTableRowContentHash();
  testReplicatedTableTopologyRepair();
  testReplicatedTableInsertBeforeNextSiblingRepair();
  testReplicatedTablePrependEvictDerivedLinks();
  testTableLiveOracle();
  testReplicatedTableApplyOpsParity();
  testReplicatedTableResyncWholesaleReplace();
  testApplyFrameToTableCheckedAcceptsValidFrame();
  testApplyFrameToTableCheckedRejectsCorruptedCheck();
  testApplyFrameToTableCheckedRangeScope();
  testApplyFrameToTableCheckedDoesNotRollBackPriorOps();
  testEpochResetClearsReplicatedTable();
  testNodeDropRemovesSubtreeAndDescendants();
  testCollectDroppableIdsAgeAndLimitBound();
  testCollectDroppableIdsExcludesSameTickReattach();
  testApplyFrameToTableCheckedRejectsNodeDropAbsentId();
  testApplyFrameToTableCheckedRejectsNodeDropAttachedId();
  testApplyFrameToTableCheckedEnforcesMaxRows();
  testNodeTableApplierDigestMatchesDirectApply();
  testCssomFnvAndRuleDiff();
  await runPageProjectionUnitTests();
  await runV4ProjectionSessionUnitTests();
  console.log('[unit] all passed');
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

function testDomAssetCache(): void {
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
  console.log('[unit] DomAssetCache put/get/LRU ok');
}

/** PP-ASSET-4 — the L1 cache must respect its LRU byte cap, not just entry count. */
function testDomAssetCacheRespectsByteCap(): void {
  const cache = new DomAssetCache(10, 100); // byte cap of 10, generous entry count
  cache.put('a', Buffer.from('aaaa'), 'text/css'); // 4 bytes, total 4
  cache.put('b', Buffer.from('bbbb'), 'text/css'); // 4 bytes, total 8
  assert.strictEqual(cache.currentBytes, 8);
  assert.ok(cache.get('a'), 'a survives under the byte cap');
  assert.ok(cache.get('b'), 'b survives under the byte cap');

  cache.put('c', Buffer.from('cccc'), 'text/css'); // 4 bytes, total would be 12 > 10 → evict oldest
  assert.strictEqual(cache.get('a'), undefined, 'oldest entry evicted once the byte cap is exceeded');
  assert.ok(cache.get('b'), 'b still present');
  assert.ok(cache.get('c'), 'c still present');
  assert.ok(cache.currentBytes <= 10, `currentBytes ${cache.currentBytes} must respect the 10-byte cap`);

  // Re-putting an existing key must not double-count its bytes nor leak its old hash.
  const cache2 = new DomAssetCache(1024, 100);
  const hash1 = cache2.put('k', Buffer.from('x'), 'text/plain');
  const hash2 = cache2.put('k', Buffer.from('yy'), 'text/plain');
  assert.strictEqual(cache2.currentBytes, 2, 'replacing a key must replace its byte accounting, not add to it');
  assert.strictEqual(cache2.size, 1);
  assert.ok(hash1 && hash2 && hash1 !== hash2);
  assert.strictEqual(cache2.getByHash(hash1!), undefined, 'stale hash of a replaced key must not resolve');
  assert.ok(cache2.getByHash(hash2!), 'current hash must resolve');
  console.log('[unit] DomAssetCache respects byte cap ok');
}

/** WP13 §5.13 — pre-warmed pool: warm-up, throttled refill, and destroy-on-release (PP-SESS-2). */
async function testBrowserPoolWarmUpAndAcquire(): Promise<void> {
  const { BrowserPool } = await import('./browser/patchright/BrowserPool');
  let launches = 0;
  const closedProcesses: number[] = [];
  const closedContexts: number[] = [];

  const launch = async () => {
    const id = ++launches;
    return {
      newContext: async () => ({
        close: async () => {
          closedContexts.push(id);
        },
      }),
      close: async () => {
        closedProcesses.push(id);
      },
    };
  };

  const pool = new BrowserPool({ size: 2, refillPerSec: 1000, launch });
  await pool.warmUp();
  assert.strictEqual(pool.availableCount, 2, 'warmUp must pre-warm to size');
  assert.strictEqual(launches, 2);

  const acquired = await pool.acquire();
  await acquired.release();
  // Released id 1 proves acquire() handed out the first pre-warmed instance
  // (ids assigned in launch order) rather than launching a fresh one.
  assert.deepStrictEqual(closedContexts, [1], 'acquire must consume a pre-warmed instance, not launch a new one');
  assert.deepStrictEqual(closedProcesses, [1], 'release must destroy the process — never recycle (PP-SESS-2)');

  // Refill throttle: fast refillPerSec here means the opportunistic refill on
  // acquire should have already replenished back toward size.
  for (let i = 0; i < 20 && pool.availableCount < 2; i++) await Promise.resolve();
  assert.strictEqual(pool.availableCount, 2, 'pool must refill back toward size after a consuming acquire');

  await pool.dispose();
  console.log('[unit] BrowserPool warm-up + acquire + destroy-on-release ok');
}

/** tryRefill must honor the refillPerSec throttle using an injectable clock — no real timers. */
function testBrowserPoolRefillThrottle(): void {
  const { BrowserPool } = require('./browser/patchright/BrowserPool') as typeof import('./browser/patchright/BrowserPool');
  let launches = 0;
  let clock = 0;
  const launch = async () => {
    launches++;
    return { newContext: async () => ({ close: async () => {} }), close: async () => {} };
  };
  const pool = new BrowserPool({ size: 5, refillPerSec: 2, launch, now: () => clock }); // 500ms min interval

  assert.strictEqual(pool.tryRefill(), true, 'first refill always allowed');
  assert.strictEqual(pool.tryRefill(), false, 'immediate second refill must be throttled');
  clock += 499;
  assert.strictEqual(pool.tryRefill(), false, 'just under the interval must still be throttled');
  clock += 2;
  assert.strictEqual(pool.tryRefill(), true, 'past the interval must allow another refill');
  console.log('[unit] BrowserPool refill throttle (injectable clock) ok');
}

/** Pool exhaustion must fall back to an on-demand launch rather than reusing an instance. */
async function testBrowserPoolExhaustionFallsBackToOnDemandLaunch(): Promise<void> {
  const { BrowserPool } = await import('./browser/patchright/BrowserPool');
  let launches = 0;
  const launch = async () => {
    launches++;
    return { newContext: async () => ({ close: async () => {} }), close: async () => {} };
  };
  const pool = new BrowserPool({ size: 0, refillPerSec: 1, launch });
  assert.strictEqual(pool.availableCount, 0);
  const a = await pool.acquire();
  assert.strictEqual(launches, 1, 'exhausted pool must launch on demand rather than block or reuse');
  await a.release();
  console.log('[unit] BrowserPool exhaustion falls back to on-demand launch ok');
}

/**
 * BrowserPoolRegistry policy (§5.13 wiring): size 0 must never touch the launch factory,
 * a first successful acquire must geometry-lock the singleton pool, a later request for a
 * different geometry must miss (never a wrong-sized Display), and release must destroy the
 * underlying process — never recycle (PP-SESS-2).
 */
async function testBrowserPoolRegistryPolicy(): Promise<void> {
  const { BrowserPoolRegistry } = await import('./browser/patchright/BrowserPoolRegistry');
  const { DisplayAllocator } = await import('./browser/patchright/Display');
  let launches = 0;
  const closedProcesses: number[] = [];
  const launchFactory = async () => {
    const id = ++launches;
    return {
      newContext: async () => ({ close: async () => {} }),
      close: async () => {
        closedProcesses.push(id);
      },
    };
  };

  const registry = new BrowserPoolRegistry(launchFactory);
  const displays = new DisplayAllocator();

  const disabled = await registry.tryAcquire({
    size: 0,
    refillPerSec: 1000,
    maxWidth: 800,
    maxHeight: 600,
    displays,
  });
  assert.strictEqual(disabled, null, 'size 0 must disable pooling entirely');
  assert.strictEqual(launches, 0, 'size 0 must never invoke the launch factory');

  const first = await registry.tryAcquire({
    size: 2,
    refillPerSec: 1000,
    maxWidth: 800,
    maxHeight: 600,
    displays,
  });
  // The very first acquire races an unawaited warmUp() — it may consume a pre-warmed
  // instance or trigger its own on-demand launch; either way, correctness holds.
  assert.notStrictEqual(first, null, 'first request must acquire (pre-warmed or on-demand)');
  assert.ok(launches >= 2, `pool creation must have launched at least size instances (got ${launches})`);

  const mismatched = await registry.tryAcquire({
    size: 2,
    refillPerSec: 1000,
    maxWidth: 1024,
    maxHeight: 768,
    displays,
  });
  assert.strictEqual(mismatched, null, 'a different max viewport than the geometry-locked pool must miss, not resize');

  await first!.release();
  assert.strictEqual(closedProcesses.length, 1, 'release must destroy exactly the acquired process — never recycle (PP-SESS-2)');

  const second = await registry.tryAcquire({
    size: 2,
    refillPerSec: 1000,
    maxWidth: 800,
    maxHeight: 600,
    displays,
  });
  assert.notStrictEqual(second, null, 'matching geometry must keep hitting the same locked pool');
  await second!.release();

  await registry.disposeForTests();
  console.log('[unit] BrowserPoolRegistry geometry-lock + fallback + destroy-on-release ok');
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
