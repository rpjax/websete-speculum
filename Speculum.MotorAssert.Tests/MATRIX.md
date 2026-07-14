# MotorAssert matrix (A–O)

Source of truth for Act→Assert coverage. **Depth:** `deep` = effect assert in required CI; `contract` = governance/shape assert in required CI; `perf` = `perf.yml` only; `deferred-K4` = manual/nightly ACME.

| ID | Depth | Coverage | Test method(s) |
|----|-------|----------|----------------|
| A1 | deep | lifecycle + correlation + session_gone | `A1_session_lifecycle_correlation_and_session_gone` |
| A2 | deep | not ready when Hosting wiped | `A2_not_ready_when_hosting_wiped_then_restore` |
| A3 | deep | MaxSessions reject | `A3_max_sessions_rejects_second_start` |
| A4 | deep | 2nd StartSession replace + SessionStarted | `A4_second_start_promotes_new_session` |
| A5 | deep | cancel Starting → slot released | `A5_cancel_starting_releases_slot` |
| A6 | deep | disconnect → StateExportCompleted + persisted | `A6_disconnect_exports_and_persists` |
| A7 | deep | resource probe + gone | `A7_resource_probe_while_running_then_gone` |
| A8 | deep | sidecar stop → SidecarFaulted **and** session_gone | `A8_sidecar_stop_faults_and_cleans_session` |
| A9 | deep | viewport defaults **1280×720** when 0×0 | `A9_viewport_defaults_when_zero` |
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
| D1 | deep | resize dims on status | `D1_*` |
| D2 | deep | resize &lt;100 noop | `D2_resize_below_100_is_noop` |
| D3–D4 | deep | frames + status/tabCount | `D3_*` `D4_*` |
| D-Start / D-Create / D-Restore / D-UrlMap | deep | SessionResolved + UrlMapped recipes | `DiagnosticsEmitterRecipesTests` |
| E1–E2 | deep | persist export/restore cookie+LS | `E1_E2_*` |
| E3 | deep | history ≥2 `/nav/a`+`/nav/b` | `E3_persisted_detail_includes_history` |
| E4 | deep | persisted list/get | `E4_*` |
| E5 | deep | identity indexers resolve same session | `E5_indexers_resolve_same_persisted_session` |
| E6 | deep | sidecar kill → SidecarFaulted then StateExportFailed | `E6_state_export_failed_on_sidecar_kill` |
| E7 | deep | drain keeps cookie+LS in persisted | `E7_drain_preserves_persisted_state` |
| E8 | deep | rebind same token → one persisted row | `E8_*` (`BugTraps/SessionRebindTrapTests`) |
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
| L13 | deep | host probe | `L13_*` |
| M1 | deep | ConfigApplied / seed Assertive | `M1_*` |
| M2 / M11 | deep | elevate + catalog | `M2_*` `M11_*` |
| M overflow | contract | catalog + runtime overflow fields (load in Perf/Api.Tests) | `M_storage_overflow_contract` + Api.Tests/MotorPerf |
| M redaction | contract | Dev `none` + schema (Prod unit) | `M_redaction_development_none` |
| N1–N2 | deep | popup / `_blank` single-tab | `N1_N2_*` |
| O1–O5 | deep | auth / opacity / validation / wipe | `O1_*`…`O5_*` |
| O4 | deep | casing/validation matrix | `O4_section_casing_validation` |

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
| Bug traps (known-red) | `BugTraps/*` (MsgPack web contract also in Api.Tests + Vitest) |

## Known red (intentional until product green)

Do **not** skip or weaken. MsgPack camelCase Bugs A/B are **fixed** (`MotorHubMessagePack` + `[Key]` DTOs).

| Item | Layer | Notes |
|------|-------|-------|
| E3 history ≥2 | MotorAssert | CDP history / seed weakness |
| L11 soft-cap `ok:false` | MotorAssert | Soft-cap may still return ok:true |
| Others (A8/A9/B1/E6/E7/F1/F3/J7/K3/M1) | MotorAssert | Product gaps revealed by strict asserts |
| Emitter publish units | `Api.Tests/.../Emitters` | Must stay green (bus recorder; not a trap) |
| E8 / B12 | MotorAssert BugTraps | Re-check on stack after MsgPack deploy |

Follow-up: treat remaining assert failures as product work.

Residual delay policy: fixed sleeps before probes/export are **gone**. Remaining `Task.Delay` are poll backoffs, intentional race injection (~80ms mid-start disconnect; ~200ms dual-probe 429), or SignalR stream handshake settle (75ms).

P (unit/contract pyramid) stays in `Speculum.Api.Tests` + sidecar `npm test` + web Vitest under the fast gate. Stress/SLO → `Speculum.MotorPerf.Tests` + `.github/workflows/perf.yml` (not required).
