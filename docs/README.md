# Speculum documentation

Technical documentation for the **Speculum** remote browser isolation platform (W7S).

> **V1.0.0** is in **active development** (not released). Documentation describes the current codebase; there is no semver or backward-compatibility guarantee until launch is announced.

## Start here

| Document | Audience | Contents |
|----------|----------|----------|
| [../readme.md](../readme.md) | Everyone | Project overview, quick start, repository map |
| [architecture.md](architecture.md) | Architects, operators | System design, data flows, security boundaries |
| [diagnostics.md](diagnostics.md) | Backend / QA / Phase 3 | Assertable observability contracts + Assert Cookbook |
| [motor-reference.md](motor-reference.md) | Backend / motor developers | Session lifecycle, forwarding model, binary protocol |
| [../deploy/README.md](../deploy/README.md) | DevOps | **Canonical deploy** via [dockup](https://github.com/rpjax/npm-dockup) |

## Component guides

| Component | Path | README |
|-----------|------|--------|
| API (.NET 10) | `Speculum.Api/` | [README](../Speculum.Api/README.md) |
| Web client (React) | `web/` | [README](../web/README.md) |
| Browser sidecar (Node) | `sidecar/` | [README](../sidecar/README.md) |
| Tests | `Speculum.Api.Tests/` | [README](../Speculum.Api.Tests/README.md) |

## Archive

| Document | Description |
|----------|-------------|
| [archive/w7-go-engine.md](archive/w7-go-engine.md) | Legacy **W7 Go MITM engine** reference (pre-Speculum rewrite). Kept for historical context only. |

## Conventions

- **Deploy:** always use `deploy/` + dockup. Do not hand-edit `deploy/out/` — it is generated.
- **Configuration:** infrastructure via environment variables; motor behaviour via SQLite + Admin API.
- **Domains:** same-origin — SPA, `/api`, and `/vhub` share one motor host; `EdgeSynchronizer` materializes Traefik routes per **Hosting** profile.
- **Naming:** see [naming.md](naming.md) (Speculum / Motor / W7S vocabulary).
