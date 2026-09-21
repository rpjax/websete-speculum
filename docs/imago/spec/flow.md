# Product flow — panel, sandbox session, generator

Imago is **one standalone tool with three features**, in this order:

```
   ┌──────────── Imago panel ─────────────┐
   │  1. Record                           │   2. Generate            3. Preview
   │  ─────────                           │   ──────────             ─────────
   │  config → launch headed Chrome       │   pick a closed session  pick a run
   │  human browses freely                │   pick a profile         serve it on its
   │  sandbox captures continuously (RAM) │ ► run ► bundle        ►  own origin, look
   │  "close sandbox" → persist to disk   │   run again, other cfg   at it, compare
   └──────────────────────────────────────┘   (N runs per session)   (preview.md)
```

Recording is **live and stateful**. Generation is **offline, repeatable and configurable** — it reads a
closed session and nothing else (IR-6). Preview is **read-only** over a run. That asymmetry is the whole
architecture.

## 1. Sandbox session — the entity everything hangs off

```jsonc
{
  "id": "sess-2026-09-03-01",
  "name": "acme storefront — browse + checkout",
  "origins": ["https://…"],            // observed, not declared up front
  "status": "recording"|"closing"|"closed"|"failed",
  "openedAt": "…", "closedAt": "…",
  "config":  { browser, viewport, ua, locale, timezone, captureFilters },
  "versions":{ imago, chromium, protocol },
  "stats":   { snapshots, requests, bytes, atoms, conflicts },
  "artifactRoot": "sessions/<id>/"
}
```

**Rule S-1 — a closed session is immutable.** Nothing after "close sandbox" may modify it. Curation
(naming atoms, marking volatile, resolving conflicts) writes a **separate overlay** document that
references the session; generation reads session + overlay. Editing capture output in place would make
every generated bundle unexplainable.

**Rule S-2 — generation never writes into a session.** A generation run is its own entity:

```jsonc
{ "runId": "gen-004", "sessionId": "sess-…", "profileHash": "…",
  "emitter": "rehost"|"flat", "config": { … }, "output": "…", "result": { oracles… } }
```

Same session + same profile → same bytes (E1/O5a). That is what makes "reconfigure and regenerate"
cheap instead of frightening.

**Rule S-3 — the session is the unit of everything.** Artifacts, timeline, oracle references, atoms,
contract and generation runs all key on `sessionId`. There is no global state.

## 2. Recording

1. **Config (optional).** Viewport, UA, locale/timezone, capture filters (hosts never recorded),
   whether to keep a persistent Chrome profile between sessions (for staying logged in).
2. **Launch.** Imago starts its **own headed Chromium** with a dedicated profile dir and remote
   debugging, then attaches over CDP. Own launcher, own dependency — nothing from the sidecar
   ([premise.md §5](premise.md)).
3. **Browse.** A human drives the real window. Capture is **passive**: it never pauses, freezes,
   blocks or dialogs. If the operator notices Imago while browsing, capture is doing it wrong.
4. **Panel during recording** shows a live tape: URL changes, snapshots taken, requests by host,
   memory used, and a **Mark** button/hotkey to name the current state ([atoms.md](atoms.md) §3).
5. **Close sandbox.** Finalize: settle, resolve pending asset fetches, run the closure check (C-4),
   dedupe by content address, write the IR, compute the contract, mark `closed`.

**Rule S-4 — crash safety.** "In memory" is the hot path, not the durability story. Bodies and
snapshots stream to an append-only journal in the session's temp dir as they arrive; RAM holds the
index and the working set. On close, the journal is promoted to the IR. A crashed or killed session is
**recoverable and marked `failed`**, never silently lost. An hour of manual browsing is expensive
enough that losing it to a renderer crash is not acceptable.

**Rule S-8 — the browser dying is a state, not a crash.** Chrome closing or crashing does not end the
session and must not take the app with it: the recorder marks the browser gone, stops polling, keeps
everything already journalled, and **Close sandbox** still finalizes and persists it (marked `failed`,
because the browse ended early). The panel says so plainly instead of continuing to look live.

Corollary, learned the hard way: no promise in the recorder's poll loop may escape. An unhandled
rejection kills the process, which kills the panel, which leaves a session frozen mid-recording with no
way to close it.

**Rule S-9 — orphan recovery at startup.** A session on disk whose status is `recording` or `closing`
belongs to a process that no longer exists. On startup the app finalizes it from the journal and marks
it `failed`. **No session may claim to be live on behalf of a process that is gone.** This is what S-4's
durability promise is for; without recovery it was only a promise.

**Rule S-10 — the panel never looks live when it is not.** If the app's socket closes, the UI says the
panel is offline and disables the actions that would fail, rather than showing stale counters next to a
pulsing REC.

**Rule S-12 — no compatibility layer; incompatible data is refused, listed, and removed by the
operator.** Artifacts carry a schema version and the reader is strict (a missing property fails, never
skip-if-absent). A session this build cannot read is **not translated** — there are no compat shims
during V1, and a translator grows one branch per historical shape, each branch a silent guess about
data nobody can verify. It is listed apart from the readable sessions, with the reason, and the panel
offers **Delete all unreadable**.

**Deletion is always the operator's.** Nothing in Imago removes a byte on its own — not at startup, not
on a schema mismatch, not to tidy up. A browse cannot be replayed, so the data it produced is never
disposable by the program's own judgement.

**Rule S-13 — every capability has a button.** The panel is the only interface (D-024), so a keystroke
is a shortcut to a control that exists on screen, never the only way to reach a feature, and the panel
explains what each one does where it is used.

**Rule S-11 — the panel API never fails in framework language.** An action (mark, close) carries **no
payload**, and the server accepts an empty body for one; every error the panel shows is a sentence about
what happened, never a parser's status text. A `Bad Request` where "Close sandbox" should be is worse
than a crash: the operator cannot act, and the message says nothing about why.

**Rule S-5 — memory budget.** Response bodies dominate. RAM cap is configurable (default 512 MB);
beyond it, bodies spill to the journal and stay content-addressed, so promotion at close is a move, not
a re-hash. The panel shows the number; a session that silently swaps is a session nobody finishes.

## 3. Generation

Second feature, separate screen, reads a closed session. Fully configurable — the surface is enumerated
in [emit.md §7](emit.md). Every run is recorded (S-2), diffable against the previous run, and disposable.

The seam this leaves open on purpose: anything that has to be **added on top** of a captured site —
challenge handling, an auth shim, a mock layer, injected instrumentation — is a **generation-time
mechanism**, plugged in as a configured step. Capture stays dumb and records what happened; the
cleverness lives where it can be re-run for free ([premise.md §2](premise.md)).

## 4. Preview

Third feature, same app, same panel: serve a generation run on its **own loopback origin** and look at
it — no separate web server for the operator to start, no `file://`. Full spec: [preview.md](preview.md).

**Rule S-6 — preview never writes.** It serves a run read-only; it never modifies the run, and never
touches the session. Something wrong in the output is fixed by changing the profile and regenerating,
not in the viewer.

**Rule S-7 — a previewed bundle never shares the panel's origin.** It contains third-party JavaScript
captured from a site we do not control; the panel can read the filesystem and launch browsers. Separate
origin, default-deny egress ([preview.md](preview.md) §2, §5).

## 5. What this flow deliberately does not have

- **No exploration script.** Coverage comes from a human browsing. Superseded D-006.
- **No crawler**, no link following, no automated state discovery.
- **No live mirroring.** Imago never projects anything to anyone.
- **No coupling.** No Speculum import, no shared process, no shared config, no shared CI job.
- **No console surface.** The panel is the only interface (D-024). Nothing here is drivable from a
  terminal, on purpose: a CLI is a second interface that quietly becomes the maintained one.
- **No second platform.** Windows only (D-025).
