# SessionsTest MATRIX (Refactor)

Coverage truth for `Category=SessionsTest` / `Category=PageProjection` in
`Speculum.Api.SessionsTest.Tests`.
Stack: `deploy/compose/docker-compose.sessions-test.yml` + explicit Telemetry event seed
(`PUT /api/configurations/Telemetry` via `seed-sessions-test.sh` + fixture baseline).
Compose includes `fixture.test` (good) and `evil-fixture.test` (`FIXTURE_ROLE=evil`) — PP4
off-allowlist nav uses `/external-link` → `window.goEvil()`.

**Product law:** `MirrorMode.PageProjection` is the product. `VideoStreaming` is **legacy**
residual — C* rows force `mirrorMode=videoStreaming` via GET→patch→PUT before Start.
Do not treat green C* as PageProjection accept.

**Readiness:** C (legacy Video input) and D (resize) rows below are **deep** Act→Assert —
effect probes (fixture DOM / Chrome geometry) plus catalogued journal facts, not HTTP
smoke. PP1–PP5 and B5.* are product PageProjection effect asserts (frames / intent click /
admit carimbo / resync / Redirect / profile restore / CPU probe). CI:
- `Category=SessionsTest` (includes C*, D*, B1/H1/N1, and PP*/B5* which also carry SessionsTest)
- `Category=PageProjection` (PP1–PP5, B5.*) — product filter

Opt-in Telemetry event types (`Telemetry.Sessions.VideoStreamingInput.*`,
`Telemetry.Sessions.Resize.*`, `Telemetry.Sessions.PageProjection.Frame.ResyncRequested`,
`FrameReceived`, `PageProjection.Input.Applied`/`Rejected`) are **off by default** and enabled via seed / fixture baseline.
D6 asserts the **absence** of the two `Resize.*` facts, so the seed must enable them.

| ID | Depth | Assert | Method | Mode |
|----|-------|--------|--------|------|
| **PP1** | deep | Start → Diff frame body + `contextId` + sequence | `PP1_start_emits_frame_with_body_context_and_sequence` | PageProjection |
| **PP1b** | deep | Admit scroll page / scroll element / keyDown / nested-context down → `lastIntent` schemaVersion+viewport+census | `PP1b_admit_stamp_survives_scroll_key_and_nested_click` | PageProjection |
| **PP2** | deep | Intent resolve-click `#btn` → `#out[data-clicks]` 0→1 | `PP2_intent_click_increments_fixture_counter` | PageProjection |
| **PP2b** | deep | Admit intent (carimbo completo) → `Input.Applied`/`cdp_applied` + `lastIntent` schemaVersion/viewport/census + clicks 0→1 | `PP2b_admit_intent_forwards_stamp_and_applies_click` | PageProjection |
| **PP2c** | deep | Admit intent viewport divergente → `Input.Rejected`/`stale_viewport`; clicks stay 0 | `PP2c_admit_intent_stale_viewport_rejects_without_click` | PageProjection |
| **PP3** | deep | POST resync → `ResyncRequested` + resync-flagged frame + Virtual still ready | `PP3_resync_delivers_resync_frame_and_keeps_virtual_armed` | PageProjection |
| **PP4** | deep | off-allowlist nav → `Sessions.MainFrameNavigationBlocked` + hub `Redirect` | `PP4_off_allowlist_nav_redirects_and_journals_blocked` | PageProjection |
| **B5.1** | deep | same as PP4 (allowlist block + hub `Redirect`) | `PP4_off_allowlist_nav_redirects_and_journals_blocked` | PageProjection |
| **B5.2** | deep | `/home` LS+IDB → stop export → same `ProfileId` → `ProfileStateRestored` + evaluate | `B5_2_profile_ls_idb_round_trip_after_stop_export` | PageProjection |
| **B5.3** | deep | `/permissions` default deny; harness grant → camera+mic `granted` on Virtual evaluate | `B5_3_permission_gate_default_deny_registered_grant_allows` | PageProjection |
| **B5.4** | deep | `Sessions.CpuProfiling=true` → probe `startCpuProfile` ok (not full profile capture) | `B5_4_sessions_cpu_profiling_flag_propagates_and_probes_registered` | PageProjection |
| **PP5** | deep | stop export → `GET /api/profiles/{id}` LS+IDB counts ≥ 1 (no soft-skip) | `PP5_restore_profile_ls_idb_asserts_counts` | PageProjection |
| C1 | deep | mouse click increments `#out[data-clicks]` + `Telemetry.Sessions.VideoStreamingInput.Applied` | `C1_mouse_click_increments_fixture_counter` | legacy VideoStreaming |
| C2 | deep | keydown → `__SPECULUM_LAST_KEY__` | `C2_keydown_reaches_fixture` | legacy VideoStreaming |
| C3 | deep | wheel → `__SPECULUM_WHEEL__` | `C3_wheel_sets_fixture_flag` | legacy VideoStreaming |
| C4 | deep | invalid `paste` → `Telemetry.Sessions.VideoStreamingInput.Rejected`; click still works | `C4_invalid_input_type_does_not_mutate_page` | legacy VideoStreaming |
| C5 | deep | malformed payload → `InputRejected`; session still accepts click | `C5_malformed_json_input_is_ignored` | legacy VideoStreaming |
| C6 | deep | touch tap increments clicks (mobile profile) | `C6_touch_tap_increments_fixture_counter` | legacy VideoStreaming |
| C7 | deep | touch cancel → cancels≥1, clicks stay 0 | `C7_touch_cancel_does_not_click` | legacy VideoStreaming |
| C8 | deep | multitouch maxPoints≥2 | `C8_multitouch_reports_two_points` | legacy VideoStreaming |
| C9 | deep | `InputRejected` payload has `input_invalid`; click recovers | `C9_input_rejected_emits_journal_then_click_works` | legacy VideoStreaming |
| C10 | deep | `/touch-scroll` drag → `__SPECULUM_SCROLL__ > 20` | `C10_touch_scroll_moves_scrollTop` | legacy VideoStreaming |
| C11 | deep | mobile profile → `maxTouchPoints` / DPR | `C11_mobile_device_profile_sets_maxTouchPoints` | legacy VideoStreaming |
| C12 | deep | text → `__SPECULUM_INPUT__` | `C12_text_input_reaches_focused_field` | legacy VideoStreaming |
| D1 | deep | soft resize 757×715 + journal + Chrome inner + screen + display*=policy max | `D1_resize_exact_geometry_applied` | either |
| D2 | deep | resize &lt;policy min rejected + prior 1280×720 kept + display* on reject | `D2_resize_below_policy_minimum_is_rejected` | either |
| D3 | unit+ | concurrent resize → `resize_busy` / `Outcome=Busy` (LiveSession unit; compose optional) | `Resize_WhenCommandGateBusy_ReturnsResizeBusy` | either |
| D4 | deep | launch 414×711 + mobile → Chrome inner + screen + display*=policy max (iPhone CSS) | `D4_mobile_iphone_logical_viewport_at_launch` | either |
| D5 | deep | mobile soft resize 414×711→390×844 + journal + Chrome inner + screen + display*=max | `D5_mobile_soft_resize_keeps_logical_geometry` | either |
| B1 | deep | Navigate path → location + SyncUrl journal path | `B1_navigate_updates_location` | PageProjection |
| H1 | deep | goback after two navigations updates location (legacy Video harness `goback`) | `H1_goback_updates_location` | legacy VideoStreaming |
| N1 | deep | window.open/_blank stays single main tab | `N1_blank_stays_single_tab` | PageProjection |
| E8b | unit+ | dirty cookie PUT state + sanitize does not fail restore (ProfileService + sidecar unit) | `ReplaceState_WithDirtyCookies_PersistsBucket` / `testCookieSanitizeMatrix` | — |
| D6 | deep | stable client screen for a whole PageProjection session emits **zero** `Telemetry.Sessions.Resize.*` facts (start owns the initial geometry; no corrective resize) | `D6_stable_screen_session_never_resizes` | PageProjection |

Migrated from legacy MotorAssert resize depth (exact geometry / reject-keep-prior). Soft-viewport
`displayWidth`/`displayHeight` assert Sessions.ViewportPolicy Maximum (compose default 4096×2160).

**D6 is the sensor for the rule in stone:** a client screen that stayed stable for the whole
session must never resize. The client learns `Sessions.MirrorMode` + `ViewportPolicy` from
`GET /api/public/client-config` before Start, mounts the definitive surface and starts at exactly
that geometry, so any `Resize` fact on a stable screen is a product bug — assert its **absence**,
never soften it. The server cannot truthfully emit a "box did not change" fact (only the client
knows its own box), so absence-of-fact is the assert; `Telemetry.Sessions.Resize.Applied` /
`.Rejected` must be enabled in the seed for D6 to mean anything.

Fixture: `tests/motor-fixture` (`/click-target`, `/home`, `/permissions`, `/touch-scroll`, `/nav/*`, `/external-link`).
Compose sets `Sessions__CpuProfiling=true` for B5.4.

**Lab (sidecar, not SessionsTest CI):** `cssom-matrix-nested` — nested CSSOM + pixel diff (`npm run lab:cssom-matrix-nested`); `document-churn` — launch under doc replace + `document.install` telemetry (`npm run lab:document-churn`, `lab:document-churn-x10`). Coverage truth for lab folds: [seal-gaps.md](../docs/page-projection/spec/seal-gaps.md).
