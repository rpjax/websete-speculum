# AGENTS.md — Speculum

You are working in the **Speculum** remote browser isolation repository.

## Mandatory reading order

1. **[docs/engineering-standards.md](docs/engineering-standards.md)** — constitution (architecture, code, tests, CI, anti-patterns). **Always apply.**
2. [docs/naming.md](docs/naming.md) — Speculum / Motor / W7S vocabulary.
3. [docs/architecture.md](docs/architecture.md) — domains and flows (if the change crosses boundaries).
4. [docs/diagnostics.md](docs/diagnostics.md) — Act→Assert contracts (if the change touches observability or MotorAssert).
5. [Speculum.MotorAssert.Tests/MATRIX.md](Speculum.MotorAssert.Tests/MATRIX.md) — coverage truth for motor CI.
6. [docs/assert-failure-policy.md](docs/assert-failure-policy.md) — when asserts fail; do **not** weaken to get green.
7. **When changing `web/`:** [docs/frontend-standards.md](docs/frontend-standards.md) + [docs/frontend-patterns.md](docs/frontend-patterns.md) — shadcn-only, revealing UI, complex-viz, anti-god-page. **Mandatory for frontend work.**

## Non-negotiable

- **Effect asserts**, not smoke (`200` / `ok: true` alone).
- Missing JSON properties **fail** — never skip-if-absent.
- Never publish a catalogued Motor/Sidecar DiagProbe **failure** without `errorCode` + `phase` (see [docs/diagnostics.md](docs/diagnostics.md)).
- **Functional ≠ Perf** — capacity/SLO belongs in `perf.yml`, not as a substitute for correctness.
- **V1 development** — no backward-compat shims or config aliases unless explicitly requested post-launch.
- Minimal, convention-matched diffs; no drive-by renames.
- **Frontend:** shadcn-only; revealing UI; no god pages/components; complex data visualized — not dumped ([docs/frontend-standards.md](docs/frontend-standards.md)).

## MotorAssert harness (when touching CI tests)

- Serial shared stack — `MotorAssertTestBase` runs `EnsureBaselineAsync` before each test.
- Clear **Diagnostics Degraded** (`POST /api/admin/diagnostics/v1/recover`) before BrowserQuery probes.
- **Export:** `WaitStateExportCompletedAsync(connectionId, …)` — never match another test's export.
- **ConfigApplied wait:** only Diagnostics / Hosting sections.

Cursor injects a short form of this as [`.cursor/rules/speculum-engineering-standards.mdc`](.cursor/rules/speculum-engineering-standards.mdc) (`alwaysApply: true`).

When editing `web/**/*.{ts,tsx,css}`, Cursor also injects [`.cursor/rules/speculum-frontend-standards.mdc`](.cursor/rules/speculum-frontend-standards.mdc) (`globs` scoped).

## Human workflow

[CONTRIBUTING.md](CONTRIBUTING.md) — local gates, PR expectations, secrets.
