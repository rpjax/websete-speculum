# Investigate diagnostics — skeleton
## Jobs
Resolve an operator question using selected scope, evidence, then an optional probe.
## Routes
`/admin/diagnostics/investigate`, entered from Timeline or Diagnostics hub.
## APIs (existing + needed)
Existing profile-state APIs are not an investigation feed. Needed: scoped evidence query, session resolve, and probe contracts with catalog descriptors.
## Named flows (for later depth)
1. Choose scope and period. 2. Read catalogued evidence. 3. Request an allowed probe. 4. Inspect structured result and errorCode/phase on failure.
## Nav placement
Diagnostics → Investigate; Timeline may deep-link the selected period.
## Explicitly deferred to Sprint N
Field-level probe forms, result sheets, and runtime API calls wait for Presentation contracts; no simulated results ship.
