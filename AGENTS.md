# AGENTS.md — Speculum

You are working in the **Speculum** remote browser isolation repository.

## Mandatory reading order

1. **[docs/engineering-standards.md](docs/engineering-standards.md)** — constitution (architecture, code, tests, CI, anti-patterns). **Always apply.**
2. [docs/naming.md](docs/naming.md) — Speculum / Sessions / W7S vocabulary.
3. [docs/architecture.md](docs/architecture.md) — domains and flows (if the change crosses boundaries).
4. [docs/diagnostics.md](docs/diagnostics.md) — Act→Assert contracts (if the change touches observability or MotorAssert).
5. [Speculum.MotorAssert.Tests/MATRIX.md](Speculum.MotorAssert.Tests/MATRIX.md) — coverage truth for session CI (legacy project name).
6. [docs/assert-failure-policy.md](docs/assert-failure-policy.md) — when asserts fail; do **not** weaken to get green.
7. **When changing `web/`:** [docs/frontend-standards.md](docs/frontend-standards.md) + [docs/frontend-patterns.md](docs/frontend-patterns.md) — shadcn-only, revealing UI, complex-viz, anti-god-page. **Mandatory for frontend work.**

## Non-negotiable

- **No ad-hoc / workaround code — ever. Carved in stone.** If the designed algorithm fails (stream, table apply, resync), **fix that algorithm**. Never reintroduce a banned path (e.g. full DomMap dump / “bootstrap” after stream seed on cold) “just to get green / hopdiag / a live surface”. Ad-hoc is **strictly forbidden**; green via workaround is a product defect. Same law: [docs/engineering-standards.md](docs/engineering-standards.md), [docs/page-projection/spec/acceptance.md](docs/page-projection/spec/acceptance.md) (T3 / V4), [CONTRIBUTING.md](CONTRIBUTING.md). **PageProjection spec index:** [docs/page-projection/spec/README.md](docs/page-projection/spec/README.md) — do not implement from `docs/page-projection/archive/`.
- **PageProjection accept = absolute 1:1 parity** with the original site (Projected ≈ opening Virtual’s target in a normal browser). Protocol recovery / green smoke alone never prove accept — see [docs/page-projection/spec/acceptance.md](docs/page-projection/spec/acceptance.md).
- **Effect asserts**, not smoke (`200` / `ok: true` alone).
- Missing JSON properties **fail** — never skip-if-absent.
- Never publish a catalogued Sessions/Sidecar DiagProbe **failure** without `errorCode` + `phase` (see [docs/diagnostics.md](docs/diagnostics.md)).
- **Diagnostics** — **capability toggles per domain** (not levels); the transport is domain-agnostic (gate only by catalog `descriptor` + `IsCapabilityEnabled`, never hardcode event/domain names, every emitted event has a descriptor). `Telemetry.SampleCollected` is one composite sample; sections and identity are opt-in per toggle, redaction stays read-time.
- **Functional ≠ Perf** — capacity/SLO belongs in `perf.yml`, not as a substitute for correctness.
- **V1 development** — no backward-compat shims or config aliases unless explicitly requested post-launch.
- Minimal, convention-matched diffs; no drive-by renames.
- **Frontend:** shadcn-only; revealing UI; no god pages/components; complex data visualized — not dumped ([docs/frontend-standards.md](docs/frontend-standards.md)).

## MotorAssert harness (when touching CI tests)

`MotorAssert` is the legacy proper name of the existing test project and
category; it does not define vocabulary for new product code.

- Serial shared stack — `MotorAssertTestBase` runs `EnsureBaselineAsync` before each test.
- Clear **Diagnostics Degraded** (`POST /api/admin/diagnostics/v1/recover`) before BrowserQuery probes.
- **Export:** `WaitStateExportCompletedAsync(connectionId, …)` — never match another test's export.
- **ConfigApplied wait:** only Diagnostics / Hosting sections.

Cursor injects a short form of this as [`.cursor/rules/speculum-engineering-standards.mdc`](.cursor/rules/speculum-engineering-standards.mdc) (`alwaysApply: true`).

When editing `web/**/*.{ts,tsx,css}`, Cursor also injects [`.cursor/rules/speculum-frontend-standards.mdc`](.cursor/rules/speculum-frontend-standards.mdc) (`globs` scoped).

## Human workflow

[CONTRIBUTING.md](CONTRIBUTING.md) — local gates, PR expectations, secrets.
