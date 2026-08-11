# Diagnosis — dommapfix

**Overall:** FAIL — see per-site issues

## beleza

- sessionId: `?`
- verdict: **FAIL**
- issues: journal_missing, SURFACE_THIN_OR_EMPTY
- ok: no_silent_stall, generation_bumped_0, no_address_miss

| Metric | Value |
|--------|-------|
| journal | missing |
| ownedRules / htmlLen | null / null |
| desyncs | qd=0 stall=0 miss=0 |
| hops resync | req=0 apply=0 fail=0 |

## eneba

- sessionId: `?`
- verdict: **FAIL**
- issues: journal_missing, SURFACE_THIN_OR_EMPTY
- ok: no_silent_stall, generation_bumped_0, no_address_miss

| Metric | Value |
|--------|-------|
| journal | missing |
| ownedRules / htmlLen | null / null |
| desyncs | qd=0 stall=0 miss=0 |
| hops resync | req=0 apply=0 fail=0 |

## Reading

- **T8 OK** when QD>0 implies **ResyncServed≥1** (and ideally client_resync_apply), with populated surface.
- **Silent stall** when FR≫WD, WD>0, QD=0 (forbidden).
- **SoftNav void** when SoftNavObserved≥1 but ownedRules/htmlLen collapse after cut without resync.
- WD>256 alone is **not** recovery if ResyncServed=0 (stuck desync / buffered_while_desynced).
