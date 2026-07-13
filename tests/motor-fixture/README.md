# Motor fixture (CI)

Deterministic HTTPS site that Chromium inside the Speculum sidecar opens during the **`motor-assertive`** GitHub Actions job.

## Not for local day-to-day

Do **not** routinely run sidecar+Chrome+fixture on a laptop. That stack is intentionally cloud-CI-only (see CONTRIBUTING / Phase 3 plan). This folder is pulled by `deploy/compose/docker-compose.motor-assert.yml`.

## Roles

| Container | Host | Purpose |
|-----------|------|---------|
| `fixture` | `fixture.test` | Allowlisted Forwarding.host pages |
| `evil-fixture` | `evil-fixture.test` | Off-allowlist host for reject / redirect / asset tests |

## Routes (`FIXTURE_ROLE=good`)

| Path | Contract |
|------|----------|
| `/health` (HTTP on `HEALTH_PORT`) | `{ ok: true }` readiness |
| `/`, `/home` | cookie `sf_marker`, LS `sf_ls`, IDB, `#speculum-probe` |
| `/set-state` | persistence markers |
| `/click-target` | button fixed at (100,100)–(300,180); click `(200,140)`; wheel + key hooks |
| `/nav/a`, `/nav/b` | history |
| `/external-link` | link to evil-fixture |
| `/asset-escape` | img/fetch to evil-fixture (subresource) |
| `/popup` | window.open / target=_blank / form |
| `/inject-probe` | host for ScriptInjection marker |
| `/console-noise` | `console.log` for JsBridge |
| `/fat-dom` | oversized DOM for probe size caps |
| `/redirect` → `/redirect/end` | redirect chain |
| `/spa` | pushState |

## TLS

Self-signed cert minted with openssl at first start. Sidecar must launch Chrome with `SPECULUM_IGNORE_CERT_ERRORS=1` in motor-assert compose.
