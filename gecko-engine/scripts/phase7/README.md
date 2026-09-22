# Phase 7 — Fixtures

Gate: `pwsh -File scripts/phase7/run.ps1`

Seven classes under `tests/phase7/fixtures/<classe>/`. Replay via `SpecDriver`
(`>` lines). All oracle caps (`--oracle.preset=lab`). No libxul.

**Defeito → fixture:** every bug found from this phase on becomes a permanent
`.spec` under `adversaria/`. Never soften asserts.
