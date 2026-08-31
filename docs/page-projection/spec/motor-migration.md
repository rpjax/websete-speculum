# Motor migration — .NET → sidecar

**Status:** in progress (target **0.3.0** — parte do tag motor, não release separado).  
**Audience:** implementer (Cursor) + reviewer.  
**Related:** [motor-0.3.0.md](motor-0.3.0.md) · [../LIVE-PP-0.3.0-IMPLEMENTATION.md](../LIVE-PP-0.3.0-IMPLEMENTATION.md) §D · [open.md](open.md) · [decision-log.md](decision-log.md) · [frame-protocol.md](frame-protocol.md) · [browser-session.md](browser-session.md)

---

## 0. How to work in this document

These rules exist because every one of them was violated at least once during the
2026-08-29…31 runtime redesign, and each violation cost hours.

1. **Verify before asserting.** Never conclude from a symbol name, a comment, or a
   memory of the file. Open the predicate. State `file:line` for every claim.
2. **A test must be seen red before it is trusted green.** Write the assertion,
   confirm it fails against the unfixed tree (`git stash`), then fix. A test written
   after the fix and never seen failing proves nothing.
3. **Assert properties, not magic numbers.** `assert seq == 65537` is a tautology
   restating the implementation. `assert strictly increasing across reinstall` is a test.
4. **A root-cause fix usually deletes.** If a change *adds* state, a queue, a counter,
   an opcode, or a trigger, it needs an explicit written justification. If nothing got
   simpler, suspect the diagnosis.
5. **Invariants, not triggers.** Never "flush on X" / "retry when Y". State the
   condition under which the system is correct, and make it a function of state.
6. **Silent failure is forbidden.** Every rejection path carries a reason code and
   telemetry. A counter that always reads 0 is a broken instrument, not a passing test.
7. **One feature = one concept + one contract.** Name the concept, never the use case.
   `IUrlResolver` resolves URLs; domain mirroring is one of its configurations.
8. **Ask before inventing.** Where this document says INVESTIGATE, produce the answer
   and report it — do not guess and proceed.

---

## 1. Target architecture (normative — as specified by the owner)

```
client ──socket──► .NET ──── control socket ────► sidecar     permanent, host level, NEVER closes
                    │
                    └──── session socket (gRPC) ─► sidecar     one per session, carries EVERYTHING
```

**Control socket** — .NET ↔ sidecar, permanent, host level. It never closes.

**Session socket** — when .NET opens a session it opens a gRPC socket for that session.
That socket carries **everything**: control RPCs, streams in both directions, and event push
toward .NET / the consumer.

**.NET creates the session** as a real persisted entity — the application-layer abstraction
(identity, tenancy, journal). It also starts the `BrowserSession` in the sidecar and opens
that session's socket. The session socket is the routing.

**On the projection stream path .NET implements nothing.** No coalescing, no dropping, no
frame interpretation. It exposes the IO streams and the interaction ports and passes bytes
through as fast as possible — a dumb pipe by design.

**The only thing .NET decides inside a live session** is answering the RPC hooks the Virtual
raises — permissions (camera, geolocation, …). Presentation relays those to the consumer over
SignalR, gets the answer plus any payload, and returns it.

**Configuration lives in .NET.** The sidecar session never reads configuration. It receives a
complete immutable snapshot at create/launch, and that snapshot does not change for the
lifetime of the session.

**The current implementation is close to this. Only the contracts need adjusting.** The
delta below is recorded as work, not as an open question.

### Delta between this design and the current code (verified 2026-08-31)

| Target | Current | Phase |
|---|---|---|
| Control socket is host level and permanent | `Control` is opened **per session**, with session metadata — `BrowserClients/Grpc/GrpcSessionConnection.cs:167`, reopened at `:2127`. Host operations are separate unary RPCs on the shared channel (`GrpcBrowserClient.cs`, e.g. host resources ≈`:200`) | M8 |
| One gRPC session socket per session, carrying everything | One shared `GrpcChannel` for the whole process (`GrpcBrowserClient.cs:40`); each session opens ~11 streams on it — `PushDomInput`, `Control`, and nine `Watch*` pumps (`GrpcSessionConnection.cs:150-180`) | M8 |
| .NET implements nothing on the stream path | It coalesces intents and drops frames — see §3 evidence | M2, M3 |

### Consumer / attach layer (verified — this design is correct and stays)

Read before touching anything here. This is not a place to redesign; the migration only
adjusts where it touches motor concerns.

- **One live binding per caller.** `Sessions/Services/SessionBindingRegistry.cs` keys by
  `callerId` (`_byCaller`). `BeginStart(callerId, sessionId)` removes and closes the previous
  entry for that caller and returns `replaced` (`:19-43`). Starting a new session for a caller
  therefore *replaces* the previous one by design.
- **Start is a two-phase promotion.** `BeginStart` → `TryPromote` (`:45`) → `CompleteStart`
  (`:117`), with `StartCancellation` / `StartCompletion` per entry (`:359-360`), plus
  `TryCancelStart` (`:73`) and `CancelAllStarts` (`:91`).
- **Attach is carrier registration on a live binding**, authorized by
  `IsAuthorized(callerId, sessionId, token)` (`:128`) / `TryGetLiveByToken` (`:166`);
  `RegisterCarrier` (`:188`) / `UnregisterCarrier` (`:216`) manage the client transports
  (`Entry.Carriers`, `:362`).
- **Output is single-reader fan-out.** `Streaming/SessionOutputFanOut.cs` reads
  `ISessionConnection` once and fans out onto `OutputStreamRegistration`s of matching kind,
  applying `OutputMultiplexingPolicy`, with an attached consumer id and per-kind exclusivity
  (`_attachedConsumerId`, `_exclusiveByKind`).

**No claim about session reattach after runtime loss is made anywhere in this document.**
An earlier draft asserted one; it was wrong and has been removed.

---

## 2. Invariants (non-negotiable)

| # | Invariant |
|---|-----------|
| I1 | .NET never parses, coalesces, drops, reorders or reframes projection payloads. |
| I2 | The sidecar session reads no configuration at runtime. Everything arrives injected at launch and is immutable for the session lifetime. |
| I3 | Backpressure is decided by whoever knows what may be discarded — the motor. .NET may only *report* consumer pressure. |
| I4 | DOM/CSSOM/projection concepts have exactly one definition, in `packages/page-projection`. No C# type may re-declare them. |
| I5 | Every feature crosses as a named contract (port + immutable config record), never as scattered call sites. |
| I6 | K2 (no cross-session state) and K5 (no site JS on Projected) survive every step. Any step that touches them ships with a browser-level regression test. |
| I7 | The consumer / attach layer (§1) is correct as designed. Adjust it only where it touches motor concerns; do not redesign it. |
| I8 | Session-scoped messages travel on the session socket. The host control socket carries nothing that names a session. |

---

## 3. Verified current state (evidence)

Every line below was read on 2026-08-31. Do not re-derive; do re-verify before deleting.

| Behaviour that violates the target | Evidence |
|---|---|
| .NET **coalesces** PP intents (evict move, collapse scroll per scroller) | `Speculum.Api/Sessions/Services/Streaming/PageProjectionIntentAdmissionChannel.cs` (221 lines); instantiated at `Sessions/Services/LiveSession.cs:1674`; field at `LiveSession.cs:56` |
| .NET **coalesces** video-streaming input | `Streaming/VideoStreamingInputAdmissionChannel.cs` (158); `LiveSession.cs:1624`; field `LiveSession.cs:54` |
| .NET **drops frames** under pressure with sequence bookkeeping | `Sessions/Services/Streaming/SequencedDiffChannels.cs` (156); `BrowserClients/Grpc/GrpcSessionConnection.cs:106` (`Create<DomainPageProjectionFrame>(_domDiffCapacity)`); drop accounting at `GrpcSessionConnection.cs:1087` (`(dropped, lowest, highest)`) |
| .NET **materialises** the frame as a typed domain object | `GrpcSessionConnection.cs:19` (`using DomainPageProjectionFrame = …Mirror.PageProjection.PageProjectionFrame`); reader at `GrpcSessionConnection.cs:451` |
| .NET re-declares DOM concepts in C# | `Sessions/Mirror/PageProjection/`: `DomNode.cs`, `DomAsset.cs`, `DomSelector.cs`, `PageProjectionFrame.cs` (282), `PageProjectionIntent.cs`, `PageProjectionResyncSnapshot.cs` |
| .NET owns the shared asset tier (reads frame cache-mode) | `Mirror/PageProjection/SharedAssetCacheL2.cs` (323); DI at `Sessions/BrowserSessionsServiceCollectionExtensions.cs:60-61`; held at `LiveSession.cs:35` |
| .NET interprets motor telemetry payloads | `Sessions/Services/PageProjectionParityTelemetryJournal.cs` (311) — parses `parity_*` payload JSON |
| URL resolution / domain mirroring lives in .NET | `Sessions/Services/UrlResolver.cs` (639): `Resolve(path, query, requestHost)`, `ProjectToClient(targetUrl, requestHost)`, `ProjectMirroredToClient`, `ProjectApexToClient`, `ResolveMirroredTarget`, `ResolveApexTarget`, `_w7s_nso` navigation-state param, `DomainPattern` / `UrlMatchRule` / `PathPattern` matching |
| Tests that encode the wrong behaviour | `Speculum.Api.Sessions.Tests/PageProjectionIntentAdmissionChannelTests.cs`, `…/VideoStreamingInputAdmissionChannelTests.cs` |

### What is already correct (do not "fix" these)

- **The wire contract is right.** `proto/browser_session.proto:379` `PageProjectionFrame`
  already carries `bytes body = 6 // opaque §5.5 binary frame/part` plus a routing header
  (`sequence`, `generation`, `part_index`, `part_count`, `flags`, `version`, `context_id`).
  The protocol is **not** duplicated in the proto.
- **No head-of-line problem.** Each `Watch*` / `Push*` is its own RPC → its own HTTP/2 stream
  (`proto:733-749`). A large resync frame cannot delay `Stop` or a permission reply.
- **The injection point exists.** `LaunchPageProjectionRequest` (`proto:108`) already carries
  the immutable per-session snapshot (device, scripts, allowlist, locale, rates, budgets),
  mirrored by `BrowserSessionOptions` in `sidecar/browser/BrowserSession.ts`.
- **The control channel exists.** `ControlToSidecar` (`proto:578`) is a bidi stream whose
  `oneof` currently holds only `PermissionReply`.
- **The .NET side of injection is right.** `Sessions/Services/SessionConfigAssembler.cs` (197)
  and `Sessions/Services/LaunchScriptResolver.cs` (140) assemble the snapshot. They do not
  move — they grow.

---

## 4. What stays in .NET (do not migrate)

| Area | Reason |
|---|---|
| Auth, Configurations, Database, Journal, Profiles, Maintenance, HostResources, ResourceMonitoring, Presentation | Application layer |
| `SessionService`, `EfSessionRepository`, aggregate `Session` | Entity lifetime, persistence, tenancy |
| `SessionCollector` (244), `SessionDrainOrchestrator` (232), `SessionBindingRegistry` (369) | Orchestration of *many* sessions |
| `SessionOutputFanOut` (472), `SessionStreamMultiplexer` (264), `SessionInputMerger` (224) | Transport topology. **The motor must not know more than one viewer exists.** |
| `InputMultiplexingPolicy` (`Configurations/Models/Sessions/InputMultiplexingPolicy.cs`) | *Who may drive* is authorization, not motor. Consumed at `LiveSessionService.cs:92` → `SessionStreamMultiplexer.cs:29` |
| Permission hooks (camera, geolocation, …) → SignalR → consumer | The one in-session decision .NET owns |
| `SessionConfigAssembler`, `LaunchScriptResolver` | The injection boundary itself |

---

## 5. Work plan

### Phase order (follow it — the dependencies are real)

| Order | Phase | Depends on | Why here |
|---|---|---|---|
| 1 | **M0** spec audit | — | Prevents implementing against a stale spec |
| 2 | **M1** `IUrlResolver` | M0 | Pure function; proves the injected-config pattern |
| 3 | **M8** socket contracts | M0 | **Must precede M3.** M3 adds a session-scoped message; M8 decides which socket carries session-scoped messages. Doing M3 first means moving it again |
| 4 | **M2** remove intent coalescing | M8 | Input backpressure lands on the socket M8 defined |
| 5 | **M3** remove frame dropping + pressure signal | M8, M2 | — |
| 6 | **M4** delete C# DOM types | — | Independent; may run in parallel with M2/M3 if a different person takes it |
| 7 | **M5** shared asset tier | **M4** | The tier reads frame cache-mode; it cannot move before .NET stops understanding frames |
| 8 | **M6** telemetry inversion | M4 | — |
| 9 | **M7** decompose `LiveSession` | all of the above | Only untangles after the motor parts have left |

**Do not start a phase before the previous one is green on Windows gates.** Each phase is one
PR / commit series, self-contained and revertible. Branch per phase off the integration branch;
never mix two phases in one commit.

### Out of scope for this document

The **VideoStreaming** mirror mode. `GrpcSessionConnection.cs:155` branches on
`MirrorMode`, and M2 deletes `VideoStreamingInputAdmissionChannel` — that deletion is in scope
because it is stream-path logic in .NET. Everything else about the video path (whether it
survives beyond 0.3.0 at all — `motor-0.3.0.md` lists "limar Video" as future work) is **not decided
here**. If a phase forces a decision about the video path, **stop and ask**.

---

### M0 — Spec reconciliation (do this first, it is cheap and it prevents wrong work)

**Why:** the specs may describe a system that no longer exists. Implementing against a stale
spec produces work that has to be redone.

**Do:**

1. For each file in `docs/page-projection/spec/`, mark one of: `CURRENT`, `STALE`, `UNKNOWN`.
   Priority order: `browser-session.md`, `frame-protocol.md`, `input.md`, `input-v2.md`,
   `input-unified-design-draft.md`, `loopback.md`, `observability.md`, `open.md`,
   `runtime-redesign.md`, `acceptance.md`, `test-matrix.md`, `support-matrix.md`.
2. For every `STALE` claim, record **the sentence** and **the code that contradicts it**
   (`file:line`). Do not rewrite the spec yet.
3. Produce `docs/page-projection/spec/spec-audit-0.3.0.md` with that table.
4. Flag every spec sentence that describes .NET doing stream work — those are the ones this
   migration invalidates, and they must be rewritten as part of the phase that changes them,
   not before.

**INVESTIGATE and report (do not guess):**
- Does `input-v2.md` or `input-unified-design-draft.md` still describe a live path, or are
  they superseded by `input.md`? If superseded, propose archiving, do not delete.

**Definition of done:** `spec-audit-0.3.0.md` exists; every phase below references the spec
files it must update.

**Do not:** rewrite specs in this phase. Audit only.

---

### M1 — `IUrlResolver`: URL resolution moves to the sidecar

**Concept:** given a request host and a path, which URL the motor navigates; and given a real
URL, which URL the client is shown. The concept is *URL resolution*. Domain mirroring, apex
mode and allowlisting are **configurations** of it, never names in the code.

**Why first:** pure function (config in, string out), no database, no lifecycle, no stream
path. It is the lowest-risk move and it proves the pattern for everything after it.

**Move (port + implementation):**

- `Resolve(path, query, requestHost) -> Result<string>`
- `ProjectToClient(targetUrl, requestHost) -> Result<string>`
- Matching rules: `DomainPattern`, `UrlMatchRule`, `PathPattern`, host normalisation,
  apex/`www` variance, navigation-state encode/decode (`_w7s_nso`).

**Injected at launch (immutable), added to `LaunchPageProjectionRequest` and
`BrowserSessionOptions` as ONE nested message/record — not loose fields:**

```
NavigationPolicy {
  default_target_host
  domains[]              // DomainPattern equivalents
  allowed_main_frame_urls[]   // UrlMatchRule equivalents
  mode                   // mirrored | apex
  navigation_state_param // "_w7s_nso" — carried, not hardcoded in two places
}
```

**Stays in .NET:** `IConfigurationService` as the source of that snapshot, and the decision of
which policy applies to which session. .NET keeps a thin `Resolve` **only** for the inbound
HTTP entry (client host → session start URL), because that happens *before* a session exists.
That is the one legitimate duplication; mark it in code with a comment pointing here.

**Outbound URL surfaces — write the inventory, this is the real work.** Every channel through
which a URL reaches the client must go through `ProjectToClient`, or the mirror leaks the real
domain. Known channels (verify each, add any found):

1. `LocationEvent` stream (`proto:737` `WatchLocation`) → address bar
2. `href` / `src` attributes inside projected DOM nodes
3. `url()` references in CSSOM ops
4. history state / `GoBack` / `GoForward`
5. `NavigationBlockedEvent` (`proto:738`)
6. any URL in console relay or error surfaces visible to the client

**Rule for URLs with no mapping:** not ours → **do not rewrite, do not block**. The user
deliberately left; the product decides what to do (open externally / show as-is). No special
branch, no attempt to retain.

**Tests:**
- Port unit tests in the sidecar: mirrored mode, apex mode, apex↔`www` variance, unmapped host
  passthrough, navigation-state round-trip.
- One end-to-end lab blueprint: entry `public/br/x` → sidecar navigates `upstream/br/x`;
  upstream redirects to `www.upstream/br/x`; the location event reaching the client reads
  `www.public/br/x`.
- Delete or port the corresponding .NET tests; do not leave both.

**DoD:** sidecar owns resolution; .NET keeps only the pre-session entry resolve; the outbound
inventory is a written list in `browser-session.md` with each item ticked.

**Traps:**
- Do not name anything `mirror` in the port API. The concept is resolution.
- `www` vs apex is not host equality — handle it explicitly and test it.
- The navigation-state parameter name must exist in exactly one place.

---

### M2 — Remove intent coalescing from .NET

**Concept:** admission under pressure belongs to the motor, because only the motor knows what
is coalescible and what is irreplaceable.

**Delete (not move — the sidecar already has this):**

- `Sessions/Services/Streaming/PageProjectionIntentAdmissionChannel.cs`
- `Sessions/Services/Streaming/VideoStreamingInputAdmissionChannel.cs`
- their wiring in `LiveSession.cs:54,56,1624,1674`
- `Speculum.Api.Sessions.Tests/PageProjectionIntentAdmissionChannelTests.cs`
- `Speculum.Api.Sessions.Tests/VideoStreamingInputAdmissionChannelTests.cs`

**Why delete rather than move:** the sidecar already coalesces (`ClientBuffer` in
`packages/page-projection/src/projected/input/ClientBuffer.ts`, `SidecarBuffer` in
`sidecar/browser/input/SidecarBuffer.ts`). Two ends coalescing is worse than one: .NET can
discard an intent the sidecar needed, and the discard is invisible to the motor.

**INVESTIGATE and report before deleting:**
- Does the sidecar's admission cover *every* class .NET protected (press, key, scroll, files,
  focus never dropped)? If a class is unprotected in the sidecar, **add it there first**, in
  a separate commit, with a test — then delete the .NET side.
- Is `PushDomInput` (`proto:747`) backed by an unbounded channel in .NET after the deletion?
  If yes, that is a memory risk. **Note it is the opposite direction from M3** (client → sidecar,
  not sidecar → client), so M3 does not cover it. Report it and stop; the bound belongs on the
  session socket as a flow-control decision, and it needs review before implementation.

**Tests:** a lab blueprint that floods intents and asserts no press/key/scroll/file/focus is
lost, with the sidecar counters as evidence (`probes/input-pipeline.json`).

**DoD:** no coalescing symbol remains in `Speculum.Api`; the flood test passes; the input
counters show the same protected classes as before.

---

### M3 — Remove frame dropping from .NET; add consumer-pressure signal

**This is the phase that can go wrong. Read it twice.**

**Concept:** .NET reports that its consumer is slow. The motor decides what to do about it.

**Delete:**
- `Sessions/Services/Streaming/SequencedDiffChannels.cs`
- its use at `GrpcSessionConnection.cs:106` and the drop accounting at `:1087`
- the associated capacity config (`SessionsConfiguration.cs:34` and
  `GrpcSessionMappers.cs:57,214` `frameQueueCapacity` / `DefaultCapacity`) — **only after** the
  replacement below exists

**Add — one new member of the control oneof carried on the SESSION socket** (I8). Do not
attach this to the host control socket introduced in M8; it names a session, so it belongs to
that session. If M8 has not landed yet, **stop** — the ordering table exists for this reason.
No new channel is created either way:

```proto
message ControlToSidecar {
  oneof message {
    PermissionReply permission_reply = 1;
    ConsumerPressure consumer_pressure = 2;   // new
  }
}

message ConsumerPressure {
  string session_id = 1;        // redundant on a per-session socket; keep only if the socket
                                // does not already carry session identity — decide in M8
  uint32 queued_frames = 2;     // what .NET is holding for this consumer
  uint64 queued_bytes = 3;
  uint64 oldest_queued_ms = 4;  // age of the oldest unsent frame
  bool   draining = 5;          // true while catching up
}
```

.NET **measures and reports**. It never decides. The sidecar reacts by lowering rate,
coalescing, or emitting a resync — all of which it already knows how to do.

**INVESTIGATE and report before deleting:**
1. Where exactly does the frame queue toward the client live today, end to end
   (`GrpcSessionConnection` → `SessionOutputFanOut` → client socket)? Write the hop list.
2. With `SequencedDiffChannels` gone, what bounds that queue? If the answer is "nothing",
   the bound must be re-introduced **as reporting plus a hard ceiling that disconnects the
   consumer**, never as a silent drop of motor payload. Propose it and wait for review.
3. Does any client depend on `dropped/lowest/highest` accounting today? If yes, name the
   consumer.

**Tests:**
- Sidecar-side unit: on `ConsumerPressure` above threshold, the motor takes a stated action and
  the action is observable in telemetry.
- Lab: slow consumer scenario; assert **no silent gap** — either frames arrive, or a resync is
  issued, or the consumer is disconnected with a reason code. Never a hole.

**DoD:** no drop logic in `Speculum.Api`; pressure signal implemented both sides; the slow
consumer test proves one of the three named outcomes and never a silent gap.

**Traps:**
- Do not re-implement dropping "temporarily" in .NET. If M3 cannot land, revert M3 whole.
- The pressure message must be rate-limited or it becomes the flood it is reporting.

---

### M4 — Delete C# DOM/projection types; .NET relays opaque envelopes

**Concept:** the projection payload has one definition (I4).

**Delete:**
- `Sessions/Mirror/PageProjection/DomNode.cs`, `DomAsset.cs`, `DomSelector.cs`,
  `PageProjectionIntent.cs`, `PageProjectionResyncSnapshot.cs`
- reduce `PageProjectionFrame.cs` to nothing, or to a thin alias of the generated proto
  message if a domain type is genuinely required by the transport
- the alias at `GrpcSessionConnection.cs:19` and any code that reads `body`

**Keep:** the proto message as-is. `proto:379` is already an opaque envelope + header — this
phase does not touch the wire.

**INVESTIGATE and report:**
- Does anything in .NET read `PageProjectionFrame.body` or the deprecated `plane` / `operation`
  fields? List every reader. Each one is either routing (keep, using the header only) or
  interpretation (delete).
- `GetDomAsset` (`proto:751`) and `PutDomUpload` (`proto:754`) — do they require .NET to
  understand asset semantics? If yes, that belongs in M5, not here.

**Tests:** existing PP category in SessionsTest must stay green; if a test depended on the
typed domain object, rewrite it against the envelope header, do not delete the coverage.

**DoD:** no DOM concept name exists under `Speculum.Api`; a grep for `DomNode|DomSelector|
DomAsset` in C# returns nothing.

---

### M5 — `ISharedAssetTier` moves to the sidecar as a host-level port

**Concept:** bytes that carry no session identity are not session state (K2), so they may be
deduplicated across sessions.

**Note the exception to I2:** this is **host-level**, not per-session. The session receives a
reference to the tier; it never creates it and never configures it. The shareability gate is
an immutable policy of the tier.

**Move:** `Mirror/PageProjection/SharedAssetCacheL2.cs` (323) and its `IsShareable` gate.
**Delete after move:** DI registration at `BrowserSessionsServiceCollectionExtensions.cs:60-61`,
field at `LiveSession.cs:35`.

**Why it must not land before M4:** the tier decides shareability by reading frame cache-mode.
While .NET still understands frames it can stay; the moment M4 lands it cannot. M5 is a
separate phase — do not merge it into M4.

**Tests (K2 is at stake — browser-level, not shape-level):**
- Two concurrent sessions; a credentialed/cookie-bearing response fetched by session A must
  **never** be served to session B. Assert on the served bytes, not on the predicate's return.
- A public cookie-less subresource is deduplicated (hit counter proves it).

**DoD:** tier lives in the sidecar; both K2 tests pass; nothing in `Speculum.Api` references
asset sharing.

---

### M6 — Telemetry contract inversion

**Concept:** the motor declares what happened; the application decides where it is filed.

**Change:** the sidecar emits **typed** lifecycle/parity events over the existing
`WatchPageProjectionLifecycle` (`proto:743`) instead of a payload the .NET side parses.

**Delete:** `Sessions/Services/PageProjectionParityTelemetryJournal.cs` (311) — its
`TryJournal(catalog, events, phase, payloadJson)` parses `parity_*` payload JSON, which is motor
knowledge in the application layer.

**Keep in .NET:** journal catalog, retention, telemetry writers.

**Separable sub-items (already on the 0.3.0 polish list). They may be split into their own
commits, but none of them may be skipped:**
- Dead metrics that always read 0: `encodeMs`, `dispatchMs`, `clientLagMs`. Either measure them
  or delete the fields. A metric that always reads 0 is a broken instrument.
- Obsolete contract fields `establish_chunk_bytes` (`proto:135`, already "Deprecated / ignored")
  and `client_state_ms` — remove, do not carry into 1.0.
- Empty `verdicts.json` on browse dossiers: either the lab declares a verdict or the file
  states explicitly that no oracle ran. Silence is the failure mode we are removing everywhere
  else; it should not survive in the lab.

**DoD:** no motor payload is parsed in C#; no metric in the dossier reads a constant 0.

---

### M7 — Decompose `LiveSession`

**Last, and only last.** `Sessions/Services/LiveSession.cs` is 2436 lines where motor and
application are interleaved. After M1–M6 the motor parts have already left; what remains
should be lifetime, notification routing and orchestration.

**Do:**
1. Re-read the file end to end and classify every region: `LIFETIME`, `ROUTING`,
   `NOTIFICATION`, `MOTOR-RESIDUE`.
2. Report the classification **before** changing anything.
3. Extract by classification, one commit per region.

**Do not** attempt this phase opportunistically during M1–M6 or M8.

---

### M8 — Socket contracts: host control vs session socket

**Concept:** two sockets with two jobs. The control socket is host level and permanent; the
session socket belongs to one session and carries everything about it.

**Do:**

1. **Split control.** Introduce a host-level, permanent `Control` stream on the sidecar service
   that is opened once by `GrpcBrowserClient` at construction and never closed. Move to it
   anything that is about the host and not about a session. Everything session-scoped
   (permission request/reply, consumer pressure from M3) travels on that session's socket.
2. **One socket per session.** `StartConnectionAsync` opens the session's own gRPC connection
   instead of multiplexing every session's streams onto the single process-wide channel.

**INVESTIGATE and report before implementing step 2:**
- What `MaxConcurrentStreams` does the sidecar's gRPC server advertise? With ~11 streams per
  session on one shared channel, that value is the hard ceiling on concurrent sessions and it
  must be reconciled with K3 (≥100 sessions). Report the number and the resulting ceiling.
- Which of today's RPCs on `GrpcBrowserClient` are genuinely host level (no `session_id`) and
  which only look host level? List both sets before moving anything.

**Tests:**
- Host control stream survives creation, use and disposal of many sessions without reconnect.
- Concurrency test at the density K3 claims: N sessions live at once, each with its own socket,
  all streams healthy. This is also the live two-session C2 smoke that `motor-0.3.0.md` still
  owes — write it once, use it for both.

**DoD:** control stream is opened once per process and never per session; every session owns
its socket; the density test passes at the target N.

**Traps:**
- Do not keep a per-session `Control` "for compatibility". Two control paths is the ambiguity
  this phase exists to remove.
- Connection-per-session costs sockets and handshakes; measure it in the density test rather
  than assuming either way.

---

## 6. Pre-1.0 proto hygiene (do with M4, while the wire is still unfrozen)

Once 1.0 ships these are compatibility surface forever.

| Field | Location | Action |
|---|---|---|
| `plane = 3`, `operation = 4` | `proto:382-383` — "deprecated for binary frames, empty string" | remove |
| `establish_chunk_bytes = 27` | `proto:135` — "Deprecated / ignored" | remove |
| `anchor = 3` in `DomInputEvent` | `proto:396` — "DEPRECATED — kept for the V1 transition only" | remove |
| `reserved 7;` gap | `proto:400` — "still-undecided companion field" | decide or reserve permanently with a comment saying why |
| `payload_json` in `DomInputEvent` | `proto:397` — intent as JSON string inside a proto message | **not urgent**, but record the decision consciously for 1.0 rather than discovering it |
| field-number gaps 16–17 in `LaunchPageProjectionRequest` | `proto:123-125` | document why, or reuse |

**Rule:** removing a field is a wire change. Do it in one commit, with the .NET and sidecar
sides in the same commit, and note it in `frame-protocol.md`.

---

## 7. Global definition of done

The migration is complete when all of the following hold:

- [ ] A grep for `Dom(Node|Selector|Asset)`, `Coalesc`, `Admission`, `SequencedDiff` under
      `Speculum.Api` returns nothing.
- [ ] `Speculum.Api` compiles with no reference to `Mirror/PageProjection` types.
- [ ] The sidecar session reads no configuration at runtime — verified by a boundary check
      (extend `check:page-projection-boundaries`) that fails on any config read inside a session.
- [ ] Every migrated feature is a named port with an immutable config record injected at launch.
- [ ] The slow-consumer test produces one of the three named outcomes, never a silent gap.
- [ ] K2 and K5 browser-level regression tests pass.
- [ ] `spec-audit-0.3.0.md` items are all resolved: each `STALE` sentence rewritten or archived.
- [ ] Windows full gates green; SessionsTest `Category=PageProjection` green **and actually run**,
      not merely compiled.

---

## 8. Stop rules

- If a phase requires adding state, a queue or a counter to make it work, **stop and report**.
  That is the signal that the boundary is drawn in the wrong place (rule 4).
- If a test cannot be seen red before green, **stop and report** — the test is not measuring
  what it claims.
- If an INVESTIGATE item cannot be answered from the code, **stop and ask**. Do not proceed on
  an assumption.
