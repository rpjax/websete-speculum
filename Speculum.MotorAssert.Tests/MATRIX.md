# MotorAssert matrix (Phase 3)

Inventory of Act→Assert coverage in `Speculum.MotorAssert.Tests`. Cases marked **deferred** are intentional non-blockers for the PR gate (see plan Phase 3).

| ID | Coverage | Test method(s) |
|----|----------|----------------|
| A1 | lifecycle + correlation + session_gone | `A1_session_lifecycle_correlation_and_session_gone` |
| A2 | not ready when Hosting wiped | `A2_not_ready_when_hosting_wiped_then_restore` |
| A3 | MaxSessions reject | `A3_max_sessions_rejects_second_start` |
| A7 | resource probe + gone | `A7_resource_probe_while_running_then_gone` |
| A8 | sidecar fault | **deferred** (container stop overnight) |
| A9 | viewport defaults | `A9_viewport_defaults_when_zero` |
| A10 | clientToken hex round-trip + reject | `A10_*` / `A10b_*` |
| B1–B3 | navigate allowlist / reject / scheme | `B1_*` `B2_*` `B3_*` |
| B4 | off-allowlist programmatic nav | `B4_programmatic_off_allowlist_navigate_keeps_session_alive` |
| B6 | asset-escape page stays alive | `B6_asset_escape_page_loads_without_killing_session` |
| B9 | path/query preserve | `B9_path_and_query_preserved_on_navigate` |
| B10 | redirect chain | `B10_redirect_chain_lands_on_end` |
| B11 | SPA path | `B11_spa_path_navigate` |
| C1–C5 | mouse / key / wheel / guard / bad JSON | `InputFramesPopupTests` |
| D1 | resize event | `D1_resize_emits_requested` |
| D3–D4 | frames + status/tabCount | `D3_*` `D4_*` |
| E1–E2 | persist export/restore | `E1_E2_*` |
| E4 | persisted list/get | `E4_admin_persisted_list_and_get` |
| F1 | SessionPolicy | `F1_*` |
| G2–G4 | drain Forwarding/Hosting; MaxSessions no-drain | `G2_*` `G3_*` `G4_*` |
| H1–H2 | script upload + inject marker | `H1_*` `H2_*` |
| H5 | script URL SSRF | `H5_*` |
| I1–I4 | JsBridge + evaljs + console | `I1_*` `I2_*` `I3_*` `I4_*` |
| J1–J3 | public config / ready / status | `J1_J2_*` `J3_*` |
| J7 | mirroring misconfigured | `J7_*` |
| K2 | Traefik `/health` `/ready` | `K2_*` |
| K4 | ACME/DNS | **nightly/manual only** |
| L1–L13 | probes / gates / host | `L1_*` `L8_*` `L11_*` `L13_*` |
| M2 / M11 | elevate + catalog | `M2_*` `M11_*` |
| N1–N2 | popup / `_blank` single-tab | `N1_N2_*` |
| O1–O5 | auth / opacity / validation / wipe Forwarding | `O1_*` `O2_*` `O3_*` `O5_*` |

## Organization

| File | Role |
|------|------|
| `Support`-free root helpers | `MotorActClient`, `DiagnosticsAssertClient`, `MotorAssertHost`, `MotorAssertTokens` |
| `LifecycleAndNavigateTests` | A / B |
| `InputFramesPopupTests` | C / D3–D4 / N / I2 / I4 / B4 |
| `PersistenceDrainInjectionTests` | E / F / G / H |
| `InputResizeProbeGovernanceTests` | D1 / L / M / O / J1 / K2 |
| `JsBridgeHostingMiscTests` | I1 / I3 / J3 / J7 / A2 / O5 |

P (unit/contract) stays in `Speculum.Api.Tests` + sidecar Vitest under the fast gate.
