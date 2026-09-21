# Preview — looking at a generated bundle

Third feature of the panel, same Node app, same process. Pick a generation run, press Preview, look at
it. No separate web server to start, no port to remember, no `npx serve`.

## 1. Why not `file://`

Stated once so nobody re-proposes it: a bundle opened from the filesystem is not the bundle.

| Breaks under `file://` | Consequence |
|---|---|
| `fetch` / `XHR` | every API call fails before the API mode (§4) can decide anything |
| ES modules (`type="module"`) | CORS on `file://` blocks them — a modern `rehost` bundle does not boot |
| Root-absolute paths (`/assets/…`) | resolve to the filesystem root |
| History API routing | `pushState` on an opaque origin; client routing dies |
| Service workers, cookies, some `@font-face` | unavailable or inconsistent |

So preview serves over HTTP. **D-016:** the Imago app serves it itself — the operator never starts a
server, which is the actual request. There is a server; it is simply not the operator's problem.

## 2. Origin model — one origin per run

**D-017 — each previewed run gets its own loopback origin**, mounted at `/`:

```
panel      http://127.0.0.1:7411/          ← Imago's own UI + API
preview    http://127.0.0.1:<ephemeral>/   ← run gen-004, run root at /
```

Two reasons, both non-negotiable:

1. **Root mounting.** A bundle full of `/assets/main.js` cannot be served from `/preview/gen-004/`
   without rewriting paths — and rewriting the artifact to look at it means you are no longer looking at
   the artifact.
2. **Isolation.** A previewed bundle contains **third-party JavaScript captured from a site we do not
   control**. It must never share an origin with a panel that can read the filesystem, list sessions and
   launch browsers. Separate origin, no credentials, no shared storage.

Consequence to know: `localStorage` is per-origin, so a bundle's storage resets when the port changes.
Ports are stable per run while the app lives; pinning across restarts is OPEN-14.

## 3. Read-only, always

**D-020 — preview never writes.** It serves run output read-only and never touches the session (S-1) or
the run (S-2). No "fix it in the preview", no live editing, no cache written back. If something is
wrong, change the profile and regenerate — that is what **I2** buys.

## 4. API modes — the interesting part

A bundle has no backend. What preview does with its API calls is a per-preview switch, and it is what
makes this feature more than a viewer:

| Mode | Behaviour | Use |
|---|---|---|
| `off` *(default)* | API calls fail as configured (404/503/network error) | see the app's real empty and error states — the ones nobody captured |
| `fixtures` | recorded responses served from the session by the dev adapter, matched per [api-contract.md](api-contract.md) §7 | the site looks alive; the form used for O1 comparison |
| `proxy` | forwarded to a backend URL under development | **the point:** the front-end drives the backend being written, endpoint by endpoint |

`proxy` turns preview into the backend team's harness: real UI, real request sequence, real payload
shapes, against a server that is half-built. Mismatches show up as the front-end misbehaving rather
than as a paragraph in a spec.

**Rule P-1 — fixture staleness is visible.** In `fixtures` mode the preview shows the session's capture
date in the chrome. A fixture is a photograph of one moment (OPEN-10), and nobody should debug against
last month's world without knowing it.

**Rule P-2 — proxy mismatches are reported, not smoothed.** In `proxy` mode, any request the contract
does not cover, any status the contract never saw, and any response failing the inferred schema is
flagged in the tape (§5). Preview is where the contract gets falsified; making it silently tolerant
would waste that.

## 5. The request tape — preview is the instrument

Every request a previewed bundle makes passes through the Imago app, so preview is the natural place
for network truth. The panel shows a live tape, classified:

```
✓ same-origin   /assets/main.a1b2.js                     12.4 KB
✓ fixture       GET /api/products?page=1                 req-014
→ proxy         POST /api/cart                           201  ⚠ not in contract
✗ blocked       https://analytics.example/collect        third-party, disposition=stub
✗ blocked       https://challenge.example/turnstile       challenge, disposition=stub
```

**Rule P-3 — default deny.** Anything outside (own origin, API target, profile allowlist) is blocked
and shown, never silently allowed. A `keep` disposition (E-6) is the only way out, and it is visible in
the tape as such.

**Rule P-4 — preview is where O4 runs.** Network closure is not a separate harness: browse the preview,
run the interaction pass, and the tape *is* the oracle's evidence ([acceptance.md](acceptance.md) O4).

## 5.1 Parity run

**F4.5** — automated comparison after generate:

| Step | Action |
|---|---|
| Trigger | Panel **Run parity** → `POST /api/parity/run` `{ sessionId, runId }` |
| Mode | Always `fixtures` for O1/O4b |
| Output | `runs/<runId>/parity/report.json`, `candidate/`, `diff/` |
| Read | `GET /api/parity/report?sessionId=&runId=` |

Full procedure: [parity.md](parity.md).

## 6. What the viewer shows

- **Atom list.** `flat` has no router, so atoms are documents: a sidebar with names and thumbnails is
  the navigation. `rehost` routes itself, so the list deep-links instead.
- **Viewport frame.** Rendered at the captured viewport(s), with a switcher over the profile's matrix —
  looking at a 1440-wide capture in a 900-wide pane and calling it wrong is a self-inflicted bug.
- **Reference comparison.** Because references are stored during the session (D-015), the viewer can put
  bundle and reference side by side per atom, with the O1 diff overlay and the O2 rule-parity report.
  This is where accept stops being a number in a log.
- **Parity report (F4.5).** Before full side-by-side: **Run parity** button, PASS/FAIL badge, gap list,
  and thumbnails (reference · candidate · diff). See [parity.md](parity.md) §7.
- **Known-dead markers.** In `flat`, JS-driven interactions are enumerated ([acceptance.md](acceptance.md)
  O3); the viewer marks them instead of letting the operator discover them by clicking.
- **Open in browser.** An embedded pane is convenient; the truthful view is the run's own origin opened
  in a real browser. Both are offered, and the embedded pane is labelled as convenience — some pages
  behave differently inside a frame.

## 7. Lifecycle

Preview servers are ephemeral and bound to the app: started on demand, stopped when the panel closes
the preview or the app exits, never left listening. Multiple runs may be previewed at once (each on its
own port) — comparing two profiles side by side is a normal thing to want.

## 8. Non-goals

- **Not a production server.** Loopback only, no auth, no TLS, not exposed on the network.
- **Not an editor** (§3).
- **Not a mock framework.** `fixtures` replays recorded bytes; it does not model behaviour
  ([api-contract.md](api-contract.md) §9). A recorded `POST` always succeeds and always returns the same
  body — in preview that looks like a working checkout, and it is not one.
