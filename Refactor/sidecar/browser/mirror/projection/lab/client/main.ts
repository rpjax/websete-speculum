/**
 * Lab client — Stream / Activity / Config + DOM projection apply.
 */

import { LabProjectionClient } from '../../client/labProjectionClient';

type TelMsg = { kind?: string; [k: string]: unknown };

type ControlMessage = {
  type: string;
  sessionId?: string;
  url?: string;
  message?: string | TelMsg;
  frames?: number;
  bytes?: number;
  generation?: number | null;
  sequence?: number | null;
  dataPlaneUrl?: string;
  telemetryMessages?: number;
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

function logActivity(text: string, kind = 'info'): void {
  const log = $('activity');
  const line = document.createElement('div');
  line.dataset.kind = kind;
  line.textContent = `${new Date().toISOString().slice(11, 23)} ${text}`;
  log.prepend(line);
  while (log.childElementCount > 400) log.lastChild?.remove();
}

function setStatus(text: string): void {
  $('status').textContent = text;
}

function defaultFixtureUrl(): string {
  return `${location.origin}/fixtures/demo.html`;
}

function readConfigFromUi(): Record<string, unknown> {
  return {
    enabled: ($('telEnabled') as HTMLInputElement).checked,
    frameEmitted: ($('telFrameEmitted') as HTMLInputElement).checked,
    transportDeferred: ($('telDeferred') as HTMLInputElement).checked,
    aggregate: ($('telAggregate') as HTMLInputElement).checked,
    establish: ($('telEstablish') as HTMLInputElement).checked,
    builderStats: ($('telBuilder') as HTMLInputElement).checked,
    applyResult: ($('telApply') as HTMLInputElement).checked,
    desync: ($('telDesync') as HTMLInputElement).checked,
    applyOverrun: ($('telOverrun') as HTMLInputElement).checked,
    clock: ($('telClock') as HTMLInputElement).checked,
    handoff: ($('telHandoff') as HTMLInputElement).checked,
    frameDecision: ($('telDecision') as HTMLInputElement).checked,
    parityFingerprint: ($('telParity') as HTMLInputElement).checked,
    encoder: ($('telEncoder') as HTMLInputElement).checked,
    aggregateIntervalMs: Number(($('telAggMs') as HTMLInputElement).value) || 2000,
  };
}

function clientKindEnabled(kind: string): boolean {
  if (kind === 'desynced') return ($('telDesync') as HTMLInputElement).checked;
  if (kind === 'applyOverrun') return ($('telOverrun') as HTMLInputElement).checked;
  if (kind === 'parityFingerprint') return ($('telParity') as HTMLInputElement).checked;
  if (kind === 'applyDecision') return ($('telDecision') as HTMLInputElement).checked;
  if (kind === 'applyResult') return ($('telApply') as HTMLInputElement).checked;
  return true;
}

export function bootLabClient(): void {
  const urlInput = $('url') as HTMLInputElement;
  urlInput.value = defaultFixtureUrl();

  let ws: WebSocket | null = null;
  let frames = 0;
  let applyOk = 0;
  let desyncCount = 0;
  let lastSeq = -1;
  let armed = false;

  const metrics = {
    frames: 0,
    establish: '—',
    gen: '—',
    seq: '—',
    applyOk: 0,
  };

  const projection = new LabProjectionClient({
    surfaceHost: $('surfaceHost'),
    onArmed: () => {
      armed = true;
      metrics.establish = 'armed';
      $('streamEstablish').textContent = 'armed';
      setStatus('armed — live apply');
      logActivity('surface armed', 'applyResult');
    },
    onDesync: (reason) => {
      armed = false;
      desyncCount += 1;
      $('streamDesync').textContent = String(desyncCount);
      setStatus(`desync: ${reason}`);
      logActivity(`desync ${reason}`, 'desynced');
    },
    onTelemetry: (msg) => {
      const kind = String(msg.kind ?? 'applyResult');
      const send = clientKindEnabled(kind);
      if (kind === 'desynced' || msg.ok === false) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'clientTelemetry', message: msg }));
        }
      } else if (send && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clientTelemetry', message: msg }));
      }
      if (msg.ok === true) applyOk += 1;
      metrics.applyOk = applyOk;
      $('streamApply').textContent = String(applyOk);
      if (kind === 'parityFingerprint') {
        $('streamDupH1').textContent = msg.duplicateH1 === true ? 'YES' : 'no';
      }
      if (kind === 'applyDecision' && typeof msg.appendOntoNonEmptyCount === 'number') {
        $('streamAppendEmpty').textContent = String(msg.appendOntoNonEmptyCount);
      }
      if (kind === 'frameDecision' && typeof msg.appendFromEmptyCount === 'number') {
        $('streamAppendEmpty').textContent = String(msg.appendFromEmptyCount);
      }
      logActivity(
        `${kind} ok=${String(msg.ok ?? '-')} seq=${String(msg.sequence ?? '-')} ${msg.reason ? msg.reason : ''}${msg.duplicateH1 === true ? ' DUP_H1' : ''}${typeof msg.appendFromEmptyCount === 'number' ? ` append∅=${msg.appendFromEmptyCount}` : ''}${typeof msg.appendOntoNonEmptyCount === 'number' ? ` onto=${msg.appendOntoNonEmptyCount}` : ''}`,
        kind,
      );
    },
  });

  const connectBtn = $('connect') as HTMLButtonElement;
  const startBtn = $('start') as HTMLButtonElement;
  const stopBtn = $('stop') as HTMLButtonElement;

  function setConnected(on: boolean): void {
    connectBtn.disabled = on;
    startBtn.disabled = !on;
    stopBtn.disabled = !on;
  }

  function showTab(name: string): void {
    for (const id of ['panelStream', 'panelActivity', 'panelConfig']) {
      $(id).hidden = id !== `panel${name}`;
    }
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      btn.classList.toggle('active', btn.dataset.tab === name);
    }
  }

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    btn.addEventListener('click', () => showTab(btn.dataset.tab ?? 'Stream'));
  }
  showTab('Stream');

  connectBtn.addEventListener('click', () => {
    if (ws !== null) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/lab/session`);
    ws.binaryType = 'arraybuffer';
    setStatus('connecting…');
    ws.addEventListener('open', () => {
      setConnected(true);
      setStatus('connected — press Start');
      logActivity('session WS open');
    });
    ws.addEventListener('close', () => {
      ws = null;
      setConnected(false);
      setStatus('disconnected');
      logActivity('session WS closed');
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') {
        frames += 1;
        metrics.frames = frames;
        $('streamFrames').textContent = String(frames);
        projection.ingest(new Uint8Array(ev.data as ArrayBuffer));
        return;
      }
      let msg: ControlMessage;
      try {
        msg = JSON.parse(ev.data) as ControlMessage;
      } catch {
        logActivity(`bad control: ${ev.data.slice(0, 80)}`);
        return;
      }
      if (msg.type === 'hello') {
        logActivity(`hello session=${msg.sessionId ?? '?'}`);
        return;
      }
      if (msg.type === 'ready') {
        setStatus(`Virtual ready — ${msg.url ?? ''}`);
        logActivity(`ready dataPlane=${msg.dataPlaneUrl ?? ''}`);
        return;
      }
      if (msg.type === 'stats') {
        $('hostStats').textContent =
          `host frames=${msg.frames ?? 0} bytes=${msg.bytes ?? 0} gen=${msg.generation ?? '-'} seq=${msg.sequence ?? '-'} tel=${msg.telemetryMessages ?? 0}`;
        if (msg.sequence != null) {
          lastSeq = msg.sequence;
          metrics.seq = String(msg.sequence);
          $('streamSeq').textContent = String(msg.sequence);
        }
        if (msg.generation != null) {
          metrics.gen = String(msg.generation);
          $('streamGen').textContent = String(msg.generation);
        }
        return;
      }
      if (msg.type === 'telemetry') {
        const tel = msg.message as TelMsg | undefined;
        const kind = tel?.kind ?? '?';
        logActivity(`telemetry ${kind} ${JSON.stringify(tel).slice(0, 120)}`, kind);
        if (kind === 'establishCompleted') {
          if (!armed) {
            metrics.establish = 'completed';
            $('streamEstablish').textContent = 'completed';
          }
        }
        if (kind === 'frameEmitted' && tel?.sequence != null) {
          $('streamSeq').textContent = String(tel.sequence);
        }
        if (kind === 'frameDecision' && tel?.appendFromEmptyCount != null) {
          $('streamAppendEmpty').textContent = String(tel.appendFromEmptyCount);
        }
        if (kind === 'parityFingerprint') {
          $('streamDupH1').textContent = tel?.duplicateH1 === true ? 'YES' : 'no';
        }
        return;
      }
      if (msg.type === 'error') {
        setStatus(`error: ${typeof msg.message === 'string' ? msg.message : '?'}`);
        logActivity(`error ${typeof msg.message === 'string' ? msg.message : '?'}`);
        return;
      }
      logActivity(`control ${msg.type}`);
    });
  });

  startBtn.addEventListener('click', () => {
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    frames = 0;
    applyOk = 0;
    desyncCount = 0;
    armed = false;
    $('streamDesync').textContent = '0';
    $('streamAppendEmpty').textContent = '0';
    $('streamDupH1').textContent = '—';
    ws.send(
      JSON.stringify({
        type: 'start',
        url: urlInput.value.trim(),
        telemetry: readConfigFromUi(),
        frameRateHz: Number(($('cfgFrameRate') as HTMLInputElement).value) || 60,
      }),
    );
    setStatus('starting Virtual…');
  });

  stopBtn.addEventListener('click', () => {
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'stop' }));
  });

  setConnected(false);
  setStatus('idle');
  void armed;
  void lastSeq;
}

bootLabClient();
