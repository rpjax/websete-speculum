# Diagnostics — Observe / Investigate / Govern

## Jobs (distinct — anti-god)

1. **Observe** — health (runtime), **resources** (live strip + time-series), **signals** (active leaks/anomalies).
2. **Investigate** — timeline, probes/resolve, **reports** (Journal-backed materializations).
3. **Govern** — elevate / recover / capability toggles / catalog audit.

Do not ship one mega Diagnostics page or a ported TelemetryMonitor god chart. Chart **quality** (CPU/mem/disk + overlays) lives on Resources; signals and reports are separate jobs.

## Routes

| Route | Job |
|-------|-----|
| `/admin/diagnostics` | Hub → pick Observe / Investigate / Govern |
| `/admin/diagnostics/health` | Observe runtime health |
| `/admin/diagnostics/resources` | Observe live resources + series chart |
| `/admin/diagnostics/resources/explore` | Expanded chart (correlate / heatmap / denser brush) |
| `/admin/diagnostics/signals` | Observe active ResourceSignals |
| `/admin/diagnostics/timeline` | Investigate timeline |
| `/admin/diagnostics/investigate` | Probes / resolve |
| `/admin/diagnostics/reports` | Investigate report list |
| `/admin/diagnostics/reports/new` | Report flow (kind → period → review) |
| `/admin/diagnostics/reports/:reportId` | Report detail reader |
| `/admin/diagnostics/governance` | Govern toggles / elevate / recover |

## APIs

**Existing today (partial):**

| método | path | use |
|--------|------|-----|
| GET | `/api/admin/diagnostics/v1/profiles/{id}` | Profile detail (prefer Profiles module for CRUD) |
| PUT | `/api/admin/diagnostics/v1/profiles/{id}/state` | Replace state (E8b) |
| GET | `/api/journal/catalog` | Journal fact catalog |
| hub | `SessionHub.StreamJournalAsync` | Live `JournalFactHubEvent` (filter `Telemetry.Sampling.SampleCollected`) |

**Needed (Presentation + domain — product Diagnostics resources track):**

| método | path | use |
|--------|------|-----|
| GET | `/api/admin/diagnostics/v1/resources/latest` | Latest composite + section readiness |
| GET | `/api/admin/diagnostics/v1/resources/history` | Series from Journal (`from`, `to`, `limit`, `bucketSeconds`, `cursor`) |
| GET | `/api/admin/diagnostics/v1/signals` | `{ items, total }` ResourceSignal |
| GET | `/api/admin/diagnostics/v1/signals/{id}` | Signal detail + evidence |
| POST | `/api/admin/diagnostics/v1/reports` | Create ResourceReport (`kind`, `from`, `to`) |
| GET | `/api/admin/diagnostics/v1/reports` | List reports |
| GET | `/api/admin/diagnostics/v1/reports/{id}` | Report chapters / status |
| GET | `/api/admin/diagnostics/v1/overview` | Runtime health (existing Observe track) |
| … | elevate / recover / timeline / probes | Govern + Investigate tracks |

### Backend contracts (non-negotiable for build)

| Layer | Role | Persistence |
|-------|------|-------------|
| Journal `Telemetry.Sampling.SampleCollected` | Sample source of truth | Existing SQLite Journal |
| `IJournalReader` + Admin REST | `latest` / `history` (+ bucketing) | New HTTP over existing reader |
| **ResourceSignal** entity | Leak/anomaly open/update/resolve | **New** Speculum SQLite table |
| **ResourceReport** entity | Materialized report artifact | **New** Speculum SQLite table |
| SignalDetector (hosted) | Evaluates samples → ResourceSignal | Writes signals; does **not** rebuild domain aggregates from Journal |
| ReportMaterializer | Builds chapters from Journal window + signals | Writes ResourceReport |

Hard rules: Journal stays append-only; signals/reports are read models; detection is server-side (assertable); never rebuild Sessions/Profiles aggregates from Journal rows.

#### ResourceSignal shape (camelCase)

| field | type | notes |
|-------|------|-------|
| `id` | string (uuid) | |
| `kind` | enum string | see kinds below |
| `severity` | `info` \| `warning` \| `critical` | |
| `status` | `active` \| `resolved` | |
| `phase` | string | detector phase |
| `summary` | string | EN operator summary |
| `detectedAt` | ISO-8601 | |
| `resolvedAt` | ISO-8601? | |
| `evidenceSampleIds` | string[] | Journal entry ids |
| `metrics` | object | minimal snapshot for list UI |
| `chartHint` | `{ from, to, metricKeys[] }?` | jump Resources window + overlays |

Indexes: `(status, detectedAt)`, `(kind, status)`.

**Kinds:** `apiMemoryLeak`, `hostSaturation`, `renderRegression`, `threadStarvation`, `sessionCapacitySaturation`, `sidecarInstability`, `journalStress`.

#### ResourceReport shape (camelCase)

| field | type | notes |
|-------|------|-------|
| `id` | string (uuid) | |
| `kind` | enum string | see kinds below |
| `status` | `pending` \| `ready` \| `failed` | |
| `from` / `to` | ISO-8601 | window |
| `createdAt` / `readyAt?` | ISO-8601 | |
| `summary` | string | |
| `chapters` | `{ title, body, relatedSignalIds?, relatedSampleIds?, seriesSummary? }[]` | narrative + optional series snapshot |
| `error` | `{ errorCode, phase }?` | required when `failed` |

Index: `(createdAt desc)`.

**Kinds:** `resourceTrend`, `leakSuspect`, `saturationWindow`, `journalHealth`.

#### History query semantics

`GET …/resources/history?from=&to=&limit=&bucketSeconds=&cursor=`

- Source: Journal facts `Telemetry.Sampling.SampleCollected` via `IJournalReader`.
- Long windows: server `bucketSeconds` (30…3600, target ~500 points); short windows: raw up to `limit` (cap documented, e.g. 2000).
- Response: `{ items: [{ id, publishedAt, sample }], nextCursor?, bucketSeconds? }` — `sample` is typed composite (`host`, `apiProcess`, `sessions`, `sidecar`, `profiles`, `journal`, `docker`); missing section = `null` (honest — no cross-fill).
- List envelope elsewhere: `{ items, total }` unless page DNA says otherwise.

### Metric catalog (chart keys)

**Defaults on Resources chart:** `host.cpu`, `host.memory`, `host.diskFree`.

**Sections (opt-in overlay):**

| section | keys |
|---------|------|
| host | cpu, memory, memoryAvailable, memoryPct, cpuCount, diskFree, diskTotal, load1m, load5m, load15m, swapUsed, diskRead, diskWrite, networkRx, networkTx |
| apiProcess | cpu, memory, threads, memoryPrivate, gcHeap, gcGen0, gcGen1, gcGen2, threadPoolBusy, threadPoolQueued |
| sessions | live, total, avgFps, minFps, maxFps, capacityPct |
| sidecar | process / eventLoop / chrome / queues / faulted fields as sampled |
| journal | queueDepth, droppedTotal, degraded, pressure fields when enabled |
| docker | runtime / container stats when enabled |
| derived | cpuPerSession, memPerSession |

Vocabulary is Refactor Telemetry (not legacy Motor / diagnostics-pipeline storage).

## DNA pages

- [Hub](hub.md), [Health](health.md), [Resources](resources.md), [Resources explore](resources-explore.md), [Signals](signals.md)
- [Timeline](timeline.md), [Investigate flow](investigate-flow/README.md)
- [Reports](reports.md), [Report detail](report-detail.md), [Report flow](report-flow/README.md)
- [Governance flow](governance-flow/README.md)

## Nav placement

**Diagnostics**.

## Explicitly out

Lab telemetry panels; MotorAssert harness UI; ported TelemetryMonitor monolith; fake health scores; Host resources apply UI inside Diagnostics.
