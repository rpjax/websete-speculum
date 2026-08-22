/**
 * Lab client — Browse + Run (protocol v1).
 */

import { LabProjectedHarness } from './LabProjectedHarness';
import { attachProjectedInputCapture } from '@speculum/page-projection/projected/input/projectedInputCapture';
import type { PageProjectionIntentV2 } from '@speculum/page-projection/core/input/intentTypes';
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
  const VIEWPORT = { width: 1280, height: 720 };

  function sendInputIntent(intent: PageProjectionIntentV2): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'client.intent', intent }));
    }
  }

  function bindInputSurfaces(client: LabProjectedHarness): void {
    for (const detach of inputDetachers.values()) detach();
    inputDetachers.clear();

    // Capture must bind inside the projected document. Listeners on the host
    // <iframe> never see pointer/keyboard events that fire in contentDocument.
    // Do not use `instanceof HTMLElement` — iframe realm makes it always false.
    const rootSurface = client.document.documentElement;
    if (rootSurface && rootSurface.nodeType === 1) {
      const detach = attachProjectedInputCapture(rootSurface, client.getLiveRegistry(), sendInputIntent, {
        contextId: CONTEXT_ID_ROOT,
        getGeneration: () => client.getGeneration(),
        getViewportSize: () => VIEWPORT,
        isArmed: () => client.isArmed,
        onMarkPropDirty: (id) => client.markPropDirty(id),
      });
      inputDetachers.set(CONTEXT_ID_ROOT, detach);
    }

    client.forEachNestedInputSurface((info) => {
      const nestedDoc = info.surface.contentDocument;
      const nestedSurface = nestedDoc?.documentElement;
      if (!nestedSurface || nestedSurface.nodeType !== 1) return;
      const detach = attachProjectedInputCapture(nestedSurface, info.registry, sendInputIntent, {
        contextId: info.contextId,
        getGeneration: info.getGeneration,
        getViewportSize: () => {
          const win = nestedDoc?.defaultView;
          const w = win?.innerWidth ?? 0;
          const h = win?.innerHeight ?? 0;
          return w > 0 && h > 0 ? { width: w, height: h } : VIEWPORT;
        },
        isArmed: info.isArmed,
        onMarkPropDirty: info.markPropDirty,
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
  const byContext = new Map<number, ContextStreamStats>();

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

  function measureHeader(): void {
    const h = $('labHeader').getBoundingClientRect().height;
    document.documentElement.style.setProperty('--hdr-h', `${Math.ceil(h)}px`);
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
      if (fixtureSelect.value) {
        urlInput.value = `${location.origin}/fixtures/${fixtureSelect.value}`;
      }
    } else {
      modeBlurb.textContent = 'Cold blueprint DAG — URL is locked to the blueprint; soak may override duration/probes.';
      syncRunTarget();
    }
    syncButtons();
  }

  function showTab(name: string): void {
    $('panelStream').hidden = name !== 'Stream';
    $('panelActivity').hidden = name !== 'Activity';
    $('panelConfig').hidden = name !== 'Config';
    $('panelProgress').hidden = name !== 'Progress';
    document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      const on = btn.dataset.tab === name;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
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

    const tbody = $('streamContextBody');
    tbody.replaceChildren();
    const ids = [...byContext.keys()].sort((a, b) => a - b);
    if (ids.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 11;
      td.className = 'stream-empty';
      td.textContent = 'No context traffic yet';
      tr.append(td);
      tbody.append(tr);
      return;
    }
    for (const id of ids) {
      const s = byContext.get(id)!;
      const tr = document.createElement('tr');
      if (id === CONTEXT_ID_ROOT) tr.className = 'stream-root';
      const cells = [
        String(id),
        String(s.wireFrames),
        String(s.emitted),
        String(s.applyOk),
        s.applyFail > 0 ? String(s.applyFail) : '—',
        String(s.desync),
        String(s.resync),
        s.overrun > 0 ? String(s.overrun) : '—',
        s.lastSequence !== null ? String(s.lastSequence) : '—',
        s.lastBuildMs !== null ? s.lastBuildMs.toFixed(1) : '—',
        s.lastApplyMs !== null ? s.lastApplyMs.toFixed(1) : '—',
      ];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      tbody.append(tr);
    }
  }

  function resetStreamCounters(): void {
    byContext.clear();
    opsTotal = 0;
    $('streamGen').textContent = '—';
    $('streamApplyMs').textContent = '—';
    $('streamOps').textContent = '—';
    updateStream();
  }

  function ensureProjection(): LabProjectedHarness {
    if (projection) return projection;
    projection = new LabProjectedHarness({
      surfaceHost,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      onArmed: () => {
        bindInputSurfaces(projection!);
      },
      onTelemetry: (msg) => {
        observeStreamTelemetry(msg);
        const m = msg as { kind?: string; contextId?: number; opCount?: number; ok?: boolean; errorCode?: string };
        const ctxId = typeof m.contextId === 'number' ? m.contextId : CONTEXT_ID_ROOT;
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
      if (mode === 'browse') urlInput.value = `${location.origin}/fixtures/demo.html`;
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
      ws = null;
      sessionLive = false;
      runInFlight = false;
      syncButtons();
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') {
        const p = ensureProjection();
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        const hdr = peekFrameHeader(bytes);
        const ctxId = hdr && hdr.contextId >= 1 ? hdr.contextId : CONTEXT_ID_ROOT;
        ctxStats(ctxId).wireFrames += 1;
        p.ingest(bytes);
        updateStream();
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
        const p = ensureProjection();
        const ctx = p.snapshotContext(contextId);
        const doc = contextId === 1 ? p.document : p.nestedDocument(contextId);
        const tree = doc ? snapshotTree(doc) : null;
        const cascade = doc ? probeCssomPaintBoundary(doc) : null;
        const formProps = doc ? snapshotFormControls(doc) : null;
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
          }),
        );
        return;
      }
      if (msg.type === 'lab.injectFrame') {
        const p = ensureProjection();
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
        return;
      }
      if (msg.type === 'lab.tamper') {
        const p = ensureProjection();
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
        return;
      }
      if (msg.type === 'session.hello') {
        sessionId = String(msg.sessionId ?? '');
        logActivity(`session.hello ${sessionId}`);
        refreshStatus();
        return;
      }
      if (msg.type === 'session.booted') {
        sessionLive = true;
        sessionId = String(msg.sessionId ?? sessionId ?? '');
        phase = 'live';
        logActivity(`booted mode=${msg.mode} dossier=${msg.dossierDir}`);
        syncButtons();
        return;
      }
      if (msg.type === 'session.stopped') {
        sessionLive = false;
        if (!runInFlight && phase !== 'complete' && phase !== 'fault') phase = 'connected';
        logActivity(`stopped ${msg.reason}`);
        syncButtons();
        return;
      }
      if (msg.type === 'session.fault') {
        phase = 'fault';
        setChip('chipPhase', `fault ${msg.message}`, 'danger');
        logActivity(`fault ${msg.message}`);
        sessionLive = false;
        runInFlight = false;
        syncButtons();
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

  $('browseStart').addEventListener('click', () => {
    const p = ensureProjection();
    p.resetSurface();
    resetStreamCounters();
    ws?.send(
      JSON.stringify({
        type: 'browse.start',
        url: urlInput.value,
        frameRateHz: Number((document.getElementById('frameRateHz') as HTMLInputElement)?.value) || 60,
        telemetry: readTelemetryFromUi(),
      }),
    );
  });
  $('browseNavigate').addEventListener('click', () => {
    if (!sessionLive) return;
    ws?.send(JSON.stringify({ type: 'browse.navigate', url: urlInput.value }));
    logActivity(`navigate ${urlInput.value}`);
  });
  $('browseStop').addEventListener('click', () => {
    ws?.send(JSON.stringify({ type: 'browse.stop', exportDossier: true }));
  });
  $('clearSurface').addEventListener('click', () => {
    if (projection) {
      projection.resetSurface();
    } else {
      surfaceHost.innerHTML = '';
    }
    setSurfaceEmpty(true);
    resetStreamCounters();
    ws?.send(JSON.stringify({ type: 'surface.clear' }));
  });
  $('runStart').addEventListener('click', () => {
    const p = ensureProjection();
    p.resetSurface();
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
  });

  window.addEventListener('resize', measureHeader);

  void Promise.all([loadFixtures(), loadBlueprints()]).then(() => {
    showMode('browse');
    measureHeader();
  });
  showTab('Stream');
  refreshStatus();
  syncButtons();
}

bootLabClient();
