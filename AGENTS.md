# AGENTS.md — Speculum

You are working in the **Speculum** remote browser isolation repository.

## Mandatory reading order

1. **[docs/engineering-standards.md](docs/engineering-standards.md)** — constitution (architecture, code, tests, CI, anti-patterns). **Always apply.**
2. [docs/naming.md](docs/naming.md) — Speculum / Motor / W7S vocabulary.
3. [docs/architecture.md](docs/architecture.md) — domains and flows (if the change crosses boundaries).
4. [docs/diagnostics.md](docs/diagnostics.md) — Act→Assert contracts (if the change touches observability or MotorAssert).
5. [Speculum.MotorAssert.Tests/MATRIX.md](Speculum.MotorAssert.Tests/MATRIX.md) — coverage truth for motor CI.
6. [docs/assert-failure-policy.md](docs/assert-failure-policy.md) — when asserts fail; do **not** weaken to get green.

## Non-negotiable

- **Effect asserts**, not smoke (`200` / `ok: true` alone).
- Missing JSON properties **fail** — never skip-if-absent.
- **Functional ≠ Perf** — capacity/SLO belongs in `perf.yml`, not as a substitute for correctness.
- **V1 development** — no backward-compat shims or config aliases unless explicitly requested post-launch.
- Minimal, convention-matched diffs; no drive-by renames.

## MotorAssert harness (when touching CI tests)

- Serial shared stack — `MotorAssertTestBase` runs `EnsureBaselineAsync` before each test.
- Clear **Diagnostics Degraded** (`POST /api/admin/diagnostics/v1/recover`) before BrowserQuery probes.
- **Export:** `WaitStateExportCompletedAsync(connectionId, …)` — never match another test's export.
- **ConfigApplied wait:** only Diagnostics / Hosting sections.

Cursor injects a short form of this as [`.cursor/rules/speculum-engineering-standards.mdc`](.cursor/rules/speculum-engineering-standards.mdc) (`alwaysApply: true`).

## Human workflow

[CONTRIBUTING.md](CONTRIBUTING.md) — local gates, PR expectations, secrets.
