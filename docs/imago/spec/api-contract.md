# The contract — what the backend has to serve

The second artifact, and the one with the shortest path to value: it depends on no fidelity work at
all. If the schedule collapses, this ships alone and is still worth the project.

## 1. Record

Every request/response pair is stored normalized:

```jsonc
{
  "reqId": "req-014",
  "session": "sess-…", "atom": "catalog/list", "transition": null,
  "initiator": { "type": "fetch"|"xhr"|"script"|"parser", "stack": ["…"] },
  "request":  { "method": "GET", "url": "…", "path": "/api/v2/products",
                "query": { "stable": {…}, "volatile": {…} },
                "headers": { "semantic": {…}, "transport": {…}, "auth": ["cookie:sid","authorization"] },
                "body": { "contentType": "…", "hash": "…" } },
  "response": { "status": 200, "headers": { … }, "body": { "contentType": "…", "hash": "…" },
                "timing": { "ttfb": 84, "total": 120 } },
  "kind": "api"|"asset"|"telemetry"|"thirdparty"|"challenge"
}
```

**Rule N-1 — classify, do not filter.** Analytics beacons, challenge traffic and asset fetches are
recorded and labelled, never dropped. The backend does not implement them, but the emitter needs to know
they exist in order to stub them ([emit.md](emit.md) §5), and "why does this bundle phone home" is
otherwise unanswerable.

## 2. Grouping

Endpoints group by `(method, pathTemplate)`. Everything else — query, headers, body — is evidence about
that endpoint, not a separate endpoint.

## 3. Path templating

**Rule N-2.** A path segment becomes a parameter when it varies across observations of otherwise
identical paths, or when it matches a declared id shape (uuid, ulid, integer, slug-with-numeric-suffix)
**and** its value appears in an observed response body or a prior URL. The second clause matters: a
segment that merely looks like an id but never appears anywhere else is more likely a route name.

Ambiguity is reported, not resolved: `contract.json` carries `templateConfidence` and the competing
readings. A human picks. Templating a path wrong sends the backend team down a week-long wrong turn,
which is far more expensive than one review.

## 4. Schema inference

For each endpoint, over all observations:

- union of request bodies and of response bodies → JSON Schema (2020-12)
- per property: `presence` (`always` | `sometimes` | `once`), observed types, nullability
- **enum candidate** when the observed value set is small, closed, and stable across ≥N observations —
  emitted as a *candidate*, never as a constraint
- format detection restricted to unambiguous shapes (ISO date/datetime, uuid, email, URL); never
  invent semantic types
- `sampleCount` on every node, because a schema derived from one observation and one derived from two
  hundred are not the same claim, and the reader must be able to tell

**Rule N-3 — sample count is part of the schema.** A property seen once is annotated as such. Silent
generalization from a single sample is the main way an inferred schema misleads.

## 5. Causality

For each transition ([atoms.md](atoms.md) §8), the call sequence with data flow between calls:

**Rule N-4.** A causal edge is recorded when a value present in response A appears later in request B's
path, query, headers or body, and B started after A completed. Value matching is exact (with declared
normalizations: string/number coercion, URL-encoding, base64). No timing-only inference.

Output per transition:

```
checkout/address --submit--> checkout/quote
  1. POST /api/cart/address          → 201 { addressId }
  2. GET  /api/cart/quote?address={$1.addressId}   ← causal on (1)
  3. GET  /api/shipping/options?zip={form.zip}
```

This is the deliverable the backend team actually needs: not a list of URLs, but ordering, dependency,
and which UI action triggers what.

## 6. Auth surface

**Rule N-5.** For each endpoint record which credential material was present (cookie names,
`Authorization` scheme, CSRF header names — names only, never values, which go to the volatile/redacted
set) and, where the operator deliberately provoked it (A-10 checklist), the unauthenticated response.
An endpoint whose auth behaviour was never observed is marked `authUnknown: true` rather than assumed
public.

## 7. Slot binding

Correlating responses to DOM positions produces `slots.json` ([ir.md](ir.md) §5).

**Rule N-6.** Binding runs on the mutation record between a response arriving and the next quiescence:
values from that response found in newly-inserted or modified nodes bind as `exact`; values found after
a recognized formatter (currency, date, number grouping, truncation with ellipsis) bind as `formatted`
with the transform named; anything else is `heuristic` and is review material only.

Repeated bindings over a list collapse into one slot with a `repetition` marker — the same evidence
[ir.md §4](ir.md) uses, arrived at from the data side.

## 8. Emission

- `contract.json` — the authoritative artifact
- `openapi.yaml` — generated draft, explicitly marked draft, with `sampleCount` and confidence carried
  into descriptions so nobody reads inference as specification
- `fixtures/` — recorded response bodies, content-addressed, **a separate artifact** (I1). The bundle
  never contains them; a dev adapter may serve them
- `coverage.md` — endpoints × atoms matrix, plus what was never observed: no error path, no empty
  state, no pagination beyond page 1, no auth failure — derived from the A-10 checklist. **The gaps are
  the point.** This is the document that tells the backend team what they are about to guess at

## 9. Honest limits — state these next to the artifact, not in a footnote

1. A mutation's **semantics** are not observable. `POST /orders` returning 201 tells you the shape, not
   the invariants, not the side effects, not the failure modes.
2. Unobserved is unspecified. Pagination page 2, an empty list, a validation error, an expired session —
   if nobody browsed there, the contract is silent, and silence looks identical to "does not
   exist".
3. Idempotency, rate limits, caching semantics and consistency guarantees are invisible to a recorder.
4. Field naming tells you nothing about ownership: two endpoints returning `id` may be different
   entities.
