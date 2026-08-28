# Implementation — In-page script packaging

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/inpage/` fragments + build concat → single injected script; orchestrated from `PageProjection.ts` |
| **LOC ceiling** | ≤600 LOC **per fragment**; concat is a build step, not a second algorithm (D-SPEC-6) |
| **Contracts implemented** | 01–06 (algorithms live in fragments); D-SPEC-2, D-SPEC-6 |
| **Invariants** | One injected classic/module script per Document generation. Fragments mirror sidecar module algorithms 1:1. MessageChannel (and/or setTimeout) drives clock — never rAF. Binary push via channel binding — never JSON tree ferry. |
| **Ban list** | Second divergent in-page algorithm vs fragment specs. Shipping unconcatenated partial producers. `JSON.stringify` of frames. Writing live identity attrs. rAF frame boundary. |

---

## Fragment list (normative order)

Build concatenates in this order so dependencies resolve without ES imports in the page (IIFE or sequential `const` scopes). Each fragment is a TypeScript file compiled to JS then concatenated.

| # | Fragment file | Mirrors impl spec | Max LOC | Exports into shared `PP` namespace |
|---|---------------|-------------------|---------|----------------------------------|
| 1 | `identity.frag.ts` | [identity.md](identity.md) | 170 | `PP.identity` |
| 2 | `fmap.frag.ts` | [fmap.md](fmap.md) | 500 | `PP.fmap` |
| 3 | `pierceAdopt.frag.ts` | adopt hooks of [pierce.md](pierce.md) | 150 | `PP.pierceAdopt` |
| 4 | `cssom.frag.ts` | [cssom.md](cssom.md) | 400 | `PP.cssom` |
| 5 | `observe.frag.ts` | [observe.md](observe.md) | 400 | `PP.observe` |
| 6 | `frame.frag.ts` | [frame.md](frame.md) | 500 | `PP.frame` |
| 7 | `encode.frag.ts` | [encode.md](encode.md) | 300 | `PP.encode` |
| 8 | `clock.frag.ts` | [clock.md](clock.md) | 200 | `PP.clock` |
| 9 | `establish.frag.ts` | [establish.md](establish.md) | 350 | `PP.establish` |
| 10 | `bootstrap.frag.ts` | this doc | 150 | `PP.bootstrap`, `PP.runEstablish`, `PP.applyRate`, `PP.forceFlush` |

Sum of ceilings exceeds a single 600 file by design — **each** fragment ≤600; bootstrap wires them.

Optional shared `opcodes.frag.ts` ≤100 if needed (constants only).

---

## Concat rules

1. **Build step** (esbuild/tsup/custom): compile each fragment to JS; concatenate in table order; wrap in one IIFE:

```js
(() => {
  const PP = {};
  /* fragment 1…10 */
  globalThis.__SPECULUM_PP__ = PP;
})();
```

2. Fragments MUST NOT import Node modules or Playwright.
3. Fragments MUST NOT read `window.__SPECULUM_PP__` before assignment completes; only bootstrap publishes globally.
4. No duplicate algorithm copies in Node for live encode (D-SPEC-2). Node may share encode **source** via a build that also emits a Node-capable encode for resync — that is a second **compile target**, same algorithm source, not a fork.
5. Source maps MAY map back to fragments for debug.
6. Injection: `page.addInitScript` / `addScriptTag` before content for cold session; on hard-nav Document swap, re-inject or rely on init script for every Document.

---

## MessageChannel clock (normative wiring in `clock.frag.ts`)

```ts
// Pseudocode — matches clock.md
function schedule(delayMs: number, fn: () => void) {
  if (delayMs <= 0) {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => fn();
    ch.port2.postMessage(null);
  } else {
    setTimeout(() => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => fn();
      ch.port2.postMessage(null);
    }, delayMs);
  }
}
```

Drift correction against `performance.now()` as in [clock.md](clock.md).  
**MUST NOT** call `requestAnimationFrame` for boundaries.

---

## Binary push

`bootstrap` receives binding name from Node (e.g. `__speculumPushFramePart`):

```ts
function pushPart(bytes: Uint8Array) {
  // Prefer transferring buffer when binding supports it
  (globalThis as any).__speculumPushFramePart(bytes);
}
```

Encode produces `Uint8Array` parts → `pushPart` each.  
MUST NOT convert the frame to JSON. Base64 only if binding cannot take binary (discouraged; still not a tree ferry).

---

## Bootstrap API

```ts
interface BootstrapConfig {
  frameRateHz: number;
  maxFrameBytes: number;
  establishChunkBytes: number;
  pushBindingName: string;
}

PP.bootstrap = (cfg: BootstrapConfig) => {
  const identity = createIdentity();
  const fmap = createFMap();
  const cssom = createCssom(identity);
  const accum = createAccum();
  const encode = createEncoder(cfg.maxFrameBytes);
  const channel = { pushPart: bindPush(cfg.pushBindingName) };
  PP.observe.start({ document, fmap, identity, accum, pierce: PP.pierceAdopt });
  PP.clock.start(() => {
    const flushed = PP.frame.flush({ fmap, identity, cssom, … });
    if (!flushed) return;
    if (establishHolding) buffer(flushed);
    else for (const part of encode.encode({…flushed})) channel.pushPart(part.bytes);
  });
  PP.clock.setTargetHz(cfg.frameRateHz);
};

PP.runEstablish = () => PP.establish.run({…});
PP.applyRate = (msg) => PP.clock.applyRateMessage(msg);
PP.forceFlush = () => { /* invoke same boundary callback once */ };
```

---

## Generation bump hook

On hard-nav, Node calls into page: `PP.identity.bumpGeneration(); PP.cssom.resetMaps(); PP.observe.rebind(document); PP.runEstablish();`.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-WIRE-3` | Injected path has no JSON frame ferry |
| `PP-FR-7` | MC/timer clock runs unfocused |
| `PP-ID-1` | Fragments never write live anchors |
| D-SPEC-6 | Each fragment ≤600 LOC in CI lint |
| Build | Concat order stable; bootstrap alone insufficient without deps |
