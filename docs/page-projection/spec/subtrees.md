# PageProjection — off-`childNodes` subtrees

**Status:** LOCKED (2026-08-18). Foundation. Do not reopen by adding kinds.  
**Index:** [README.md](README.md).

The base algorithm walks `childNodes`. That is one tree, one Document, one algorithm instance.

HTML has **two** kinds of subtree that walk does **not** see. There is no third kind that paints and matters to projection.

| Kind | What it is | Feature | Order |
|------|------------|---------|--------|
| **Shadow root** | A `ShadowRoot` on a host in **this** Document. How it was created does not matter. The walker follows `.shadowRoot`. | [shadow.md](shadow.md) | **1 — next** |
| **Nested browsing context** | A **new** Document (new navigation context). Tags are how HTML creates it (`iframe`, `frame`, `object`, `embed`), not extra kinds. | [multi-document.md](multi-document.md) | **2 — after shadow** |

`template.content` is not a kind: the walker already does not see it, and it does not paint. Stamp lands in `childNodes`.

The split is recursive: a shadow may contain a nested context; a nested context may contain shadow. Always the same two kinds.

Closed / UA shadow is still shadow (kind 1), not a third kind. A tag that did not create a browsing context has no extra subtree.

Do not branch the design on parser vs `attachShadow` vs tag flavour. Assign by what the walker would follow.
