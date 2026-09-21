# Imago spec — agent start here

**Status:** F1 in progress — code at [`../../../imago/`](../../../imago/README.md). **Windows only** (D-025).
The **panel is the only interface** (D-024): there is no CLI and none is coming.
**Imago is a standalone project**, beside the sidecar and disconnected from all of Speculum: no shared
code, process, config or CI, in either direction (**I7**, D-011). Do not integrate it with anything.

**Shape:** one tool, three features ([flow.md](flow.md)) —

1. **Record** — launch a headed Chrome, a human browses freely, the sandbox captures everything in
   memory; **Close sandbox** persists it as a **sandbox session** on disk.
2. **Generate** — read a closed session and emit, under a fully configurable profile, a **bundle** that
   runs without the origin's backend, plus the **contract** that backend must implement.
3. **Preview** — serve a generated run on its own loopback origin and look at it, compare it against the
   session's stored references, and watch every request it makes ([preview.md](preview.md)).

Capture is expensive and unrepeatable; generation is cheap and repeatable. Everything in this spec
follows from that asymmetry.

---

## Now (2026-09-03)

Spec written; nothing implemented. Standing decisions — full text and rationale in
[decision-log.md](decision-log.md):

| | |
|---|---|
| **D-001** | name `Imago` |
| **D-002** | output is **generated**, never hand-edited → generation idempotence is an accept criterion |
| **D-003** | bundle ⟂ observation data: response bytes never become markup, only fixtures by opt-in |
| **D-004** | **flat by default**: no semantic componentization; two mechanical layers — **fragment**, **slot** |
| **D-005** | "identical and functional" and "our own code" are **two emitters over one IR**: `rehost`, `flat` |
| **D-007** | the **IR is the only generator input**; generation never touches the network |
| **D-010** | *(supersedes D-006)* no exploration script — **timeline** captured continuously, **atoms are curation** |
| **D-011** | *(supersedes D-008)* **standalone**: own browser, own injected agent, own storage, own panel, own CI |
| **D-012** | *(revises D-009)* challenges **ignored, not solved** — captured, then dispositioned at generation |
| **D-013** | **O5a** generation idempotence required; **O5b** capture reproducibility dropped |
| **D-014** | a closed session is **immutable**; curation lives in an overlay; generation is its own entity |
| **D-015** | oracles run offline against **references stored during the session** |
| **D-016** | **preview is served by the Imago app itself** — no separate web server, and `file://` is rejected |
| **D-017** | each previewed run gets its **own loopback origin**, root-mounted, never the panel's |
| **D-018** | preview API modes `off` \| `fixtures` \| `proxy` — `proxy` makes it the backend team's harness |
| **D-019** | preview is **default-deny egress** and is where **O4** runs; the request tape is the evidence |
| **D-020** | preview is **read-only**: it never writes to a run or a session |
| **D-021** | lives at **`imago/`** in the repo root — own build, own CI, own boundary check |
| **D-022** | panel = **Fastify + React/Vite**, own front end, nothing from `web/` |
| **D-023** | driver = **`playwright-core`** headed, system Chrome, own profile dir — not patchright |
| **D-024** | **the panel is the only interface** — no CLI, not even as a stepping stone |
| **D-025** | **Windows only** — one platform, no cross-platform abstraction |

**Shipped — F1 + a first `rehost` and preview:**

- **Record** — headed Chrome, own injected agent, tree + CSSOM as authored rules (C-1/C-2/C-3),
  classified network (N-1), journal + content-addressed blobs (S-4), settle/mark/interval snapshots
  (A-11/12/13), close → IR + a resolver that **closes** the world (C-4/C-4a/C-4b).
- **Generate** — `rehost` v1: files laid out under the primary host's own paths, cross-origin hosts
  namespaced, HTML/CSS rewritten, JS never blanket-replaced, and a **bundle service worker** that
  resolves the rest from the route map (D-029).
- **Preview** — one run, one loopback origin, root-mounted (D-017); API modes `off`/`fixtures`/`proxy`
  (D-018); a classified request tape that is also O4's evidence (D-019); read-only (D-020).
- **Panel** — rail navigation, keyboard shortcuts, toasts, session filter, tape with filter/pause,
  browser-gone / panel-offline / stall banners, orphan recovery (D-030).

63 effect asserts in `npm test`, including generate + preview over real HTTP.

**Next:** **F4.5 parity harness** — oracle references at close + automated report (O4/O4b/O1-lite).
See [parity.md](parity.md). F2 (contract) remains highest-value for backend unblock.

**If the schedule bites:** F1 + F2 (contract) is the workaround that was actually asked for. It depends
on no fidelity work and unblocks the backend on its own.

---

## Reading order

1. [premise.md](premise.md) — what this is, non-goals, constraints **I1–I7**. Always apply.
2. [flow.md](flow.md) — panel, sandbox session entity, record → generate. **Read before anything else technical.**
3. [atoms.md](atoms.md) — timeline, snapshots, atoms as curation, conflicts, oracle references.
4. [ir.md](ir.md) — what a closed session leaves on disk. **The only generator input.**
5. [capture.md](capture.md) — how bytes come off the live page.
6. [api-contract.md](api-contract.md) — normalization, causality, slots, coverage.
7. [emit.md](emit.md) — the two emitters and the configuration surface.
8. [preview.md](preview.md) — serving, isolation, API modes, the request tape.
9. [parity.md](parity.md) — offline bundle vs reference comparison (F4.5).
10. [acceptance.md](acceptance.md) — oracles **O1–O6**. "It looked right" is never accept.
11. [open.md](open.md) — unresolved. Never close one silently.
12. [roadmap.md](roadmap.md) — build order.

## Conflict rule

| Layer | Wins |
|---|---|
| Purpose, non-goals, constraints I1–I7 | **[premise.md](premise.md)** |
| Product flow, session entity, immutability, generation runs | **[flow.md](flow.md)** |
| Timeline, snapshot triggers, atom curation, conflicts | **[atoms.md](atoms.md)** |
| IR shape and invariants IR-1…IR-8 | **[ir.md](ir.md)** |
| How bytes are collected from the live page | **[capture.md](capture.md)** |
| Endpoint grouping, schema inference, slots | **[api-contract.md](api-contract.md)** |
| Emitter behaviour, rewriting, dispositions, config surface | **[emit.md](emit.md)** |
| Preview serving, origin isolation, API modes, request tape | **[preview.md](preview.md)** |
| Accept bar and oracles | **[acceptance.md](acceptance.md)** |
| Why a decision exists | **[decision-log.md](decision-log.md)** — append-only, never rewrite |

If two docs disagree on **IR shape**, `ir.md` wins. On **what counts as done**, `acceptance.md` wins.
On **who owns what across record/generate**, `flow.md` wins. Do not "choose in code" — append a
decision-log row.

## Standards

Imago shares no code with Speculum, but it is written by the same people to the same bar: effect
asserts not smoke, no ad-hoc second path, missing property fails, minimal convention-matched diffs.
Independence is about code, not about standards.
