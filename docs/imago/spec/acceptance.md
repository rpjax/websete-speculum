# Acceptance — oracles O1–O6

**Protocol-PASS is not accept.** "The generator ran", "the bundle served 200s", "I opened it and it
looked right" prove nothing. Every oracle below is mechanical, produces a number or a diff, and runs
**offline against references stored during the session** ([atoms.md](atoms.md) §7) — never against the
live origin, which has drifted since and would make every run an argument.

## Anti-accept

- screenshot comparison alone (blind to `:hover`, `:focus-visible`, `@media`, `@keyframes`)
- a session with a non-empty `errors.json` treated as complete
- "no console errors"
- comparing against the live origin instead of stored references
- any accept claim on a session with unresolved conflicts (A-8)

## O1 — Visual parity

Per atom, per configured viewport: bundle screenshot vs the **stored reference**, same UA/locale/
timezone/DPR, animations paused, volatile regions masked.

On **`rehost`**, both reference and candidate are captured in preview **`fixtures` mode** — comparing
in `off` mode would blame empty states nobody claimed to have fixed.

Both halves must hold: differing pixels ≤ **0.1%**, and no contiguous differing region larger than
**32×32 px**. The second half catches a missing font or a collapsed section that a global percentage
hides.

`flat` is compared in its fixture-populated form; with empty slots the comparison is meaningless.

## O2 — CSS rule parity

For the sampled node set, compare the **set of matching rules** (selector text, source order, cascade
layer) between bundle and stored reference — including rules that do not currently apply.

This is what proves hover, focus, breakpoints and keyframes survived. A bundle can be pixel-perfect at
rest and completely dead on interaction; O1 alone calls that a pass.

**O2 is the load-bearing oracle.** If only one is implemented, it is this one.

## O3 — Interaction parity

A generated interaction pass — hover every interactive element, focus-tab the document, toggle every
declared disclosure, cross every breakpoint — comparing post-action matching-rule sets and geometry
against the stored references.

Scope, stated honestly: on `rehost` this covers JS-driven behaviour, because the JS is the origin's.
On `flat` it covers CSS-driven behaviour only, and JS-driven interactions are enumerated as
**known-dead** rather than silently failing.

## O4 — Network closure

Run in **preview** ([preview.md](preview.md) §5), which already proxies every request the bundle makes:
any request to a host outside (own origin, configured API base, configured allowlist) fails the oracle —
including one fired by a third party that was supposed to be stubbed (E-6). No separate harness; the
preview tape is the evidence.

Run per atom **and** after the O3 pass: a beacon that only fires on click is exactly the one a load-time
check misses.

### O4b — Fixture coverage *(F4.5 MVP, `rehost` + `fixtures`)*

Sub-oracle of O4 for API replay correctness. While O4 counts tape kinds, O4b checks that **every
GraphQL POST** the bundle made could have been served from the session's fixture index — by request
body hash, persisted-query hash, response-key alias, or length fallback ([parity.md](parity.md)).

Pass when `graphqlMissing` is empty. Each miss names `operationName` and pq prefix when known.

Also: every `missing-asset` on the tape is listed with URL — these are bundle completeness gaps, not
policy blocks.

Operational procedure: [parity.md](parity.md) §3–§5.

## O5a — Generation idempotence *(required)*

Generate twice from the same session with the same profile → byte-identical trees. A differing byte is a
bug, usually unordered iteration.

Without this, **I2** ("generated, never hand-edited") is a slogan: the first time regeneration differs
for no reason, someone starts hand-editing and the decision dies.

## O5b — Capture reproducibility *(dropped — D-013)*

Not an oracle. A human-driven session cannot be replayed, so "two captures produce the same IR" is not
a property this design can have. Its purpose is served instead by **conflict reporting within a
session** ([atoms.md](atoms.md) §6): when the same atom is seen twice and differs, the panel shows the
diff and a human resolves it. Recorded here so nobody re-adds it as a "missing" test.

## O6 — Contract closure

Both directions:

1. every request observed appears in `contract.json`, classified (N-1) — nothing silently dropped
2. every endpoint in `contract.json` traces back to at least one atom or transition — no orphans
   invented by grouping

Plus `coverage.md` ships with the artifact. `sampleCount: 1`, `authUnknown: true`, or no observed error
path are **disclosures, not defects**. Shipping the contract without them is the defect.

## Accept statement

A generation run is accepted for a session when, for every named atom:

| | `rehost` | `flat` |
|---|---|---|
| O1 visual | required | required (preview in `fixtures` mode) |
| O2 CSS rules | required | required |
| O3 interaction | required, full | required, CSS-driven scope; JS-driven enumerated as known-dead |
| O4 closure | required | required |
| O4b fixture coverage | required in `fixtures` mode | required in `fixtures` mode |
| O5a idempotence | required | required |
| O6 contract | required | required |

and `errors.json` is empty or every entry is an accepted, listed substitution, and no atom carries an
unresolved conflict.

Anything less ships as a **partial result with a named gap list**. Partial is a legitimate, useful
deliverable — it just may not be called done.
