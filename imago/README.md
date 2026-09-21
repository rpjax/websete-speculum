# Imago

Record a live site by browsing it, then generate a bundle that runs **without the origin's backend**
plus the **API contract** that backend has to implement.

**Windows only** (D-025). **The panel is the only interface** (D-024) — there is no CLI and none is
coming. **Imago is standalone**: it shares no code with the surrounding repository, in either
direction, enforced by `npm run check:boundaries` rather than by memory.

Spec: [`../docs/imago/spec/`](../docs/imago/spec/README.md).

## Run

```powershell
npm install
npm run build      # boundary check → agent bundle → panel UI → tsc
npm start          # serves the panel on http://127.0.0.1:7411 and opens it
```

Requires **Google Chrome installed** (`channel: 'chrome'` — nothing is downloaded, D-023).

## Using it

**New recording** → name, optional start URL, settle window → **Start recording**. Chrome opens and you
browse normally: the recorder is passive and never navigates, clicks, freezes or dialogs (C-0).

While recording the panel shows counters (snapshots, requests, captured bytes, in-flight, errors) and a
live tape of navigations, snapshots, marks and errors.

- **Mark state** in the panel, or `Ctrl+Shift+M` inside the page — always captured, settled or not.
- **Close sandbox** — finalizes the session, promotes it to the IR layout and runs the closure check.

**Sessions** lists every recording — filter with `/`. Opening one shows its closure report, snapshots,
errors, and the **bundle** panel.

## Generate and preview

**Generate bundle** on a closed session emits a `rehost` run beside it (the session itself is never
touched). The run holds the origin's own bytes under the primary host's paths, cross-origin hosts under
`/__imago/h/<host>/`, HTML and CSS rewritten, and a generated service worker that resolves at runtime
whatever the rewrite could not reach — JavaScript is never blanket-replaced.

**Preview** serves one run on **its own loopback origin**, root-mounted and isolated from the panel.
The API mode decides what happens to calls the bundle does not hold:

| mode | behaviour |
|---|---|
| `off` | the call fails — you see the empty and error states nobody captured |
| `fixtures` | the recorded response is replayed. The site looks alive, and **the mock lies**: a recorded `POST` always succeeds with the same body |
| `proxy` | forwarded to the backend under construction — the front end drives your half-built server, and calls outside the contract are flagged |

Every request passes through the preview, so the request tape is also what O4 will assert. It separates
two failures that look alike: **blocked** is an API call or beacon the current mode refuses (expected in
`off`), while **missing-asset** is a byte the bundle should hold and does not — a capture gap, reported
as its own kind and never fetched from the real origin.

**Run parity** (F4.5) compares the bundle against references stored at close: network gaps (O4/O4b),
fixture coverage, and a screenshot diff (O1-lite). Output: `runs/<runId>/parity/report.json`. Spec:
[`parity.md`](../docs/imago/spec/parity.md).

## Managing sessions

**Sessions** shows size on disk per session and in total, filter, and sort by when / size / snapshots /
name. Select rows to delete in bulk; delete a single session from its row or from its detail view;
delete a generated bundle without touching the session it came from (a bundle is regenerable, a browse
is not). Rename writes to the session's **overlay** — `session.json` is never rewritten (S-1).

Nothing is ever deleted by Imago itself. A session written by an earlier build cannot be read — there is
no conversion layer and there will not be one — so it is listed apart with the reason and a
**Delete all unreadable** button. Removing it is your call, not the program's.

## Keyboard

Every one of these also has a button; the keys are a shortcut, never the only way in. **How it works**
in the sidebar explains each one where it applies.

| | |
|---|---|
| `1` `2` `3` `4` | Record · Sessions · Previews · How it works |
| `m` | mark the current state while recording (same as **Mark state**) |
| `Ctrl+Shift+M` | the same, pressed **inside the Chrome window being recorded** |
| `/` | jump to the session filter |

## Status

| Phase | State |
|---|---|
| F1 panel + recorder | **shipped** |
| F2 contract | not started — **highest value** |
| F3 curation UI (atom naming, conflicts, volatile set) | not started |
| F4 `rehost` generator + preview | **v1 shipped** |
| F4.5 parity harness (O4/O4b/O1-lite) | **done** |
| F5 `flat` + O2/O3 + side-by-side viewer | not started |

## Layout

```
src/agent/     in-page collector, bundled to dist/agent.js and injected before page scripts
src/recorder/  launcher, passive recorder, request classification
src/core/      session types, canonical hashing, journal + blob store, on-disk store
src/ir/        close → IR promotion and the closure check
src/panel/     Fastify server, WebSocket tape, panel state
src/parity/    oracle references at close, parity run, report
ui/            React panel (the only interface)
```

Sessions live under `IMAGO_HOME` (default `./.imago`):

```
.imago/
  chrome-profile/            our own Chrome profile — stays logged in between sessions
  sessions/<sessionId>/
    session.json  journal.jsonl  timeline.jsonl  closure.json  errors.json
    snapshots/    trees/     styles/   assets/   network/   blobs/   oracles/
    runs/<runId>/ …          parity/report.json  parity/candidate/  parity/diff/
```

A closed session is **immutable** (D-014). Curation and generation never write into it.

## What already holds

- content addressing over canonical (key-sorted) JSON — without it O5a is unreachable, and a hashed
  artifact is never pretty-printed
- append-only journal + blob store, so a renderer crash costs the tail of a session, not the browse
- CSSOM collected as **authored rules**, never computed style (I3); cross-origin sheets are refetched
  (C-1) and a failed refetch marks the session `failed`
- closed shadow roots readable via our own `attachShadow` patch — our code, not the sidecar's
- every request classified, never filtered (N-1)
- **all assets are downloaded at close**, not just the ones written in markup: every recorded textual
  body (HTML, CSS, JS, JSON) is swept for absolute URLs and fetched in rounds, so the URLs the app
  builds in JavaScript and the image URLs that arrive inside API payloads end up in the bundle too
  (C-4c). The sweep is fenced to hosts that already served a subresource in this session, so it
  downloads the site's assets rather than crawling the web
- the resolver is a **unit proved against a simulated application** — three live servers imitating an
  app whose images exist only inside an API payload, an extension-less CDN, and a docs site that must
  not be crawled. Unknown hosts are promoted by probe **evidence** (content-type), never by matching a
  vendor name (C-4e)
- long asset paths are content-addressed, never truncated — an image proxy's paths differ only near the
  end, and shortening them would collide two assets onto one file (C-4d)
- closure check (C-4) at close: referenced but never fetched is reported, and a generator will refuse
  to run on it (E5)
- a dead panel never breaks a recording, and a dead browser does not kill the app: the session stays
  closable and **Close sandbox** still persists what was captured (S-8)
- sessions left `recording` by a dead process are finalized and marked `failed` at startup (S-9)
- the panel says when it is offline instead of showing stale counters next to a pulsing REC (S-10)
- in-flight is tracked by request age: long-lived streams and beacons never hold settle hostage (A-11),
  a page that never settles still gets `interval` snapshots (A-12), and the stall reason is published
  to the tape and the panel (A-13)
- panel actions carry no payload and errors arrive as sentences, asserted over real HTTP (S-11)

## Tooling

```powershell
npm test           # boundary check + effect asserts on hashing, journal and closure
npm run typecheck  # server and UI
npm run dev        # vite dev server on 5174, proxying the panel API
```

`npm test` is tooling, not a second interface (D-024).

## Deliberately missing

Atom naming and curation (F3) · the contract (F2) · `flat` generator (F5) · CSS/interaction oracles (O2/O3) ·
WebSocket/SSE bodies (OPEN-2) · authenticated-session policy (OPEN-3) · canvas content (OPEN-5).
