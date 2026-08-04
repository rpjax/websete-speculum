# Dom Projection — virtual assets (serve plane)

**Status:** design (initial plan).

**Scope:** how Speculum **serves** bytes for URLs that F rewrote. Not F itself —
[dom-projection-diff-pipeline.md](dom-projection-diff-pipeline.md).

**Related:** Sessions `MirrorMode.DomProjection` · PathBase `/w7s`

---

## 1. Purpose

Projected DOM never fetches the remote site origin. F emits only Speculum
prefixes; this plane serves them.

| Prefix | Role |
|--------|------|
| `/w7s/virtual-assets/{host}{path}?query` | Normal http(s) resources (path + host preserved) |
| `/w7s/virtual-blob/{id}` | Ingested `blob:` payloads |
| `/w7s/virtual-data/{id}` | Ingested `data:` payloads |

Auth: session identity (cookie and/or session token) — not operator Bearer.

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
| Map + rewrite to Speculum URL prefixes; dedicated media/boundary attrs | [dom-projection-diff-pipeline.md](dom-projection-diff-pipeline.md) |
| Cache vs pass-through; Range; HLS/DASH body rewrite; bridges | **This doc** |
| Coalesce admin knobs | [dom-projection-coalesce.md](dom-projection-coalesce.md) |

---

## 7. Non-goals (V1)

- MSE byte piping / Speculum media player
- DRM license/CDM integration
- Netflix-class encrypted adaptive fidelity
