# Generate resource report — flow

## Jobs
Create a ResourceReport: choose kind → choose period → review and submit for server materialization from Journal samples.

## Routes
| Route | Step |
|-------|------|
| `/admin/diagnostics/reports/new?step=kind` | 01 Kind |
| `/admin/diagnostics/reports/new?step=period` | 02 Period |
| `/admin/diagnostics/reports/new?step=review` | 03 Review |

Prefill: `?from=&to=` from Resources window; `?kind=leakSuspect` from Signals NBA.

## APIs

| ação | método | path |
|------|--------|------|
| create | POST | `/api/admin/diagnostics/v1/reports` body `{ kind, from, to }` → `{ id, status: "pending" }` |
| follow | GET | `/api/admin/diagnostics/v1/reports/{id}` |

## Named flow steps
1. [Kind](01-kind.md) — pick report kind
2. [Period](02-period.md) — from/to (presets or custom)
3. [Review](03-review.md) — confirm → POST → navigate detail

## Nav placement
Diagnostics → Reports → Generate report; Resources NBA.

## Explicitly deferred
Custom chapter templates; scheduled reports; PDF export.
