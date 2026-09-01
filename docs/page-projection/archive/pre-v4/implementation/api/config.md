# Implementation — PageProjection configuration (API)

**Future path:** `Speculum.Api/Configurations/Models/Sessions/PageProjectionOptions.cs` (or equivalent Sessions→PageProjection options)  
**Contracts:** [15-configuration.md](../../contracts/15-configuration.md)  
**Norm:** redesign §5.16 — defaults MUST match **exactly**  
**Decisions:** D-SPEC-0

---

## Purpose

Runtime-configurable knobs under Sessions → PageProjection. Starting defaults are normative until O4 recalibrates. Validation MUST reject values that could stall emission indefinitely.

---

## Invariants

1. Defaults table below matches redesign §5.16 / contract 15 **exactly** (including `mirrorMaxBytes` = **4 MiB** = `4194304`).
2. Deleted coalesce / queue knobs MUST NOT appear in options, config binders, or docs aliases (V1 — no shims).
3. Invalid values fail closed at bind/startup or admin PUT validation.
4. Input knobs (input §11) remain separate and unchanged.

---

## Bans

- Config aliases / migration shims for deleted knobs (`strategy`, `coalesceWindowMs`, `maxWaitMs`, `maxBufferBytes`, `maxOpsPerFlush`, `PageProjectionDiffQueueCapacity` as load control).
- Default `mirrorMaxBytes` other than 4194304.
- Values that set frame rate to 0 or stall interval to “forever” without an explicit upper bound check.

---

## Defaults table (§5.16 exact)

| Knob | Default | CLR / JSON notes |
|------|---------|------------------|
| `frameRateHz` | `60` | int |
| `frameRateLadder` | `60,30,15,5` | `int[]` / list |
| `hiddenRateHz` | `1` | int |
| `rateRecoverMs` | `5000` | int |
| `frameStallMs` | `1000` | int |
| `maxFrameBytes` | `1048576` | int (1 MiB) |
| `establishChunkBytes` | `65536` | int (64 KiB) |
| `swapTimeoutMs` | `1500` | int |
| `clientStateMs` | `1000` | int |
| `applyBudgetMs` | `4` | int (E9) |
| `mirrorMaxBytes` | `4194304` | int (4 MiB, E7) |
| `assetCacheL1MaxBytes` | `8388608` | int (8 MiB) |
| `assetCacheL2MaxBytes` | `1073741824` | long (1 GiB) |
| `assetCacheL2Enabled` | `true` | bool |
| `assetPriorityViewportPx` | `200` | int |
| `browserPoolSize` | `8` | int |
| `browserPoolRefillPerSec` | `2` | int |
| `aggregateIntervalMs` | `10000` | int |

---

## Signatures (C#)

```csharp
public sealed class PageProjectionOptions
{
    public const string SectionName = "Sessions:PageProjection"; // or project convention

    public int FrameRateHz { get; set; } = 60;
    public int[] FrameRateLadder { get; set; } = [60, 30, 15, 5];
    public int HiddenRateHz { get; set; } = 1;
    public int RateRecoverMs { get; set; } = 5000;
    public int FrameStallMs { get; set; } = 1000;
    public int MaxFrameBytes { get; set; } = 1_048_576;
    public int EstablishChunkBytes { get; set; } = 65_536;
    public int SwapTimeoutMs { get; set; } = 1500;
    public int ClientStateMs { get; set; } = 1000;
    public int ApplyBudgetMs { get; set; } = 4;
    public int MirrorMaxBytes { get; set; } = 4_194_304;
    public int AssetCacheL1MaxBytes { get; set; } = 8_388_608;
    public long AssetCacheL2MaxBytes { get; set; } = 1_073_741_824;
    public bool AssetCacheL2Enabled { get; set; } = true;
    public int AssetPriorityViewportPx { get; set; } = 200;
    public int BrowserPoolSize { get; set; } = 8;
    public int BrowserPoolRefillPerSec { get; set; } = 2;
    public int AggregateIntervalMs { get; set; } = 10_000;
}

public static class PageProjectionOptionsValidator
{
    public static ValidateOptionsResult Validate(PageProjectionOptions o);
}
```

---

## Algorithm — validation

```
Validate(o):
  FrameRateHz >= 1 && <= 240
  HiddenRateHz >= 1 && <= FrameRateHz
  FrameRateLadder non-empty, strictly decreasing positive ints, contains steps used by policy
  RateRecoverMs >= 100
  FrameStallMs >= 100
  MaxFrameBytes >= EstablishChunkBytes && >= 1024
  EstablishChunkBytes >= 1024
  SwapTimeoutMs >= 100
  ClientStateMs >= 100
  ApplyBudgetMs >= 1
  MirrorMaxBytes >= 1_048_576          // refuse absurdly small mirrors
  AssetCacheL1MaxBytes >= 0
  AssetCacheL2MaxBytes >= 0
  BrowserPoolSize >= 0
  BrowserPoolRefillPerSec >= 0
  AggregateIntervalMs >= 1000

  Reject if FrameRateHz == 0
  Reject if any ladder value == 0
  Reject unknown properties only if binder is strict — deleted knobs must not bind silently as no-ops that look configured

  MUST reject values that could stall emission indefinitely
    e.g. FrameStallMs absurdly high without watchdog elsewhere — cap FrameStallMs at e.g. 60_000
```

Exact numeric caps MAY be tightened in DECISIONS; do not leave uncapped “int.MaxValue” stalls.

---

## Propagation

| Knob | Consumers |
|------|-----------|
| frame rate / ladder / hidden / recover | API rate policy → sidecar clock |
| frameStallMs | sidecar watchdog |
| maxFrameBytes / establishChunkBytes | sidecar encode/establish |
| swapTimeoutMs / clientStateMs / applyBudgetMs | web client (via client config endpoint or hub hello) |
| mirrorMaxBytes | sidecar Node mirror |
| asset L1/L2 / priority | API asset plane + sidecar rewrite/prefetch |
| browser pool | sidecar pool |
| aggregateIntervalMs | API telemetry |

Client-visible subset MUST be delivered through the existing client config mechanism — no ad-hoc duplicate sources of truth.

---

## Tests

| ID | Assert |
|----|--------|
| Defaults | Fresh bind equals table exactly (`MirrorMaxBytes == 4194304`) |
| Deleted | Binder rejects or ignores-as-absent deleted coalesce knobs — MUST NOT reintroduce as functional load control |
| Validate | `FrameRateHz = 0` fails |
| Validate | Negative cache sizes fail |
| Wire | Admin/config PUT applies and `WaitConfigApplied` only where Diagnostics/Hosting rules allow (MotorAssert policy) |
