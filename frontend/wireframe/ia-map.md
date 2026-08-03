# IA map — routes, guards, deep-links

Master route table for Admin + Setup. Sprint 1 routes have full DNA files; skeleton domains list contracts for Sprint 2–3.

## Auth gates

| Gate | Meaning |
|------|---------|
| `public` | No Bearer (login, refresh, client-config, health) |
| `bearer` | `Authorization: Bearer <accessToken>` from login/refresh |
| `setup` | Setup surface; may use public client-config; config apply needs bearer unless `SPECULUM_BYPASS_API_AUTH` (lab/CI only — not prod) |

Token storage + refresh: [`shell/auth-session.md`](shell/auth-session.md). Store `accessToken` + `refreshToken` (+ expiry + `username`) in memory + `sessionStorage`. Refresh on 401 once via `POST /w7s/api/auth/refresh`.

All Speculum control-plane SPA routes and HTTP APIs live under **`/w7s/*`**. Any other path is the Live catch-all (virtual browser navigation → StartSession).

## Route table

| Route | Domain | Gate | DNA file | Notes |
|-------|--------|------|----------|-------|
| `/w7s/admin/login` | Auth | public | [`auth/login.md`](auth/login.md) | `?returnUrl=` allowlisted |
| `/w7s/admin/change-password` | Auth | bearer | [`auth/change-password.md`](auth/change-password.md) | |
| `/w7s/admin/session-expired` | Auth | public | [`auth/session-expired.md`](auth/session-expired.md) | Soft landing |
| `/w7s/admin` | Home | bearer | [`home/operator-home.md`](home/operator-home.md) | |
| `/w7s/setup` | Setup | setup | [`setup/readiness-gate.md`](setup/readiness-gate.md) | Entry |
| `/w7s/setup/configure` | Setup | setup | [`setup/guided-first-config.md`](setup/guided-first-config.md) | `?step={Section}` |
| `/w7s/lab` | Lab | — | — | Debug / wire lab |
| `/w7s/admin/sessions` | Sessions | bearer | [`sessions/live-list.md`](sessions/live-list.md) | |
| `/w7s/admin/sessions/:sessionId` | Sessions | bearer | [`sessions/live-detail.md`](sessions/live-detail.md) | |
| `/w7s/admin/profiles` | Profiles | bearer | [`profiles/list.md`](profiles/list.md) | |
| `/w7s/admin/profiles/:profileId` | Profiles | bearer | [`profiles/detail.md`](profiles/detail.md) | |
| `/w7s/admin/profiles/:profileId/delete` | Profiles | bearer | [`profiles/delete-confirm.md`](profiles/delete-confirm.md) | Or modal route |
| `/w7s/admin/scripts` | Scripts | bearer | [`scripts/README.md`](scripts/README.md) | Default tab: library |
| `/w7s/admin/scripts?tab=library` | Scripts | bearer | [`scripts/library.md`](scripts/library.md) | |
| `/w7s/admin/scripts?tab=injections` | Scripts | bearer | [`scripts/injections.md`](scripts/injections.md) | |
| `/w7s/admin/scripts/upload` | Scripts | bearer | [`scripts/upload-flow.md`](scripts/upload-flow.md) | `?returnUrl=` |
| `/w7s/admin/scripts/injections/new` | Scripts | bearer | [`scripts/injection-flow/README.md`](scripts/injection-flow/README.md) | `?step=source\|placement\|targets\|review` |
| `/w7s/admin/scripts/injections/:index/edit` | Scripts | bearer | injection-flow README | Same `?step=` |
| `/w7s/admin/scripts/injections/:index/remove` | Scripts | bearer | [`scripts/remove-injection.md`](scripts/remove-injection.md) | Review + apply |
| `/w7s/admin/configurations` | Configurations | bearer | [`configurations/README.md`](configurations/README.md) | Skeleton |
| `/w7s/admin/configurations/:section` | Configurations | bearer | skeleton | PascalCase key |
| `/w7s/admin/configurations/:section/review` | Configurations | bearer | skeleton | Optional large-diff review |
| `/w7s/admin/host-resources` | Host resources | bearer | [`host-resources/README.md`](host-resources/README.md) | Skeleton |
| `/w7s/admin/host-resources/preview` | Host resources | bearer | skeleton | |
| `/w7s/admin/host-resources/apply` | Host resources | bearer | skeleton | |
| `/w7s/admin/diagnostics` | Diagnostics | bearer | [`diagnostics/hub.md`](diagnostics/hub.md) | Job hub |
| `/w7s/admin/diagnostics/health` | Diagnostics | bearer | [`diagnostics/health.md`](diagnostics/health.md) | Observe runtime |
| `/w7s/admin/diagnostics/resources` | Diagnostics | bearer | [`diagnostics/resources.md`](diagnostics/resources.md) | Live strip + series chart |
| `/w7s/admin/diagnostics/resources/explore` | Diagnostics | bearer | [`diagnostics/resources-explore.md`](diagnostics/resources-explore.md) | Expanded chart modes |
| `/w7s/admin/diagnostics/signals` | Diagnostics | bearer | [`diagnostics/signals.md`](diagnostics/signals.md) | Active ResourceSignals |
| `/w7s/admin/diagnostics/timeline` | Diagnostics | bearer | [`diagnostics/timeline.md`](diagnostics/timeline.md) | Investigate timeline |
| `/w7s/admin/diagnostics/investigate` | Diagnostics | bearer | [`diagnostics/investigate-flow/README.md`](diagnostics/investigate-flow/README.md) | Probes / resolve |
| `/w7s/admin/diagnostics/reports` | Diagnostics | bearer | [`diagnostics/reports.md`](diagnostics/reports.md) | Report list |
| `/w7s/admin/diagnostics/reports/new` | Diagnostics | bearer | [`diagnostics/report-flow/README.md`](diagnostics/report-flow/README.md) | `?step=kind\|period\|review` |
| `/w7s/admin/diagnostics/reports/:reportId` | Diagnostics | bearer | [`diagnostics/report-detail.md`](diagnostics/report-detail.md) | Materialized report |
| `/w7s/admin/diagnostics/governance` | Diagnostics | bearer | [`diagnostics/governance-flow/README.md`](diagnostics/governance-flow/README.md) | Govern |

## Shell companions (not routes)

| DNA | Role |
|-----|------|
| [`shell/app-shell.md`](shell/app-shell.md) | Chrome |
| [`shell/nav.md`](shell/nav.md) | Domain nav |
| [`shell/command-palette.md`](shell/command-palette.md) | ⌘K |
| [`shell/toast-and-banners.md`](shell/toast-and-banners.md) | Feedback host |
| [`shell/auth-session.md`](shell/auth-session.md) | Bearer + refresh |

## Nav items (Admin shell)

Order: Home · Sessions · Profiles · Scripts · Configurations · Host resources · then **Diagnostics** section (Health · Resources · Signals · Timeline · Investigate · Reports · Governance).  
Footer / user menu: Change password · Sign out.

## Deep-links

| From | To | When |
|------|-----|------|
| Home NBA | `/w7s/setup` | `operational === false` |
| Home missing chip | `/w7s/admin/configurations/:section` or `/w7s/setup/configure?step=` | Missing section name |
| Home shortcuts | domain routes | Always |
| Profiles detail (live block) | `/w7s/admin/sessions` | Delete blocked |
| Scripts library empty | `/w7s/admin/scripts/upload` | Empty CTA |
| Injection source | `/w7s/admin/scripts/upload?returnUrl=…` | Library empty |
| Injections remove | `/w7s/admin/scripts/injections/:index/remove` | Remove |
| Setup complete | `/w7s/admin` | Mandatory satisfied |
| 401 after refresh fail | `/w7s/admin/session-expired` → login | |
| Configurations Scripting row | `/w7s/admin/scripts?tab=injections` | Prefer Scripts UX for injections |
| Host resources status NBA | `/w7s/admin/diagnostics/resources` | Live resource monitoring (not capacity) |
| Diagnostics Resources NBA | `/w7s/admin/host-resources` | Capacity / shm provision |
| Diagnostics Resources NBA | `/w7s/admin/diagnostics/reports/new` | Generate report for current chart window |
| Diagnostics Signals row | `/w7s/admin/diagnostics/resources?signalId=` | Jump chart window + metricKeys from `chartHint` |
| Health NBA (Telemetry off) | `/w7s/admin/configurations/Telemetry` | Enable sampling |
| Health NBA | `/w7s/admin/diagnostics/resources` | When runtime ok but operator wants watch |

## Presentation gaps (build must add if missing)

Thin HTTP over existing domain services — do not invent alternate URLs:

| Contract path | Domain service |
|---------------|----------------|
| `GET /w7s/api/profiles`, `GET/DELETE /w7s/api/profiles/{id}` | `IProfileService` (`ProfilePage` / `ProfileSummary`) |
| `GET /w7s/api/sessions`, `GET /w7s/api/sessions/{id}` | `ILiveSessionService.ListSnapshots` / `TryGet` → `LiveSessionTelemetrySnapshot` |
| `GET /w7s/api/admin/diagnostics/v1/resources/latest` · `…/history` | Journal `IJournalReader` + Telemetry sample compose |
| `GET /w7s/api/admin/diagnostics/v1/signals` · `…/signals/{id}` | ResourceSignal store + SignalDetector |
| `POST/GET /w7s/api/admin/diagnostics/v1/reports` · `…/reports/{id}` | ResourceReport store + ReportMaterializer |

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
