# Imago — premise, non-goals, constraints

## 1. What it is

A **standalone generator**. One tool, two features ([flow.md](flow.md)):

1. **Record** — launch a headed Chrome, let a human browse a site, capture everything, persist it as a
   **sandbox session**.
2. **Generate** — read a closed session and emit, under a fully configurable profile, a **bundle** that
   runs without the origin's backend and a **contract** describing every call that backend must serve.

Two artifacts, kept separate (I1): the bundle is for the browser, the contract is for whoever writes
the backend.

## 2. Non-goals — carved in stone

| Not | Because |
|---|---|
| **Not part of Speculum** | Imago is a project **beside** the sidecar and disconnected from everything else: no shared code, no shared process, no shared config, no shared CI job, no import in either direction. See §5. |
| **Not a mirror / not a `MirrorMode`** | Imago never projects a live browser to anyone. It records, then it generates. |
| **Not an anti-bot solution** | Challenges are **ignored, not solved** (D-009 rev). They are captured like any other traffic and handled at *generation* time by configuration, which is also where a future mechanism would plug in (§4). Imago is never progress on the anti-bot requirement. |
| **Not source recovery** | Imago does not recover the origin's component architecture. If the target ships source maps, that is a separate opportunity (OPEN-1) reusing the same session. |
| **Not a backend simulator** | An observed mutation gives the request shape, not the semantics, the invariants, or the failure modes. |
| **Not a crawler** | Coverage is whatever a human visited. There is no exploration script and no link following. |

## 3. The bundle question, settled

| Level | What it is | Identical & functional? | Maintainable? |
|---|---|---|---|
| **N1 re-host** | the origin's own HTML/JS/CSS/assets, served by us, API base pointed at our backend | **yes — it *is* the app** | no (minified) |
| **N2 re-host + patch** | N1 plus URL/CSP/SRI rewriting, host surgery, third-party dispositions | yes | no |
| **N3 reconstruction** | our markup + the origin's authored CSS | CSS-driven behaviour only | yes |

**Ruling (D-005):** N2 and N3 are **two emitters over one IR**, not one compromise output. Extraction
yields structure and style; behaviour comes from the origin's JS, from source maps, or from someone
writing it. There is no fourth source, so no single artifact can be both "identical and 100% functional"
and "our own maintainable code".

## 4. Constraints (I1–I7)

- **I1 — Artifact separation.** Bundle ⟂ observation data. No response body ever becomes markup.
  Observed data enters a bundle only as a **fixture** through a declared adapter, by configuration.
- **I2 — Generated, never seeded.** Emitter output is never hand-edited: reconfigure and regenerate.
  Corollary: byte-idempotence of generation is an accept criterion (O5a).
- **I3 — Rules, not computed style.** CSS is collected from the CSSOM as authored rules. Inlining
  computed style is **forbidden**: it silently destroys `:hover`, `:focus-visible`, `@media`,
  `@keyframes` — exactly the behaviour this tool exists to preserve. A computed style is the value of
  one state, never the rule that produces every state.
- **I4 — Flat by default.** No semantic taxonomy (`Button`, `Card`, `ProductTile`). Two mechanical
  layers only, both derived by structural diff: repeated **fragment** and data **slot**.
- **I5 — A snapshot is a state, not a page.** See [atoms.md](atoms.md).
- **I6 — Fidelity is measured.** Accept has oracles run against **references stored during the
  session** ([acceptance.md](acceptance.md)). "I opened it and it looked right" is anti-accept.
- **I7 — Standalone.** Imago does not import, extend, subclass, configure or depend on any Speculum
  code, and nothing in Speculum may depend on Imago. Techniques may be re-implemented; modules may not
  be shared. Where the two would otherwise couple, Imago **duplicates** — this is deliberate, and the
  duplication is the price of independence, not an oversight.

## 5. Standalone means standalone

Consequences, spelled out so nobody "optimizes" them away later:

- **Own browser launch.** Imago launches its own headed Chromium with its own profile dir and attaches
  over CDP. Not the sidecar's launcher, not its stealth stack, not `patchright` unless a target's
  *capture* actually requires it (config, not architecture).
- **Own injected agent.** The in-page collector — including the `attachShadow` patch needed to read
  closed shadow roots — is Imago's own code, installed via `Page.addScriptToEvaluateOnNewDocument`.
  It is a fingerprint surface; since challenges are ignored, that is accepted, not mitigated.
- **Own storage.** Session artifacts on disk under Imago's own root. No Speculum SQLite, no Journal, no
  Telemetry, no Diagnostics catalog.
- **Own panel.** Its own UI and its own local service.
- **Own repo location and CI.** OPEN-9.

Speculum's engineering law still applies as *engineering culture* — effect asserts, no ad-hoc second
path, missing property fails. Independence is about code, not about standards.

## 6. Vocabulary

| Term | Meaning |
|---|---|
| **Imago** | this tool: record a live site, generate bundle + contract |
| **Sandbox session** | one recording run; the entity everything keys on |
| **Timeline** | the continuous record of a session |
| **Snapshot** | one settled state serialized off the live page |
| **Atom** | a snapshot a human named — the curation layer over the timeline |
| **Transition** | movement between two atoms, plus the calls it fired |
| **IR** | the content-addressed artifact set written at close; the only generator input |
| **Generation run** | one configured emit from one session |
| **Emitter** | IR → bundle: `rehost` or `flat` |
| **Fragment** | a subtree repeated across atoms, emitted once |
| **Slot** | a DOM position whose content came from an observed response |
| **Contract** | the normalized endpoint inventory a replacement backend must serve |
