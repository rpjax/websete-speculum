import assert from 'assert';
import type { BrowserSessionEvents, BrowserUrlMatchRule } from '../BrowserSession';
import { EventBridge } from '../../host/EventBridge';
import { wrapBrowserSessionEvents } from './wrapSessionEvents';
import { UrlResolver } from './urlResolver';

function resolverPolicy() {
  return {
    requestHost: 'session.speculum.test',
    defaultTargetHost: 'www.fixture.test',
    allowedMainFrameUrls: [] as BrowserUrlMatchRule[],
    domains: [{ domain: 'fixture.test', isSubdomainMirroringEnabled: false }],
    navigationStateParam: '_w7s_nso',
  };
}

export function runWrapSessionEventsUnitTests(): void {
  testWrapPreservesEventBridgePageProjectionFrame();
  testWrapProjectsLocationChanged();
}

function testWrapPreservesEventBridgePageProjectionFrame(): void {
  const bridge = new EventBridge('wrap-pp');
  const wrapped = wrapBrowserSessionEvents(bridge, new UrlResolver(resolverPolicy()));
  const body = new Uint8Array([0x01, 0x02, 0x03]);

  wrapped.onPageProjectionFrame?.({
    sequence: 1,
    generation: 1,
    plane: '',
    operation: '',
    timestampMs: 1,
    body,
    contextId: 1,
  });

  assert.strictEqual(bridge.dom.pendingCount, 1);
  console.log('[unit] wrapSessionEvents preserves EventBridge.onPageProjectionFrame ok');
}

function testWrapProjectsLocationChanged(): void {
  let locationUrl = '';
  const sink: BrowserSessionEvents = {
    onVideoFrame() {},
    onAudioFrame() {},
    onConsole() {},
    onLocationChanged(url: string) {
      locationUrl = url;
    },
    onMainFrameNavigationBlocked() {},
    onEditableFocusChanged() {},
    onCrash() {},
    onCameraPermissionRequested: async () => 'deny',
    onMicrophonePermissionRequested: async () => 'deny',
  };

  const wrapped = wrapBrowserSessionEvents(sink, new UrlResolver(resolverPolicy()));
  wrapped.onLocationChanged('https://www.fixture.test/click-target');

  assert.ok(locationUrl.includes('session.speculum.test'));
  console.log('[unit] wrapSessionEvents projects onLocationChanged ok');
}
