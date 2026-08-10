# Dom Projection — virtual assets (serve plane)


> **Naming / supersession:** product mode/pipe is **PageProjection**
> (`MirrorMode.PageProjection`), not `DomProjection`. Sealed contracts:
> [page-projection-diff-streams.md](page-projection-diff-streams.md) (Dom plane),
> [page-projection-cssom.md](page-projection-cssom.md) (Cssom plane). This file
> remains the implemented V1 contract until T11/T12 cutover.

**Status:** design (initial plan).

**Scope:** how Speculum **serves** bytes for URLs that F rewrote. Not F itself —
[page-projection-diff-pipeline.md](page-projection-diff-pipeline.md).

**Related:** Sessions `MirrorMode.DomProjection` (→ `PageProjection` at cutover) · PathBase `/w7s`

---

## 1. Purpose

Projected DOM never fetches the remote site origin. F emits only Speculum
prefixes; this plane serves them.

| Prefix | Role |
|--------|------|
| `/w7s/virtual-assets/{host}{path}?query` | Normal http(s) resources (path + host preserved) |
| `/w7s/virtual-blob/{id}` | Ingested `blob:` payloads |
| `/w7s/virtual-data/{id}` | Ingested `data:` payloads |

Auth: live-session identity — not operator Bearer. See §1.1.

### 1.1 Auth contract (V1)

1. Every `/w7s/virtual-*` URL the consumer paints carries the live-session binding
   token in the **reserved** query parameter **`speculum-session-token`**
   (`SessionBindingAuth.QueryParameterName` / client `SessionAuthQueryParam`).
2. The API authenticates **only** that parameter, plus the header
   `X-Speculum-Session-Token` as an internal escape hatch for cross-origin dev and
   harness callers. **There is no auth cookie.** The same reserved parameter authenticates
   data-plane dial (`/w7s/vtransport`, `/w7s/vstream`). Hub RPCs carry `token` in the
   MessagePack body (already explicit).
3. A mirrored site's own `token=` is opaque upstream query. It is **never** read as
   Speculum auth, and it stays in the URL.
4. The virtual-asset key strips **only** Speculum-reserved parameters
   (`speculum-session-token`, `speculum-cache-bust`); every other part of the query
   survives verbatim — order and percent-encoding included — because the producer
   materialized the body under the remote URL as-is.
5. Bad or absent auth → `401`. Wrong mirror mode → `mirror_mode_mismatch`.
   Key not materialized → `asset_missing`.

The reserved name is the whole contract: it must be impossible for a mirrored page's
query to collide with it. Forced stylesheet reloads use the reserved
`speculum-cache-bust` for the same reason — an ad-hoc buster would land in the key and
miss the asset.

Consequence for the consumer: **every** fetchable URL sink must be stamped, not just
`src`/`href` — `xlink:href`, `data-src`, `poster`, `srcset`/`imagesrcset`, inline
`style`, CSS `url()`, and the bare-string forms of `@import` and `image-set()` (which
the applier folds into `url()` first, since the CSS engine fetches those itself with no
auth of its own).

---

## 2. Serve modes

| Mode | Typical use | Behavior |
|------|-------------|----------|
| **`cache`** | CSS, fonts, images, small static, blob/data | Session cache; GET serves bytes. If not ready: **await** in-flight fill; timeout → **404**. |
| **`pass-through`** | Media files, HLS/DASH segments, large streamable bodies | Proxy GET (**`Range`** etc.) via Virtual session network; stream `200`/`206` + body. Client media engine buffers/seeks. |

**Classifier (V1 starting point):**

- **`pass-through`:** `video/*`, `audio/*`, media extensions, HLS/DASH manifests
  and segments.
- **`cache`:** everything else (including `virtual-blob` / `virtual-data`).

---

## 3. Pass-through (V1)

1. Client GETs a virtual-assets URL (media).
2. Resolve session + original `https://{host}{path}?query`.
3. Stream via Virtual session network (frame-appropriate jar).
4. Forward **`Range`**; return status, `Content-Type`, `Content-Range`, body stream.
5. Timeout → failure (404/502 policy in implementation).

F does not block DomDiff emit on this path.

---

## 4. HLS / DASH (initial plan)

1. Discover manifest URL (F rewrote the URL in the tree).
2. Fetch manifest via Virtual network; **rewrite all media URLs inside** to
   Speculum prefixes (`virtual-assets` / blob / data as applicable).
3. Serve rewritten manifest (short cache OK).
4. Segment GETs → **pass-through**.

No custom Speculum player in V1.

---

## 5. MSE / DRM — stubs

V1: **no** MSE/DRM byte pipelines. F may set dedicated attrs
(`speculum-media-mse`, `speculum-drm-unsupported`); consumer shows
poster/placeholder.

Reserved future wiring (no V1 behavior):

| Extension | Future role |
|-----------|-------------|
| **`MediaPassThrough`** | V1 — implemented (§3) |
| **`ManifestRewrite`** | V1 — implemented (§4) |
| **`MseBridge`** | Future MSE mirror path (optional subpath under same session auth) |
| **`DrmBridge`** | Future license/CDM-related handling or explicit UX |

---

## 6. Relationship to F

| Concern | Doc |
|---------|-----|
| Map + rewrite to Speculum URL prefixes; dedicated media/boundary attrs | [page-projection-diff-pipeline.md](page-projection-diff-pipeline.md) |
| Cache vs pass-through; Range; HLS/DASH body rewrite; bridges | **This doc** |
| Coalesce admin knobs | [page-projection-coalesce.md](page-projection-coalesce.md) |

---

## 7. Non-goals (V1)

- MSE byte piping / Speculum media player
- DRM license/CDM integration
- Netflix-class encrypted adaptive fidelity
