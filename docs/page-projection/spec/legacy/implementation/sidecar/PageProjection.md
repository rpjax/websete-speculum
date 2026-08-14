# Implementation — PageProjection (orchestration only)

| Field | Value |
|-------|-------|
| **Future path** | `Refactor/sidecar/browser/patchright/mirror/page/PageProjection.ts` |
| **LOC ceiling** | 300 |
| **Contracts implemented** | Wiring only across contracts 01–07, 12; redesign §4 / §9 orchestration rule |
| **Invariants** | This file contains **no algorithms** for identity, F, observe, flush, encode, checksum, Cssom coalesce, pierce discovery, mirror apply, or URL rewrite. It constructs modules, wires callbacks, owns session lifecycle hooks, and forwards. |
| **Ban list** | Embedding flush/encode/HTML walk logic. JSON ferry. DomMap bootstrap. Recycle navigated browsers. Soft-nav generation bump. rAF clock. Any workaround path forbidden by AGENTS.md / acceptance. |

---

## Responsibility

`PageProjection` is the session-scoped façade the browser session host calls. It:

1. Acquires / releases pool browsers (contract 12).
2. Injects concatenated in-page script ([inpage.md](inpage.md)).
3. Constructs Node modules: channel, rewrite, mirror, pierce host, rate policy, watchdog.
4. Starts/stops observe/clock via in-page bootstrap API.
5. Triggers establish on init and hard-nav; ignores soft-nav for establish (D-SPEC-9).
6. Forwards rewritten parts to API relay.
7. Serves OOB resync from mirror.
8. Resolves input ids via identity host.

---

## Types / signatures

```ts
interface PageProjectionOptions {
  // Subset of contract 15 knobs needed by sidecar
  frameRateHz: number;
  frameRateLadder: number[];
  hiddenRateHz: number;
  rateRecoverMs: number;
  frameStallMs: number;
  maxFrameBytes: number;
  establishChunkBytes: number;
  mirrorMaxBytes: number;
}

interface PageProjection {
  attach(session: SessionHandles, opts: PageProjectionOptions): Promise<void>;
  detach(): Promise<void>;
  /** Hard Document swap detected. */
  onHardNavigation(): Promise<void>;
  /** Soft-nav: no-op for establish/generation. */
  onSoftNavigation(): void;
  handleResyncRequest(req: ResyncRequest): Promise<ResyncStream>;
  resolveInputNode(id: number): Promise<JSHandle | undefined>;
}

interface SessionHandles {
  page: PageLike;
  pool: BrowserPool;
  relay: FrameRelay; // API outbound
  telemetry: TelemetrySink;
}

interface BrowserPool {
  acquire(): Promise<CleanBrowserInstance>;
  releaseDestroy(instance: CleanBrowserInstance): Promise<void>;
}
```

---

## Browser pool (contract 12) — normative orchestration

Full pool sizing lives with the session host; `PageProjection` **must** obey:

1. **Acquire** at session start: `instance = await pool.acquire()` — clean, fresh context+profile, **never navigated** (PP-SESS-1 / E10).
2. Navigate only after attach wiring is ready (bindings installed).
3. **Release:** `await pool.releaseDestroy(instance)` — instance is **destroyed**, never recycled to another session (PP-SESS-2, K2).
4. Report `Session.PoolAcquired` / `Session.PoolReleased` with `bootMs` **separate** from site-load timings.
5. Defaults: `browserPoolSize=8`, `browserPoolRefillPerSec=2` (config 15) — owned by pool service; PageProjection does not reimplement refill math.

MUST NOT share cookies, storage, DOM, CSSOM, or id space across sessions.

---

## Step-by-step — `attach` (wiring only)

1. `pool.acquire()` → store instance.
2. Launch flags for unthrottled timers (delegate to pool launch config — [clock.md](clock.md)).
3. `channel.start(page, { onPart })`.
4. Inject in-page script (concat build artifact).
5. Call in-page `bootstrap({ frameRateHz, maxFrameBytes, … })` — constructs identity/fmap/observe/frame/clock/encode/cssom/establish inside page.
6. Construct `rewrite`, `mirror` on Node.
7. Wire `onPart`:
   - `rewritten = rewrite.rewritePart(bytes)`
   - `mirror.applyPart(rewritten)`
   - `relay.send(rewritten)`
8. Start Node rate policy + watchdog timers (call into clock control / forceFlush).
9. On first document ready: `inpage.runEstablish()` then enable live push.
10. Emit telemetry establish started/completed via sink (no per-op facts).

### `onPart` MUST NOT

Decode for business logic beyond rewrite+mirror; MUST NOT JSON.parse tree.

---

## Step-by-step — `onHardNavigation`

1. In-page `identity.bumpGeneration()` + cssom clear maps.
2. `mirror.clear()`.
3. `inpage.runEstablish()` for new Document.
4. Emit `Diff.GenerationBumped`.

### `onSoftNavigation`

No generation bump; no establish; live frames continue (PP-NAV-2).

---

## Step-by-step — `handleResyncRequest`

1. Do **not** advance live sequence.
2. `html = mirror.serializeHtml()`; `install = mirror.serializeCssomInstall()`.
3. Encode resync frame(s) with `FLAG_RESYNC` via Node-side encoder helper (shared encode module usable from Node for resync only — establish live encode remains in-page). Watermark `{ generation, coversThroughSequence }` from mirror’s last applied live sequence.
4. Stream to client; page not involved (PP-REC-2, PP-REC-3).

---

## Module import map (no logic)

| Module | Role |
|--------|------|
| `identity` | Host façade |
| `fmap` | (in-page) |
| `observe` | (in-page) |
| `frame` | (in-page) |
| `clock` | in-page + Node policy |
| `encode` | in-page (+ Node resync encode) |
| `establish` | in-page |
| `cssom` | in-page |
| `channel` | Node ↔ page |
| `pierce` | Node CDP + in-page adopt |
| `node/mirror` | flat mirror |
| `node/rewrite` | URL rewrite hop |
| `inpage` concat | script injection |

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-SESS-1` | Warm pool → E10 |
| `PP-SESS-2` | Destroy on release |
| `PP-NAV-1..2` | Hard vs soft wiring |
| `PP-REC-2..3` | Resync from mirror |
| `PP-EST-3` | Establish triggered once per hard epoch |
| Orchestration | File stays ≤300 LOC; no flush/checksum bodies |

---

## Failure forwarding

On mirror over budget → `mirror_over_budget` / `phase: live_apply` → desync path.  
On channel fault → catalogued failure with errorCode+phase.  
Never soft-skip.
