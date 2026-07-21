# Journal

Unified **operational fact log** for Speculum.Api.

Journal answers: *what happened, when, and which entities were involved?*  
It does **not** answer: *what is the current aggregate state?*

| Journal is | Journal is not |
|------------|----------------|
| Append-only operational narrative | Event-sourcing / aggregate rebuild |
| Searchable by envelope + index keys | A substitute for Diagnostics events/probes |
| Cheap sync admission, async durable drain | A caller-side “await until on disk” API |
| Schema-governed payloads (`Type` + `SchemaVersion`) | Free-form log lines |

**Hard rule:** never rebuild domain aggregates from Journal rows.

Journal enablement is **not** the Diagnostics capability taxonomy. Fact types are toggled in the Journal catalog; health is Journal-local (`Healthy` / `Degraded`).

`PublishPolicy.Guaranteed` means *persist at least once while the process is alive and the sink is healthy* — not “on disk when Append returns,” and not crash-proof across process death before flush.

---

## Lifecycle

```text
Boot
  AddDatabase() → SpeculumDbContext + SQLite options
  AddJournal() → admission / drain pipeline (requires AddDatabase)
  DiscoverJournalFacts() → scan [JournalFact] in Speculum.Api assembly (idempotent)
  EnsureDatabase() → SQLite EnsureCreated + WAL (sync)
  JournalWorker (IHostedService) starts drain

Append
  writer.Append(payload)
    → catalog + enablement (admission-time only)
    → stamp Id/PublishedAt, indexes, JSON (payload size / column limits)
    → queue.Enqueue (depth reserve → TryWrite; Soft/Hard/Max guards)

Drain (JournalWorker)
  supervised: await LoopAsync (TakeBatch → ProcessBatch)
  on crash → record → if budget exceeded StopApplication; else backoff + restart

Shutdown
  Cancel TakeBatch wait → finish in-flight persist → TakeBatch remainder while Count>0 (ShutdownFlushTimeout)
  Append rejected when admission closed (drain stopped / crash backoff)
```

`Append` success means *accepted into the admission channel* (or silently skipped when disabled), not *on disk*.

---

## Admission matrix

| Condition | BestEffort | Guaranteed |
|-----------|------------|------------|
| Unregistered + `RejectUnregisteredTypes` | throw | throw |
| Unregistered + reject false | skip (metric) | skip (metric) |
| Type disabled in catalog | skip (metric) | skip (metric) |
| `depth >= Soft` (Soft&gt;0) | drop | admit |
| `depth >= Hard` (Hard&gt;0) | drop | admit + queue-pressure Degraded (rising edge) |
| `depth >= Max` (Max&gt;0) | drop | reject + persist Degraded |
| Payload / index over limits | throw | throw |
| `TryWrite` fails | drop | fail + persist Degraded |

Enablement is evaluated at Append time only — disabling a type does not remove already-queued facts.

---

## Drain stack

| Piece | Role |
|-------|------|
| `IJournalQueue` / `JournalQueue` | `Enqueue`/`Count` + one blocking `TakeBatchAsync` (CT abort); channel never completes |
| `IJournalDrainPolicy` | Guaranteed before BestEffort; under Degraded drop BestEffort (keep ≤ `DegradedBestEffortKeep`) |
| `IJournalHealth` | Persist Degraded (sticky) **or** queue pressure (clears when depth falls) |
| `JournalWorker` | `IHostedService`: await batch → persist with in-place retries; crash supervisor |
| `IJournalRepository` | SaveBatch + Read (single store port) |
| `JournalDrainMetrics` | In-process counters + `System.Diagnostics.Metrics` (`Speculum.Journal`) + `ActivitySource` |
| `JournalHealthCheck` | Host health check tag `journal` |

### Depth guards

| Setting | Behavior |
|---------|----------|
| `SoftQueueDepth` (&gt;0) | Drop BestEffort |
| `SoftQueueDepth` = 0 | Soft shedding off |
| `HardQueueDepth` (&gt;0) | Drop BestEffort + queue-pressure Degraded (clears when depth &lt; Soft, or Hard/2 if Soft=0) |
| `MaxQueueDepth` (&gt;0) | Absolute ceiling — Guaranteed rejected |
| Guaranteed below Max | Always reserved+`TryWrite` |

### Persist failure

- Persist Degraded → sticky until `inserted > 0` × `RecoverAfterSuccessfulBatches` (or `Recover()`)
- Same batch retried in place up to `MaxPersistAttempts`, then dropped (`journal.persist_abandoned`)
- Unique Id conflicts treated as idempotent (0 inserted)
- Crash budget: `MaxCrashesInPeriod` within `CrashPeriod` → `StopApplication` (checked immediately after crash, before backoff)
- Ready health: `Unhealthy` when drain is not running; `Degraded` when persist/queue pressure active

---

## Declaring a fact

Example: [`BrowserSessions/Journal/SessionStarted.cs`](../BrowserSessions/Journal/SessionStarted.cs)

```csharp
[JournalFact("BrowserSessions.SessionStarted", schemaVersion: 1,
    Owner = "browser-sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class SessionStarted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required bool Restored { get; init; }
}
```

Emit: `writer.Append(new SessionStarted { ... });`

---

## DI

```csharp
builder.Services.AddDatabase();
builder.Services.AddJournal();
builder.Services.DiscoverJournalFacts();

var app = builder.Build();
app.Services.EnsureDatabase();
```

- `"Database"` — SQLite path / busy timeout (`DatabaseOptions`)
- `"Journal"` — drain / admission tunables (`JournalDrainOptions`, validated on start)

Ports: `IJournalWriter`, `IJournalReader`, `IJournalCatalog`, `IJournalQueue`, `IJournalHealth`, `IJournalRepository`, `IJournalDrainPolicy`, `JournalDrainMetrics`. Hosted: `JournalWorker` (`IHostedService`).

Store: unified [`SpeculumDbContext`](../Database/SpeculumDbContext.cs); Journal contributes `IEntityTypeConfiguration<>` under `Storage/`.

---

## Query

`IJournalReader.ReadAsync(JournalQuery?)` — envelope/index filters (including `PublishPolicy`), orders (`Sequence`, `PublishedAt`, `IndexKeyType`).  
Default `Limit` = `DefaultReadLimit` (1000); hard ceiling `MaxReadLimit` (10_000). Not payload JSON paths.

---

## Folder map

```text
Journal/
  Attributes/   [JournalFact], [JournalIndex]
  Catalog/      Descriptor + factory
  Models/       Envelope, PublishPolicy, Query, HealthState
  Services/     Writer, Catalog, Queue, Worker, Policy, Health, Metrics, Reader, Options
  Storage/      EF configurations, Repository, records, mapper
  JournalServiceCollectionExtensions.cs
  JournalFactDiscovery.cs
  README.md

Database/       SpeculumDbContext, options, EnsureDatabase, SQLite interceptor
```

---

## Status / out of scope

**In place:** admission matrix, Channel queue, drain worker, EF via unified `SpeculumDbContext`, dual-factor health, meters/activities, health check, options validation, `DiscoverJournalFacts`, tests, example fact.

**Not in this slice:** `SessionService.Append`, Diagnostics coupling, Admin HTTP recover/metrics UI, retention cleaner, EF migrations (V1 uses EnsureCreated; wipe+recreate on model change).

---

## Anti-patterns

- Rebuilding aggregates from Journal history  
- Awaiting store I/O inside `Append`  
- Soft-skipping missing required indexes  
- Gating Journal with Diagnostics capability names  
- Public queue delete/reorder/purge APIs  
- Completing / closing the Journal channel (it is process-lifetime)  

- Polling the queue instead of Channel wake  
- Treating Guaranteed as crash-proof across process death  
