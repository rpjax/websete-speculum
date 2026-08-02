# Host resources — skeleton (Sprint 2 depth)

## Jobs
1. View current host-resource plan / status (hero gauges + last apply).  
2. Preview capacity changes (GiB facilitators, presets, live estimate).  
3. Apply plan (with visual review / confirm + next-best actions).  
Revealing UI — not a wall of tunables.

## Routes
| Route | Job |
|-------|-----|
| `/admin/host-resources` | Status hero + Parameters step |
| `/admin/host-resources/preview` | Review step (server plan) |
| `/admin/host-resources/apply` | Applied confirmation |

Wizard stays **3 steps** (Parameters → Review → Applied) on those routes.

## APIs (existing)

| método | path | use |
|--------|------|-----|
| GET | `/api/admin/host-resources` | Current status |
| POST | `/api/admin/host-resources/preview` | Preview plan |
| POST | `/api/admin/host-resources/apply` | Apply |

**Request body** (`HostResourceProvisionParams`, camelCase):

| field | default (server) |
|-------|------------------|
| `maxRamBytes` | optional null → host MemoryTotal |
| `reservePercent` | 15 |
| `reserveMinBytes` | 2 GiB |
| `shmMinBytes` | 2 GiB |
| `shmMaxPercentOfBudget` | 75 |
| `raiseUlimits` | true |
| `nofile` | 1048576 |
| `nproc` | 65535 |

Status response nests: `host`, `sidecar`, `lastApply`, `hostError`. Preview returns `HostResourceProvisionPlan` (`budgetBytes`, `reserveBytes`, `shmTargetBytes`, …). Apply returns `shmAppliedBytes`, `warnings`, `appliedAtUtc`.

## DNA pages
- [Status](status.md)
- [Parameters](preview-apply-flow/01-params.md) → [Review](preview-apply-flow/02-review.md) → [Apply](preview-apply-flow/03-apply.md)

## Implementation notes (web)
- Feature folder: `Refactor/web/src/features/admin/host-resources/`
- Helpers (`hostResourcesHelpers.ts`) mirror `HostResourceCalculator` for live estimate only; Review always uses POST preview.
- Presets merge memory knobs without wiping ulimits.
- Related admission config: `/admin/configurations/ResourceManagement`

## Nav placement
**Host resources** (capacity / shm). Related config also under ResourceManagement section in Configurations.
