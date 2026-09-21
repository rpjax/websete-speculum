# Capture — recording a live session

## 1. The recorder

```
Imago panel ─ launch ─► headed Chromium (own profile dir, remote debugging)
                 │
                 ├─ CDP Network   : every request/response, from t0, never stops
                 ├─ CDP Page/DOM  : navigation, frames, lifecycle
                 ├─ injected agent: tree + CSSOM + settle signals + oracle refs
                 └─ asset resolver: closure enforcement (C-4)
                          │
                          ▼
              in-RAM index + append-only journal  ──"close sandbox"──►  IR on disk
```

Own launcher, own dependency, own injected code (**I7**). Plain CDP/Playwright is enough; the sidecar's
stealth stack is not imported. If a specific target's *capture* is blocked by a challenge, that is a
per-target config decision, not an architecture change.

**Rule C-0 — passive.** The recorder never navigates, never clicks, never pauses the page, never opens
a dialog. The human owns the browser.

## 2. Per-snapshot sequence

1. trigger fires (`settle` / `mark` / `interval`)
2. serialize the tree (§3)
3. collect the CSSOM (§4)
4. queue asset resolution (§5)
5. if the snapshot is named or the panel asked, take oracle references
   ([atoms.md](atoms.md) §7) — this is the only moment animations are paused, and only for that instant
6. hash, dedupe (A-3), append to the timeline

At **close sandbox**, after asset resolution (C-4), take oracle references for the entry snapshot and
every `mark` snapshot ([parity.md](parity.md) §2). Playwright captures `oracles/<snapId>/reference.png`
with `animations: 'disabled'` while the browser context is still alive.

## 3. Tree serialization

### 3.1 Scope
From `document`, descending into shadow roots (both modes), same-origin nested browsing contexts
recursively, `<template>` content, `<slot>` assignments and adopted stylesheets. A cross-origin iframe
is a boundary node carrying its URL; its content is captured if the human browses into it.

### 3.2 Closed shadow roots
`attachShadow({ mode: 'closed' })` is unreadable from page script by design. Imago installs **its own**
patch via `Page.addScriptToEvaluateOnNewDocument`, before any page script runs, keeping a registry of
roots. Own implementation — nothing imported from `speculum-pp` (**I7**). It is detectable surface; the
project ignores challenges (D-009 rev), so this is accepted and written down rather than mitigated.

### 3.3 Not serializable
Canvas pixels, WebGL scenes, video frames and plugin content. Recorded as typed placeholders with
dimensions, optionally with a still image, and always listed in `errors.json` as **substitutions** so no
reader mistakes the bundle for complete. OPEN-5.

## 4. CSSOM — the collection that decides whether hover survives

**Collect rules, never computed style (I3).** Sources, in cascade order:

1. `document.styleSheets` → `cssRules` recursively, descending `CSSGroupingRule` (`@media`,
   `@supports`, `@layer`, `@container`)
2. `document.adoptedStyleSheets`, plus every shadow root's
3. constructed sheets reachable from the §3.2 registry
4. `<style>` elements, indexed as sheets so ordering and layers survive

**C-1 — cross-origin sheets throw on `cssRules`.** This is the single most common way a capture
silently loses half a design. On `SecurityError`, refetch the sheet's `href` through the recorder's own
network context, store it as an authored asset, mark it `recovered: "refetch"`. A failed refetch is a
**capture failure**, not a warning: a bundle missing a stylesheet is not a bundle.

**C-2 — never prune by coverage.** `CSS.startRuleUsageTracking` reports rules that matched *during the
run*. `:hover`, `:focus-visible`, `:active`, print rules and untriggered breakpoints never matched.
Pruning by coverage deletes exactly what this project promised to keep. Size optimization is a
generation-time option and must be reversible.

**C-3 — record cascade context** for every sheet: owner node position, `media` attribute, `@layer`
order, shadow-root origin. Order *is* the cascade.

## 5. Assets and closed world

Every fetched URL is stored content-addressed. The resolver additionally walks collected CSS for
`url()`, `image-set()`, `@font-face src`, and the tree for `src`, `srcset`, `poster`, preloads and
URL-shaped `data-*`. Anything referenced but never fetched (below-the-fold images, alternate densities,
fonts for unexercised scripts) is fetched by the recorder before the session closes.

**C-4 — the resolver closes the world; it does not merely complain about it.** At close, every
reference the page never requested is **fetched deliberately**, then what still fails is reported with a
reason and grouped by host. Reporting alone was the bug: a first real session showed 591 "missing"
references — the page had simply never asked for its own below-the-fold images and unused `srcset`
densities. A closure check that only accuses is a closure check doing half its job.

**C-4a — a subresource is a byte the page needs, never a place it can take you.** The ref policy
(`src/shared/refPolicy.ts`, asserted in `npm test`) admits `img/source src|srcset`, `script src`,
`link href` only for asset `rel` values, `video/audio src|poster`, `object data`, SVG `use|image href`,
CSS `url()` and inline `style`, plus the `data-src`/`data-srcset` lazy-loading conventions. It never
admits `a href`, `area href`, `base href`, `link rel=canonical|alternate|preconnect|dns-prefetch`, or
any `mailto:`/`tel:`/`#fragment`/`data:` value. Sweeping `<a href>` in made the closure check demand
that Imago fetch the outbound web — App Store links, Discord invites — and then call the session broken
for not having done it.

**C-4b — a non-2xx is not "fetched".** Counting every attempt as success reports a closed world while
the bundle is missing bytes.

**C-4c — reference discovery does not stop at the DOM.** A real application does not keep its asset
URLs in markup: it builds them in JavaScript, and it receives them inside API payloads — an image-proxy
URL in a GraphQL response is an asset the bundle needs that no `<img src>` ever mentioned. So at close
every recorded **textual** body (HTML, CSS, JS, JSON, XML) is swept for absolute URLs. Only
**asset-shaped** URLs are fetched — a blog link embedded in a webpack bundle is not a subresource.
The sweep runs in rounds (default 10, until nothing new) because what it fetches can reference more.

The fence, without which "download the assets" becomes crawling the web from the operator's machine:
a swept URL is fetched when its host **already delivered a subresource in this session**, or when
the host was **named by an asset-shaped URL** the sweep read from a recorded body (C-4c). An image
proxy that only ever appeared inside a GraphQL payload is in; a host the page merely mentioned in a
docs link is out. JSON escaping (`https:\/\/host\/path`) is undone before matching, since that is
exactly the shape API payloads use.

**C-4e — the resolver is a unit, and it is proved against a simulated application.**
The logic that decides whether a bundle is complete lives in `src/ir/resolver.ts`, driven entirely
through injected dependencies, and `npm test` runs it against three real HTTP servers that imitate the
shape which broke on the first real target: an app whose image URLs exist **only** inside an API
payload, on a CDN host serving **extension-less** paths that never delivered a byte during the browse,
plus an outbound docs site that must not be crawled.

Three rules fall out of that, each one a bug the proof caught immediately:

1. **An unknown host is promoted by evidence, never by name.** One probe per host; its response
   `content-type` decides. Recognising an image CDN by matching `imgproxy` in its hostname works for
   exactly one target and silently misses Cloudinary, imgix, Akamai, an S3 signed URL or `/_next/image`.
2. **A promotion must be acted on, not just reported.** The promoted host has to re-enter the proven
   set, and candidates queued in earlier rounds must still sweep — a host promoted in round 3 with its
   round-1 candidates discarded yields exactly one image out of a hundred.
3. **A body's kind comes from what came back, never from the fact that we asked.** Labelling every
   fetched body an asset forges evidence: one probe of a documentation page promotes its host and the
   sweep starts downloading someone else's website. Bodies from unproven hosts are not read for
   references at all.

The extractor recognises domain, IPv4 and `localhost` authorities with optional ports. It deliberately
does **not** match a bare `//…`, which would swallow every line comment in a minified bundle.

**C-4f — a document host's pages are not assets, and a swept page is never mined.**
"Any URL on a proven host" is a crawl, because a site's own host serves both its pages and its assets:
each fetched page yields more links, and on a real storefront that reached ~8800 URLs and hundreds of
megabytes. The two kinds of host are separated by evidence:

| host | what it served | what the sweep takes |
|---|---|---|
| **document host** | at least one `text/html` body | asset-shaped URLs only — never its pages |
| **asset-only host** (an image proxy, a CDN) | never HTML | everything, extension-less included |

And a page the sweep itself fetched is stored but **never read for references** — only documents the
browse actually loaded are sources. Both halves are needed: the host rule stops the first hop, the
harvest rule stops the recursion.

Two budgets make a runaway impossible rather than unlikely: **3 000 fetches** and **400 MB**, both
reported as `resolve_capped` when hit.

**C-4d — a long path is content-addressed, never truncated.** An image proxy emits paths of a
hundred-plus characters that differ only near the end. Shortening them collides two different assets
onto one file and the bundle silently serves the wrong picture; Windows' path limit makes that worse,
not different. A path over budget, or with an over-long segment, is stored as
`__imago/a/<hash><ext>` — unique by construction.

## 6. In memory, then on disk

Per [flow.md](flow.md) S-4/S-5:

- RAM holds the index and working set; bodies stream to an append-only journal in the session temp dir,
  already content-addressed, so "close sandbox" promotes by moving, not re-hashing
- configurable RAM cap (default 512 MB), shown live in the panel
- a crashed session is recoverable and marked `failed` — an hour of manual browsing is too expensive to
  lose to a renderer crash

**C-5 — capture filters.** Hosts the operator never wants recorded (a corporate proxy, an unrelated tab's
telemetry) are dropped at the CDP boundary and counted, so the count is visible rather than the bytes.

## 7. What is pinned, what is declared

A human-driven session cannot be replayed, so **capture reproducibility is not an accept criterion**
(O5b dropped — D-013). What the recorder still pins, because it costs nothing and makes comparison
meaningful: UA, locale, timezone, viewport(s), DPR, `prefers-*` media features.

Everything that varies within a session and would otherwise trip conflict reporting (A-8) goes into the
session's volatile set: generated ids, hydration attributes, timestamps, cache-busting query keys,
ad slots. The volatile set is **curated in the panel**, not guessed, and stored in the overlay.

## 8. Challenges are recorded, not handled

Challenge scripts, iframes and their traffic are captured like anything else and classified
(`kind: "challenge"`). Nothing special happens at capture time. What to do about them — stub, keep,
placeholder — is a **generation** setting ([emit.md](emit.md) §5), which is also the seam where a future
mechanism would attach. This is the whole of "ignore the challenge".

## 9. Out of scope for v1 (tracked)

WebSocket/SSE payloads (OPEN-2) · authenticated capture policy (OPEN-3) · service workers, unregistered
at capture and re-declared at generation (OPEN-4) · canvas/WebGL/video (OPEN-5).
