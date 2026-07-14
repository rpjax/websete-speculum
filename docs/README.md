# Speculum documentation

[![CI](https://github.com/rpjax/websete-speculum/actions/workflows/ci.yml/badge.svg)](https://github.com/rpjax/websete-speculum/actions/workflows/ci.yml)
[![Perf](https://github.com/rpjax/websete-speculum/actions/workflows/perf.yml/badge.svg)](https://github.com/rpjax/websete-speculum/actions/workflows/perf.yml)

Technical documentation for the **Speculum** remote browser isolation platform (W7S).

> **V1.0.0** is in **active development** (not released). Documentation describes the current codebase; there is no semver or backward-compatibility guarantee until launch is announced.

## Start here

| Document | Audience | Contents |
|----------|----------|----------|
| **[engineering-standards.md](engineering-standards.md)** | **Agents + contributors (mandatory)** | **Architecture / code / testing / CI constitution** |
| **[frontend-standards.md](frontend-standards.md)** | **Agents + contributors (mandatory for `web/`)** | **Frontend UX constitution (shadcn, revealing UI, complex viz)** |
| [frontend-patterns.md](frontend-patterns.md) | Agents / frontend | Approved UX recipes and decision trees |
| [../AGENTS.md](../AGENTS.md) | AI agents | Short entry pointing at engineering + frontend standards |
| [../.cursor/rules/speculum-engineering-standards.mdc](../.cursor/rules/speculum-engineering-standards.mdc) | Cursor | Always-on rule summary (`alwaysApply: true`) |
| [../.cursor/rules/speculum-frontend-standards.mdc](../.cursor/rules/speculum-frontend-standards.mdc) | Cursor | Frontend rule when editing `web/**` |
| [../readme.md](../readme.md) | Everyone | Project overview, quick start, repository map |
| [architecture.md](architecture.md) | Architects, operators | System design, data flows, security boundaries |
| [naming.md](naming.md) | Developers / agents | Speculum / Motor / W7S vocabulary |
| [diagnostics.md](diagnostics.md) | Backend / QA | Assertable observability contracts + Assert Cookbook |
| [assert-failure-policy.md](assert-failure-policy.md) | CI / QA | Never weaken hardened asserts — triage product vs harness |
| [motor-reference.md](motor-reference.md) | Backend / motor developers | Session lifecycle, forwarding model, binary protocol |
| [../deploy/README.md](../deploy/README.md) | DevOps | **Canonical deploy** via [dockup](https://github.com/rpjax/npm-dockup) |

## Component guides

| Component | Path | README |
|-----------|------|--------|
| API (.NET 10) | `Speculum.Api/` | [README](../Speculum.Api/README.md) |
| Web client (React) | `web/` | [README](../web/README.md) |
| Browser sidecar (Node) | `sidecar/` | [README](../sidecar/README.md) |
| Tests | `Speculum.Api.Tests/` | [README](../Speculum.Api.Tests/README.md) |
| MotorAssert (CI Chrome) | `Speculum.MotorAssert.Tests/` | [README](../Speculum.MotorAssert.Tests/README.md) |
| Motor fixture site | `tests/motor-fixture/` | [README](../tests/motor-fixture/README.md) |

## Archive

| Document | Description |
|----------|-------------|
| [archive/w7-go-engine.md](archive/w7-go-engine.md) | Legacy **W7 Go MITM engine** reference (pre-Speculum rewrite). Kept for historical context only. |

## Conventions

- **Engineering law:** [engineering-standards.md](engineering-standards.md) (agents: [../AGENTS.md](../AGENTS.md)).
- **Frontend UX law:** [frontend-standards.md](frontend-standards.md) + [frontend-patterns.md](frontend-patterns.md) (shadcn-only; Cursor: [../.cursor/rules/speculum-frontend-standards.mdc](../.cursor/rules/speculum-frontend-standards.mdc)).
- **Deploy:** always use `deploy/` + dockup. Do not hand-edit `deploy/out/` — it is generated.
- **Configuration:** infrastructure via environment variables; motor behaviour via SQLite + Admin API.
- **Domains:** same-origin — SPA, `/api`, and `/vhub` share one motor host; `EdgeSynchronizer` materializes Traefik routes per **Hosting** profile.
- **Naming:** see [naming.md](naming.md) (Speculum / Motor / W7S vocabulary).
- **MotorAssert matrix:** [../Speculum.MotorAssert.Tests/MATRIX.md](../Speculum.MotorAssert.Tests/MATRIX.md).
