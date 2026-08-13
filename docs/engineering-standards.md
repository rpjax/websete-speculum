# Speculum Engineering Standards (mandatory)

**Audience:** humans and AI agents changing this repository.  
**Status:** constitution — not optional guidance.  
**If this conflicts with convenience, this wins.**

Read this **before** multi-file or sessions/diagnostics/CI changes. Deeper detail lives in the linked docs; this file defines the **non-negotiable contract**.

---

## 0. Agent preamble (read first)

| Step | Document |
|------|----------|
| 1 | This file |
| 2 | [naming.md](naming.md) — Speculum / Sessions / W7S vocabulary |
| 3 | [architecture.md](architecture.md) — domains and flows |
| 4 | [diagnostics.md](diagnostics.md) — Act→Assert cookbook |
| 5 | Before MotorAssert or CI matrix changes: [../Speculum.MotorAssert.Tests/MATRIX.md](../Speculum.MotorAssert.Tests/MATRIX.md) |
| 6 | Before changing a failing hardened assert: [assert-failure-policy.md](assert-failure-policy.md) |
| 7 | Cursor injects a short always-on summary: [../.cursor/rules/speculum-engineering-standards.mdc](../.cursor/rules/speculum-engineering-standards.mdc) |
| 8 | Before UI work under `web/`: [frontend-standards.md](frontend-standards.md) + [frontend-patterns.md](frontend-patterns.md); Cursor: [../.cursor/rules/speculum-frontend-standards.mdc](../.cursor/rules/speculum-frontend-standards.mdc) |
| 9 | PageProjection Live work: [page-projection/spec/acceptance.md](page-projection/spec/acceptance.md) — **absolute 1:1 parity** with the original site |

**Hard bans before you type:**

- **No ad-hoc / workaround code.** Fix the designed algorithm; never paper over failures with a second path that restores a banned cost (e.g. cold full DomMap “bootstrap” after a stream seed). Green hopdiag via workaround is forbidden.
- Do not skip, ignore, or soften an assert to get green CI.
- Do not add config key aliases or “deprecated” API paths during V1 development.
- Do not treat `Task.Delay` as the primary Act→Assert synchronizer.
- Do not assume `200` / `ok: true` proves session truth.
- Do not treat PageProjection protocol recovery (QD / Resync / WD) or smoke PASS as accept unless **Projected ≈ original site 1:1** — see [page-projection/spec/acceptance.md](page-projection/spec/acceptance.md).

---

## 1. Architecture constitution

### 1.1 One question per folder

`Speculum.Api` is organized by **responsibility**, not by layer soup. The
pre-refactor tree and `web/src/features/motor/` retain legacy names until a
structural migration:

| Domain | Folder | Question |
|--------|--------|----------|
| Sessions | `Refactor/Speculum.Api/Sessions/` | How does a live browsing session behave? |
| Session edge | `Refactor/Speculum.Api/Presentation/Sessions/` | How do clients control and stream a session? |
| Browser client | `Refactor/Speculum.Api/wwwroot/speculum/` | How does browser code open and use sessions? |
| Legacy live browsing | `Motor/`, `web/src/features/motor/` | Existing pre-refactor implementation only |
| Edge | `Edge/` | How is Traefik/CORS materialized from Hosting? |
| Browser persistence | `BrowserPersistence/` | How is Chrome state stored between visits? |
| Diagnostics | `Diagnostics/` | How do we observe and prove session truth? |
| Admin / Scripts | `Admin/`, `Scripts/` | Operator HTTP + injected scripts |

Cross-cutting change → re-read architecture + naming **before** editing two or more domains.

### 1.2 Dependency direction

```
Transport (Hub, Admin endpoints)
  → Application (Coordinator, ConfigService, EdgeSynchronizer)
    → Domain (HostMapper, TraefikYamlBuilder, protocol models)
      → Infrastructure (SQLite, WebSocket, filesystem)
```

Domain types **must not** reference ASP.NET, SignalR, or `IServiceProvider`.

### 1.3 Vocabulary (Speculum / Sessions / W7S)

| Term | Use when |
|------|----------|
| **Speculum** | Platform, config, infrastructure, docs |
| **Sessions** | Live remote browsing (control, transport, URL mapping) |
| **W7S** | **Wire / client boundary only** (`_w7s_nso`, sidecar protocol docs) |
| **Browser persistence** | Chrome state in SQLite — not the live relay |
| **Diagnostics** | Assertable observability |

**Distinctions:**

- `LiveSession` (live control + transport) ≠ `BrowserSessionStore` (persisted snapshots).
- `Motor` is allowed only in existing legacy proper names such as
  `MotorHub` and `Speculum.MotorAssert.Tests`; do not introduce it in new code.
- **W7S must not** appear in C# namespaces, internal class names, application log prefixes, or API folder names.

Full rules: [naming.md](naming.md).

### 1.4 Configuration layers (do not mix)

1. **Infrastructure (env)** — bind address, DB path, sidecar URL, Traefik roots. Never session site domains as sole source of truth.
2. **Session runtime (SQLite + Admin API)** — `Forwarding`, `MaxSessions`, `Hosting`, `Diagnostics`, `JsBridge`, …
3. **Admin credentials** — `Admin.apiKey` seeded once (`ADMIN_BOOTSTRAP_KEY` optional bootstrap).

Config section path segments are **PascalCase literals** (`SessionPolicy`, not `sessionPolicy`). No legacy aliases in V1.

### 1.5 Edge and deploy

- Same-origin session host: SPA + `/api` + `/vhub`.
- `EdgeSynchronizer` materializes Traefik from Hosting — do not hand-edit generated `deploy/out/`.
- Canonical deploy: **dockup** + [../deploy/README.md](../deploy/README.md).

### 1.6 V1.0.0 development policy

- **Not released** — no semver tags / release branches until launch is announced.
- **No backward compatibility** — no migration shims, dual key names, or “keep old path forever” unless explicitly requested post-launch.
- Breaking config/API shape is allowed; **document it** in the same PR.

---

## 2. Code change rules

### 2.1 Scope and style

- **Minimal diff** — one logical intent per commit/PR when possible.
- **Match surrounding conventions** — read neighbors before inventing patterns.
- **No drive-by refactors** — no formatting-only or rename-only PRs mixed with behaviour.
- **Rename with structure** — never a PR that only renames symbols ([naming.md](naming.md)).
- **File name = primary type** — no cryptic `Mgr` / `Svc` / `Helper` dumps.
- **Comments** — only for non-obvious intent (CDP quirks, wire contracts, security). Do not narrate obvious code.

### 2.2 Wire and hub contracts

- Prefer **explicit, MessagePack-safe** DTOs (concrete `Dictionary<>` when `IReadOnlyDictionary` fails round-trip).
- Use `[MessagePackObject]` + `[Key("camelCase")]` on hub DTOs consumed by JS (`clientToken`, `url`, indexers, …). Align server `SessionHubMessagePack.Options` in the refactor with clients and contract tests.
- Stable public contracts (do not rename without a deliberate plan): REST config/diagnostics routes, `/vhub` methods, `_w7s_nso`, sidecar opcodes and `diagProbe` / `diagResult`.

### 2.3 Errors and opacity

- Admin surfaces stay **opaque** where designed (e.g. Admin section does not leak the raw API key).
- Prefer catalogued `errorCode` strings (`session_gone`, `probe_busy`, `probe_timeout`, …) over ad-hoc messages for Act→Assert.

### 2.4 Diagnostics as product

Pipeline: **Observe → Govern → Record → Query → Present**.

- Same **schema** in Development and Production; environment differs by **redaction / budgets**, not by deleting taxonomies.
- Catalog Act→Assert events must not be randomly sampled away.
- Catalogued **failures** (and decisive lifecycle emits) must include stable payload fields — at minimum `errorCode` + `phase` on failures. An incomplete emit is a product defect, not an acceptable soft-pass — see [diagnostics.md](diagnostics.md) (Failure & lifecycle payload contract).
- Control plane: **capability toggles per domain** (`metrics`/`events`/`snapshots`/`probe`), budgets, overflow, elevate, soft-caps. The transport is domain-agnostic — it gates only by catalog `descriptor` + `IsCapabilityEnabled`, never by hardcoded event/domain names — see [diagnostics.md](diagnostics.md).
- `Telemetry` domain: one composite `Telemetry.SampleCollected` sample (host/sessions/sidecar/persistence/pipeline) on a global interval; sections and identity are opt-in per toggle, redaction stays read-time.

---

## 3. Testing constitution

### 3.1 Pyramid (mandatory)

```text
Fast gate (no Chrome)          Required CI Chrome              Informational
─────────────────────          ─────────────────────           ─────────────
Api.Tests units                Speculum.MotorAssert.Tests      Speculum.MotorPerf.Tests
sidecar npm test               Category=MotorAssertive         Category=MotorPerf
web Vitest                     compose + Chromium              .github/workflows/perf.yml
```

- Fast gate catches cheap bugs (URL map, MsgPack keys, wheel defaults, Traefik YAML).
- The legacy **motor-assertive** category proves **session truth** end-to-end.
- **Perf** measures capacity/SLO — **never** confuses “slow” with “the session lied”. Badge is informational; **not** branch-protection required.

### 3.2 Act → Assert (effect, not smoke)

Prefer, in order:

1. Catalogued diagnostics events (`?since=` / `namePrefix=`).
2. Snapshot / registry / `errorCode` contracts.
3. Browser probes (`cookies`, `storage`, `dom`, `evaluate`, …).
4. Short beat `Task.Delay` **only after** Act is already confirmed by (1)–(3).

Forbidden as primary proof:

- `StatusCode == 200` alone
- `ok: true` alone without data content
- `if (TryGetProperty(…))` then skip — **missing property = fail**

Harness helpers: `DiagnosticsAssertClient` / `MotorActClient` (`Require*`, `Expect*`, `WaitForEventsAsync`). Prefer shared helpers over copy-paste JSON scraping.

### 3.3 MATRIX is source of truth

- Every matrix ID A–O has a depth: `deep` | `contract` | `perf` | `deferred-K4`.
- **CI green ⇒ MATRIX remains accurate** when coverage depth changes.
- **K4 ACME** stays manual/nightly/deferred (DNS/Cloudflare secrets) — sole intentional exclusion from “everything on PR”.

### 3.4 Depth labels (honest scope)

| Depth | Meaning |
|-------|---------|
| `deep` | Effect assert in required motor-assertive (probe/timeline/export truth) |
| `contract` | Shape/governance assert in required CI without load/stress (catalog fields, auth opacity, soft-cap XOR 413) |
| `perf` | Only `perf.yml` / MotorPerf |
| `deferred-K4` | Documented out of PR required set |

When a deep assert cannot run safely on the **shared** motor-assert stack (e.g. shrinking `maxBytes` until the API dies), move **load** to Perf/Api unit sink tests and keep a **documented** `contract` slice in required CI — update MATRIX in the same change. Do **not** silently delete coverage.

### 3.5 Flakes and retries

- **Flake = bug** (product or harness). Fix the cause.
- Unit tests: **zero** retries.
- Motor-assertive: at most **one** justified retry, documented in harness comments / MATRIX / assert-failure-policy — never silent loop retries.

### 3.6 Harness isolation (shared compose stack)

MotorAssert runs **one** API + sidecar + Chromium stack **serially** (`DisableParallelization = true`). Tests mutate shared SQLite config and Diagnostics runtime state — isolation is mandatory.

**Per-test baseline** (`MotorAssertTestBase` → `EnsureBaselineAsync` before every test method):

| Restore | Why |
|---------|-----|
| `MaxSessions = 4` | Prior tests may cap at 1 for slot asserts |
| `JsBridge.enable = true` | I3/I5 flip isolation |
| Clear **Diagnostics Degraded** via `POST /api/admin/diagnostics/v1/recover` | Circuit breaker caps every domain to the **Metric** capability → `403 probe_level_insufficient` even when config says Assertive |
| PUT Assertive Diagnostics + `WaitConfigApplied` + runtime verify | L8 and governance tests turn `browserQuery.probe` off; must not leak |

**Rules:**

- `WaitConfigAppliedAsync` — **only** after PUT **Diagnostics** or **Hosting** (sections that emit `Diagnostics.ConfigApplied`). Never after JsBridge, MaxSessions, Forwarding, SessionPolicy, etc.
- `WaitStateExportCompletedAsync(connectionId, since-before-disconnect)` — **never** a global `WaitForEventsAsync(null, "Motor.StateExport", since-at-test-start)`; that can match another test's export and restore before cookies are persisted (E1/E8 class of bug).
- Mutations (Diagnostics Off, tiny `maxBytes`, Hosting wipe, …) **must** restore in `finally` and re-establish baseline when `/ready` was affected.
- Prefer poll helpers (`WaitCookieAsync`, `WaitEvaluateContainsAsync`, `WaitConfigAppliedAsync`, …) over fixed `Task.Delay` as the primary synchronizer.

**Diagnostics Degraded (product behaviour tests must understand):**

- Publish circuit breaker trips on sustained sink drops / slow writes → `Diagnostics.Degraded` event.
- While degraded, `IsCapabilityEnabled` caps every domain to the `Metric` capability — BrowserQuery probes return `probe_level_insufficient`.
- Recovery: successful cleanup cycle (hosted service) or **`POST /api/admin/diagnostics/v1/recover`** (ops/lab/harness). PUT Diagnostics alone does **not** clear degraded.

Do not invent parallel MotorAssert collections that fight over one compose stack.

### 3.7 Assert failure policy

From [assert-failure-policy.md](assert-failure-policy.md):

> When a hardened assert fails, fix the product or the harness. Do not `[Skip]` / `[Ignore]` / soften.

Weakening the assert to green is a **policy violation**.

---

## 4. CI contract

| Workflow | Protects `main`? | Measures |
|----------|------------------|----------|
| `.github/workflows/ci.yml` | **Yes** (required) | Units + motor-assertive correctness |
| `.github/workflows/perf.yml` | **No** | Capacity / SLO trends |

Local day-to-day:

```bash
dotnet test Speculum.sln -c Release --filter "Category!=MotorAssertive&Category!=MotorPerf"
# + sidecar npm test + web npm test
```

Do **not** treat the legacy motor-assertive Docker+Chrome category as laptop QA by default — that job is GitHub Actions–first ([CONTRIBUTING.md](../CONTRIBUTING.md)).

---

## 5. Explicit anti-patterns

| Ban | Why |
|-----|-----|
| **Ad-hoc / workaround paths** | Hides the real defect; often reintroduces banned cost (e.g. DomMap dump on cold). Fix the algorithm. |
| Skip-if-missing-property | Hides missing contracts |
| Smoke-only session tests | Green ≠ working |
| Shrinking live Diagnostics `maxBytes` on shared CI stack to “prove” overflow without a Perf/unit home | Stack kills cascade; move load to Perf / sink units |
| Hub args as `IReadOnlyDictionary` without a round-trip test | MessagePack may drop indexers |
| `Task.Delay` as sole wait for SessionStarted / export / probe | Race-prone flakes |
| Global `StateExport` wait without `connectionId` | False-positive export; restore before persist (E1/E8) |
| Ignoring `Diagnostics.Degraded` when probes 403 | Config looks Assertive; runtime is capped |
| `WaitConfigApplied` after non-Diagnostics PUT | False wait / timeout (I5, G4 class) |
| Config aliases / migration shims in V1 | Contradicts V1 policy |
| W7S in C# namespaces / API folders | Vocabulary leak |
| Hand-editing `deploy/out/` | Generated by dockup |
| Drive-by renames across the tree | Noise; naming.md forbids rename-only PRs |
| Softening asserts to pass CI | See assert-failure-policy |

---

## 6. Merge checklist

- [ ] Fast gate green (`Category!=MotorAssertive&Category!=MotorPerf`, sidecar, web).
- [ ] Required CI green including legacy **`motor-assertive`** when behaviour touches sessions/diagnostics/edge/persist.
- [ ] MATRIX depth updated if coverage changed.
- [ ] Diagnostics cookbook / this file updated if a new contract class was introduced.
- [ ] Component or architecture docs updated when behaviour or boundaries change (same PR).
- [ ] No new skip/ignore on MotorAssertive without an explicit deferred MATRIX row (e.g. K4).
- [ ] Naming: Speculum / Sessions / W7S respected; no new ambiguity between live session and persisted session.

---

## 7. Where detail lives

| Concern | Canonical doc |
|---------|----------------|
| System design | [architecture.md](architecture.md) |
| Naming / folders | [naming.md](naming.md) |
| Probes, events, cookbook | [diagnostics.md](diagnostics.md) |
| Motor protocol / forwarding | [motor-reference.md](motor-reference.md) |
| Sidecar wire | [w7s-sidecar-protocol.md](w7s-sidecar-protocol.md) |
| Matrix A–O | [../Speculum.MotorAssert.Tests/MATRIX.md](../Speculum.MotorAssert.Tests/MATRIX.md) |
| Assert failure / triage | [assert-failure-policy.md](assert-failure-policy.md) |
| Frontend UX constitution | [frontend-standards.md](frontend-standards.md) |
| Frontend UX recipes | [frontend-patterns.md](frontend-patterns.md) |
| Deploy | [../deploy/README.md](../deploy/README.md) |
| Human contributor workflow | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| Agent entry (repo root) | [../AGENTS.md](../AGENTS.md) |
| Cursor always-apply rule | [../.cursor/rules/speculum-engineering-standards.mdc](../.cursor/rules/speculum-engineering-standards.mdc) |
| Cursor frontend rule (`web/**`) | [../.cursor/rules/speculum-frontend-standards.mdc](../.cursor/rules/speculum-frontend-standards.mdc) |

This file, [diagnostics.md](diagnostics.md), and MATRIX are the permanent testing law. Frontend UX law: [frontend-standards.md](frontend-standards.md).
