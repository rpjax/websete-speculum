/**
 * Projected apply surface — two-phase table→DOM client.
 */

export {
  ProjectionClient,
  createProjectionClient,
  type ProjectionClientOptions,
} from './ProjectionClient';
export { DomFrameApplier } from './applyDom';
export { PageProjectionRegistry } from './registry';
export { createSurfaceHost, type SurfaceHost } from './surface';
export {
  PROJECTED_STANDARDS_SRCDOC,
  PROJECTED_STANDARDS_READY_TIMEOUT_MS,
  PROJECTED_SKELETON_META_NAME,
  stampProjectedStandardsSrcdoc,
  stripProjectedSkeleton,
  isProjectedStandardsSkeleton,
  isProjectedStandardsDocument,
  whenProjectedStandardsReady,
  type ProjectedStandardsReadyError,
  type ProjectedStandardsReadyErrorCode,
  type WhenProjectedStandardsReadyOpts,
} from './projectedBlankIframe';
export { NestedProjectedApply } from './nestedProjectedApply';
export { attachProjectedInputCapture } from './input/projectedInputCapture';
export {
  ProjectedInputCaptureMetrics,
  type ProjectedInputCaptureMetricsSnapshot,
  type InputLatencyStats,
} from './input/inputCaptureMetrics';
export { ScrollEchoGate, type ScrollEchoTarget } from './input/scrollEchoGate';
export { snapshotFormControls } from './formControlSnapshot';
export {
  ViewportSync,
  measureHostElement,
  type ViewportSyncOptions,
  type ViewportResizeResult,
} from './viewportSync';
export {
  VIEWPORT_POLICY_BASELINE,
  LAB_VIEWPORT_POLICY,
  VIEWPORT_SIZE_EPSILON,
  normalizeSessionViewport,
  validateResizeViewport,
  viewportSizesClose,
  type ViewportPolicyBounds,
  type ViewportSize,
} from './viewportPolicy';
export {
  detectViewportDeviceProfile,
  deviceProfilesEqual,
  type ViewportDeviceProfile,
} from './viewportDevice';
export {
  SessionAuthQueryParam,
  SessionCacheBustQueryParam,
  isVirtualAssetUrl,
  appendSessionAuth,
  appendCacheBust,
  appendSessionBindingQuery,
  stampAttrAuth,
  stampCssTextAuth,
  stampSrcsetAuth,
  stampAuthInServedBody,
} from './sessionBindingAuth';
