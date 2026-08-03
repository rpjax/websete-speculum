# Stealth suite — Speculum Sessions (agent runbook)

Agent-facing checklist to **measure** how detectable the remote Chrome (sidecar) is,
and produce **objective notes** for prioritising stealth work.

This is **not** CI MotorAssert and **not** a substitute for Cloudflare’s private score.
It measures the **same browser-side axes** antibot vendors use (fingerprint consistency,
headless/webdriver leaks, WebGL/canvas, UA vs platform).

Vocabulary: **Speculum** / **Sessions** / **sidecar** — see [naming.md](naming.md).

---

## Antibot policy: preset vs mimic

**Goal:** best antibot score on the **remote Chromium** (sidecar).  
“Look like the operator’s device” only when it does **not** reduce that score.  
Inconsistent identity always loses to a boring, coherent Chromium kit.

Remote Chrome is always Chromium — **never** paste Safari/iOS/WebKit UA or `platform=iPhone`.

### Ownership

| Signal | Source | Rule |
|--------|--------|------|
| `deviceCategory` (`phone` \| `tablet` \| `pc`) | Client hint → API normalize | Picks the kit |
| UA, `navigator.platform`, UA-CH, model | **Preset kit** | Closed pack; Chrome version = remote binary |
| `hardwareConcurrency`, `deviceMemory` | **Preset kit only** | Never host; never client |
| mobile / touch / mtp floors | **Preset kit** | phone/tablet: touch+mobile, mtp ≥ 5 |
| Viewport CSS | Mimic + ViewportPolicy | Canvas 1:1 contract |
| DPR | Mimic **clamped** to kit/policy | |
| locale, language, languages, TZ, colorScheme | Mimic; policy fills blanks | |
| geolocation | Mimic or **omit** | Never invent |
| WebGL strings | Preset **after** GL context works | **P0** score gap |
| Fonts | Preset list per kit | **P1** score gap (Android claim + Linux fonts) |
| `pc` Windows kit (full) | Future | V1 easy = Linux pc kit (consistent, weak vs Win) |

### Kits (V1)

| Category | Identity | HW defaults |
|----------|----------|-------------|
| `phone` | Chrome Android Pixel-class; `platform=Linux armv8l` | concurrency 8, deviceMemory 4 |
| `tablet` | Chrome Android tablet-class; arm platform | concurrency 8, deviceMemory 4 |
| `pc` | Chrome Linux matching container binary | concurrency 8, deviceMemory 8 |

### Score backlog (after easy consistency)

1. **P0** — WebGL context recovery (string spoof is useless if `getContext` is null).
2. **P1** — Font kit for phone/tablet; full Windows `pc` kit (UA+platform+UA-CH+GPU together).
3. Worker UA patch if CreepJS still lies after platform CDP.
4. Deploy: keep sidecar images in sync (stale image → mobile 980 prove fail).

---

## Preconditions

1. Stack up with a **live session path** that can navigate to **arbitrary HTTPS** hosts  
   (dev/prod with Navigation allowlist covering the suite hosts below — **not** `sessions-test`, which is fixture-only).
2. Agent can open the session UI (lab `/` or live `/br/…`) **or** drive StartSession + Navigate via hub/API.
3. Run **two profiles** when possible:
   - **Desktop:** `mobile=false`, DPR 1, typical 1280×720 (or measured canvas).
   - **Mobile:** `mobile=true`, touch, DPR 2, iPhone-class CSS e.g. **414×711** (regression class for viewport stealth).
4. Record **git SHA / image tags / env** (`dev` vs `prod`, `SPECULUM_INPUT_BACKEND`, date UTC).

If Navigation blocks a host: widen allowlist for the suite domains only, re-Apply Navigation, continue. Do not use SessionsTest compose for this suite.

---

## Suite URLs (order)

Open each **inside the remote session** (the Chrome the sidecar drives), not in the operator’s local browser.

| # | URL | Focus |
|---|-----|--------|
| 1 | `https://abrahamjuliot.github.io/creepjs/` | Primary: lies, headless, WebGL/canvas, workers, UA consistency |
| 2 | `https://bot.sannysoft.com/` | Smoke: `webdriver`, chrome gaps, basic flags |
| 3 | `https://arh.antoinevastel.com/bots/areyouheadless` | Headless classification |
| 4 | `https://pixelscan.net/` | Aggregated pass/fail (UA / IP / WebGL / timezone) |
| 5 | `https://fingerprint.com/demo/` | Commercial-style visitor stability (optional if slow/blocked) |
| 6 | One **Cloudflare-fronted** public site the allowlist permits | Outcome only: clear / JS challenge / block / Turnstile |

BrowserLeaks deep-dives (`https://browserleaks.com/canvas`, `/webgl`, `/javascript`) — optional follow-ups when CreepJS flags a specific surface.

---

## Procedure (per profile)

For **Desktop**, then **Mobile**:

1. Start session; confirm logical viewport proven (no `LaunchBrowserFailed` / viewport_unproven).
2. Navigate to URL #1; wait until the page finishes computing (CreepJS can take 30–90s).
3. Capture evidence (pick what the environment allows):
   - Screenshot of the result summary, **and/or**
   - Paste/key findings into the report template below (prefer structured bullets over screenshots alone).
4. Repeat for URLs #2–#4 (and #5–#6 if reachable).
5. Do **not** soft-skip missing fields — if a page fails to load, record `blocked` / `timeout` / `navigation_rejected` with error text.

### What to extract (minimum)

From **CreepJS** (required):

- Headless / automation indicators (any red/fail).
- UA / User-Agent Client Hints vs platform mismatch.
- WebGL / GPU / renderer notes (SwiftShader is expected today — note it explicitly).
- Canvas / audio / worker discrepancies called out as “lie” or “noise”.
- Screen / viewport / devicePixelRatio vs session logical size (expect logical W×H; outer Chrome window may differ — CSS viewport is the contract).

From **Sannysoft / Vastel**: pass/fail lines that mention `webdriver`, chrome, permissions, plugins.

From **Pixelscan / Fingerprint**: overall verdict + top 3 failed checks.

From **Cloudflare site**: `passed` | `challenge` | `blocked` | `unreachable`.

---

## Report template (copy into agent final message or `docs/` note)

```text
## Stealth suite results
- When (UTC):
- Env: dev | prod | other
- Sidecar image / git SHA:
- SPECULUM_INPUT_BACKEND:
- Navigation allowlist note:

### Profile: Desktop | Mobile
- Viewport requested (CSS): W×H
- Device: mobile/touch/dsf/maxTouchPoints

| # | URL | Load | Key findings (fail/lie/mismatch only) |
|---|-----|------|----------------------------------------|
| 1 | creepjs | ok/fail | |
| 2 | sannysoft | ok/fail | |
| 3 | vastel | ok/fail | |
| 4 | pixelscan | ok/fail | |
| 5 | fingerprint | ok/skip | |
| 6 | cloudflare site (URL) | passed/challenge/blocked/unreachable | |

### Priority backlog (objective)
1. …
2. …
3. …

### Explicitly out of scope this run
- TLS JA3/JA4, IP/ASN reputation, CF private ML (not visible in-page).
```

**Priority backlog rules for the agent:**

1. Prefer **inconsistencies** (UA says Android, platform Linux; WebGL SwiftShader + “high-end” GPU claims; screen≠layout when metrics claim otherwise).
2. Prefer **hard fails** (`webdriver`, headless true) over cosmetic noise.
3. Do **not** recommend `--app` solely for outer-window cosmetics if antibot risk is unclear — CSS prove is the resolution contract.
4. Map each backlog item to a **code area** when obvious (`ChromeRuntime` flags, `device-emulation` UA/CH, WebGL spoof extension, viewport meta init).

---

## Pass criteria for “suite ran”

- Both profiles attempted **or** one profile + explicit blocker for the other.
- CreepJS + Sannysoft (or Vastel) completed with recorded findings.
- Report template filled; backlog has ≥1 concrete improvement **or** “no browser-side fails beyond known SwiftShader/datacenter IP”.

Latest filled report: [stealth-suite-results.md](stealth-suite-results.md) (+ raw [`stealth-suite-raw.json`](stealth-suite-raw.json)).

### Automated collector (optional)

From repo root, against a **dev** stack (not sessions-test):

```powershell
$env:STEALTH_SUITE="1"
$env:SESSIONS_TEST_API_BASE="http://127.0.0.1:8080/w7s"
$env:STEALTH_SUITE_OUT="<repo>/docs"
dotnet test Refactor/Speculum.Api.SessionsTest.Tests --filter FullyQualifiedName~StealthSuiteCollect
```

Writes/overwrites the results MD + raw JSON. Always **curate** the MD (auto findings can false-positive on marketing pages).

---

## Anti-patterns

- Running the suite only in the **operator** browser (invalid).
- Using **sessions-test** / motor-fixture-only Navigation.
- Treating CreepJS score as “Cloudflare score”.
- Soft-skipping failed loads without recording why.
- Changing product asserts or disabling prove to “look stealthier”.
