# SessionsTest MATRIX (Refactor)

Coverage truth for `Category=SessionsTest` in `Speculum.Api.SessionsTest.Tests`.
Stack: `Refactor/deploy/compose/docker-compose.sessions-test.yml` + explicit Telemetry event seed
(`PUT /api/configurations/Telemetry` via `seed-sessions-test.sh`).

**Readiness:** C (input) and D (resize) rows below are **deep** Act→Assert coverage —
effect probes (fixture DOM / Chrome geometry) plus catalogued journal facts, not HTTP
smoke. CI job `sessions-test` boots the compose stack with `SPECULUM_BYPASS_API_AUTH`
and mandatory Sessions/ResourceManagement/Navigation env so `/health/ready` passes
before seed + `dotnet test --filter Category=SessionsTest`.

Opt-in Telemetry event types (`Telemetry.Sessions.VideoStreamingInput.Applied`, `Telemetry.Sessions.VideoStreamingInput.Rejected`,
`Telemetry.Sessions.Resize.Applied`, `Telemetry.Sessions.Resize.Rejected`) are **off by default** and enabled
only via `PUT /api/configurations/Telemetry` (seed script / test baseline).
D6 asserts the **absence** of the two `Resize.*` facts, so the seed must enable them.

| ID | Depth | Assert | Method |
|----|-------|--------|--------|
| C1 | deep | mouse click increments `#out[data-clicks]` + `Telemetry.Sessions.VideoStreamingInput.Applied` | `C1_mouse_click_increments_fixture_counter` |
| C2 | deep | keydown → `__SPECULUM_LAST_KEY__` | `C2_keydown_reaches_fixture` |
| C3 | deep | wheel → `__SPECULUM_WHEEL__` | `C3_wheel_sets_fixture_flag` |
| C4 | deep | invalid `paste` → `Telemetry.Sessions.VideoStreamingInput.Rejected`; click still works | `C4_invalid_input_type_does_not_mutate_page` |
| C5 | deep | malformed payload → `InputRejected`; session still accepts click | `C5_malformed_json_input_is_ignored` |
| C6 | deep | touch tap increments clicks (mobile profile) | `C6_touch_tap_increments_fixture_counter` |
| C7 | deep | touch cancel → cancels≥1, clicks stay 0 | `C7_touch_cancel_does_not_click` |
| C8 | deep | multitouch maxPoints≥2 | `C8_multitouch_reports_two_points` |
| C9 | deep | `InputRejected` payload has `input_invalid`; click recovers | `C9_input_rejected_emits_journal_then_click_works` |
| C10 | deep | `/touch-scroll` drag → `__SPECULUM_SCROLL__ > 20` | `C10_touch_scroll_moves_scrollTop` |
| C11 | deep | mobile profile → `maxTouchPoints` / DPR | `C11_mobile_device_profile_sets_maxTouchPoints` |
| C12 | deep | text → `__SPECULUM_INPUT__` | `C12_text_input_reaches_focused_field` |
| D1 | deep | soft resize 757×715 + journal + Chrome inner + screen + display*=policy max | `D1_resize_exact_geometry_applied` |
| D2 | deep | resize &lt;policy min rejected + prior 1280×720 kept + display* on reject | `D2_resize_below_policy_minimum_is_rejected` |
| D3 | unit+ | concurrent resize → `resize_busy` / `Outcome=Busy` (LiveSession unit; compose optional) | `Resize_WhenCommandGateBusy_ReturnsResizeBusy` |
| D4 | deep | launch 414×711 + mobile → Chrome inner + screen + display*=policy max (iPhone CSS) | `D4_mobile_iphone_logical_viewport_at_launch` |
| D5 | deep | mobile soft resize 414×711→390×844 + journal + Chrome inner + screen + display*=max | `D5_mobile_soft_resize_keeps_logical_geometry` |
| B1 | deep | Navigate path → location + SyncUrl journal path | `B1_navigate_updates_location` |
| H1 | deep | goback after two navigations updates location | `H1_goback_updates_location` |
| N1 | deep | window.open/_blank stays single main tab | `N1_blank_stays_single_tab` |
| E8b | unit+ | dirty cookie PUT state + sanitize does not fail restore (ProfileService + sidecar unit) | `ReplaceState_WithDirtyCookies_PersistsBucket` / `testCookieSanitizeMatrix` |
| D6 | deep | stable client screen for a whole PageProjection session emits **zero** `Telemetry.Sessions.Resize.*` facts (start owns the initial geometry; no corrective resize) | `D6_stable_screen_session_never_resizes` |

Migrated from legacy MotorAssert resize depth (exact geometry / reject-keep-prior). Soft-viewport
`displayWidth`/`displayHeight` assert Sessions.ViewportPolicy Maximum (compose default 4096×2160).

**D6 is the sensor for the rule in stone:** a client screen that stayed stable for the whole
session must never resize. The client learns `Sessions.MirrorMode` + `ViewportPolicy` from
`GET /api/public/client-config` before Start, mounts the definitive surface and starts at exactly
that geometry, so any `Resize` fact on a stable screen is a product bug — assert its **absence**,
never soften it. The server cannot truthfully emit a "box did not change" fact (only the client
knows its own box), so absence-of-fact is the assert; `Telemetry.Sessions.Resize.Applied` /
`.Rejected` must be enabled in the seed for D6 to mean anything.

Fixture: `tests/motor-fixture` (`/click-target`, `/touch-scroll`, `/nav/*`).
