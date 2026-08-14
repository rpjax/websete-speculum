# Contract 15 — Configuration

**Norm:** redesign §5.16.

## Knobs (Sessions → PageProjection)

| Knob | Default | Notes |
|------|---------|-------|
| `frameRateHz` | 60 | target |
| `frameRateLadder` | 60,30,15,5 | degrade steps |
| `hiddenRateHz` | 1 | client hidden |
| `rateRecoverMs` | 5000 | min upward step interval |
| `frameStallMs` | 1000 | clock watchdog |
| `maxFrameBytes` | 1048576 | part split |
| `establishChunkBytes` | 65536 | establish chunk target |
| `swapTimeoutMs` | 1500 | double-buffer fallback |
| `clientStateMs` | 1000 | ClientState interval |
| `applyBudgetMs` | 4 | E9 overrun |
| `mirrorMaxBytes` | 4194304 | E7 mirror |
| `assetCacheL1MaxBytes` | 8388608 | per session LRU |
| `assetCacheL2MaxBytes` | 1073741824 | host LRU |
| `assetCacheL2Enabled` | true | kill switch |
| `assetPriorityViewportPx` | 200 | prefetch margin |
| `browserPoolSize` | 8 | pre-warmed |
| `browserPoolRefillPerSec` | 2 | refill throttle |
| `aggregateIntervalMs` | 10000 | Frame.Aggregate |

Input knobs (input §11) unchanged.

## Validation

MUST reject values that could stall emission indefinitely.

## Deleted (MUST NOT appear)

`strategy`, `coalesceWindowMs`, `maxWaitMs`, `maxBufferBytes`, `maxOpsPerFlush`, `PageProjectionDiffQueueCapacity` as load control.
