# Diagnosis — fullsmoke3

**Overall:** FAIL — see per-site issues

## Script accept
```
{
  "belezaNoSilentStall": true,
  "enebaNoSilentStall": true,
  "enebaNoAddressMiss": true,
  "enebaNoGenerationBump": true,
  "enebaSoftNav": true,
  "belezaT8Recovered": true,
  "enebaT8Recovered": true
}
```

## beleza

- sessionId: `7982e134-3927-40d1-a132-129071d78e9c`
- verdict: **FAIL**
- issues: QD_WITHOUT_RESYNC_SERVED, RESYNC_FAILED_WITHOUT_APPLY, RESYNC_FAILED×1, BROKEN_IMGS×30
- ok: no_silent_stall, generation_bumped_0, no_address_miss, surface_populated

| Metric | Value |
|--------|-------|
| FR / WD | 5936 / 512 |
| FR maxSeq / WD maxSeq | 5936 / 513 |
| QueueDropped | 1 `{"api_fanout_backpressure":1}` |
| ResyncReq / Served | 2 / 0 |
| SoftNav / GenBump | 0 / 0 |
| ownedRules / htmlLen | 4463 / 2218549 |
| desyncs | qd=1 stall=1 miss=0 |
| hops resync | req=2 apply=0 fail=1 |
| resync fails | [{"httpStatus":400,"errorCode":"resync_failed","expected":257}] |

Text sample: `Ir direto para o conteúdo Acessibilidade Grupo Boticário Nossas Lojas Baixe o nosso app! Precisa de ajuda? Meus Pedidos `

## eneba

- sessionId: `4f647c16-e270-42d3-8ad6-5897e259e222`
- verdict: **PASS**
- ok: no_silent_stall, t8_recovered_or_no_cut, generation_bumped_0, no_address_miss, surface_populated, softnav_observed, qd_then_resync_served, client_resync_apply

| Metric | Value |
|--------|-------|
| FR / WD | 264 / 263 |
| FR maxSeq / WD maxSeq | 264 / 264 |
| QueueDropped | 1 `{"api_fanout_backpressure":1}` |
| ResyncReq / Served | 1 / 1 |
| SoftNav / GenBump | 2 / 0 |
| ownedRules / htmlLen | 1832 / 550681 |
| desyncs | qd=1 stall=1 miss=0 |
| hops resync | req=1 apply=1 fail=0 |

Text sample: `Português Brasileiro BRL Log in  |  Registrar-se Categorias Jogos -90% Software eCartões NordVPN Gift Cards Eneba FC27 P`

## Reading

- **T8 OK** when QD>0 implies **ResyncServed≥1** (and ideally client_resync_apply), with populated surface.
- **Silent stall** when FR≫WD, WD>0, QD=0 (forbidden).
- **SoftNav void** when SoftNavObserved≥1 but ownedRules/htmlLen collapse after cut without resync.
- WD>256 alone is **not** recovery if ResyncServed=0 (stuck desync / buffered_while_desynced).
