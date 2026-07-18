# MotorAssert matrix (A–O)

Source of truth for Act→Assert coverage. **Depth:** `deep` = effect assert in required CI; `contract` = governance/shape assert in required CI; `perf` = `perf.yml` only; `deferred-K4` = manual/nightly ACME.

Constitution: [docs/engineering-standards.md](../docs/engineering-standards.md) (§3 Testing). Assert failures: [docs/assert-failure-policy.md](../docs/assert-failure-policy.md).

| ID | Depth | Coverage | Test method(s) |
|----|-------|----------|----------------|
| A1 | deep | lifecycle + correlation + session_gone | `A1_session_lifecycle_correlation_and_session_gone` |
| A2 | deep | not ready when Hosting wiped | `A2_not_ready_when_hosting_wiped_then_restore` |
| A3 | deep | MaxSessions reject | `A3_max_sessions_rejects_second_start` |
| A4 | deep | 2nd StartSession replace + SessionStarted | `A4_second_start_promotes_new_session` |
| A5 | deep | cancel Starting → slot released | `A5_cancel_starting_releases_slot` |
| A6 | deep | disconnect → StateExportCompleted + persisted | `A6_disconnect_exports_and_persists` |
| A7 | deep | resource probe + gone | `A7_resource_probe_while_running_then_gone` |
| A8 | deep | sidecar stop → SidecarFaulted **payload errorCode+fault** and session_gone | `A8_sidecar_stop_faults_and_cleans_session` |
| A9 | deep | startup **0×0 → 1280×720** proven (status + Chrome + RandR + JPEG) | `A9_viewport_defaults_when_zero` |
| A10 | deep | clientToken hex round-trip + reject | `A10_*` / `A10b_*` |
| B1–B3 | deep | navigate allowlist (**B1 probe `/nav/b`**) / reject / scheme | `B1_*` `B2_*` `B3_*` |
| B4 | deep | goEvil → redirect wire + alive + tabs | `B4_*` / `B4b_*` |
| B5 | deep | domain wildcard allowlist E2E | `B5_wildcard_subdomain_allowed` |
| B6 | deep | asset-escape page stays alive | `B6_*` |
| B7 | deep | NSO apex → target host probe | `B7_nso_apex_lands_on_target_host` |
| B8 | deep | Hosting mirroring ON + status/probe | `B8_mirroring_operational_and_sub_host` |
| B9 | deep | path/query preserve | `B9_*` |
| B10 | deep | redirect chain + history goback/forward | `B10_*` / `B10b_*` |
| B11 | deep | SPA path | `B11_*` |
| B12 | deep | status + `Motor.UrlMapped` client URL path+NSO | `B12_*` (`BugTraps/ClientUrlSyncTrapTests`) |
| C1–C5 | deep | mouse / key / wheel / guard / bad JSON | `InputFramesPopupTests` |
| C6–C8 | deep | touch tap / cancel / multitouch | `InputFramesPopupTests` |
| C9 | deep | `Motor.InputRejected` on blocked type | `C9_input_rejected_emits_catalog_event` |
| C10 | deep | touch drag scroll | `C10_touch_scroll_moves_scrollTop` |
| C11 | deep | mobile DeviceProfile → maxTouchPoints | `C11_mobile_device_profile_sets_maxTouchPoints` |
| C12 | deep | `text` insertText into focused input | `C12_text_input_reaches_focused_field` |
| D1 | deep | exact resize **757×715** (`ResizeApplied` + RandR + Chrome + status + JPEG) | `D1_resize_exact_geometry_applied` |
| D2 | deep | resize &lt;100 → `ResizeRejected`, session stays at prior size | `D2_resize_below_100_is_rejected` |
| D3–D4 | deep | frames + status/tabCount | `D3_*` `D4_*` |
| D-Start / D-Create / D-Restore / D-UrlMap | deep | SessionResolved + UrlMapped recipes | `DiagnosticsEmitterRecipesTests` |
| E1–E2 | deep | persist export/restore cookie+LS | `E1_E2_*` |
| E3 | deep | history ≥2 `/nav/a`+`/nav/b` | `E3_persisted_detail_includes_history` |
| E3b | deep | reattach same token merges history across generations | `E3b_reattach_merges_history_across_generations` |
| E4 | deep | persisted list/get | `E4_*` |
| E5 | deep | identity indexers resolve same session | `E5_indexers_resolve_same_persisted_session` |
| E6 | deep | sidecar kill → SidecarFaulted+StateExportFailed **payloads** | `E6_state_export_failed_on_sidecar_kill` |
| E7 | deep | drain keeps cookie+LS in persisted | `E7_drain_preserves_persisted_state` |
| E8 | deep | rebind same token → one persisted row | `E8_*` (`BugTraps/SessionRebindTrapTests`) |
| E8b | deep | dirty cookie sameSite/expires restore still SessionStarted + marker cookie | `E8b_rebind_with_dirty_cookie_fields_still_starts` |
| F1 | deep | SessionPolicy PUT | `F1_*` |
| F2–F3 | deep | TTL; DELETE → 404 not configured | `F2_*` `F3_*` |
| G2–G4 | deep | drain Forwarding/Hosting; MaxSessions no-drain | `G2_*` `G3_*` `G4_*` |
| H1–H2 | deep | script upload + inject marker | `H1_*` `H2_*` |
| H3–H4 | deep | HeaderTop/BodyBottom Classic vs Module | `H3_*` `H4_*` |
| H5 | deep | script URL SSRF | `H5_*` |
| H6–H8 | deep | missing id 400; delete; size limit | `H6_*` `H7_*` `H8_*` |
| I1–I4 | deep | JsBridge + evaljs + console | `I1_*` `I2_*` `I3_*` `I4_*` |
| I5 | deep | JsBridge flip mid-session snapshot immutable | `I5_*` |
| J1–J3 | deep | public config / ready / status | `J1_J2_*` `J3_*` |
| J4–J6 | deep | mirroring status fields (with B8) | `B8_*` / `J7_*` |
| J7 | deep | mirroring ON without edgeTls → **400** | `J7_mirroring_without_edge_tls_is_rejected` |
| K1 | deep | Hosting PUT → Traefik dynamic files | `K1_hosting_put_writes_bootstrap_yml` |
| K2 | deep | Traefik health/ready/client-config/negotiate | `K2_*` |
| K3 | deep | CORS preflight via Traefik | `K3_cors_preflight_via_traefik` |
| K4 | deferred-K4 | ACME/DNS | manual/nightly only |
| L1–L8 | deep | probes / gates | `L1_*` `L8_*` / `L2_*`… |
| L9–L10 | deep | probe_busy 429; timeout errorCode | `L9_*` `L10_*` |
| L11 | contract | soft-cap XOR 413 | `L11_*` |
| L12 | deep | resolve op | `L12_*` |
| L13 | deep | machine host probe envelope | `L13_*` |
| L14 | deep | API process probe envelope | `L14_*` |
| M1 | deep | ConfigApplied / seed Assertive | `M1_*` |
| M2 / M11 | deep | elevate + catalog | `M2_*` `M11_*` |
| M overflow | contract | catalog + runtime overflow fields (load in Perf/Api.Tests) | `M_storage_overflow_contract` + Api.Tests/MotorPerf |
| M redaction | contract | Dev `none` + schema (Prod unit) | `M_redaction_development_none` |
| N1–N2 | deep | popup / `_blank` single-tab | `N1_N2_*` |
| O1–O5 | deep | auth / opacity / validation / wipe | `O1_*`…`O5_*` |
| O4 | deep | casing/validation matrix | `O4_section_casing_validation` |
| T1 | deep | composite `Telemetry.SampleCollected` carries all sections (host/apiProcess/motor/sidecar/persistence/pipeline) + story fields | `T1_composite_sample_has_all_sections` |
| T2 | deep | live session reflected in `motor.total`/`liveSessionIds`/`sessions` + `sidecar.connected` | `T2_live_session_reflected_in_motor_and_sidecar_aggregates` |

## Organization

| Area | File(s) |
|------|---------|
| Helpers | `MotorActClient`, `DiagnosticsAssertClient`, `MotorAssertHost`, `MotorAssertTokens` |
| Lifecycle | `LifecycleAndNavigateTests`, `LifecycleDeepTests` |
| Navigation | `LifecycleAndNavigateTests`, `NavigationDeepTests`, `InputFramesPopupTests` (B4) |
| Input / frames | `InputFramesPopupTests`, `InputResizeProbeGovernanceTests` |
| Persistence / scripts | `PersistenceDrainInjectionTests`, `PersistenceDeepTests`, `ScriptsDeepTests` |
| Hosting / edge | `JsBridgeHostingMiscTests`, `DiagnosticsEdgeDeepTests` |
| Diagnostics governance | `InputResizeProbeGovernanceTests`, `DiagnosticsEdgeDeepTests`, `DiagnosticsGovernance/*` |
| Telemetry (composite sample) | `TelemetrySampleDeepTests` |
| Regression traps | `BugTraps/*` (MsgPack web contract also in Api.Tests + Vitest) |

## Assert policy

Do **not** skip or soften matrix asserts. Triage product vs harness with [docs/assert-failure-policy.md](../docs/assert-failure-policy.md).

| Item | Layer | Notes |
|------|-------|-------|
| MessagePack camelCase | Api.Tests + Vitest + MotorAssert | Contract suites must stay green |
| Emitter publish units | `Api.Tests/.../Emitters` | Bus recorder contracts — required |
| E8 / B12 rebind + UrlMapped | `BugTraps/*` | Regression guards for identity / URL map |
| Span correlation + abandon (schema v2) | `Api.Tests/.../Pipeline/SpanTrackerTests` | seq / Open↔Close pairing / causation nesting / scope isolation / timeout + teardown + boot-recovery abandon — required |
| Span catalog invariant | `Api.Tests/.../Catalog/DiagnosticsCatalogTests` | every `SpanKey` has ≥1 Open + ≥1 Close; every Open declares a key; declared constants == used keys — required |
| Per-session telemetry mirror | `Api.Tests/.../Telemetry/TelemetryEmitterTests` | composite + `Telemetry.SessionSampleCollected` scoped by connectionId (only when `includePerSession`) — required |
| Frontend story / span reconstruction | web Vitest `timeline/spanCompute.test.ts` | `buildSpans`/`buildStories` ordering + pairing + nesting — required |

Depth note: each MotorAssert test runs `EnsureBaselineAsync` (clear Diagnostics Degraded via `/recover`, MaxSessions / JsBridge / Assertive BrowserQuery with runtime verify) via `MotorAssertTestBase`, so Diagnostics level mutations and circuit-breaker caps cannot leak into the next test.

Export note: persistence restore tests use `WaitStateExportCompletedAsync(connectionId, since-before-disconnect)` — see [diagnostics.md](../docs/diagnostics.md) §4.

P (unit/contract pyramid) stays in `Speculum.Api.Tests` + sidecar `npm test` + web Vitest under the fast gate. Stress/SLO → `Speculum.MotorPerf.Tests` + `.github/workflows/perf.yml` (not required).
