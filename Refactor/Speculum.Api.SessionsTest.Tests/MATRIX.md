# SessionsTest MATRIX (Refactor)

Coverage truth for `Category=SessionsTest` in `Speculum.Api.SessionsTest.Tests`.
Stack: `Refactor/deploy/compose/docker-compose.sessions-test.yml` + explicit Telemetry event seed
(`PUT /api/configurations/Telemetry` via `seed-sessions-test.sh`).

**Readiness:** C (input) and D (resize) rows below are **deep** Act→Assert coverage —
effect probes (fixture DOM / Chrome geometry) plus catalogued journal facts, not HTTP
smoke. CI job `sessions-test` boots the compose stack with `SPECULUM_BYPASS_API_AUTH`
and mandatory Sessions/ResourceManagement/Navigation env so `/health/ready` passes
before seed + `dotnet test --filter Category=SessionsTest`.

Opt-in Telemetry event types (`Telemetry.Sessions.Input.Applied`, `Telemetry.Sessions.Input.Rejected`,
`Telemetry.Sessions.Resize.Applied`, `Telemetry.Sessions.Resize.Rejected`) are **off by default** and enabled
only via `PUT /api/configurations/Telemetry` (seed script / test baseline).

| ID | Depth | Assert | Method |
|----|-------|--------|--------|
| C1 | deep | mouse click increments `#out[data-clicks]` + `Telemetry.Sessions.Input.Applied` | `C1_mouse_click_increments_fixture_counter` |
| C2 | deep | keydown → `__SPECULUM_LAST_KEY__` | `C2_keydown_reaches_fixture` |
| C3 | deep | wheel → `__SPECULUM_WHEEL__` | `C3_wheel_sets_fixture_flag` |
| C4 | deep | invalid `paste` → `Telemetry.Sessions.Input.Rejected`; click still works | `C4_invalid_input_type_does_not_mutate_page` |
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

Migrated from legacy MotorAssert resize depth (exact geometry / reject-keep-prior). Soft-viewport
`displayWidth`/`displayHeight` assert Sessions.ViewportPolicy Maximum (compose default 4096×2160).

Fixture: `tests/motor-fixture` (`/click-target`, `/touch-scroll`).
