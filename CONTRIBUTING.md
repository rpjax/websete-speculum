# Contributing to Speculum

Thank you for improving Speculum. This guide covers local workflow, quality expectations, and where to place changes.

> **V1.0.0 development:** The project is **not released**. Do not add semver tags, release notes, or backward-compatibility shims unless explicitly requested for a future launch. Breaking config/API changes are acceptable while V1 is in development.

---

## Before you start

1. Read [readme.md](readme.md) for repository layout.
2. Read [docs/architecture.md](docs/architecture.md) if your change crosses API, web, or sidecar boundaries.
3. Deploy changes should go through [deploy/README.md](deploy/README.md) (dockup manifest), not ad-hoc compose edits in `deploy/out/`.

---

## Development setup

### Full stack (recommended for integration testing)

Requires [@rodrigopjax/dockup](https://github.com/rpjax/npm-dockup) **>= 2.0.2**.

```bash
cd deploy && cp speculum.dockup.example.json speculum.dockup.json
dockup validate --root ..
dockup deploy --env dev --root ..
```

### Component-only (faster iteration)

Run sidecar, API, and web separately — see component READMEs:

- [Speculum.Api/README.md](Speculum.Api/README.md)
- [web/README.md](web/README.md)
- [sidecar/README.md](sidecar/README.md)

---

## Quality bar

All PRs should pass local verification:

```bash
dotnet test Speculum.sln -c Release
cd sidecar && npm ci && npm test
cd web && npm ci && npm run lint && npm run build
cd deploy && dockup validate --root ..
```

CI (`.github/workflows/ci.yml`) enforces dotnet, sidecar, web, compose, and dockup validate on every push/PR.

### Code principles

- **Minimal scope** — one logical change per commit/PR when possible.
- **Match conventions** — follow [docs/naming.md](docs/naming.md) (Speculum / Motor / W7S vocabulary).
- **No drive-by refactors** — avoid unrelated formatting or renames.
- **Tests when behaviour changes** — extend `Speculum.Api.Tests` or sidecar tests for regressions; web tests are lint + build unless you add behavioural tests.

---

## Project boundaries

| Change type | Location |
|-------------|----------|
| API / SignalR / config store | `Speculum.Api/` |
| Motor UI / admin UI | `web/src/features/` |
| Chrome / screencast / input | `sidecar/src/` |
| Container images / Traefik | `deploy/speculum.dockup.example.json`, Dockerfiles |
| Architecture docs | `docs/` |
| User-facing overview | `readme.md` |

---

## Configuration and secrets

- Never commit `deploy/speculum.dockup.json` (gitignored).
- Never commit `.env` files with real API keys.
- Use `ADMIN_BOOTSTRAP_KEY` only for local/bootstrap scenarios.
- Update `speculum.dockup.example.json` when adding new **required** deploy env vars.

---

## Documentation

When you change behaviour, update the relevant README in the same PR:

| Area | Document |
|------|----------|
| Cross-cutting design | `docs/architecture.md`, `docs/naming.md` |
| W7S sidecar wire | `docs/w7s-sidecar-protocol.md` |
| Motor / protocol | `docs/motor-reference.md` |
| Deploy | `deploy/README.md` |
| Component | `Speculum.Api/`, `web/`, or `sidecar/` README |

---

## Pull requests

1. Branch from `main` (or `master`).
2. Ensure CI checks pass.
3. Describe **what** changed and **why** in the PR body.
4. Include a test plan (commands run, manual steps for UI if applicable).

---

## Security

- Report sensitive issues privately to repository maintainers — do not open public issues for undisclosed vulnerabilities.
- `/vhub` is intentionally public at the API layer; document edge protections if you change auth boundaries.
