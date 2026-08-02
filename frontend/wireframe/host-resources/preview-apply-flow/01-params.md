# Resource plan parameters

## Job
Collect a safe host-resource plan for preview — GiB-first facilitators, presets, live estimate, rare ulimits in reveal.

## Route / params / auth gate
- Route: `/admin/host-resources` (step parameters)
- Auth: Bearer access

## Layout

```
Step 1 of 3 — Plan parameters

[HelperCallout — shared desktop vs dedicated]

Plan presets (GuidedPreset):
  Shared desktop | Dedicated host | Conservative reserve | Aggressive shm

Primary (GiB / percent) with chips + custom:
  RAM budget cap (Host total chip + GiB chips + custom)
  Memory reserve % chips + custom
  Minimum reserve GiB chips + custom
  Minimum shared memory GiB chips + custom
  Shared memory cap % chips + custom

▸ Process limits (Reveal)
  Raise process limits switch + safe-default callout
  nofile / nproc when enabled

[Live estimate — budget / reserve / shm when host total known]
[ Review plan ]
```

## Inventory
| id | UI unit | Wire field | default |
|----|---------|------------|---------|
| maxRam | GiB chips + nullable | maxRamBytes | null → host total |
| reservePercent | % chips | reservePercent | 15 |
| reserveMin | GiB chips | reserveMinBytes | 2 |
| shmMin | GiB chips | shmMinBytes | 2 |
| shmMaxPercent | % chips | shmMaxPercentOfBudget | 75 |
| raiseUlimits | switch | raiseUlimits | true |
| nofile/nproc | number | nofile/nproc | 1048576 / 65535 |

Convert GiB ↔ bytes client-side (`× 1024³`). Never show raw bytes as primary.

### Presets (merge; do not wipe ulimits)
| id | effect |
|----|--------|
| shared-desktop | set `maxRamBytes` to suggested shared cap |
| dedicated | `maxRamBytes = null` |
| conservative-reserve | reserve 25% / min 4 GiB |
| aggressive-shm | shm max 90% / min 4 GiB |

### Live estimate
When `host.memoryTotalBytes` is known, show client estimate matching `HostResourceCalculator.Compute`. Review still uses POST `/preview` as authoritative.

## Copy
“Plan parameters”; “Review plan”; “Empty means the host total.”; “Process limits”; “Why this matters”; “Live estimate”.

## Inteligência UX
Defaults minimize busywork; chips reduce typing; ulimits revealed; preview errors retain values; client validation blocks Review when budget after reserve &lt; shmMin.

## Dados
POST `/api/admin/host-resources/preview` with `HostResourceProvisionParams` (bytes on wire).

## Aceite
- [ ] GiB-first primary fields with chips
- [ ] Presets merge without wiping process limits
- [ ] Ulimits in reveal
- [ ] Live estimate only when host total known; Review uses server plan
