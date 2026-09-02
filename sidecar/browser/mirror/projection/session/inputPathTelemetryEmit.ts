/**
 * PageProjection input-path telemetry emit helpers — boolean gate is the first instruction.
 */

export type PageProjectionIntentPathPhase =
  | 'sidecar_enqueued'
  | 'cdp_dropped'
  | 'cdp_applied'
  | 'cdp_rejected';

export type StaleViewportRejectContext = {
  viewportW: number;
  viewportH: number;
  activeViewportW: number;
  activeViewportH: number;
};

export type PageProjectionIntentPathPayload = {
  phase: PageProjectionIntentPathPhase;
  kind: string;
  reason?: string;
  generation?: number;
  errorCode?: string;
  validationPhase?: string;
  viewportW?: number;
  viewportH?: number;
  activeViewportW?: number;
  activeViewportH?: number;
};

export type PageProjectionIntentPathSink = (event: PageProjectionIntentPathPayload) => void;

export type PageProjectionIntentPathConsole = (level: number, text: string) => void;

/** Test counters — incremented only when payload construction runs (toggle on). */
export let inputPathRejectPayloadBuildCount = 0;
export let inputPathAppliedPayloadBuildCount = 0;

export function resetInputPathTelemetryEmitCounters(): void {
  inputPathRejectPayloadBuildCount = 0;
  inputPathAppliedPayloadBuildCount = 0;
}

export function emitInputPathReject(
  enabled: boolean,
  sink: PageProjectionIntentPathSink | undefined,
  onConsole: PageProjectionIntentPathConsole | undefined,
  errorCode: string,
  validationPhase: string,
  kind: string,
  staleViewport?: StaleViewportRejectContext,
): void {
  if (!enabled) return;
  inputPathRejectPayloadBuildCount += 1;
  onConsole?.(3, `input_reject ${errorCode} ${validationPhase}`);
  if (errorCode === 'stale_viewport' && staleViewport) {
    sink?.({
      phase: 'cdp_rejected',
      kind,
      errorCode,
      validationPhase,
      viewportW: staleViewport.viewportW,
      viewportH: staleViewport.viewportH,
      activeViewportW: staleViewport.activeViewportW,
      activeViewportH: staleViewport.activeViewportH,
    });
    return;
  }
  sink?.({
    phase: 'cdp_rejected',
    kind,
    errorCode,
    validationPhase,
  });
}

export function emitInputPathApplied(
  enabled: boolean,
  sink: PageProjectionIntentPathSink | undefined,
  kind: string,
): void {
  if (!enabled) return;
  inputPathAppliedPayloadBuildCount += 1;
  sink?.({
    phase: 'cdp_applied',
    kind,
  });
}
