# Diagnostics governance — skeleton
## Jobs
Review configured versus effective capabilities, manage budgets, and recover a degraded runtime with proof.
## Routes
`/admin/diagnostics/governance`, entered from the Govern card.
## APIs (existing + needed)
Existing profile-state APIs are unrelated. Needed: runtime overview, capability configuration, elevate/recover, catalog, and audit endpoints.
## Named flows (for later depth)
1. Load configured and effective state. 2. Edit capability toggles and budgets. 3. Preview changes. 4. Apply configuration and wait for ConfigApplied. 5. Recover or elevate with returned runtime proof.
## Nav placement
Diagnostics → Govern; Health may link to a degraded explanation.
## Explicitly deferred to Sprint N
Live controls and audit tables await contracts; no controls claim to recover or govern before APIs exist.
