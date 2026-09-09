/**
 * Lab Runs panel — browse dossiers, deep-dive run inspection.
 */

export type RunVerdictSummary = {
  pass: number;
  fail: number;
  skipped: number;
};

export type RunSummary = {
  id: string;
  dir: string;
  createdAt: string;
  mode: 'browse' | 'run';
  status: string;
  blueprintId: string | null;
  url: string | null;
  wallMs: number | null;
  headed: boolean;
  verdicts: RunVerdictSummary;
  exitCode: number;
};

export type LabVerdict = {
  id: string;
  status: 'pass' | 'fail' | 'skipped';
  reason: string;
};

export type TimelineEntry = {
  actionId: string;
  queue: string;
  startedAt: string;
  endedAt: string;
  status: string;
  detail?: string;
};

export type ActEntry = {
  name: string;
  ok: boolean;
  error?: string;
};

export type ManifestEntry = {
  kind: string;
  path: string;
  bytes?: number;
  contentType?: string;
};

export type LabRunDetail = {
  id: string;
  dir: string;
  session: Record<string, unknown>;
  meta: Record<string, unknown> | null;
  verdicts: LabVerdict[];
  manifest: { artifacts?: ManifestEntry[] } | null;
  timeline: TimelineEntry[];
  acts: ActEntry[];
  blueprint: Record<string, unknown> | null;
  probes: {
    metrics: Record<string, unknown> | null;
    inputPipeline: Record<string, unknown> | null;
    iso: Record<string, unknown> | null;
    isoBrowse: Record<string, unknown> | null;
  };
  crash: Record<string, unknown> | null;
  telemetryCounts: Record<string, unknown> | null;
};

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type RunsPanelOptions = {
  fetch: FetchFn;
  onActivity?: (text: string) => void;
};

type DetailSection = 'overview' | 'timeline' | 'verdicts' | 'acts' | 'artifacts' | 'probes' | 'raw';

const DETAIL_SECTIONS: Array<{ id: DetailSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'verdicts', label: 'Verdicts' },
  { id: 'acts', label: 'Acts' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'probes', label: 'Probes' },
  { id: 'raw', label: 'Raw' },
];

function fmtTs(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtBytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function durationMs(start: string, end: string): number | null {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function metric(label: string, value: string, tone?: string): HTMLElement {
  const box = el('div', `runs-metric${tone ? ` runs-metric--${tone}` : ''}`);
  box.append(el('div', 'runs-metric__label', label), el('div', 'runs-metric__value', value));
  return box;
}

function verdictTone(status: string): string {
  if (status === 'pass') return 'pass';
  if (status === 'fail') return 'fail';
  return 'skipped';
}

function runCardTone(run: RunSummary): string {
  if (run.verdicts.fail > 0 || run.status === 'faulted') return 'fail';
  if (run.verdicts.pass > 0 && run.verdicts.fail === 0) return 'pass';
  return 'neutral';
}

function truncateText(raw: string, max = 56): string {
  if (!raw) return '—';
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

function truncateUrl(raw: string | null, max = 48): string {
  if (!raw) return '—';
  try {
    const u = new URL(raw);
    const compact = `${u.host}${u.pathname}`;
    return truncateText(compact, max);
  } catch {
    return truncateText(raw, max);
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function extractRunIdFromDossierPath(path: string): string | null {
  const norm = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = norm.split('/');
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : null;
}

export function createRunsPanel(opts: RunsPanelOptions): {
  refresh: () => Promise<void>;
  selectByDossierDir: (dossierDir: string) => Promise<void>;
  mount: () => void;
} {
  const root = document.getElementById('runsPanelRoot');
  if (!root) throw new Error('runsPanelRoot missing');

  let runs: RunSummary[] = [];
  let selectedId: string | null = null;
  let detail: LabRunDetail | null = null;
  let filter: 'all' | 'pass' | 'fail' | 'browse' | 'run' = 'all';
  let search = '';
  let detailSection: DetailSection = 'overview';
  let loading = false;
  const selectedIds = new Set<string>();

  const listEl = document.getElementById('runsList')!;
  const detailHeaderEl = document.getElementById('runsDetailHeader')!;
  const detailBodyEl = document.getElementById('runsDetailBody')!;
  const searchInput = document.getElementById('runsSearch') as HTMLInputElement;
  const filterBar = document.getElementById('runsFilters')!;
  const statsEl = document.getElementById('runsStats');
  const selectAllInput = document.getElementById('runsSelectAll') as HTMLInputElement | null;
  const deleteSelectedBtn = document.getElementById('runsDeleteSelected') as HTMLButtonElement | null;

  function setLoading(on: boolean): void {
    loading = on;
    root.classList.toggle('runs-panel--loading', on);
  }

  function filteredRuns(): RunSummary[] {
    const q = search.trim().toLowerCase();
    return runs.filter((r) => {
      if (filter === 'pass' && (r.verdicts.fail > 0 || r.exitCode !== 0)) return false;
      if (filter === 'fail' && r.verdicts.fail === 0 && r.status !== 'faulted') return false;
      if (filter === 'browse' && r.mode !== 'browse') return false;
      if (filter === 'run' && r.mode !== 'run') return false;
      if (!q) return true;
      const hay = [
        r.id,
        r.blueprintId ?? '',
        r.url ?? '',
        r.status,
        r.mode,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function renderStats(): void {
    if (!statsEl) return;
    const visible = filteredRuns();
    const pass = visible.filter((r) => r.verdicts.fail === 0 && r.exitCode === 0 && r.verdicts.pass > 0).length;
    const fail = visible.filter((r) => r.verdicts.fail > 0 || r.status === 'faulted' || r.exitCode !== 0).length;
    statsEl.textContent =
      visible.length === runs.length
        ? `${runs.length} runs · ${pass} pass · ${fail} fail`
        : `${visible.length}/${runs.length} shown · ${pass} pass · ${fail} fail`;
  }

  function syncBulkUi(): void {
    const visible = filteredRuns();
    const visibleIds = visible.map((r) => r.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    const someSelected = visibleIds.some((id) => selectedIds.has(id));
    if (selectAllInput) {
      selectAllInput.checked = allSelected;
      selectAllInput.indeterminate = someSelected && !allSelected;
    }
    if (deleteSelectedBtn) {
      deleteSelectedBtn.disabled = selectedIds.size === 0 || loading;
      deleteSelectedBtn.textContent =
        selectedIds.size > 0 ? `Delete (${selectedIds.size})` : 'Delete selected';
    }
  }

  async function deleteRuns(ids: readonly string[], label: string): Promise<void> {
    if (ids.length === 0) return;
    const msg =
      ids.length === 1
        ? `Delete dossier "${ids[0]}"? This removes the folder from disk.`
        : `Delete ${ids.length} dossiers (${label})? This cannot be undone.`;
    if (!window.confirm(msg)) return;

    setLoading(true);
    try {
      const res = await opts.fetch('/lab/runs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { deleted?: string[]; failed?: string[] };
      const deleted = body.deleted ?? [];
      for (const id of deleted) selectedIds.delete(id);
      if (selectedId && deleted.includes(selectedId)) {
        selectedId = null;
        detail = null;
      }
      opts.onActivity?.(`runs deleted ${deleted.length}${body.failed?.length ? ` (${body.failed.length} failed)` : ''}`);
      await refresh();
    } catch (err) {
      opts.onActivity?.(`runs.delete failed ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  function renderFilters(): void {
    filterBar.querySelectorAll<HTMLButtonElement>('[data-runs-filter]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.runsFilter === filter);
    });
  }

  function renderList(): void {
    listEl.replaceChildren();
    const visible = filteredRuns();
    renderStats();
    syncBulkUi();
    if (visible.length === 0) {
      const empty = el('div', 'runs-list-empty', runs.length === 0 ? 'No dossiers yet — start a Browse or Run.' : 'No runs match filter.');
      listEl.append(empty);
      return;
    }
    for (const run of visible) {
      const card = el('div', `runs-card runs-card--${runCardTone(run)}${selectedId === run.id ? ' runs-card--selected' : ''}`);
      card.dataset.runId = run.id;

      const check = el('input') as HTMLInputElement;
      check.type = 'checkbox';
      check.className = 'runs-card__check';
      check.checked = selectedIds.has(run.id);
      check.title = 'Select for bulk delete';
      check.addEventListener('click', (ev) => ev.stopPropagation());
      check.addEventListener('change', () => {
        if (check.checked) selectedIds.add(run.id);
        else selectedIds.delete(run.id);
        syncBulkUi();
        card.classList.toggle('runs-card--checked', check.checked);
      });

      const bodyBtn = el('button', 'runs-card__body');
      bodyBtn.type = 'button';

      const head = el('div', 'runs-card__head');
      const title = el('div', 'runs-card__title', run.blueprintId ?? (run.mode === 'browse' ? 'Browse' : run.id.slice(0, 24)));
      const when = el('div', 'runs-card__when', fmtTs(run.createdAt));
      head.append(title, when);

      const urlLine = el('div', 'runs-card__url', truncateUrl(run.url));
      urlLine.title = run.url ?? '';

      const meta = el('div', 'runs-card__meta');
      meta.append(
        el('span', `runs-chip runs-chip--mode`, run.mode),
        el('span', `runs-chip runs-chip--${run.status === 'faulted' ? 'fail' : 'status'}`, run.status),
      );
      if (run.verdicts.pass + run.verdicts.fail + run.verdicts.skipped > 0) {
        meta.append(
          el('span', 'runs-chip runs-chip--pass', `✓ ${run.verdicts.pass}`),
          run.verdicts.fail > 0 ? el('span', 'runs-chip runs-chip--fail', `✗ ${run.verdicts.fail}`) : document.createDocumentFragment(),
          run.verdicts.skipped > 0 ? el('span', 'runs-chip runs-chip--skip', `⊘ ${run.verdicts.skipped}`) : document.createDocumentFragment(),
        );
      }
      if (run.wallMs != null) {
        meta.append(el('span', 'runs-chip runs-chip--muted', fmtMs(run.wallMs)));
      }

      bodyBtn.append(head, urlLine, meta);
      bodyBtn.addEventListener('click', () => {
        void selectRun(run.id);
      });

      card.append(check, bodyBtn);
      card.classList.toggle('runs-card--checked', check.checked);
      listEl.append(card);
    }
  }

  function renderDetailNav(): HTMLElement {
    const nav = el('div', 'runs-detail-nav');
    for (const s of DETAIL_SECTIONS) {
      const btn = el('button', `runs-detail-nav__btn${detailSection === s.id ? ' active' : ''}`, s.label);
      btn.type = 'button';
      btn.dataset.runsSection = s.id;
      btn.addEventListener('click', () => {
        detailSection = s.id;
        renderDetail();
      });
      nav.append(btn);
    }
    return nav;
  }

  function renderOverview(d: LabRunDetail): HTMLElement {
    const wrap = el('div', 'runs-section');
    const vSum = d.verdicts.reduce(
      (acc, v) => {
        acc[v.status] += 1;
        return acc;
      },
      { pass: 0, fail: 0, skipped: 0 },
    );

    const hero = el('div', 'runs-hero');
    const exitTone = vSum.fail > 0 || d.crash ? 'fail' : vSum.pass > 0 ? 'pass' : 'neutral';
    hero.append(
      el('div', `runs-hero__badge runs-hero__badge--${exitTone}`, vSum.fail > 0 ? 'FAILED' : vSum.pass > 0 ? 'PASSED' : 'NO VERDICTS'),
      el('div', 'runs-hero__title', String(d.session.blueprintId ?? d.session.mode ?? 'Session')),
      el('div', 'runs-hero__sub', String(d.session.url ?? d.meta?.url ?? '—')),
    );
    wrap.append(hero);

    const grid = el('div', 'runs-metric-grid');
    grid.append(
      metric('Session', String(d.session.sessionId ?? '—').slice(0, 8) + '…'),
      metric('Mode', String(d.session.mode ?? '—')),
      metric('Status', String(d.session.status ?? '—'), String(d.session.status) === 'faulted' ? 'fail' : undefined),
      metric('Wall', fmtMs(typeof d.meta?.wallMs === 'number' ? d.meta.wallMs : null)),
      metric('Frame Hz', String(d.session.frameRateHz ?? d.meta?.frameRateHz ?? '—')),
      metric('Headed', d.session.headed === true ? 'yes' : 'no'),
      metric('Verdicts', `${vSum.pass} / ${vSum.fail} / ${vSum.skipped}`, vSum.fail > 0 ? 'fail' : 'pass'),
      metric('Timeline', String(d.timeline.length)),
      metric('Acts', String(d.acts.length)),
      metric('Artifacts', String(d.manifest?.artifacts?.length ?? 0)),
    );
    wrap.append(grid);

    if (d.session.fault && typeof d.session.fault === 'object') {
      const fault = d.session.fault as { message?: string; at?: string };
      const box = el('div', 'runs-callout runs-callout--fail');
      box.append(
        el('strong', undefined, 'Session fault'),
        el('div', undefined, fault.message ?? 'unknown'),
        el('div', 'runs-callout__meta', fault.at ? fmtTs(fault.at) : ''),
      );
      wrap.append(box);
    }

    if (d.crash) {
      const box = el('div', 'runs-callout runs-callout--fail');
      const pre = el('pre', 'runs-pre');
      pre.textContent = JSON.stringify(d.crash, null, 2);
      box.append(el('strong', undefined, 'Crash'), pre);
      wrap.append(box);
    }

    const pathRow = el('div', 'runs-path-row');
    pathRow.append(el('span', 'runs-path-row__label', 'Dossier'), el('code', 'runs-path-row__path', d.dir));
    wrap.append(pathRow);

    return wrap;
  }

  function renderTimeline(d: LabRunDetail): HTMLElement {
    const wrap = el('div', 'runs-section');
    if (d.timeline.length === 0) {
      wrap.append(el('p', 'runs-hint', 'No timeline entries — browse sessions or runs without blueprint actions.'));
      return wrap;
    }

    const totalMs = d.timeline.reduce((sum, t) => {
      const ms = durationMs(t.startedAt, t.endedAt);
      return sum + (ms ?? 0);
    }, 0);
    const maxMs = Math.max(
      1,
      ...d.timeline.map((t) => durationMs(t.startedAt, t.endedAt) ?? 0),
    );

    const chart = el('div', 'runs-timeline-chart');
    chart.setAttribute('aria-label', 'Action duration chart');
    for (const t of d.timeline) {
      const ms = durationMs(t.startedAt, t.endedAt) ?? 0;
      const bar = el('div', `runs-timeline-bar runs-timeline-bar--${t.status}`);
      bar.style.width = `${Math.max(4, (ms / maxMs) * 100)}%`;
      bar.title = `${t.actionId} · ${t.queue} · ${fmtMs(ms)}`;
      chart.append(bar);
    }
    wrap.append(
      el('div', 'runs-timeline-chart-label', `Action wall total · ${fmtMs(totalMs)}`),
      chart,
    );

    const list = el('div', 'runs-timeline-list');
    for (const t of d.timeline) {
      const ms = durationMs(t.startedAt, t.endedAt);
      const row = el('article', `runs-tl-row runs-tl-row--${t.status}`);
      const head = el('div', 'runs-tl-row__head');
      head.append(
        el('span', 'runs-tl-row__status', t.status),
        el('span', 'runs-tl-row__id', t.actionId),
        el('span', 'runs-tl-row__queue', t.queue),
        el('span', 'runs-tl-row__dur', ms != null ? fmtMs(ms) : '—'),
      );
      row.append(head);
      const sub = el('div', 'runs-tl-row__sub');
      sub.textContent = `${fmtTs(t.startedAt)} → ${fmtTs(t.endedAt)}`;
      row.append(sub);
      if (t.detail) {
        row.append(el('div', 'runs-tl-row__detail', t.detail));
      }
      list.append(row);
    }
    wrap.append(list);
    return wrap;
  }

  function renderVerdicts(d: LabRunDetail): HTMLElement {
    const wrap = el('div', 'runs-section');
    if (d.verdicts.length === 0) {
      wrap.append(el('p', 'runs-hint', 'No verdicts recorded.'));
      return wrap;
    }

    const groups = { pass: [] as LabVerdict[], fail: [] as LabVerdict[], skipped: [] as LabVerdict[] };
    for (const v of d.verdicts) groups[v.status].push(v);

    for (const [status, items] of Object.entries(groups) as Array<[keyof typeof groups, LabVerdict[]]>) {
      if (items.length === 0) continue;
      const section = el('section', `runs-verdict-group runs-verdict-group--${status}`);
      section.append(el('h3', 'runs-verdict-group__title', `${status} (${items.length})`));
      for (const v of items) {
        const card = el('article', `runs-verdict-card runs-verdict-card--${verdictTone(v.status)}`);
        card.append(el('div', 'runs-verdict-card__id', v.id), el('div', 'runs-verdict-card__reason', v.reason || '—'));
        section.append(card);
      }
      wrap.append(section);
    }
    return wrap;
  }

  function renderActs(d: LabRunDetail): HTMLElement {
    const wrap = el('div', 'runs-section');
    if (d.acts.length === 0) {
      wrap.append(el('p', 'runs-hint', 'No journal acts.'));
      return wrap;
    }
    const table = el('div', 'runs-acts-table');
    const head = el('div', 'runs-acts-table__head');
    head.append(el('span', undefined, 'Act'), el('span', undefined, 'Result'), el('span', undefined, 'Error'));
    table.append(head);
    for (const a of d.acts) {
      const row = el('div', `runs-acts-table__row${a.ok ? ' runs-acts-table__row--ok' : ' runs-acts-table__row--fail'}`);
      row.append(
        el('code', 'runs-acts-table__name', a.name),
        el('span', 'runs-acts-table__ok', a.ok ? 'ok' : 'fail'),
        el('span', 'runs-acts-table__err', a.error ?? '—'),
      );
      table.append(row);
    }
    wrap.append(table);
    return wrap;
  }

  function renderArtifacts(d: LabRunDetail): HTMLElement {
    const wrap = el('div', 'runs-section');
    const arts = [...(d.manifest?.artifacts ?? [])].sort((a, b) => a.path.localeCompare(b.path));
    if (arts.length === 0) {
      wrap.append(el('p', 'runs-hint', 'Manifest empty or not finalized.'));
      return wrap;
    }

    const byKind = new Map<string, ManifestEntry[]>();
    for (const a of arts) {
      const k = a.kind || 'other';
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k)!.push(a);
    }

    for (const [kind, items] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const group = el('section', 'runs-artifact-group');
      group.append(el('h3', 'runs-artifact-group__title', `${kind} (${items.length})`));
      const list = el('div', 'runs-artifact-list');
      for (const a of items) {
        const row = el('div', 'runs-artifact-row');
        const link = el('a', 'runs-artifact-row__link') as HTMLAnchorElement;
        link.href = `/lab/runs/${encodeURIComponent(d.id)}/files/${encodeURIComponent(a.path)}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = a.path;
        row.append(link, el('span', 'runs-artifact-row__bytes', fmtBytes(a.bytes)));
        list.append(row);
      }
      group.append(list);
      wrap.append(group);
    }
    return wrap;
  }

  function renderProbes(d: LabRunDetail): HTMLElement {
    const wrap = el('div', 'runs-section runs-probes');
    const blocks: Array<[string, Record<string, unknown> | null]> = [
      ['metrics.json', d.probes.metrics],
      ['input-pipeline.json', d.probes.inputPipeline],
      ['iso.json', d.probes.iso],
      ['iso-browse.json', d.probes.isoBrowse],
      ['telemetry/counts.json', d.telemetryCounts],
    ];
    for (const [label, data] of blocks) {
      const block = el('details', 'runs-probe-block');
      block.open = label === 'input-pipeline.json' && data != null;
      const sum = el('summary', undefined, label);
      block.append(sum);
      if (!data) {
        block.append(el('p', 'runs-hint', 'Not present in dossier.'));
      } else {
        const pre = el('pre', 'runs-pre runs-pre--scroll');
        pre.textContent = JSON.stringify(data, null, 2);
        block.append(pre);
      }
      wrap.append(block);
    }
    return wrap;
  }

  function renderCopyBar(label: string, text: string): HTMLElement {
    const bar = el('div', 'runs-copy-bar');
    bar.append(el('span', 'runs-copy-bar__label', label));
    const btn = el('button', 'runs-copy-bar__btn', 'Copy') as HTMLButtonElement;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      void copyText(text).then((ok) => {
        opts.onActivity?.(ok ? `copied ${label}` : `copy failed ${label}`);
        if (ok) {
          btn.textContent = 'Copied';
          window.setTimeout(() => {
            btn.textContent = 'Copy';
          }, 1200);
        }
      });
    });
    bar.append(btn);
    return bar;
  }

  function renderRaw(d: LabRunDetail): HTMLElement {
    const wrap = el('div', 'runs-section');
    const raw = JSON.stringify(d, null, 2);
    wrap.append(renderCopyBar('JSON', raw));
    const pre = el('pre', 'runs-pre runs-pre--detail');
    pre.textContent = raw;
    wrap.append(pre);
    return wrap;
  }

  function renderDetailBody(d: LabRunDetail): HTMLElement {
    switch (detailSection) {
      case 'overview':
        return renderOverview(d);
      case 'timeline':
        return renderTimeline(d);
      case 'verdicts':
        return renderVerdicts(d);
      case 'acts':
        return renderActs(d);
      case 'artifacts':
        return renderArtifacts(d);
      case 'probes':
        return renderProbes(d);
      case 'raw':
        return renderRaw(d);
      default:
        return renderOverview(d);
    }
  }

  function renderDetailActions(d: LabRunDetail, summary: RunSummary | undefined): HTMLElement {
    const actions = el('div', 'runs-detail-actions');
    const delBtn = el('button', 'runs-detail-actions__btn runs-detail-actions__btn--danger', 'Delete') as HTMLButtonElement;
    delBtn.type = 'button';
    delBtn.addEventListener('click', () => {
      void deleteRuns([d.id], d.id);
    });

    const copyId = el('button', 'runs-detail-actions__btn', 'Copy id') as HTMLButtonElement;
    copyId.type = 'button';
    copyId.addEventListener('click', () => {
      void copyText(d.id).then((ok) => opts.onActivity?.(ok ? 'copied run id' : 'copy failed'));
    });

    const copyPath = el('button', 'runs-detail-actions__btn', 'Copy path') as HTMLButtonElement;
    copyPath.type = 'button';
    copyPath.addEventListener('click', () => {
      void copyText(d.dir).then((ok) => opts.onActivity?.(ok ? 'copied dossier path' : 'copy failed'));
    });

    actions.append(delBtn, copyId, copyPath);

    if (summary?.url) {
      const copyUrl = el('button', 'runs-detail-actions__btn', 'Copy URL') as HTMLButtonElement;
      copyUrl.type = 'button';
      copyUrl.addEventListener('click', () => {
        void copyText(summary.url!).then((ok) => opts.onActivity?.(ok ? 'copied url' : 'copy failed'));
      });
      actions.append(copyUrl);
    }

    return actions;
  }

  function renderDetail(): void {
    detailHeaderEl.replaceChildren();
    detailBodyEl.replaceChildren();
    if (!detail) {
      detailBodyEl.append(
        el('div', 'runs-list-empty', 'Select a run to inspect timeline, verdicts, and artifacts.'),
      );
      return;
    }

    const summary = runs.find((r) => r.id === detail!.id);
    const top = el('div', 'runs-detail-top');
    if (summary) {
      const strip = el('div', 'runs-detail-strip');
      const tone = runCardTone(summary);
      strip.append(
        el('span', `runs-hero__badge runs-hero__badge--${tone === 'fail' ? 'fail' : tone === 'pass' ? 'pass' : 'neutral'}`, tone === 'fail' ? 'FAIL' : tone === 'pass' ? 'PASS' : 'RUN'),
        el('span', `runs-chip runs-chip--mode`, summary.mode),
        el('span', 'runs-chip runs-chip--muted', fmtTs(summary.createdAt)),
        summary.blueprintId ? el('span', 'runs-chip runs-chip--accent', summary.blueprintId) : document.createDocumentFragment(),
      );
      top.append(strip);
      if (summary.url) {
        const urlRow = el('div', 'runs-detail-url', truncateUrl(summary.url, 72));
        urlRow.title = summary.url;
        top.append(urlRow);
      }
    }
    top.append(renderDetailActions(detail, summary));
    detailHeaderEl.append(top, renderDetailNav());

    detailBodyEl.append(renderDetailBody(detail));
  }

  async function selectRun(id: string): Promise<void> {
    selectedId = id;
    renderList();
    setLoading(true);
    try {
      const res = await opts.fetch(`/lab/runs/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      detail = (await res.json()) as LabRunDetail;
      detailSection = detail.verdicts.some((v) => v.status === 'fail') ? 'verdicts' : 'overview';
      renderDetail();
    } catch (err) {
      detail = null;
      renderDetail();
      opts.onActivity?.(`runs.load failed ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      const res = await opts.fetch('/lab/runs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { runs: RunSummary[] };
      runs = body.runs ?? [];
      renderList();
      if (selectedId && runs.some((r) => r.id === selectedId)) {
        await selectRun(selectedId);
      } else if (selectedId) {
        selectedId = null;
        detail = null;
        renderDetail();
      }
      opts.onActivity?.(`runs refreshed (${runs.length})`);
    } catch (err) {
      opts.onActivity?.(`runs.refresh failed ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function selectByDossierDir(dossierDir: string): Promise<void> {
    const id = extractRunIdFromDossierPath(dossierDir);
    if (!id) return;
    if (runs.length === 0) await refresh();
    await selectRun(id);
  }

  function mount(): void {
    document.getElementById('runsRefresh')?.addEventListener('click', () => {
      void refresh();
    });
    searchInput?.addEventListener('input', () => {
      search = searchInput.value;
      renderList();
    });
    filterBar.querySelectorAll<HTMLButtonElement>('[data-runs-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filter = (btn.dataset.runsFilter as typeof filter) ?? 'all';
        renderFilters();
        renderList();
      });
    });
    selectAllInput?.addEventListener('change', () => {
      const visible = filteredRuns();
      if (selectAllInput.checked) {
        for (const r of visible) selectedIds.add(r.id);
      } else {
        for (const r of visible) selectedIds.delete(r.id);
      }
      renderList();
    });
    deleteSelectedBtn?.addEventListener('click', () => {
      void deleteRuns([...selectedIds], 'selected');
    });
    renderFilters();
    renderDetail();
    void refresh();
  }

  return { refresh, selectByDossierDir, mount };
}
