# Build order

Ordered by value under schedule pressure. Each phase is independently useful; stopping after any of them
leaves something real.

## F1 — Panel + recorder (the spine) — *shipped*

Panel launches headed Chrome, records the timeline with the journal behind it, shows the live tape and
**Mark state**, **Close sandbox** → persists a session and reports closure. Snapshots on `settle` and
`mark`. No curation UI yet, no generator, no oracles. The panel is the only way in (D-024).

Done when: browse a real site for ten minutes, close, and a session on disk passes the closure check
(C-4) and can be re-opened and inspected.

The first real session **is** the target probe: framework, source maps present or not, chunk count,
whether the API base is a runtime config or a build-time literal, third-party inventory, WS/SW/canvas
presence. Write it into `targets/<name>.md`. It re-plans everything below, and it costs one browse.

## F2 — Contract (**highest value; ship this first if the schedule bites**)

Normalization, grouping, path templating with confidence, schema inference with sample counts,
causality across transitions, auth surface, `coverage.md`, OpenAPI draft, fixtures.

Depends on no fidelity work at all and unblocks the backend on its own. If everything else is cancelled,
this justifies the project.

## F3 — Curation UI

Atom naming and proposals, conflict resolution (A-8), volatile set editing, transition annotation,
coverage checklist. Turns a raw session into something a generator can use well.

## F4 — `rehost` generator + preview + O4/O5a — *v1 shipped, oracles pending*

URL and API-base rewriting, SRI/CSP, host dispositions. Ships **with preview**
([preview.md](preview.md)): per-run loopback origin, `off`/`fixtures`/`proxy` modes, default-deny
egress, request tape. Preview is not a later nicety — without it there is no way to look at a `rehost`
bundle at all, and O4 has no harness.

This is the phase that produces "the site, working, on our backend", and `proxy` mode is what lets the
backend team develop against it.

## F4.5 — Parity harness (`rehost`) — *next*

Entry oracle references (screenshot + meta at close) + automated parity run (O4, O4b, O1-lite).
Independent of `flat` and of full F3 curation.

Done when: a real session (eneba) generates a `parity/report.json` with actionable named gaps without
manual scripts. Spec: [parity.md](parity.md).

## F5 — `flat` generator + slots + O2/O3 + side-by-side

Fragments, slot anchors, fixture adapter, CSS matching-rule references, interaction pass, and the full
side-by-side reference viewer ([preview.md](preview.md) §6). The wireframe path and the input for a
hand-written front-end.

## F6 — Widening

Multi-viewport variants · authenticated sessions (OPEN-3) · streams (OPEN-2) · generation-time
mechanisms layered on the E-6 seam (challenge handling, auth shims, injected instrumentation).

---

**Schedule note.** F1+F2 is the workaround that was actually asked for. F4 makes it a working site.
F5 is a second product wearing the same coat — worth building only if someone will write a front-end
against it. Do not start F5 before F2 is delivered.
