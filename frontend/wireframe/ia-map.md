# IA map — routes, guards, deep-links

Master route table for Admin + Setup. Sprint 1 routes have full DNA files; skeleton domains list contracts for Sprint 2–3.

## Auth gates

| Gate | Meaning |
|------|---------|
| `public` | No Bearer (login, refresh, client-config, health) |
| `bearer` | `Authorization: Bearer <accessToken>` from login/refresh |
| `setup` | Setup surface; may use public client-config; config apply needs bearer unless `SPECULUM_BYPASS_API_AUTH` (lab/CI only — not prod) |

Token storage + refresh: [`shell/auth-session.md`](shell/auth-session.md). Store `accessToken` + `refreshToken` (+ expiry + `username`) in memory + `sessionStorage`. Refresh on 401 once via `POST /api/auth/refresh`.

## Route table

| Route | Domain | Gate | DNA file | Notes |
|-------|--------|------|----------|-------|
| `/admin/login` | Auth | public | [`auth/login.md`](auth/login.md) | `?returnUrl=` allowlisted |
| `/admin/change-password` | Auth | bearer | [`auth/change-password.md`](auth/change-password.md) | |
| `/admin/session-expired` | Auth | public | [`auth/session-expired.md`](auth/session-expired.md) | Soft landing |
| `/admin` | Home | bearer | [`home/operator-home.md`](home/operator-home.md) | |
| `/setup` | Setup | setup | [`setup/readiness-gate.md`](setup/readiness-gate.md) | Entry |
| `/setup/configure` | Setup | setup | [`setup/guided-first-config.md`](setup/guided-first-config.md) | `?step={Section}` |
| `/admin/sessions` | Sessions | bearer | [`sessions/live-list.md`](sessions/live-list.md) | |
| `/admin/sessions/:sessionId` | Sessions | bearer | [`sessions/live-detail.md`](sessions/live-detail.md) | |
| `/admin/profiles` | Profiles | bearer | [`profiles/list.md`](profiles/list.md) | |
| `/admin/profiles/:profileId` | Profiles | bearer | [`profiles/detail.md`](profiles/detail.md) | |
| `/admin/profiles/:profileId/delete` | Profiles | bearer | [`profiles/delete-confirm.md`](profiles/delete-confirm.md) | Or modal route |
| `/admin/scripts` | Scripts | bearer | [`scripts/README.md`](scripts/README.md) | Default tab: library |
| `/admin/scripts?tab=library` | Scripts | bearer | [`scripts/library.md`](scripts/library.md) | |
| `/admin/scripts?tab=injections` | Scripts | bearer | [`scripts/injections.md`](scripts/injections.md) | |
| `/admin/scripts/upload` | Scripts | bearer | [`scripts/upload-flow.md`](scripts/upload-flow.md) | `?returnUrl=` |
| `/admin/scripts/injections/new` | Scripts | bearer | [`scripts/injection-flow/README.md`](scripts/injection-flow/README.md) | `?step=source\|placement\|targets\|review` |
| `/admin/scripts/injections/:index/edit` | Scripts | bearer | injection-flow README | Same `?step=` |
| `/admin/scripts/injections/:index/remove` | Scripts | bearer | [`scripts/remove-injection.md`](scripts/remove-injection.md) | Review + apply |
| `/admin/configurations` | Configurations | bearer | [`configurations/README.md`](configurations/README.md) | Skeleton |
| `/admin/configurations/:section` | Configurations | bearer | skeleton | PascalCase key |
| `/admin/configurations/:section/review` | Configurations | bearer | skeleton | Optional large-diff review |
| `/admin/host-resources` | Host resources | bearer | [`host-resources/README.md`](host-resources/README.md) | Skeleton |
| `/admin/host-resources/preview` | Host resources | bearer | skeleton | |
| `/admin/host-resources/apply` | Host resources | bearer | skeleton | |
| `/admin/diagnostics` | Diagnostics | bearer | [`diagnostics/hub.md`](diagnostics/hub.md) | Job hub |
| `/admin/diagnostics/health` | Diagnostics | bearer | [`diagnostics/health.md`](diagnostics/health.md) | Observe runtime |
| `/admin/diagnostics/resources` | Diagnostics | bearer | [`diagnostics/resources.md`](diagnostics/resources.md) | Live strip + series chart |
| `/admin/diagnostics/resources/explore` | Diagnostics | bearer | [`diagnostics/resources-explore.md`](diagnostics/resources-explore.md) | Expanded chart modes |
| `/admin/diagnostics/signals` | Diagnostics | bearer | [`diagnostics/signals.md`](diagnostics/signals.md) | Active ResourceSignals |
| `/admin/diagnostics/timeline` | Diagnostics | bearer | [`diagnostics/timeline.md`](diagnostics/timeline.md) | Investigate timeline |
| `/admin/diagnostics/investigate` | Diagnostics | bearer | [`diagnostics/investigate-flow/README.md`](diagnostics/investigate-flow/README.md) | Probes / resolve |
| `/admin/diagnostics/reports` | Diagnostics | bearer | [`diagnostics/reports.md`](diagnostics/reports.md) | Report list |
| `/admin/diagnostics/reports/new` | Diagnostics | bearer | [`diagnostics/report-flow/README.md`](diagnostics/report-flow/README.md) | `?step=kind\|period\|review` |
| `/admin/diagnostics/reports/:reportId` | Diagnostics | bearer | [`diagnostics/report-detail.md`](diagnostics/report-detail.md) | Materialized report |
| `/admin/diagnostics/governance` | Diagnostics | bearer | [`diagnostics/governance-flow/README.md`](diagnostics/governance-flow/README.md) | Govern |

## Shell companions (not routes)

| DNA | Role |
|-----|------|
| [`shell/app-shell.md`](shell/app-shell.md) | Chrome |
| [`shell/nav.md`](shell/nav.md) | Domain nav |
| [`shell/command-palette.md`](shell/command-palette.md) | ⌘K |
| [`shell/toast-and-banners.md`](shell/toast-and-banners.md) | Feedback host |
| [`shell/auth-session.md`](shell/auth-session.md) | Bearer + refresh |

## Nav items (Admin shell)

Order: Home · Sessions · Profiles · Scripts · Configurations · Host resources · Diagnostics.  
Footer / user menu: Change password · Sign out.

## Deep-links

| From | To | When |
|------|-----|------|
| Home NBA | `/setup` | `operational === false` |
| Home missing chip | `/admin/configurations/:section` or `/setup/configure?step=` | Missing section name |
| Home shortcuts | domain routes | Always |
| Profiles detail (live block) | `/admin/sessions` | Delete blocked |
| Scripts library empty | `/admin/scripts/upload` | Empty CTA |
| Injection source | `/admin/scripts/upload?returnUrl=…` | Library empty |
| Injections remove | `/admin/scripts/injections/:index/remove` | Remove |
| Setup complete | `/admin` | Mandatory satisfied |
| 401 after refresh fail | `/admin/session-expired` → login | |
| Configurations Scripting row | `/admin/scripts?tab=injections` | Prefer Scripts UX for injections |
| Host resources status NBA | `/admin/diagnostics/resources` | Live resource monitoring (not capacity) |
| Diagnostics Resources NBA | `/admin/host-resources` | Capacity / shm provision |
| Diagnostics Resources NBA | `/admin/diagnostics/reports/new` | Generate report for current chart window |
| Diagnostics Signals row | `/admin/diagnostics/resources?signalId=` | Jump chart window + metricKeys from `chartHint` |
| Health NBA (Telemetry off) | `/admin/configurations/Telemetry` | Enable sampling |
| Health NBA | `/admin/diagnostics/resources` | When runtime ok but operator wants watch |

## Presentation gaps (build must add if missing)

Thin HTTP over existing domain services — do not invent alternate URLs:

| Contract path | Domain service |
|---------------|----------------|
| `GET /api/profiles`, `GET/DELETE /api/profiles/{id}` | `IProfileService` (`ProfilePage` / `ProfileSummary`) |
| `GET /api/sessions`, `GET /api/sessions/{id}` | `ILiveSessionService.ListSnapshots` / `TryGet` → `LiveSessionTelemetrySnapshot` |
| `GET /api/admin/diagnostics/v1/resources/latest` · `…/history` | Journal `IJournalReader` + Telemetry sample compose |
| `GET /api/admin/diagnostics/v1/signals` · `…/signals/{id}` | ResourceSignal store + SignalDetector |
| `POST/GET /api/admin/diagnostics/v1/reports` · `…/reports/{id}` | ResourceReport store + ReportMaterializer |

Existing today: Auth, Scripts, Configurations, Host resources, public client-config, diagnostics profiles (prefer Profiles module for Admin CRUD), Journal catalog + `StreamJournalAsync`. Resources/signals/reports Presentation is **needed** (see [`diagnostics/README.md`](diagnostics/README.md)).

## Glossary

| Term | Meaning |
|------|---------|
| Live | In-memory session with sidecar connection |
| Profile | Persisted browser state identity (SQLite) |
| NBA | Next best action |
| Section | Engine config key (`Navigation`, `Sessions`, …) |
| Apply | Persist section JSON + run apply pipeline |
| Journal | Operational fact log (admission + durable drain); not the Diagnostics timeline |
| Telemetry sample | Periodic composite `Telemetry.Sampling.SampleCollected` stored in Journal |
| Series | Time-series of sample metrics on Resources (CPU, memory, …) |
| Signal | Persisted ResourceSignal (leak/anomaly); not a chart hint alone |
| Report | Persisted ResourceReport materialised from a Journal window |

## Out of IA map

- Motor `/`, Lab routes
- Edge / mirroring ops (1.1)
