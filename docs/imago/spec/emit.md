# Generation — IR → bundle

Two emitters, one IR (**D-005**), both driven by a configuration profile (§7). **`flat` is the
default (D-042).** `rehost` is unchanged and still available, but it is no longer the path to "it
works": shipping the origin's JavaScript means inheriting every way someone else's application can
fail, and none of those failures are ones we can fix. A generation run never
writes into a session (S-2) and never touches the network (IR-6).

| | `rehost` | `flat` |
|---|---|---|
| Ships | the origin's own HTML/JS/CSS/assets | our markup + the origin's authored CSS |
| JS | original, running | none (or a declared minimal shim) |
| Functional | **yes — it is the application** | CSS-driven only: hover, focus, transitions, breakpoints, keyframes |
| Maintainable | no (minified) | yes |
| For | a working site over our backend | wireframe, and input for a front-end we write |

## 1. Invariants (E1–E5)

- **E1 Idempotent.** Same session + same profile → byte-identical output. No timestamps, no run ids, no
  hash-map iteration order. Enforced by O5a.
- **E2 Closed world.** The rendered bundle issues no request outside its own origin, the configured API
  base, and the configured allowlist. Enforced at runtime by O4, not by inspection.
- **E3 No observed data in markup (I1).** A slot emits an addressable empty anchor. Fixtures are opt-in
  and served by an adapter, never baked in.
- **E4 IR-only.** No network at build time. A missing byte means capture was incomplete: fail, do not
  fetch.
- **E5 Loud failure.** A non-closed IR (C-4) or one with substitutions refuses to generate unless run
  with an acknowledged-degradation flag, which is recorded in the output manifest.

## 2. `rehost`

The origin's own bytes, served from our origin, pointed at our backend. Rewrites, all configured:

1. **URLs** — absolute origin URLs in HTML, CSS `url()` and enumerated JS literals → relative paths into
   `assets/`. Blanket search-and-replace across minified bundles is **banned** (it corrupts unrelated
   strings); literal rewriting is per-target and listed in the profile.
2. **API base** — redirected at our backend. Preference order: runtime config object → build-time
   literal → `fetch`/XHR interception shim. Which exists is the target probe's main question, and it is
   the difference between an afternoon and a week.
3. **SRI** — `integrity` dropped or recomputed. It cannot survive rewritten bytes, and a stale hash is a
   blank page.
4. **CSP** — ours, derived from the closed world (E2), not copied from the origin.
5. **Service workers** — the origin's registration removed; any SW in the bundle is ours and declared.

`rehost` is the only output that can honestly claim "identical and 100% functional" — it does not
reproduce the application, it *is* the application, missing only its server.

## 3. `flat`

One document per atom from the IR tree, authored stylesheets referenced (never inlined as computed
style — **I3**), fragments emitted once and included, assets relative, slots marked:

```html
<span data-imago-slot="slot-a91f"></span>
```

Honest about what it is: a dead page that preserves exact structure, the complete authored CSS, the
asset set, and a map of where data belongs. **No semantic componentization (I4)** — fragments carry
hashes, not names; `repetition` records ship as metadata beside the output, not as invented components.

### 3.1 Why this is the emitter that cannot fail the interesting way

`rehost` has to **guess** what the application will ask for at runtime, because the application is
still running: a webpack chunk URL built by concatenation, an API origin assembled inside the bundle,
an analytics SDK's endpoint. `flat` does not guess, because its reference set was **enumerated from
the render tree at capture time** — `img/src`, `srcset`, `url()` in the rules we kept, `@font-face`,
`poster`, the icon. That set is finite and closed.

Everything the sweep existed to compensate for therefore has nothing to do here: no host promoted by
probe, no fetch budget, no byte budget, no document-host fence, no page crawled by accident. A
reference we do not hold is a **capture gap with a name** (E4: fail, do not fetch), and the operator's
answer is to browse further or mark another state — never for the generator to go to the network.

### 3.2 The rules

**Rule E-18 — no script leaves the emitter.** `<script>` is dropped whole, and so is every `on*`
attribute. This is not a safety measure bolted on; it is the definition of the output. A page that
runs nothing cannot mismatch hydration, cannot 404 a lazy chunk, cannot have a third-party SDK throw
inside an error boundary, and has no API call to answer.

**Rule E-19 — the cascade is re-emitted, never re-referenced.** One file per source sheet, in source
order, named `styles/<order>-<hash>.css`. The origin's own `<link rel=stylesheet>` and `<style>`
elements are dropped: the CSSOM already carries that text, so keeping them would apply the cascade
twice and the second copy would still point at the origin.

**Rule E-20 — dropped because a dead page cannot honestly use them.** `<base>` (it would break every
relative path we just rewrote), `<noscript>` (its content is the fallback for a page that never ran,
and would duplicate content that did), the origin's `<meta http-equiv>` CSP and `refresh`,
`integrity` (it cannot survive a rewritten byte, and a stale hash is a blank page), `nonce`,
`loading="lazy"` (nothing will scroll this page), and every `link rel` except the icons.

**Rule E-21 — a reference we do not hold has its attribute removed, not left pointing at the
internet.** E2's closed world made mechanical: leaving the original URL would send the rendered page
to the real origin, which is the one thing the bundle must never do. The URL goes to
`manifest.missing`; in CSS it becomes `url('about:blank')`, which fails silently instead of leaving.

**Rule E-22 — `url()` rewriting is allowed here, and only here.** The ban in §2.1 is on rewriting
**minified JavaScript**, where a string that looks like a URL may be anything. `url()` in CSS is a
grammar production with exactly one meaning, and `flat` never touches JavaScript at all — so the
dangerous case cannot arise. This is the deeper reason `flat` is the safe emitter, not merely the
simpler one. Replacements are single-quoted, because the same text must be valid inside a stylesheet
file *and* inside a double-quoted `style` attribute.

**Rule E-23 — assets are content-addressed, always.** `assets/<hash><ext>`, with the extension taken
from the recorded content type (E-15's rule). Not an escape hatch as in `rehost` (C-4d, E-14) but the
only layout, which makes a path collision and an over-long Windows path impossible by construction
rather than handled.

**Rule E-24 — a link is a destination, resolved.** Every navigation target — `<a href>`, `<area
href>`, `<form action>` — is resolved against the page's own URL first. One pointing at a page this
session captured becomes our copy, so the operator's atoms are each other's links; everything else
keeps the **absolute** original, which is where the origin was sending the reader anyway. A
fragment-only `href` stays a fragment; a `javascript:` href is dropped, being inline script.

"Left exactly as written" was the earlier rule and it was wrong: on a real page **71 of 87 links are
root-relative** (`/store/all`), so under our origin they resolved to `127.0.0.1:<port>/store/all` and
dead-ended inside the bundle — the operator clicked the menu and got a 404. E2 is untouched, because
a link issues no request until a human clicks it, exactly like the absolute links that were always
kept.

**Rule E-25 — live state is emitted explicitly.** An input's `value`, a box's `checked`, an option's
`selected` — captured from the live DOM and written as attributes, so the static page shows what the
operator actually saw. Never presented as bytes the origin served.

**Rule E-26 — a shadow root becomes declarative shadow DOM.** `<template shadowrootmode="open">`; the
browser builds the shadow tree from markup with no script. A `closed` root is emitted open, with a
warning: closedness cannot be reproduced without script, and structure matters more than a flag
nothing can observe.

**Rule E-28 — a frame's `src` is decided by the frame branch, never as a plain attribute.**
An `iframe` or `frame` whose inner document this session captured points at our copy of it; one we
could not read — cross-origin, or never reached — is emitted with **no `src` at all**, and the warning
says which and why. This rule exists because it was broken: `iframe` was missing from the
URL-attribute table, so six live external frames (a review widget, an anti-fraud SDK, three tracking
pixels) shipped inside a bundle that is supposed to be a closed world.

**Rule E-29 — a relative URL inside a stylesheet resolves against the stylesheet, not the document.**
Every sheet lives in `styles/`, so from inside one the asset directory is exactly one level up
(`../assets/…`), whatever depth the referencing document sits at. Also learned the hard way: the
emitted CSS said `url('assets/…')`, the browser asked for `/styles/assets/…`, and three `@font-face`
files 404ed while every string assert stayed green.

**Rule E-31 — the dead end is the bundle's index.** A navigation to a path this session never
captured answers 404 with a generated page that names the URL asked for, says a `flat` bundle has no
router to hand it to, and **lists every document the bundle holds**, linked. A black page reading
"no such document in this bundle" is indistinguishable from a crash; the same fact, with the pages
next to it, is a way forward.

**Rule E-30 — one document per page, not per snapshot.** A session holds many snapshots of the same
URL — one per settle, one every 20 s (A-12) — so each **URL** gets exactly one document, and the
snapshot chosen is the last one the operator **marked**; with no marks, the most recent capture. The
count and the choice go into the manifest's warnings. The first flat bundle shipped with **no entry
document at all** because the path was keyed by URL while being decided per snapshot, so four
snapshots of one page overwrote each other's mapping. The emitter now refuses to finish without an
entry (E5), rather than producing a bundle whose own root 404s.

**Rule E-27 — what the emitter cannot carry is named, never hidden.** A blank `<canvas>` (its pixels
needed script), a cross-origin iframe (its document was never readable), a `closed` shadow root
emitted open — each one a warning in the manifest. And the preview of a `flat` run answers an
uncaptured path with **404**, never with the entry document: there is no client-side router to hand
the path to, so showing the homepage under a URL nobody captured would be a lie that reads as success.

## 4. Fragment inclusion

Build-time inclusion, resolved before writing: one fragment file, N references, zero runtime cost, no
framework. A fragment is never promoted to a custom element, a template or a parameterized partial —
that is componentization through the back door.

## 5. Third-party, telemetry and challenges

**E-6 — every non-API host in the contract needs an explicit disposition in the profile**, with no
default, because a silent default is how a bundle quietly phones an analytics vendor from a customer
demo:

| Disposition | Effect |
|---|---|
| `stub` | inert placeholder preserving recorded dimensions (no layout shift) |
| `drop` | element and script removed |
| `keep` | left intact **and** added to the E2 allowlist, with a written justification |
| `fixture` | served from recorded bytes by the dev adapter |

Challenge widgets default to `stub`. A challenge is a live conversation with a third-party origin and
cannot be replayed — so Imago ignores it rather than pretending. **This is also the seam for anything
added on top later**: a challenge mechanism, an auth shim, a mock layer, injected instrumentation are
all generation-time steps configured here. Capture stays dumb; the cleverness lives where it can be
re-run for free.

## 5a. The application's own API is same-origin — and that is where a bundle blanks

A client-routed application calls its API with a **relative path**. Served from our origin, that
request arrives at the worker looking exactly like a local file request, and treating it as one is the
single most convincing way for a bundle to look correct and then fail:

1. the server-rendered document paints, complete, with every asset;
2. hydration asks for data;
3. the static layer answers 404 — or worse, answers the SPA fallback's HTML;
4. the application replaces its content with empty state, about half a second in.

**Rule E-7 — the worker routes by intent, not by origin.** A navigation or an asset request is served
bytes (route map, then the local file). Anything else is a **data request**, and it goes to the
preview's API layer under the URL the recording knows it by — the primary host plus the path — so
fixtures can match what was actually recorded.

**Rule E-8 — the SPA fallback is for navigations only.** An unknown path is a client route only when
the request is a navigation. Handing the entry document to a `fetch` that expected JSON kills the
application on a parse error, which reads as "the bundle is broken" and is not.

**Rule E-9 — the boot reload is guarded and happens at most once per tab.** An unguarded reload while
waiting for the worker to activate is a loop, and it fires just after first paint, which is
indistinguishable from the page breaking by itself.

## 5ante. An extension-less URL is not a download

A static server types a file by its extension, and a real site's URLs mostly have none:
`/steam-gift-terraria` serves HTML, `/edge/script` serves JavaScript. Saved under those names the
bundle is served as `application/octet-stream` — and the browser **downloads the page instead of
rendering it**, which is the most confusing failure this pipeline can produce, because nothing is
missing and nothing errors.

**Rule E-15 — the recorded content type decides the extension when the URL has none.** A document
becomes `…/index.html`, which keeps the original URL working as a directory index and leaves
client-side routing intact; everything else gains the extension its bytes deserve. The route map
records where it landed, so nothing downstream needs to guess.

**Rule E-16 — the boot script goes into every document, not just the entry.** Any page in the bundle
can be the one that gets opened.

## 5ter. Three ways a complete bundle still shows an error page

The bundle held every byte, the origins were rewritten, and the page rendered the application's
error boundary. None of the three causes was a missing asset.

**Rule E-17a — the protocol-relative origin form (`//host/path`) is never rewritten.** Application
code routinely prefixes a scheme onto it (`"https:" + url`), and a root-relative replacement turns
that into `https:/__imago/…`, which the browser reads as the host `__imago` and fails to resolve.
That is worse than leaving the URL alone: left alone, the worker and the server fallback (E-11) still
catch it at request time. Only the complete forms `https://host` and `http://host` are substituted.

**Rule E-17b — a host recorded as `telemetry` or `challenge` is answered with an empty `200`.**
Analytics and anti-fraud SDKs are not written to survive their endpoint returning "not found": they
throw, the application's error boundary catches it, and the page becomes "something went wrong". An
empty `200 {}` is what those SDKs see when they are simply not wanted, and they move on. The stub is
recorded on the tape as `telemetry stub`, so it is never mistaken for data the bundle actually has.

**Rule E-17c — an asset the bundle does not hold is reported as a missing asset, not as an API
miss.** A GET whose path carries an asset extension and that no file answers records `missing-asset`
and returns `404 text/plain`, instead of falling through to the fixture layer. The distinction is the
whole diagnosis: a missing asset is a **capture gap** (browse further, or the URL is built at runtime
in a way the sweep cannot reach), while a fixture miss is a **backend call nobody recorded**. Routing
one through the other sends the reader looking for a backend that was never involved.

## 5bis. A path is a file for one URL and a folder for another

`/api/v2/pixel` is a file; `/api/v2/pixel/track` needs `pixel` to be a directory. A site serves both,
and on disk only one can win — whichever arrives second cannot be written and the whole generation
dies on `EEXIST` from `mkdir`.

**Rule E-14 — a path collision is not an error.** The loser is stored content-addressed under
`__imago/a/<hash><ext>`, exactly like an over-long path (C-4d), the route map points at wherever it
landed, and the manifest records the substitution as a warning. Generation never fails because a site's
URL space does not fit a filesystem's.

## 5c. The API is usually on its own host — and CORS makes that fatal

A real application's API lives at `graphql.<site>` or `api.<site>`, and that origin is built inside
the JavaScript bundle. Left alone, the bundle calls the real internet, the browser refuses it on CORS
before the request is even sent, and the application never gets data no matter how complete the asset
set is. In the console it reads as `blocked by CORS policy`, and on screen as React errors #418/#423/#425
— hydration mismatches — followed by whole subtrees disappearing.

**Rule E-10 — complete origins of recorded hosts are rewritten, and they are enumerated.** Every host
this session recorded (the primary host excepted, whose paths are the web root) has its complete origin
— `https://host`, `http://host`, `//host`, and the JSON-escaped form — substituted for
`/__imago/h/<host>`, in HTML, CSS **and JavaScript**. This does not reopen the blanket-replacement ban
(E2): the set is closed, derived from the session, and listed in the manifest as `rewrittenOrigins`.

**Rule E-11 — the server resolves a data request no file answers.** `/__imago/h/<host>/…` becomes
`https://<host>/…`; any other unmatched path on our origin becomes the primary host plus that path.
Both go through the same fixture/proxy layer as the worker's own channel.

The redundancy is deliberate. The bundle reaches the API three ways — the worker's channel, a rewritten
origin, a relative path — and all three land in one resolver, so a bundle whose worker never took
control still gets its data. **The worker is an optimisation, not a requirement**, which is why the boot
script no longer reloads (superseding E-9's guarded reload with no reload at all).

**Rule E-12 — a GraphQL miss answers in GraphQL's shape.** `{ data: null, errors: [...] }` with status
200, not a 404 carrying a foreign body. A client that meets a 404 where it expected a GraphQL envelope
throws, React unmounts the subtree, and a complete page loses its navigation and hero a moment after
painting. The miss is still reported as a miss.

**Rule E-13 — the same operation with different variables answers, labelled.** A bundle served from
localhost cannot reproduce the region, currency or session the browse had, so variables drift by
construction. A response for the right operation is far closer to the truth than no response, and the
tape says `matched by same operation, different variables` so nobody mistakes it for an exact replay.

## 5b. A missing asset is not a policy decision

The bundle worker separates two failures that look alike in a log and mean opposite things:

| | meaning |
|---|---|
| **blocked** | an API call or beacon the current preview mode refuses — working as configured |
| **missing-asset** | a byte the bundle should hold and does not — a **capture gap** |

A missing asset is refused, never fetched from the real origin (E2), and reported as its own kind so
bundle incompleteness cannot hide inside "blocked by policy". The worker tells them apart by the
request's `destination`.

## 6. The API shim

Both emitters ship a generated client owning the seam: `rehost` intercepts at the app's own
configuration point (or `fetch`/XHR if it has none); `flat` exposes one function per contract endpoint
plus the optional fixture adapter. Generated from `contract.json`, so bundle and specification cannot
drift — a contract change is a diff, not archaeology.

## 7. The configuration surface

"Completely configurable" means this, enumerated, versioned, and hashed into `profileHash` (S-2):

| Group | Options |
|---|---|
| **Selection** | which atoms; which viewport variants; include unnamed snapshots or not |
| **Emitter** | `rehost` \| `flat`; output layout; base path |
| **API** | base URL rewrite target; interception strategy; generate shim y/n; OpenAPI draft y/n |
| **Data** | slots empty \| fixtures; fixture source; capture-date banner in dev adapter |
| **Hosts** | per-host disposition (§5); E2 allowlist |
| **Assets** | inline threshold; keep original filenames vs content-addressed; font subsetting off by default |
| **CSS** | verbatim (default) \| reversible optimization; never coverage-pruned (C-2) |
| **Security** | CSP policy; SRI drop \| recompute |
| **Degradation** | fail on substitutions (default) \| acknowledge and record |
| **Oracles** | which of O1–O6 to run after generation, and their thresholds |

A profile is a file, diffable and reusable across sessions. Two runs differing only by profile are
directly comparable — that is the point of making generation cheap and capture expensive.
