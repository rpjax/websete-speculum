# Timeline, snapshots, atoms

## 1. Two layers, and why

A human browsing freely cannot be asked to declare anything up front. So capture is split:

| Layer | Produced by | Truth |
|---|---|---|
| **Timeline** | the recorder, continuously, with no judgement | everything that happened |
| **Atoms** | a human, live (Mark) or afterwards in the panel | which states matter and what they are called |

The timeline is raw and complete; atoms are curation over it. This preserves what D-006 was actually
protecting — **a human decides state identity, never a heuristic** — while removing the exploration
script the flow does not have (D-010 supersedes D-006).

## 2. Timeline

Append-only, one session:

```
navigation(url, kind: hard|soft)     request/response(reqId)      console(level, text)
snapshot(snapId, trigger)            mutationBurst(count, ms)     userAction(kind, selector?)
frameAttached/Detached               memoryMark(bytes)            error(code, detail)
```

Everything is timestamped on one clock. Attribution of requests to snapshots and transitions is derived
from this timeline at close, not decided live.

## 3. Snapshots — when the page gets serialized

**Rule A-1 — three triggers, all recorded with their reason:**

| Trigger | When |
|---|---|
| `settle` | automatic: after a navigation or a large mutation burst, once the page stops moving (§4) |
| `mark` | the operator pressed Mark in the panel — always taken, even if unsettled (flagged) |
| `interval` | safety net on a long-lived state, throttled and deduped by content hash |

**Rule A-2 — capture never disturbs the human.** No pausing, no freezing of animations, no modal, no
navigation of its own during recording. Animation freezing exists only for **oracle references** (§7),
which are taken in a controlled moment, not mid-browse.

**Rule A-3 — dedupe by content.** A snapshot whose canonical tree hash already exists in the session is
recorded as a timeline event referencing the existing tree, not stored twice. Browsing in circles is
normal and must be cheap.

## 4. Settle predicate

A `settle` snapshot fires when, for a configurable window (default 500 ms), all hold:

1. document `readyState === 'complete'`
2. no **fresh** in-flight request (§4.1)
3. no pending font (`document.fonts.status === 'loaded'`)
4. no `MutationObserver` record on `document` (subtree, attributes, characterData)

### 4.1 Fresh vs long-lived in flight — **A-11**

Counting in-flight requests as a single number is wrong on any real site, and wrong in the way that
produces zero snapshots forever: a live page always has something open — analytics beacons that never
resolve, long polls, EventSource, prefetch that the browser parks. A count also *leaks*, because not
every request emits a terminal event.

So in-flight is tracked as **request → start time**, and split by age:

| | blocks settle |
|---|---|
| **fresh** — younger than the stall threshold (5 s) | yes |
| **long-lived** — older | **no**, and it is reported as ignored |

A request that has been open for five seconds is not page load; it is a stream, a poll, or a beacon.
Waiting for it is waiting forever.

### 4.2 A page that never settles — **A-12**

A ticker, a carousel or a poller mutates continuously and will never satisfy the predicate. It still
gets snapshots: after `intervalMs` (default 20 s) without one, an `interval` snapshot is taken and
flagged **`unsettled`**. A session is never empty just because the page is alive.

### 4.3 Say why — **A-13**

While stalled, the recorder publishes the reason to the tape (throttled to once per 10 s): still
loading · N requests in flight (+M long-lived, ignored) · fonts loading · DOM mutated Xms ago. The
panel surfaces the same reason next to a zero snapshot count.

Silence is the failure mode here: an operator staring at "snapshots 0" with no explanation cannot tell
a broken recorder from a busy page. **Never block browsing waiting for settle.**

## 5. Atoms

```jsonc
{ "id": "catalog/list", "snapshot": "snap-014", "url": "…canonical…",
  "viewport": {…}, "entry": false, "note": "operator text",
  "transitionsOut": ["tr-3","tr-7"] }
```

- **A-4** an atom is a **named snapshot**. Naming happens live (Mark, with a name prompt) or in the
  panel afterwards against the timeline. Both write to the session's curation overlay
  ([flow.md](flow.md) S-1), never into the session itself.
- **A-5** the recorder **proposes** atoms — every `settle` snapshot after a navigation or a large
  mutation burst is a candidate, listed in the panel with a thumbnail. A proposal is never promoted
  automatically. Automation suggests; a human decides.
- **A-6** atom ids are opaque strings in a flat namespace. Nothing parses them.
- **A-7** an unnamed snapshot is still kept, still content-addressed, still available to generation if
  the operator promotes it later. Curation is reversible; capture is not.

## 6. Same state visited twice

A human will revisit states, and the DOM will differ for legitimate reasons.

**Rule A-8 — conflicts are reported, never merged.** If two snapshots share an atom id and differ
outside the volatile set, the panel shows the diff and offers exactly three resolutions:
**pick one** · **keep both as distinct atoms** · **mark the differing region volatile**. Silent merge
is banned; a pipeline that reconciles two different DOMs behind your back can never be trusted about
anything else.

This replaces the hard capture error of the script-driven design: with a human at the wheel, divergence
is expected, so it becomes a curation task instead of a failure.

## 7. Oracle references

Because the origin drifts and the session is browsed once, oracles cannot re-open the live site later
and call the difference a regression. **Rule A-9:** at every named atom (and on demand from the panel),
the recorder stores, alongside the snapshot:

- a **reference screenshot** per configured viewport, animations paused for that instant only
- the **matching-rule set** for a sampled node set (selector text, source order, cascade layer) — the
  raw material for O2, which a screenshot can never provide
- geometry for those nodes (`getBoundingClientRect`)

**F4.5 MVP (D-034):** screenshot references only, for the entry snapshot and every `mark` snapshot.
Matching-rule sets and geometry ship in F5 with O2. See [parity.md](parity.md) §2.

Oracles then run entirely offline, bundle vs stored references. This is what makes
[acceptance.md](acceptance.md) runnable at all in a human-driven flow.

## 8. Transitions

```jsonc
{ "id": "tr-3", "from": "checkout/address", "to": "checkout/quote",
  "action": { "kind": "click|submit|hover|navigate|scroll", "target": "…", "note": "…" },
  "requests": ["req-88","req-89"],
  "causality": [{ "producer": "req-88", "jsonPath": "$.addressId", "consumer": "req-89", "location": "query.address" }] }
```

Derived from the timeline between two named atoms; the operator can annotate or drop one. The
transition — not the atom — is where the contract acquires meaning: not "the site calls `/cart/quote`",
but "submitting this form fires `POST /cart/address`, then `GET /cart/quote` carrying the id the first
one returned".

## 9. Coverage is the session

One browse records only what that browse touched. Lazy sections, secondary routes, empty states, error
states and paginated tails do not exist unless someone walked into them.

**Rule A-10 — the panel ships a coverage checklist**, not as ceremony but because an unobserved error
response is an endpoint the backend team will implement wrong: empty list · invalid form submit ·
404 route · missing/expired auth · second page of a paginated list · a slow or failed request. What was
never visited is published in `coverage.md` ([api-contract.md](api-contract.md) §8). **The gaps are the
deliverable's most honest page.**
