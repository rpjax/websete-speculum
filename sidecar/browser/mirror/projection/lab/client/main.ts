/**
 * Lab client — Browse + Run (protocol v1).
 */

import { LabProjectedHarness } from './LabProjectedHarness';
import type { UnifiedIntent } from '@speculum/page-projection/core/input/unifiedIntentTypes';
import {
  attachProjectedInputCapture,
  ProjectedInputCaptureMetrics,
  ScrollEchoGate,
} from '@speculum/page-projection/projected';
import {
  ViewportSync,
  measureHostElement,
  LAB_VIEWPORT_POLICY,
  normalizeSessionViewport,
  detectViewportDeviceProfile,
  type ViewportResizeResult,
  type ViewportDeviceProfile,
  type ViewportSize,
} from '@speculum/page-projection/projected';
import { snapshotTree } from '@speculum/page-projection/core/snapshot/domTreeSnapshot';
import { snapshotFormControls } from '@speculum/page-projection/projected/formControlSnapshot';
import { peekFrameHeader } from '@speculum/page-projection/core/decode';
import { LAB_TELEMETRY_DEFAULTS, TELEMETRY_BOOL_CAPS } from '@speculum/page-projection/core/telemetry';
import { CONTEXT_ID_ROOT } from '@speculum/page-projection/core/frame';

type ContextStreamStats = {
  wireFrames: number;
  emitted: number;
  applyOk: number;
  applyFail: number;
  desync: number;
  resync: number;
  overrun: number;
  lastApplyMs: number | null;
  lastBuildMs: number | null;
  lastEncodeMs: number | null;
  lastSequence: number | null;
  generation: number | null;
};

function emptyContextStats(): ContextStreamStats {
  return {
    wireFrames: 0,
    emitted: 0,
    applyOk: 0,
    applyFail: 0,
    desync: 0,
    resync: 0,
    overrun: 0,
    lastApplyMs: null,
    lastBuildMs: null,
    lastEncodeMs: null,
    lastSequence: null,
    generation: null,
  };
}

type FixtureEntry = { id: string; path: string; tags?: string[]; notes?: string };
type BlueprintSummary = {
  id: string;
  description: string;
  defaultUrl: string | null;
  acceptsSoakOverrides: boolean;
};

type Phase = 'idle' | 'connected' | 'live' | 'running' | 'fault' | 'complete';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

function displayUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.replace(/^\/+/, '');
  return `${location.origin}/${path.startsWith('fixtures/') ? path : `fixtures/${path}`}`;
}

function shortDesc(text: string, max = 72): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** PP-CSSOM-A-2 — same shape as Virtual `probeCssomPaintBoundary` (fixture probes). */
function probeCssomPaintBoundary(doc: Document): {
  authorColor: string;
  adoptedColor: string;
  adoptedCount: number;
  styleSheetCount: number;
  styleElCount: number;
  doublePaint: boolean;
} | null {
  const authorEl = doc.getElementById('author-probe');
  const adoptedEl = doc.getElementById('adopted-probe');
  if (!authorEl || !adoptedEl) return null;
  const view = doc.defaultView;
  const authorColor = view ? view.getComputedStyle(authorEl).color : '';
  const adoptedColor = view ? view.getComputedStyle(adoptedEl).color : '';
  const adopted = doc.adoptedStyleSheets ? Array.from(doc.adoptedStyleSheets) : [];
  const styleEls = Array.from(doc.querySelectorAll('style'));
  const authorTexts = new Set<string>();
  const sheetText = (sheet: CSSStyleSheet): string => {
    try {
      const parts: string[] = [];
      for (let i = 0; i < sheet.cssRules.length; i++) {
        const r = sheet.cssRules.item(i);
        if (r) parts.push(r.cssText);
      }
      return parts.join('\n');
    } catch {
      return '';
    }
  };
  for (let i = 0; i < styleEls.length; i++) {
    const el = styleEls[i]!;
    const sheet = (el as HTMLStyleElement).sheet;
    if (sheet) authorTexts.add(sheetText(sheet));
    else if (el.textContent) authorTexts.add(el.textContent);
  }
  let doublePaint = false;
  for (let i = 0; i < adopted.length; i++) {
    const s = adopted[i]!;
    if (s.ownerNode) doublePaint = true;
    const text = sheetText(s);
    if (text.length > 0 && authorTexts.has(text)) doublePaint = true;
  }
  return {
    authorColor,
    adoptedColor,
    adoptedCount: adopted.length,
    styleSheetCount: doc.styleSheets.length,
    styleElCount: styleEls.length,
    doublePaint,
  };
}

function logActivity(text: string): void {
  const row = document.createElement('div');
  row.textContent = `${new Date().toISOString().slice(11, 19)} ${text}`;
  const box = $('activity');
  box.prepend(row);
  while (box.childElementCount > 200) box.lastChild?.remove();
}

function logConsole(level: number, text: string): void {
  const row = document.createElement('div');
  const lvl = level >= 3 ? 'lvl-3' : level === 2 ? 'lvl-2' : 'lvl-1';
  row.className = lvl;
  const tag = level >= 3 ? 'error' : level === 2 ? 'warn' : 'log';
  row.textContent = `${new Date().toISOString().slice(11, 19)} [${tag}] ${text}`;
  const box = $('consoleLog');
  box.prepend(row);
  while (box.childElementCount > 400) box.lastChild?.remove();
}

function formatIntentShort(intent: Record<string, unknown>): string {
  const rec = intent as Record<string, unknown>;
  const kind =
    typeof rec.type === 'string'
      ? rec.type
      : typeof rec.kind === 'string'
        ? rec.kind
        : typeof rec.op === 'string'
          ? rec.op
          : 'intent';
  const id = rec.targetId ?? rec.nodeId ?? rec.id;
  if (kind === 'historyNav' && typeof rec.direction === 'string') return `${kind}:${rec.direction}`;
  return id != null ? `${kind}#${id}` : kind;
}

function readTelemetryFromUi(): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...LAB_TELEMETRY_DEFAULTS };
  for (const key of TELEMETRY_BOOL_CAPS) {
    const el = document.getElementById(`tel_${key}`) as HTMLInputElement | null;
    if (el) cfg[key] = el.checked;
  }
  const agg = document.getElementById('tel_aggregateIntervalMs') as HTMLInputElement | null;
  if (agg) cfg.aggregateIntervalMs = Number(agg.value) || 2000;
  return cfg;
}

function setChip(id: string, text: string, kind?: 'ok' | 'warn' | 'danger' | 'live' | ''): void {
  const el = $(id);
  el.textContent = text;
  el.className = kind ? `chip ${kind}` : 'chip';
  el.title = text;
  el.hidden = false;
}

export function bootLabClient(): void {
  let ws: WebSocket | null = null;
  let projection: LabProjectedHarness | null = null;
  const inputDetachers = new Map<number, () => void>();
  /** Shared across root + nested surfaces — Stop dumps into dossier. */
  let inputCaptureMetrics = new ProjectedInputCaptureMetrics();
  let sessionToken = '';
  let assetBaseUrl = window.location.origin;
  let canonicalViewport: ViewportSize = { width: 1280, height: 720 };
  let viewportSync: ViewportSync | null = null;
  let pendingResize: {
    resolve: (result: ViewportResizeResult) => void;
  } | null = null;
  let bootDeviceProfile: ViewportDeviceProfile = detectViewportDeviceProfile();

  /** Lab-only diag hooks — early so a later boot throw cannot hide them. */
  (
    window as unknown as {
      __labDiagProjectedPeek?: () => ReturnType<LabProjectedHarness['peekNestedHosts']> | null;
      __labDiagForceLoadAfterDrop?: (
        contextId?: number,
      ) => ReturnType<LabProjectedHarness['forceLoadAfterDropRaceForDiag']> | null;
      __speculumLabDumpInputClick?: () => void;
    }
  ).__labDiagProjectedPeek = () => (projection ? projection.peekNestedHosts() : null);
  (
    window as unknown as {
      __labDiagForceLoadAfterDrop?: (
        contextId?: number,
      ) => ReturnType<LabProjectedHarness['forceLoadAfterDropRaceForDiag']> | null;
    }
  ).__labDiagForceLoadAfterDrop = (contextId = 99) =>
    projection ? projection.forceLoadAfterDropRaceForDiag(contextId) : null;
  (
    window as unknown as { __speculumLabDumpInputClick?: () => void }
  ).__speculumLabDumpInputClick = () => {
    /* replaced once sendInputClickDiag is defined */
  };

  function disposeViewportSync(): void {
    viewportSync?.dispose();
    viewportSync = null;
    if (pendingResize) {
      pendingResize.resolve({ applied: false, message: 'sync disposed', errorCode: 'disposed' });
      pendingResize = null;
    }
  }

  function requestRemoteResize(
    size: ViewportSize,
    device: ViewportDeviceProfile,
  ): Promise<ViewportResizeResult> {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve({
        applied: false,
        message: 'ws not open',
        errorCode: 'ws_closed',
      });
    }
    return new Promise((resolve) => {
      if (pendingResize) {
        pendingResize.resolve({ applied: false, message: 'superseded', errorCode: 'superseded' });
      }
      pendingResize = { resolve };
      ws!.send(
        JSON.stringify({
          type: 'client.resize',
          width: size.width,
          height: size.height,
          device,
        }),
      );
    });
  }

  function startViewportSync(): void {
    disposeViewportSync();
    // Stage must match canonical before observe — seed may equal host and otherwise no-op.
    projection?.client.setCssSize(canonicalViewport.width, canonicalViewport.height);
    const sync = new ViewportSync({
      measure: () => measureHostElement(surfaceHost),
      resize: requestRemoteResize,
      viewportPolicy: LAB_VIEWPORT_POLICY,
      onApplied: (size) => {
        canonicalViewport = size;
        projection?.client.setCssSize(size.width, size.height);
        logActivity(`viewport ${size.width}×${size.height}`);
      },
      onRejected: (detail) => {
        logActivity(`viewport resize rejected: ${detail}`);
      },
    });
    sync.seedRemote(canonicalViewport.width, canonicalViewport.height, bootDeviceProfile);
    sync.observe(surfaceHost);
    viewportSync = sync;
  }

  function measureAndNormalizeViewport(): ViewportSize {
    const measured = measureHostElement(surfaceHost);
    return normalizeSessionViewport(measured.width, measured.height, LAB_VIEWPORT_POLICY);
  }

  function sendInputIntent(intent: UnifiedIntent): void {
    if (surfaceWrap.classList.contains('is-crashed')) return;
    if (ws?.readyState === WebSocket.OPEN) {
      const payload: Record<string, unknown> = { schemaVersion: intent.schemaVersion, type: intent.type };
      if (intent.type === 'move' || intent.type === 'down' || intent.type === 'up') {
        payload.x = intent.x;
        payload.y = intent.y;
        payload.viewportW = intent.viewportW;
        payload.viewportH = intent.viewportH;
        payload.button = intent.button;
        // Sparse-cdp id-addressed click — nodeId + local % in target box.
        if (intent.type !== 'move') {
          if (intent.contextId != null) payload.contextId = intent.contextId;
          if (intent.nodeId !== undefined) payload.nodeId = intent.nodeId;
          if (intent.localX != null) payload.localX = intent.localX;
          if (intent.localY != null) payload.localY = intent.localY;
        }
        payload.payload = JSON.stringify({
          x: intent.x,
          y: intent.y,
          button: intent.button,
          ...(intent.type !== 'move' && intent.localX != null && intent.localY != null
            ? { localX: intent.localX, localY: intent.localY }
            : {}),
        });
      } else if (intent.type === 'keyDown' || intent.type === 'keyUp') {
        payload.key = intent.key;
        payload.code = intent.code;
        payload.payload = JSON.stringify({ key: intent.key, code: intent.code, modifiers: intent.modifiers });
      } else if (intent.type === 'scrollSet') {
        payload.contextId = intent.contextId;
        payload.nodeId = intent.nodeId;
        payload.scrollX = intent.scrollX;
        payload.scrollY = intent.scrollY;
        payload.payload = JSON.stringify({ scrollX: intent.scrollX, scrollY: intent.scrollY });
      } else if (intent.type === 'historyNav') {
        payload.direction = intent.direction;
        payload.payload = JSON.stringify({ direction: intent.direction });
      }
      payload.timestampClient = intent.timestampClient;
      ws.send(JSON.stringify({ type: 'client.intent', intent: payload }));
      logActivity(`intent ${formatIntentShort(intent as unknown as Record<string, unknown>)}`);
    }
  }

  function sendInputClickDiag(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logActivity('input.diag skipped (no ws)');
      return;
    }
    ws.send(
      JSON.stringify({
        type: 'browse.inputDiag',
        inputCapture: inputCaptureMetrics.snapshot(),
      }),
    );
    logActivity('input.diag requested…');
  }

  function sendWidgetParityDiag(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logActivity('widget.diag skipped (no ws)');
      return;
    }
    if (!projection) {
      logActivity('widget.diag skipped (no projection)');
      return;
    }
    if (widgetParityInFlight) return;
    widgetParityInFlight = true;
    syncButtons();
    const projectedHosts = projection.probeWidgetHostBindings();
    ws.send(JSON.stringify({ type: 'browse.widgetParity', projectedHosts }));
    logActivity('widget.diag requested…');
  }

  (window as unknown as { __speculumLabDumpInputClick?: () => void }).__speculumLabDumpInputClick =
    sendInputClickDiag;
  (window as unknown as { __speculumLabWidgetParity?: () => void }).__speculumLabWidgetParity =
    sendWidgetParityDiag;
  document.addEventListener('speculum-input-diag', () => sendInputClickDiag());
  document.addEventListener('speculum-widget-parity', () => sendWidgetParityDiag());

  function bindInputSurfaces(client: LabProjectedHarness): void {
    for (const detach of inputDetachers.values()) detach();
    inputDetachers.clear();
    inputCaptureMetrics = new ProjectedInputCaptureMetrics();

    // Capture must bind inside the projected document. Listeners on the host
    // <iframe> never see pointer/keyboard events that fire in contentDocument.
    // Do not use `instanceof HTMLElement` — iframe realm makes it always false.
    // ScrollEchoGate: call expect() before any programmatic Projected scroll apply;
    // until apply sets scroll, consume is a no-op (local-first user scroll still intents).
    const scrollEcho = new ScrollEchoGate();
    const rootSurface = client.document.documentElement;
    if (rootSurface && rootSurface.nodeType === 1) {
      const detach = attachProjectedInputCapture(rootSurface, client.getLiveRegistry(), sendInputIntent, {
        contextId: CONTEXT_ID_ROOT,
        getGeneration: () => client.getGeneration(),
        getViewportSize: () => canonicalViewport,
        isArmed: () => client.isArmed,
        onMarkPropDirty: (id) => client.markPropDirty(id),
        consumeScrollEcho: (target, observed) => scrollEcho.consume(target, observed),
        metrics: inputCaptureMetrics,
      });
      inputDetachers.set(CONTEXT_ID_ROOT, detach);
    }

    const rootWin = client.document.defaultView;
    client.forEachNestedInputSurface((info) => {
      const nestedDoc = info.surface.contentDocument;
      const nestedSurface = nestedDoc?.documentElement;
      if (!nestedSurface || nestedSurface.nodeType !== 1) return;
      const detach = attachProjectedInputCapture(nestedSurface, info.registry, sendInputIntent, {
        contextId: info.contextId,
        getGeneration: info.getGeneration,
        // Mode A coords are root Virtual viewport — same canonical size as root capture.
        getViewportSize: () => canonicalViewport,
        // Walk nested frame offsets up to the projected root (not lab chrome).
        getRootWindow: () => rootWin,
        isArmed: info.isArmed,
        onMarkPropDirty: info.markPropDirty,
        consumeScrollEcho: (target, observed) => scrollEcho.consume(target, observed),
        metrics: inputCaptureMetrics,
      });
      inputDetachers.set(info.contextId, detach);
    });
  }
  let mode: 'browse' | 'run' = 'browse';
  let runInFlight = false;
  let sessionLive = false;
  let sessionId: string | null = null;
  let phase: Phase = 'idle';
  let opsTotal = 0;
  let browseSnapCount = 0;
  let snapInFlight = false;
  let widgetParityInFlight = false;
  let autoSnapTimer: ReturnType<typeof setInterval> | null = null;
  const byContext = new Map<number, ContextStreamStats>();

  function stopAutoSnap(): void {
    if (autoSnapTimer) {
      clearInterval(autoSnapTimer);
      autoSnapTimer = null;
    }
  }

  function requestBrowseSnap(label?: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionLive || snapInFlight) return;
    snapInFlight = true;
    syncButtons();
    ws.send(JSON.stringify({ type: 'client.snapshot', label }));
  }

  function startAutoSnap(): void {
    stopAutoSnap();
    const enabled = (document.getElementById('autoSnap') as HTMLInputElement | null)?.checked === true;
    if (!enabled || !sessionLive) return;
    const raw = Number((document.getElementById('autoSnapIntervalMs') as HTMLInputElement | null)?.value);
    const intervalMs = Number.isFinite(raw) && raw >= 1000 ? raw : 5000;
    autoSnapTimer = setInterval(() => {
      requestBrowseSnap('auto');
    }, intervalMs);
  }

  function ctxStats(contextId: number): ContextStreamStats {
    let row = byContext.get(contextId);
    if (!row) {
      row = emptyContextStats();
      byContext.set(contextId, row);
    }
    return row;
  }

  function observeStreamTelemetry(msg: Record<string, unknown>): void {
    const kind = typeof msg.kind === 'string' ? msg.kind : '';
    const ctxId =
      typeof msg.contextId === 'number' && Number.isInteger(msg.contextId) && msg.contextId >= 1
        ? msg.contextId
        : CONTEXT_ID_ROOT;
    const row = ctxStats(ctxId);
    if (kind === 'frameEmitted') {
      row.emitted += 1;
      if (typeof msg.sequence === 'number') row.lastSequence = msg.sequence;
      if (typeof msg.generation === 'number') row.generation = msg.generation;
      if (typeof msg.buildMs === 'number') row.lastBuildMs = msg.buildMs;
      if (typeof msg.encodeMs === 'number') row.lastEncodeMs = msg.encodeMs;
    }
    if (kind === 'applyResult') {
      const ok = msg.ok === true;
      if (ok) row.applyOk += 1;
      else row.applyFail += 1;
      if (typeof msg.applyMs === 'number') row.lastApplyMs = msg.applyMs;
      if (typeof msg.sequence === 'number') row.lastSequence = msg.sequence;
      if (typeof msg.generation === 'number') row.generation = msg.generation;
    }
    if (kind === 'desynced' || kind === 'desync') row.desync += 1;
    if (kind === 'applyOverrun') row.overrun += 1;
  }

  const fixtureSelect = $('fixture') as HTMLSelectElement;
  const urlInput = $('url') as HTMLInputElement;
  const blueprintSelect = $('blueprint') as HTMLSelectElement;
  const soakOverrides = $('soakOverrides');
  const surfaceHost = $('surfaceHost');
  const surfaceWrap = $('surfaceWrap');
  const fixtureField = $('fixtureField');
  const blueprintField = $('blueprintField');
  const blueprintDesc = $('blueprintDesc');
  const urlLabel = $('urlLabel');
  const modeBlurb = $('modeBlurb');
  let blueprints: BlueprintSummary[] = [];

  function setSurfaceEmpty(empty: boolean): void {
    surfaceWrap.classList.toggle('is-empty', empty);
  }

  function showCrashOverlay(detail: string): void {
    surfaceWrap.classList.add('is-crashed');
    surfaceWrap.classList.remove('is-empty');
    const overlay = $('surfaceCrash');
    overlay.hidden = false;
    $('surfaceCrashDetail').textContent = detail.trim() || 'unknown fault';
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch {
      /* */
    }
  }

  function clearCrashOverlay(): void {
    surfaceWrap.classList.remove('is-crashed');
    const overlay = document.getElementById('surfaceCrash');
    if (overlay) overlay.hidden = true;
    const detail = document.getElementById('surfaceCrashDetail');
    if (detail) detail.textContent = '—';
  }

  function measureHeader(): void {
    const h = $('labHeader').getBoundingClientRect().height;
    document.documentElement.style.setProperty('--hdr-h', `${Math.ceil(h)}px`);
  }

  let labFullscreen = false;

  function syncFullscreenUi(): void {
    document.body.classList.toggle('lab-fullscreen', labFullscreen);
    const exitBtn = $('exitFullscreen') as HTMLButtonElement;
    exitBtn.setAttribute('aria-hidden', labFullscreen ? 'false' : 'true');
    const enterBtn = $('enterFullscreen') as HTMLButtonElement;
    enterBtn.setAttribute('aria-pressed', labFullscreen ? 'true' : 'false');
    if (!labFullscreen) measureHeader();
  }

  async function enterLabFullscreen(): Promise<void> {
    labFullscreen = true;
    syncFullscreenUi();
    try {
      const root = document.documentElement;
      if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
        await root.requestFullscreen();
      }
    } catch {
      /* CSS chrome hide still works when native fullscreen is denied (common on mobile). */
    }
    logActivity('fullscreen on');
    // Class toggle can miss ResizeObserver coalescing with native fullscreen — flush measure.
    if (viewportSync) {
      const measured = measureHostElement(surfaceHost);
      viewportSync.schedule(measured.width, measured.height);
    }
  }

  async function exitLabFullscreen(): Promise<void> {
    labFullscreen = false;
    syncFullscreenUi();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* */
    }
    logActivity('fullscreen off');
    if (viewportSync) {
      const measured = measureHostElement(surfaceHost);
      viewportSync.schedule(measured.width, measured.height);
    }
  }

  function refreshStatus(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setChip('chipWs', 'ws idle');
    } else {
      setChip('chipWs', 'ws open', 'ok');
    }

    const phaseText =
      phase === 'idle'
        ? 'idle'
        : phase === 'connected'
          ? 'connected — start Virtual or run'
          : phase === 'live'
            ? `live ${mode}`
            : phase === 'running'
              ? 'run in flight'
              : phase === 'complete'
                ? 'run complete'
                : phase;
    const phaseKind =
      phase === 'fault' ? 'danger' : phase === 'running' || phase === 'live' ? 'live' : phase === 'complete' ? 'ok' : '';
    setChip('chipPhase', phaseText, phaseKind);

    if (sessionId) {
      setChip('chipSession', `session ${sessionId.slice(0, 8)}…`);
      $('chipSession').title = sessionId;
    } else {
      $('chipSession').hidden = true;
    }
  }

  function syncButtons(): void {
    const open = ws !== null && ws.readyState === WebSocket.OPEN;
    const connectBtn = $('connect') as HTMLButtonElement;
    connectBtn.disabled = open;
    connectBtn.classList.toggle('primary', !open);
    ($('disconnect') as HTMLButtonElement).disabled = !open;

    ($('browseStart') as HTMLButtonElement).disabled = !open || mode !== 'browse' || sessionLive || runInFlight;
    ($('browseNavigate') as HTMLButtonElement).disabled = !open || mode !== 'browse' || !sessionLive || runInFlight;
    ($('browseSnap') as HTMLButtonElement).disabled =
      !open || mode !== 'browse' || !sessionLive || runInFlight || snapInFlight;
    ($('browseWidgetParity') as HTMLButtonElement).disabled =
      !open || mode !== 'browse' || !sessionLive || runInFlight || widgetParityInFlight || !projection;
    ($('browseValidate') as HTMLButtonElement).disabled =
      !open || mode !== 'browse' || !sessionLive || runInFlight || browseSnapCount < 1 || snapInFlight;
    ($('browseStop') as HTMLButtonElement).disabled = !open || !sessionLive || mode !== 'browse' || runInFlight;
    ($('clearSurface') as HTMLButtonElement).disabled = !open || runInFlight;
    ($('runStart') as HTMLButtonElement).disabled = !open || mode !== 'run' || runInFlight;

    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      btn.disabled = runInFlight;
    });

    ($('browseStart') as HTMLButtonElement).classList.toggle('primary', open && mode === 'browse' && !sessionLive);
    ($('runStart') as HTMLButtonElement).classList.toggle('primary', open && mode === 'run' && !runInFlight);

    ($('browseStart') as HTMLButtonElement).title = !open
      ? 'Connect first'
      : sessionLive
        ? 'Virtual already live — Stop first'
        : 'Cold-start Virtual at the URL';
    ($('runStart') as HTMLButtonElement).title = !open
      ? 'Connect first'
      : runInFlight
        ? 'Run in flight'
        : 'Cold-boot blueprint DAG (URL comes from blueprint)';
    ($('browseNavigate') as HTMLButtonElement).title = sessionLive
      ? 'Navigate live Virtual to the URL field'
      : 'Start Virtual first';

    refreshStatus();
    measureHeader();
  }

  function selectedBlueprint(): BlueprintSummary | undefined {
    return blueprints.find((b) => b.id === blueprintSelect.value);
  }

  function syncRunTarget(): void {
    const bp = selectedBlueprint();
    urlInput.value = bp?.defaultUrl ? displayUrl(bp.defaultUrl) : '';
    urlInput.readOnly = true;
    urlLabel.textContent = 'Blueprint URL';
    urlInput.title = 'Locked — comes from the selected blueprint';
    soakOverrides.hidden = !(bp?.acceptsSoakOverrides ?? false);
    blueprintDesc.hidden = !bp;
    blueprintDesc.textContent = bp ? bp.description : '';
  }

  function showMode(next: 'browse' | 'run'): void {
    if (runInFlight && next !== mode) return;
    mode = next;
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      const on = btn.dataset.mode === next;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('browseControls').hidden = next !== 'browse';
    $('runControls').hidden = next !== 'run';
    fixtureField.hidden = next !== 'browse';
    blueprintField.hidden = next !== 'run';
    blueprintDesc.hidden = next !== 'run';
    if (next === 'browse') {
      modeBlurb.textContent = 'Free navigation — pick a fixture or edit the URL, then Start Virtual.';
      urlInput.readOnly = false;
      urlLabel.textContent = 'URL';
      urlInput.title = 'Editable — free navigation target';
      if (!urlInput.value || urlInput.value.startsWith(`${location.origin}/fixtures/`)) {
        urlInput.value = 'https://www.eneba.com';
      }
    } else {
      modeBlurb.textContent = 'Cold blueprint DAG — URL is locked to the blueprint; soak may override duration/probes.';
      syncRunTarget();
    }
    syncButtons();
  }

  function showTab(name: string): void {
    $('panelStream').hidden = name !== 'Stream';
    $('panelDebug').hidden = name !== 'Debug';
    $('panelActivity').hidden = name !== 'Activity';
    $('panelConsole').hidden = name !== 'Console';
    $('panelConfig').hidden = name !== 'Config';
    $('panelProgress').hidden = name !== 'Progress';
    document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      const on = btn.dataset.tab === name;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function renderDebugProbe(payload: Record<string, unknown>): void {
    const wall = typeof payload.wallMs === 'number' ? payload.wallMs : null;
    $('dbgWall').textContent = wall != null ? String(Math.round(wall)) : '—';
    const intentJournal = (payload.intentJournal ?? {}) as Record<string, unknown>;
    $('dbgIntents').textContent = String(intentJournal.total ?? 0);
    $('dbgIntentDrop').textContent = String(intentJournal.dropped ?? 0);
    const pipe = (payload.inputPipeline ?? null) as Record<string, unknown> | null;
    const inject = (pipe?.inject ?? null) as Record<string, unknown> | null;
    $('dbgInjectRecv').textContent = String(inject?.received ?? pipe?.ingressReceived ?? 0);
    $('dbgInjectDrop').textContent = String(
      (typeof inject?.dropped === 'number' ? inject.dropped : 0)
        + (typeof pipe?.ingressDropped === 'number' ? pipe.ingressDropped : 0),
    );
    $('dbgChainPeak').textContent = String(inject?.chainDepthPeak ?? 0);
    $('dbgMoveCollapse').textContent = String(inject?.moveCollapseCount ?? 0);
    const queue = (inject?.queueWaitMs ?? null) as { p95?: number } | null;
    const injMs = (inject?.injectMs ?? null) as { p95?: number } | null;
    $('dbgQueueP95').textContent =
      queue && typeof queue.p95 === 'number' ? queue.p95.toFixed(1) : '—';
    $('dbgInjectP95').textContent =
      injMs && typeof injMs.p95 === 'number' ? injMs.p95.toFixed(1) : '—';
    const metrics = (payload.metrics ?? {}) as Record<string, unknown>;
    const fps = typeof metrics.steadyFps === 'number' ? metrics.steadyFps : null;
    $('dbgFps').textContent = fps != null ? fps.toFixed(1) : '—';
    $('dbgDesync').textContent = String(metrics.desyncCount ?? 0);
    const cpuOn = payload.cpuProfiling === true;
    const cpuRun = payload.cpuProfileStarted === true;
    $('dbgCpu').textContent = cpuOn ? (cpuRun ? 'profiling' : 'armed') : 'off';
    const crash = payload.crash;
    $('dbgCrash').textContent = crash ? JSON.stringify(crash, null, 2) : 'none';
    const last = inject?.lastOutcome ?? null;
    $('dbgLastOutcome').textContent = last ? JSON.stringify(last, null, 2) : '—';
    const drops = {
      journal: intentJournal.dropsByError ?? {},
      ingress: pipe?.ingressDropsByReason ?? {},
      inject: inject?.dropsByReason ?? {},
    };
    $('dbgDrops').textContent = JSON.stringify(drops, null, 2);
  }

  function updateStream(): void {
    const root = ctxStats(CONTEXT_ID_ROOT);
    $('streamFrames').textContent = String(root.wireFrames);
    $('streamApply').textContent = String(root.applyOk);
    $('streamDesync').textContent = String(root.desync);
    $('streamResync').textContent = String(root.resync);
    $('streamOps').textContent = opsTotal > 0 ? String(opsTotal) : '—';
    if (projection) {
      $('streamSeq').textContent = String(projection.lastAcceptedSequence);
    }
    if (root.generation !== null) $('streamGen').textContent = String(root.generation);
    if (root.lastApplyMs !== null) $('streamApplyMs').textContent = root.lastApplyMs.toFixed(1);

    const list = $('streamContextList');
    list.replaceChildren();
    const ids = [...byContext.keys()].sort((a, b) => a - b);
    if (ids.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stream-empty';
      empty.textContent = 'No context traffic yet';
      list.append(empty);
      return;
    }
    for (const id of ids) {
      const s = byContext.get(id)!;
      const card = document.createElement('article');
      card.className = id === CONTEXT_ID_ROOT ? 'ctx-card stream-root' : 'ctx-card';

      const head = document.createElement('div');
      head.className = 'ctx-card-head';
      const idEl = document.createElement('div');
      idEl.className = 'ctx-id';
      idEl.textContent = id === CONTEXT_ID_ROOT ? `ctx ${id} · root` : `ctx ${id}`;
      const seqEl = document.createElement('div');
      seqEl.className = 'ctx-seq';
      seqEl.textContent = s.lastSequence !== null ? `seq ${s.lastSequence}` : 'seq —';
      head.append(idEl, seqEl);

      const stats = document.createElement('div');
      stats.className = 'ctx-stats';
      const rows: Array<[string, string, string?]> = [
        ['Wire', String(s.wireFrames), 'Wire frame parts received'],
        ['Emit', String(s.emitted), 'Virtual frameEmitted'],
        ['Apply+', String(s.applyOk)],
        ['Apply−', s.applyFail > 0 ? String(s.applyFail) : '—'],
        ['Desync', String(s.desync)],
        ['Resync', String(s.resync)],
        ['Ovr', s.overrun > 0 ? String(s.overrun) : '—'],
        ['Build', s.lastBuildMs !== null ? `${s.lastBuildMs.toFixed(1)} ms` : '—'],
        ['Apply', s.lastApplyMs !== null ? `${s.lastApplyMs.toFixed(1)} ms` : '—'],
      ];
      for (const [k, v, title] of rows) {
        const cell = document.createElement('div');
        cell.className = 'ctx-stat';
        if (title) cell.title = title;
        const kEl = document.createElement('span');
        kEl.className = 'k';
        kEl.textContent = k;
        const vEl = document.createElement('span');
        vEl.className = 'v';
        vEl.textContent = v;
        cell.append(kEl, vEl);
        stats.append(cell);
      }

      card.append(head, stats);
      list.append(card);
    }
  }

  function resetStreamCounters(): void {
    byContext.clear();
    opsTotal = 0;
    browseSnapCount = 0;
    $('streamGen').textContent = '—';
    $('streamApplyMs').textContent = '—';
    $('streamOps').textContent = '—';
    $('streamSnaps').textContent = '0';
    updateStream();
  }

  async function ensureProjection(): Promise<LabProjectedHarness> {
    if (projection) return projection;
    projection = await LabProjectedHarness.create({
      surfaceHost,
      width: canonicalViewport.width,
      height: canonicalViewport.height,
      getToken: () => sessionToken,
      getAssetBaseUrl: () => assetBaseUrl,
      onArmed: () => {
        bindInputSurfaces(projection!);
      },
      onTelemetry: (msg) => {
        observeStreamTelemetry(msg);
        const m = msg as { kind?: string; contextId?: number; opCount?: number; ok?: boolean; errorCode?: string; message?: string };
        const ctxId = typeof m.contextId === 'number' ? m.contextId : CONTEXT_ID_ROOT;
        if (m.kind === 'clientWarn' && typeof m.message === 'string') {
          logConsole(3, m.message);
          logActivity(m.message);
        }
        if (m.kind === 'applyResult' && m.ok === true && ctxId !== CONTEXT_ID_ROOT && projection) {
          bindInputSurfaces(projection);
        }
        if (m.kind === 'applyResult' && typeof m.opCount === 'number' && ctxId === CONTEXT_ID_ROOT && m.ok === true) {
          opsTotal += m.opCount;
          $('streamOps').textContent = String(m.opCount);
        }
        if (m.kind === 'desynced' || m.kind === 'desync') {
          logActivity(
            ctxId === CONTEXT_ID_ROOT
              ? `desync ${(msg as { errorCode?: string }).errorCode ?? m.kind}`
              : `ctx${ctxId} desync ${(msg as { errorCode?: string }).errorCode ?? m.kind}`,
          );
        }
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'client.telemetry', message: msg }));
        }
        updateStream();
      },
      onRequestResync: (info) => {
        const ctxId = info.contextId ?? CONTEXT_ID_ROOT;
        ctxStats(ctxId).resync += 1;
        logActivity(
          ctxId === CONTEXT_ID_ROOT
            ? `resync requested reason=${info.reason}`
            : `ctx${ctxId} resync requested reason=${info.reason}`,
        );
        updateStream();
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'client.requestResync', ...info }));
        }
      },
      onDesync: (reason) => {
        updateStream();
        logActivity(`desync ${reason}`);
      },
    });
    setSurfaceEmpty(false);
    if (canonicalViewport.width > 0 && canonicalViewport.height > 0) {
      projection.client.setCssSize(canonicalViewport.width, canonicalViewport.height);
    }
    return projection;
  }

  function appendProgress(msg: {
    actionId: unknown;
    queue: unknown;
    status: unknown;
    detail?: unknown;
  }): void {
    const status = String(msg.status);
    const row = document.createElement('div');
    row.className = `tl-row ${status}`;
    const st = document.createElement('span');
    st.className = 'tl-status';
    st.textContent = status;
    const id = document.createElement('span');
    id.className = 'tl-id';
    id.textContent = String(msg.actionId);
    const q = document.createElement('span');
    q.className = 'tl-queue';
    q.textContent = String(msg.queue);
    row.append(st, id, q);
    if (msg.detail) {
      const d = document.createElement('div');
      d.className = 'tl-detail';
      d.textContent = String(msg.detail);
      row.append(d);
    }
    $('runTimeline').prepend(row);
  }

  function renderVerdictSummary(s: { pass: number; fail: number; skipped: number }): void {
    const box = $('runVerdicts');
    box.innerHTML = '';
    for (const [k, v] of [
      ['pass', s.pass],
      ['fail', s.fail],
      ['skipped', s.skipped],
    ] as const) {
      const chip = document.createElement('span');
      chip.className = `verdict ${k}`;
      chip.textContent = `${k} ${v}`;
      box.appendChild(chip);
    }
  }

  async function loadFixtures(): Promise<void> {
    try {
      const res = await fetch('/lab/fixtures');
      const list = (await res.json()) as FixtureEntry[];
      fixtureSelect.innerHTML = '';
      for (const f of list) {
        const opt = document.createElement('option');
        opt.value = f.path;
        opt.textContent = f.id;
        if (f.notes) opt.title = f.notes;
        fixtureSelect.appendChild(opt);
      }
      const demo = list.find((f) => f.id === 'demo') ?? list[0];
      if (demo && mode === 'browse') {
        fixtureSelect.value = demo.path;
        urlInput.value = `${location.origin}/fixtures/${demo.path}`;
      }
    } catch {
      if (mode === 'browse') urlInput.value = 'https://www.eneba.com';
    }
  }

  async function loadBlueprints(): Promise<void> {
    try {
      const res = await fetch('/lab/blueprints');
      const data = (await res.json()) as { blueprints: BlueprintSummary[] };
      blueprints = data.blueprints;
      blueprintSelect.innerHTML = '';
      for (const bp of blueprints) {
        const opt = document.createElement('option');
        opt.value = bp.id;
        opt.textContent = `${bp.id} — ${shortDesc(bp.description, 48)}`;
        opt.title = bp.description;
        blueprintSelect.appendChild(opt);
      }
      if (blueprints.some((b) => b.id === 'soak')) blueprintSelect.value = 'soak';
    } catch {
      blueprints = [
        {
          id: 'soak',
          description: 'Timed soak',
          defaultUrl: 'fixtures/demo.html',
          acceptsSoakOverrides: true,
        },
      ];
      blueprintSelect.innerHTML = '<option value="soak">soak</option>';
    }
    if (mode === 'run') syncRunTarget();
  }

  function connect(): void {
    if (ws) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/lab/session`);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      phase = 'connected';
      logActivity('ws open');
      ws?.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
      syncButtons();
    });
    ws.addEventListener('close', () => {
      phase = 'idle';
      sessionId = null;
      logActivity('ws close');
      disposeViewportSync();
      stopAutoSnap();
      ws = null;
      sessionLive = false;
      runInFlight = false;
      snapInFlight = false;
      syncButtons();
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') {
        void ensureProjection().then((p) => {
          const bytes = new Uint8Array(ev.data as ArrayBuffer);
          const hdr = peekFrameHeader(bytes);
          const ctxId = hdr && hdr.contextId >= 1 ? hdr.contextId : CONTEXT_ID_ROOT;
          ctxStats(ctxId).wireFrames += 1;
          p.ingest(bytes);
          updateStream();
        });
        return;
      }
      let msg: { type?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'telemetry') {
        const tel = msg.message;
        if (typeof tel === 'object' && tel !== null) {
          observeStreamTelemetry(tel as Record<string, unknown>);
          updateStream();
        }
        return;
      }
      if (msg.type === 'requestSnapshot') {
        const contextId = typeof msg.contextId === 'number' && msg.contextId >= 1 ? msg.contextId : 1;
        const includeNestedPeek = msg.includeNestedPeek === true;
        const registryProbeNodeIds = Array.isArray(msg.registryProbeNodeIds)
          ? msg.registryProbeNodeIds.filter((n): n is number => typeof n === 'number')
          : [];
        const rectLadderRaw = msg.rectLadderProbe;
        const rectLadderProbe =
          typeof rectLadderRaw === 'object' &&
          rectLadderRaw !== null &&
          typeof (rectLadderRaw as { nestedContextId?: unknown }).nestedContextId === 'number'
            ? {
                nestedContextId: (rectLadderRaw as { nestedContextId: number }).nestedContextId,
                widgetNodeId:
                  typeof (rectLadderRaw as { widgetNodeId?: unknown }).widgetNodeId === 'number'
                    ? (rectLadderRaw as { widgetNodeId: number }).widgetNodeId
                    : undefined,
              }
            : undefined;
        const paintRaw = msg.paintProbe;
        const paintProbeReq =
          typeof paintRaw === 'object' &&
          paintRaw !== null &&
          typeof (paintRaw as { nestedContextId?: unknown }).nestedContextId === 'number'
            ? {
                nestedContextId: (paintRaw as { nestedContextId: number }).nestedContextId,
                widgetNodeId:
                  typeof (paintRaw as { widgetNodeId?: unknown }).widgetNodeId === 'number'
                    ? (paintRaw as { widgetNodeId: number }).widgetNodeId
                    : undefined,
              }
            : undefined;
        const sheetDumpRaw = msg.cssomSheetDump;
        const cssomSheetDumpReq =
          typeof sheetDumpRaw === 'object' && sheetDumpRaw !== null
            ? {
                nestedContextId:
                  typeof (sheetDumpRaw as { nestedContextId?: unknown }).nestedContextId === 'number'
                    ? (sheetDumpRaw as { nestedContextId: number }).nestedContextId
                    : undefined,
              }
            : undefined;
        void ensureProjection().then(async (p) => {
          const ctx = p.snapshotContext(contextId);
          const doc = contextId === 1 ? p.document : p.nestedDocument(contextId);
          const tree = doc ? snapshotTree(doc) : null;
          const cascade = doc ? probeCssomPaintBoundary(doc) : null;
          const formProps = doc ? snapshotFormControls(doc) : null;
          const nestedPeek =
            includeNestedPeek && contextId === 1 ? p.peekNestedHosts() : undefined;
          const registryProbe =
            contextId >= 2 && registryProbeNodeIds.length > 0
              ? p.probeNestedRegistry(contextId, registryProbeNodeIds)
              : undefined;
          const rectLadder = rectLadderProbe
            ? p.probeRectLadder(
                rectLadderProbe.nestedContextId,
                rectLadderProbe.widgetNodeId ?? 21,
              )
            : undefined;
          let paintProbe:
            | {
                widgetPaint: ReturnType<typeof p.probeWidgetPaint>['paint'];
                widgetPaintOk: boolean;
                widgetPaintReason?: string;
              }
            | undefined;
          if (paintProbeReq) {
            const wId = paintProbeReq.widgetNodeId ?? 21;
            const paint = p.probeWidgetPaint(paintProbeReq.nestedContextId, wId);
            paintProbe = {
              widgetPaint: paint.paint,
              widgetPaintOk: paint.ok,
              widgetPaintReason: paint.reason,
            };
          }
          const cssomSheetDump = cssomSheetDumpReq
            ? p.probeCssomSheetDump(cssomSheetDumpReq.nestedContextId ?? contextId)
            : undefined;
          ws?.send(
            JSON.stringify({
              type: 'client.snapshotResult',
              contextId,
              tree,
              table: ctx.table,
              sequence: ctx.sequence,
              generation: ctx.generation,
              desynced: ctx.desynced,
              applyError: ctx.applyError,
              armed: ctx.armed,
              resyncInFlight: ctx.resyncInFlight,
              cascade,
              formProps,
              ...(nestedPeek !== undefined ? { nestedPeek } : {}),
              ...(registryProbe !== undefined ? { registryProbe } : {}),
              ...(rectLadder !== undefined ? { rectLadder } : {}),
              ...(paintProbe !== undefined ? { paintProbe } : {}),
              ...(cssomSheetDump !== undefined ? { cssomSheetDump } : {}),
            }),
          );
        });
        return;
      }
      if (msg.type === 'lab.injectFrame') {
        void ensureProjection().then((p) => {
          const b64 = typeof msg.bytes === 'string' ? msg.bytes : '';
          try {
            const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            p.ingest(bin);
            p.flushNow();
          } catch (err) {
            logActivity(`lab.injectFrame failed ${err instanceof Error ? err.message : String(err)}`);
          }
          const tableSnap = p.snapshotTable();
          logActivity(
            `lab.injectFrame seq=${tableSnap.sequence} desynced=${p.desynced} err=${p.applyError ?? 'null'}`,
          );
          ws?.send(
            JSON.stringify({
              type: 'client.injectResult',
              sequence: tableSnap.sequence,
              generation: tableSnap.generation,
              desynced: p.desynced,
              applyError: p.applyError,
              tableHash: tableSnap.table.tableHash,
            }),
          );
        });
        return;
      }
      if (msg.type === 'lab.tamper') {
        void ensureProjection().then((p) => {
          p.flushNow();
          const r = p.tamperGhostCssRule();
          logActivity(`lab.tamper ghostRule ok=${r.ok}${r.reason ? ` ${r.reason}` : ''}`);
          ws?.send(
            JSON.stringify({
              type: 'client.tamperResult',
              ok: r.ok,
              reason: r.reason ?? null,
            }),
          );
        });
        return;
      }
      if (msg.type === 'session.resized') {
        const pending = pendingResize;
        if (pending) {
          pendingResize = null;
          pending.resolve({
            applied: msg.applied === true,
            width: typeof msg.width === 'number' ? msg.width : undefined,
            height: typeof msg.height === 'number' ? msg.height : undefined,
            message: typeof msg.message === 'string' ? msg.message : undefined,
            errorCode: typeof msg.errorCode === 'string' ? msg.errorCode : undefined,
          });
        }
        return;
      }
      if (msg.type === 'session.hello') {
        sessionId = String(msg.sessionId ?? '');
        sessionToken = String((msg as { sessionToken?: string }).sessionToken ?? '');
        assetBaseUrl = window.location.origin;
        logActivity(`session.hello ${sessionId}`);
        refreshStatus();
        return;
      }
      if (msg.type === 'session.booted') {
        clearCrashOverlay();
        sessionLive = true;
        sessionId = String(msg.sessionId ?? sessionId ?? '');
        phase = 'live';
        browseSnapCount = 0;
        $('streamSnaps').textContent = '0';
        logActivity(`booted mode=${msg.mode} dossier=${msg.dossierDir}`);
        logActivity('click diag: __speculumLabDumpInputClick() in devtools after pointer click');
        startViewportSync();
        if (msg.mode === 'browse') startAutoSnap();
        syncButtons();
        return;
      }
      if (msg.type === 'session.stopped') {
        sessionLive = false;
        stopAutoSnap();
        snapInFlight = false;
        disposeViewportSync();
        const reason = typeof msg.reason === 'string' ? msg.reason : '';
        if (reason.startsWith('crash:') && phase !== 'fault') {
          phase = 'fault';
          showCrashOverlay(reason.slice('crash:'.length) || reason);
        }
        if (!runInFlight && phase !== 'complete' && phase !== 'fault') phase = 'connected';
        logActivity(`stopped ${msg.reason}${msg.dossierDir ? ` ${msg.dossierDir}` : ''}`);
        syncButtons();
        return;
      }
      if (msg.type === 'widget.diag') {
        const diagnostic = msg.diagnostic as Record<string, unknown>;
        console.log('[widget-parity-diag]', diagnostic);
        widgetParityInFlight = false;
        const verdict = diagnostic.verdict as string | undefined;
        const hypothesis = diagnostic.hypothesis as string[] | undefined;
        logActivity(
          `widget.diag verdict=${verdict ?? '?'} ${(hypothesis ?? []).slice(0, 2).join(' | ') || ''}`,
        );
        syncButtons();
        return;
      }
      if (msg.type === 'input.diag') {
        const diagnostic = msg.diagnostic as Record<string, unknown>;
        console.log('[input-click-diag]', diagnostic);
        const intent = diagnostic.lastIntent as Record<string, unknown> | null | undefined;
        const resolve = diagnostic.lastResolve as Record<string, unknown> | null | undefined;
        const capture = diagnostic.projectedCapture as { emittedByType?: Record<string, number> } | null;
        const rejects = diagnostic.sidecarRejects as { total?: number } | null;
        logActivity(
          `input.diag ctx=${intent?.contextId ?? '?'} node=${intent?.nodeId ?? '?'} ` +
            `xy=${resolve?.ok === true ? `${resolve.x},${resolve.y}` : resolve?.reason ?? '—'} ` +
            `efp=${String(diagnostic.rootElementFromPoint ?? 'null')} ` +
            `emit=${JSON.stringify(capture?.emittedByType ?? {})} rejects=${rejects?.total ?? 0}`,
        );
        return;
      }
      if (msg.type === 'debug.probe') {
        if (msg.payload && typeof msg.payload === 'object') {
          renderDebugProbe(msg.payload as Record<string, unknown>);
        }
        return;
      }
      if (msg.type === 'session.fault') {
        phase = 'fault';
        const code = typeof msg.errorCode === 'string' ? msg.errorCode : '';
        const detail = `${code ? `${code}: ` : ''}${msg.message}`;
        setChip('chipPhase', `fault ${detail}`, 'danger');
        logActivity(`fault ${detail}`);
        if (typeof msg.dossierDir === 'string' && msg.dossierDir) {
          logActivity(`fault dossier ${msg.dossierDir}`);
        }
        showCrashOverlay(detail);
        if (msg.errorCode || msg.message) {
          renderDebugProbe({
            crash: {
              errorCode: msg.errorCode,
              message: msg.message,
              phase: msg.phase,
              dossierDir: msg.dossierDir,
            },
          });
        }
        sessionLive = false;
        runInFlight = false;
        stopAutoSnap();
        snapInFlight = false;
        syncButtons();
        return;
      }
      if (msg.type === 'console') {
        const level = typeof msg.level === 'number' ? msg.level : 1;
        const text = typeof msg.text === 'string' ? msg.text : String(msg.text ?? '');
        logConsole(level, text);
        if (level >= 3) logActivity(`console error ${text.slice(0, 120)}`);
        return;
      }
      if (msg.type === 'snap.stored') {
        snapInFlight = false;
        browseSnapCount =
          typeof msg.snapCount === 'number' ? msg.snapCount : browseSnapCount + 1;
        $('streamSnaps').textContent = String(browseSnapCount);
        const pass = msg.allPass === true ? 'pass' : 'fail';
        logActivity(
          `snap stored ${msg.id}${msg.label ? ` (${msg.label})` : ''} seq=${msg.sequence ?? '—'} ${pass} (n=${browseSnapCount})`,
        );
        syncButtons();
        return;
      }
      if (msg.type === 'validate.result') {
        const verdict = msg.allPass === true ? 'pass' : 'fail';
        logActivity(
          `validate ${verdict} snaps=${msg.snapCount} pass=${msg.pass} fail=${msg.fail} skipped=${msg.skipped}`,
        );
        setChip(
          'chipPhase',
          msg.allPass === true ? `iso pass (${msg.snapCount})` : `iso fail (${msg.fail})`,
          msg.allPass === true ? 'ok' : 'danger',
        );
        return;
      }
      if (msg.type === 'run.progress') {
        appendProgress(msg);
        return;
      }
      if (msg.type === 'run.complete') {
        runInFlight = false;
        sessionLive = false;
        phase = 'complete';
        const s = msg.verdictsSummary as { pass: number; fail: number; skipped: number };
        renderVerdictSummary(s);
        $('runDossier').textContent = String(msg.dossierDir ?? '');
        $('progressHint').textContent =
          s.fail > 0 ? `Run finished with ${s.fail} fail(s).` : 'Run finished — no fails in summary.';
        logActivity(`run.complete fail=${s.fail} ${msg.dossierDir}`);
        setChip(
          'chipPhase',
          s.fail > 0 ? `complete fail=${s.fail}` : `complete pass=${s.pass}`,
          s.fail > 0 ? 'danger' : 'ok',
        );
        syncButtons();
        return;
      }
      if (msg.type === 'error') {
        logActivity(`error ${msg.message}`);
        if (msg.code === 'snapshot_failed' || msg.code === 'validate_failed') {
          snapInFlight = false;
          syncButtons();
          return;
        }
        if (msg.code === 'widget_parity_failed') {
          widgetParityInFlight = false;
          syncButtons();
          return;
        }
        if (
          msg.code === 'input_dispatch_failed'
          || msg.code === 'input_unavailable'
          || msg.code === 'input_dropped'
        ) {
          return;
        }
        phase = 'fault';
        setChip('chipPhase', String(msg.message), 'danger');
        runInFlight = false;
        syncButtons();
      }
    });
  }

  $('connect').addEventListener('click', () => connect());
  $('disconnect').addEventListener('click', () => {
    ws?.close();
    ws = null;
  });
  fixtureSelect.addEventListener('change', () => {
    if (mode !== 'browse') return;
    urlInput.value = `${location.origin}/fixtures/${fixtureSelect.value}`;
  });
  blueprintSelect.addEventListener('change', () => {
    if (mode === 'run') syncRunTarget();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => showMode((btn.dataset.mode as 'browse' | 'run') ?? 'browse'));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab ?? 'Stream'));
  });
  $('clearActivity').addEventListener('click', () => {
    $('activity').innerHTML = '';
  });
  $('clearConsole').addEventListener('click', () => {
    $('consoleLog').innerHTML = '';
  });
  (document.getElementById('autoSnap') as HTMLInputElement | null)?.addEventListener('change', () => {
    if (sessionLive) startAutoSnap();
    else stopAutoSnap();
  });
  (document.getElementById('autoSnapIntervalMs') as HTMLInputElement | null)?.addEventListener(
    'change',
    () => {
      if (sessionLive) startAutoSnap();
    },
  );

  $('browseStart').addEventListener('click', () => {
    // Measure first — never construct the projected stage at the 1280×720 default
    // and then leave it stale when Virtual boots at the real host size.
    clearCrashOverlay();
    disposeViewportSync();
    canonicalViewport = measureAndNormalizeViewport();
    bootDeviceProfile = detectViewportDeviceProfile();
    void (async () => {
      const p = await ensureProjection();
      await p.resetSurface();
      p.client.setCssSize(canonicalViewport.width, canonicalViewport.height);
      resetStreamCounters();
      logActivity(
        `browse.start viewport ${canonicalViewport.width}×${canonicalViewport.height}`,
      );
      ws?.send(
        JSON.stringify({
          type: 'browse.start',
          url: urlInput.value,
          width: canonicalViewport.width,
          height: canonicalViewport.height,
          device: bootDeviceProfile,
          frameRateHz: Number((document.getElementById('frameRateHz') as HTMLInputElement)?.value) || 60,
          telemetry: readTelemetryFromUi(),
          cpuProfiling: (document.getElementById('browseCpu') as HTMLInputElement)?.checked === true,
        }),
      );
    })();
  });
  $('browseNavigate').addEventListener('click', () => {
    if (!sessionLive) return;
    ws?.send(JSON.stringify({ type: 'browse.navigate', url: urlInput.value }));
    logActivity(`navigate ${urlInput.value}`);
  });
  $('browseSnap').addEventListener('click', () => {
    requestBrowseSnap('manual');
  });
  $('browseWidgetParity').addEventListener('click', () => {
    sendWidgetParityDiag();
  });
  $('browseValidate').addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || browseSnapCount < 1) return;
    logActivity(`validate snaps… (n=${browseSnapCount})`);
    ws.send(JSON.stringify({ type: 'client.validateSnaps' }));
  });
  $('browseStop').addEventListener('click', () => {
    stopAutoSnap();
    snapInFlight = false;
    syncButtons();
    logActivity('browse.stop…');
    ws?.send(
      JSON.stringify({
        type: 'browse.stop',
        exportDossier: true,
        inputCapture: inputCaptureMetrics.snapshot(),
      }),
    );
  });
  $('clearSurface').addEventListener('click', () => {
    clearCrashOverlay();
    disposeViewportSync();
    if (projection) {
      void projection.resetSurface();
    } else {
      surfaceHost.innerHTML = '';
    }
    setSurfaceEmpty(true);
    resetStreamCounters();
    ws?.send(JSON.stringify({ type: 'surface.clear' }));
  });
  $('runStart').addEventListener('click', () => {
    clearCrashOverlay();
    void (async () => {
      const p = await ensureProjection();
      await p.resetSurface();
      runInFlight = true;
      sessionLive = false;
      phase = 'running';
      $('runTimeline').innerHTML = '';
      $('runVerdicts').innerHTML = '';
      $('runDossier').textContent = '';
      $('progressHint').textContent = 'Run in flight…';
      showTab('Progress');
      resetStreamCounters();
      syncButtons();
      const bp = selectedBlueprint();
      const overrides: Record<string, unknown> = {
        telemetry: readTelemetryFromUi(),
      };
      if (bp?.acceptsSoakOverrides) {
        overrides.durationMs = Number((document.getElementById('runDurationMs') as HTMLInputElement)?.value) || 15000;
        overrides.cpu = (document.getElementById('runCpu') as HTMLInputElement)?.checked === true;
        overrides.iso = (document.getElementById('runIso') as HTMLInputElement)?.checked === true;
      }
      ws?.send(
        JSON.stringify({
          type: 'run.start',
          blueprintId: blueprintSelect.value || 'soak',
          overrides,
        }),
      );
    })();
  });
  window.addEventListener('resize', measureHeader);
  $('enterFullscreen').addEventListener('click', () => {
    void enterLabFullscreen();
  });
  $('exitFullscreen').addEventListener('click', () => {
    void exitLabFullscreen();
  });
  document.addEventListener('fullscreenchange', () => {
    if (labFullscreen && document.fullscreenElement !== document.documentElement) {
      labFullscreen = false;
      syncFullscreenUi();
    }
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && labFullscreen) void exitLabFullscreen();
  });

  void Promise.all([loadFixtures(), loadBlueprints()]).then(() => {
    showMode('browse');
    measureHeader();
  });
  showTab('Stream');
  refreshStatus();
  syncButtons();
  (window as unknown as { __labBootOk?: number }).__labBootOk = Date.now();
}

bootLabClient();
