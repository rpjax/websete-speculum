# Parity — offline bundle vs session references

Mechanical comparison between a generated **rehost** run and **references stored during capture**.
Never against the live origin (D-015) — the origin has drifted; comparing against it is an argument,
not a measurement.

Operational procedure for oracles O1, O4, O4b. Full oracle definitions: [acceptance.md](acceptance.md).

---

## 1. Purpose

A preview that "looks mostly right" hides layered gaps:

| Layer | Typical symptom |
|---|---|
| Fixtures | GraphQL spinners, empty hero, forms that never submit |
| Assets | Broken images, blank slots, wrong aspect ratios |
| Visual | Layout shifts, modals, typography |

Parity turns those into a **named gap list** and optional pixel diff — so fixing stops being guesswork.

---

## 2. References (capture)

Stored under `oracles/<snapId>/` in the closed session ([ir.md](ir.md) §1).

| File | Content |
|---|---|
| `reference.png` | Viewport screenshot, animations paused for that instant only (A-2 exception) |
| `meta.json` | `url`, `viewport`, `dpr`, `locale`, `timezone`, `userAgent`, `capturedAt` |

**MVP scope (D-034):** capture references for:

1. the **entry snapshot** — first `mark`, else first snapshot (same rule as `rehost` entry)
2. every snapshot with `trigger === 'mark'`

CSS matching-rule sets and geometry (full A-9) are **F5** — not required for F4.5 MVP.

References are taken **at close**, while the browser is still up, after asset resolution (C-4) and
before the context closes ([capture.md](capture.md) §2).

---

## 3. Parity run (preview)

Triggered from the panel (`POST /api/parity/run`). Inputs: `(sessionId, runId)`.

Steps:

1. Start preview in **`fixtures` mode** (O1 comparison uses the same mode as accept).
2. Playwright (headless, system Chrome): open preview entry URL, dismiss cookie banners if present,
   wait for network idle.
3. Collect the **preview tape** (O4 evidence — [preview.md](preview.md) §5).
4. Screenshot candidate → `runs/<runId>/parity/candidate/<snapId>.png`.
5. Compare candidate vs stored reference (O1-lite when reference exists).
6. Write `runs/<runId>/parity/report.json`.

Preview remains read-only (D-020). Parity writes only under the run directory (`parity/`).

---

## 4. Oracles in F4.5 MVP

| Oracle | Pass when |
|---|---|
| **O4** | No product `missing`, `missing-asset`, or unexpected `blocked` on the tape (fixtures mode). Telemetry (Sentry, GTM, Forter, …), browser extensions, and local `/metrics/` proxy hops are **ignored** — listed in `ignored` count only. |
| **O4b** | Every GraphQL POST in the tape matched a session fixture (by body hash, pq, or gql key) |
| **O1** | Reference exists and: differing pixels ≤ **0.1%**, no contiguous diff region &gt; **32×32 px** |

O1 is **skipped** (not failed) when no reference was captured for the entry snapshot.

O2 (CSS rules) and O3 (interaction) remain F5 — see [roadmap.md](roadmap.md).

---

## 5. Report artifact

`runs/<runId>/parity/report.json` — schema version 1:

```jsonc
{
  "schema": 1,
  "sessionId": "sess-…",
  "runId": "gen-…",
  "at": "ISO-8601",
  "entrySnapId": "snap-014",
  "viewport": { "width": 1440, "height": 900, "dpr": 1 },
  "pass": false,
  "oracles": {
    "O4": { "pass": false, "missing": 2, "missingAsset": 14, "blocked": 0, "gaps": [...] },
    "O4b": { "pass": true, "graphqlMissing": [] },
    "O1": { "pass": false, "skipped": false, "differPct": 8.2, "maxRegion": { "w": 120, "h": 340 } }
  },
  "gaps": [
    { "layer": "fixture", "summary": "GraphQL HomePage not in session" },
    { "layer": "asset", "summary": "14 imgproxy URLs missing from bundle" }
  ]
}
```

`gaps[]` is the human-readable rollup. `oracles.*` is machine truth.

---

## 6. Anti-patterns

- Declaring PASS from a green tape while the screenshot diff shows hero slots empty.
- Comparing against `https://www.eneba.com` live instead of stored references.
- Treating O1 skip (no reference) as accept — partial result only.
- Writing fixture bodies from inside preview (D-020). Missing fixtures are fixed by re-capture or an
  explicit panel action on the session, not by the preview server.

---

## 7. Panel UI (F4.5)

On the preview view:

- **Run parity** button
- PASS / FAIL badge
- Gap list (layer + summary)
- Thumbnails: reference · candidate · diff (when O1 ran)

Side-by-side interactive comparison remains F5 ([preview.md](preview.md) §6).
