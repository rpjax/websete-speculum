# Sessions Assert MATRIX (Refactor)

Coverage truth for `Category=SessionsAssertive` in `Speculum.Api.Assert.Tests`.
Stack: `Refactor/deploy/compose/docker-compose.sessions-assert.yml` + explicit journal seed.

Opt-in journal types (`Sessions.InputApplied`, `Sessions.ResizeApplied`, `Sessions.ResizeRejected`)
are **off by default** and enabled only via `PUT /api/dev/engine-config` (seed script).

| ID | Depth | Assert | Method |
|----|-------|--------|--------|
| C1 | deep | mouse click increments `#out[data-clicks]` + `Sessions.InputApplied` | `C1_mouse_click_increments_fixture_counter` |
| C2 | deep | keydown → `__SPECULUM_LAST_KEY__` | `C2_keydown_reaches_fixture` |
| C3 | deep | wheel → `__SPECULUM_WHEEL__` | `C3_wheel_sets_fixture_flag` |
| C4 | deep | invalid `paste` → `Sessions.InputRejected`; click still works | `C4_invalid_input_type_does_not_mutate_page` |
| C5 | deep | malformed payload → `InputRejected`; session still accepts click | `C5_malformed_json_input_is_ignored` |
| C6 | deep | touch tap increments clicks (mobile profile) | `C6_touch_tap_increments_fixture_counter` |
| C7 | deep | touch cancel → cancels≥1, clicks stay 0 | `C7_touch_cancel_does_not_click` |
| C8 | deep | multitouch maxPoints≥2 | `C8_multitouch_reports_two_points` |
| C9 | deep | `InputRejected` payload has `input_invalid`; click recovers | `C9_input_rejected_emits_journal_then_click_works` |
| C10 | deep | `/touch-scroll` drag → `__SPECULUM_SCROLL__ > 20` | `C10_touch_scroll_moves_scrollTop` |
| C11 | deep | mobile profile → `maxTouchPoints` / DPR | `C11_mobile_device_profile_sets_maxTouchPoints` |
| C12 | deep | text → `__SPECULUM_INPUT__` | `C12_text_input_reaches_focused_field` |
| D1 | deep | resize 757×715 applied + journal + evaluate | `D1_resize_exact_geometry_applied` |
| D2 | deep | resize &lt;100 rejected + prior size kept | `D2_resize_below_100_is_rejected` |

Fixture: `tests/motor-fixture` (`/click-target`, `/touch-scroll`).
