# Contributing to Speculum

Thank you for improving Speculum. This guide covers local workflow, quality expectations, and where to place changes.

> **Releases:** Versions and `CHANGELOG.md` are owned by [Release Please](https://github.com/googleapis/release-please). Do not hand-edit semver tags or invent parallel version schemes. V1 still forbids backward-compat config/API shims unless explicitly requested post-launch.

---

## Before you start

1. Read **[docs/engineering-standards.md](docs/engineering-standards.md)** — mandatory quality / architecture / testing constitution (AI agents: [AGENTS.md](AGENTS.md)).
2. For UI work under `web/`, also read **[docs/frontend-standards.md](docs/frontend-standards.md)** and [docs/frontend-patterns.md](docs/frontend-patterns.md).
3. Read [readme.md](readme.md) for repository layout.
4. Read [docs/architecture.md](docs/architecture.md) if your change crosses API, web, or sidecar boundaries.
5. Deploy changes should go through [deploy/README.md](deploy/README.md) (dockup manifest), not ad-hoc compose edits in `deploy/out/`.
6. **Ad-hoc / workaround code is strictly forbidden** — fix the designed algorithm (stream, mirror, ledger, apply). Never paper over failures with a second path that restores a banned cost (e.g. cold full DomMap “bootstrap” after a stream seed). See [docs/page-projection-acceptance.md](docs/page-projection-acceptance.md).

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

Refactor-only (legacy root `Speculum.sln` / MotorAssert / root `web`+`sidecar` are **not** in CI until `Refactor/` is promoted):

| Job | Role |
|-----|------|
| `refactor-dotnet` | Journal + Sessions + Telemetry unit tests |
| `refactor-sidecar` / `refactor-web` | npm test (+ lint/build for web) |
| `refactor-compose` / `refactor-dockup` | compose + dockup validate |
| **`sessions-test`** | Refactor Act→Assert stack (Chrome) |

**Branch protection on `main` is mandatory** — require every CI job above **and** the PR title check. Prefer **squash merge** so the merge commit subject is the PR title (Release Please reads conventional commits on `main` only after merge).

Release Please runs only after **CI succeeds** on a **push** to `main` (not on red CI, not on PR branches). After it creates a GitHub Release it **dispatches** Docker Hub publish (`workflow_dispatch`); publish still waits for CI green on the release SHA. Without branch protection, a force-merge of a red PR can still land commits on `main` that later enter a release — set protection before relying on the release flow.

### Code principles

Full constitution: **[docs/engineering-standards.md](docs/engineering-standards.md)**.

- **Minimal scope** — one logical change per commit/PR when possible.
- **Match conventions** — follow [docs/naming.md](docs/naming.md) (Speculum / Motor / W7S vocabulary).
- **No drive-by refactors** — avoid unrelated formatting or renames.
- **Tests when behaviour changes** — pyramid: units (Api / sidecar / web) + MotorAssert Act→Assert on CI Chrome; Perf only for SLOs. Extend MATRIX when coverage depth changes. Never weaken asserts to get green ([docs/assert-failure-policy.md](docs/assert-failure-policy.md)).
- **Frontend** — shadcn-only, revealing UI, enriched visualization of complex data/flows ([docs/frontend-standards.md](docs/frontend-standards.md)).
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
| Frontend UX / IA / shadcn patterns | `docs/frontend-standards.md`, `docs/frontend-patterns.md`, `.cursor/rules/speculum-frontend-standards.mdc` |
| Cross-cutting design | `docs/architecture.md`, `docs/naming.md` |
| Diagnostics / Act→Assert | `docs/diagnostics.md`, `docs/assert-failure-policy.md`, `Speculum.MotorAssert.Tests/MATRIX.md` |
| W7S sidecar wire | `docs/w7s-sidecar-protocol.md` |
| Motor / protocol | `docs/motor-reference.md` |
| Deploy | `deploy/README.md` |
| Component | `Speculum.Api/`, `web/`, or `sidecar/` README |

---

## Pull requests

1. Branch from `main` (or `master`).
2. Use a **Conventional Commits** PR title (enforced by CI), e.g. `feat: …`, `fix: …`, `perf: …`, `chore: …`, `docs: …`, `ci: …`, `test: …`, `refactor: …`.
3. **Squash-merge** into `main` so the squash commit subject matches that title.
4. Ensure CI checks pass (including MotorAssert and PR title).
5. Describe **what** changed and **why** in the PR body.
6. Include a test plan (commands run, manual steps for UI if applicable).

Feature merges only run CI. Version bumps happen via the bot **Release PR** (changelog + `version.txt` + manifest), not by hand.

---

## Releases and Docker Hub

Single-repo semver (see `.release-please-manifest.json` / `version.txt`). Pre-1.0 until the product is ready for a major launch. Current baseline is whatever `main` last released (e.g. `0.2.0`).

| Step | What happens |
|------|----------------|
| Feature PR → `main` | CI only |
| Release Please on `main` | Opens/updates a **Release PR** (after CI green on the push) |
| Merge Release PR | Bumps `version.txt` / manifest / changelog; next Release Please run creates GitHub Release + tag `vX.Y.Z` |
| Release Please → `Publish images` | On `release_created`, dispatches **Publish images** via `workflow_dispatch` with that tag (required: `GITHUB_TOKEN` release events do **not** start other workflows) |
| `Publish images` | Waits for CI green on that SHA, then `dockup deploy --env prod` pushes `websete/speculum-{api,sidecar,web}:X.Y.Z` and retags `:latest` |

**Gates:** red CI blocks merge to `main` (branch protection), blocks Release Please (only runs after CI success on push to `main`), and blocks Docker Hub publish (`wait-ci`). PR branch commits never bump the version — only squash-merges onto `main` feed Release Please; the version tag only ships when the **Release PR** merges and Release Please creates the GitHub Release.

Repo Actions settings must allow the default `GITHUB_TOKEN` to **create pull requests** (Release Please) and workflows need `actions: write` on the Release Please job (already set) so it can dispatch publish.

VPS redeploy stays **manual** (no Watchtower / CI→Hostinger). Prod dockup pull tag is `:latest` — after Hub publish finishes, regenerate/redeploy compose on the VPS when you want the new images.

### Operator setup (once)

```bash
gh secret set DOCKERHUB_USERNAME
gh secret set DOCKERHUB_TOKEN
```

Branch protection on `main`: require CI jobs + PR title check; enable squash merge.

**Manual republish** (rare): `gh workflow run "Publish images" -f tag=vX.Y.Z` or create/publish a GitHub Release for that tag (human-authored `release` events still trigger publish).

Details: [Refactor/deploy/README.md](Refactor/deploy/README.md) (Releases and image publish).

---

## Security

- Report sensitive issues privately to repository maintainers — do not open public issues for undisclosed vulnerabilities.
- `/vhub` is intentionally public at the API layer; document edge protections if you change auth boundaries.
