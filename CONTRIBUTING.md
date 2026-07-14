# Contributing to Speculum

Thank you for improving Speculum. This guide covers local workflow, quality expectations, and where to place changes.

> **V1.0.0 development:** The project is **not released**. Do not add semver tags, release notes, or backward-compatibility shims unless explicitly requested for a future launch. Breaking config/API changes are acceptable while V1 is in development.

---

## Before you start

1. Read **[docs/engineering-standards.md](docs/engineering-standards.md)** — mandatory quality / architecture / testing constitution (AI agents: [AGENTS.md](AGENTS.md)).
2. Read [readme.md](readme.md) for repository layout.
3. Read [docs/architecture.md](docs/architecture.md) if your change crosses API, web, or sidecar boundaries.
4. Deploy changes should go through [deploy/README.md](deploy/README.md) (dockup manifest), not ad-hoc compose edits in `deploy/out/`.

---

## Development setup

### Full stack (recommended for integration testing)

Requires [@rodrigopjax/dockup](https://github.com/rpjax/npm-dockup) **>= 2.0.2**.

```bash
cd deploy && cp speculum.dockup.example.json speculum.dockup.json
dockup validate -c speculum.dockup.example.json --root ..   # also works before copy
# or, after copy: dockup validate --root ..
dockup deploy --env dev --root ..
```

### Component-only (faster iteration)

Run sidecar, API, and web separately — see component READMEs:

- [Speculum.Api/README.md](Speculum.Api/README.md)
- [web/README.md](web/README.md)
- [sidecar/README.md](sidecar/README.md)

---

## Quality bar

### Local (fast gate — no Chrome)

```bash
dotnet test Speculum.sln -c Release --filter "Category!=MotorAssertive&Category!=MotorPerf"
cd sidecar && npm ci && npm test
cd web && npm ci && npm test && npm run lint && npm run build
cd deploy && dockup validate -c speculum.dockup.example.json --root ..
docker compose -f deploy/compose/docker-compose.motor-assert.yml config
```

If you maintain a local `deploy/speculum.dockup.json` (gitignored), `dockup validate --root ..` from `deploy/` works the same.

Do **not** routinely run the motor-assertive Docker stack (sidecar + Xvfb + Chromium) on a laptop — that job is GitHub Actions only.

### CI (required for `main`)

| Job | Role |
|-----|------|
| `dotnet` / `sidecar` / `web` / `compose` / `dockup` | Fast gate |
| **`motor-assertive`** | Fixture Node + API + sidecar/Chrome; Act→Assert via diagnostics |

Branch protection on `main` should require **all** of the above checks (especially `motor-assertive`).

MotorAssert sources: `Speculum.MotorAssert.Tests/` + fixture `tests/motor-fixture/` + compose `deploy/compose/docker-compose.motor-assert.yml`.

### Code principles

Full constitution: **[docs/engineering-standards.md](docs/engineering-standards.md)**.

- **Minimal scope** — one logical change per commit/PR when possible.
- **Match conventions** — follow [docs/naming.md](docs/naming.md) (Speculum / Motor / W7S vocabulary).
- **No drive-by refactors** — avoid unrelated formatting or renames.
- **Tests when behaviour changes** — pyramid: units (Api / sidecar / web) + MotorAssert Act→Assert on CI Chrome; Perf only for SLOs. Extend MATRIX when coverage depth changes. Never weaken asserts to get green ([docs/known-red-ci.md](docs/known-red-ci.md)).
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
| Engineering standards (agents + humans) | `docs/engineering-standards.md`, `AGENTS.md` |
| Cross-cutting design | `docs/architecture.md`, `docs/naming.md` |
| Diagnostics / Act→Assert | `docs/diagnostics.md`, `Speculum.MotorAssert.Tests/MATRIX.md` |
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
