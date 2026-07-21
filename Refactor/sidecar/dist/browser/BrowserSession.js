"use strict";
/**
 * Plug-and-play remote browser session contract (V1).
 *
 * The WebSocket / connection handler calls this surface — it is NOT a TS mirror of
 * C# ISessionConnection. Transport, wire codecs, and session registry stay outside.
 *
 * Implementations (Patchright+Xvfb, headless mock, …) are injected at composition time
 * via {@link BrowserSessionFactory}.
 *
 * V1 rules:
 * - Outbound media/observation only via {@link BrowserSessionEvents}.
 * - Main-frame allowlist lives in {@link BrowserLaunchOptions}; block notify is
 *   {@link BrowserSessionEvents.onMainFrameNavigationBlocked}.
 * - JsBridge / Diagnostics gating live above this port (API). Console stream and
 *   {@link BrowserSession.evaluate} are always session capabilities.
 * - Session snapshot is pull: {@link BrowserSession.getStatus}. The API polls when/if needed.
 * - Editable focus (client native keyboard / IME) is push:
 *   {@link BrowserSessionEvents.onEditableFocusChanged}.
 * - Single-tab enforcement is internal (visible via {@link BrowserStatus.tabCount}).
 * - Audio out + camera/mic in are on the contract for facial-validation paths;
 *   payloads may stay opaque until codecs are fixed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=BrowserSession.js.map