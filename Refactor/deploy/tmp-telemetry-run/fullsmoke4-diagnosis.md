# Diagnosis — fullsmoke4

Stack: `http://localhost:8080/` · `mirrorMode=pageProjection` · Telemetry + ClientObservation ON  
Script: `run-resmoke-next.cjs` PREFIX=`fullsmoke4` · `Sessions.DetachedSessionTimeout=5m`  
Fix sob teste: gRPC API↔sidecar `MaxGrpcMessageBytes=64MiB` (+ aceite smoke exige `ResyncServed≥1` pós-QD).

**Overall:** PASS — T8 recovery holds; SoftNav without mid-wipe void; no silent FR≫WD

### Residual fullsmoke3 fechado

Beleza OOB deixou de falhar com *Received message exceeds the maximum configured message size*; `ResyncServed≥1` + `client_resync_apply≥1` + `resync fail=0`. Eneba mantém SoftNav×2, GenBump=0, sem void.

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

- sessionId: `a60c8cd8-74aa-4c2f-beb8-4992ad494ae6`
- verdict: **PASS**
- ok: no_silent_stall, t8_recovered_or_no_cut, generation_bumped_0, no_address_miss, surface_populated, qd_then_resync_served, client_resync_apply

| Metric | Value |
|--------|-------|
| FR / WD | 6366 / 768 |
| FR maxSeq / WD maxSeq | 6366 / 770 |
| QueueDropped | 2 `{"api_fanout_backpressure":2}` |
| ResyncReq / Served | 2 / 1 |
| SoftNav / GenBump | 0 / 0 |
| ownedRules / htmlLen | 4710 / 2386316 |
| desyncs | qd=2 stall=2 miss=0 |
| hops resync | req=2 apply=1 fail=0 |

Text sample: `Ir direto para o conteúdo Acessibilidade Grupo Boticário Nossas Lojas Baixe o nosso app! Precisa de ajuda? Meus Pedidos `

## eneba

- sessionId: `593053aa-7e51-4a90-a93c-91bb935e4a70`
- verdict: **PASS**
- ok: no_silent_stall, t8_recovered_or_no_cut, generation_bumped_0, no_address_miss, surface_populated, softnav_observed, qd_then_resync_served, client_resync_apply

| Metric | Value |
|--------|-------|
| FR / WD | 266 / 265 |
| FR maxSeq / WD maxSeq | 266 / 266 |
| QueueDropped | 1 `{"api_fanout_backpressure":1}` |
| ResyncReq / Served | 1 / 1 |
| SoftNav / GenBump | 2 / 0 |
| ownedRules / htmlLen | 1832 / 545776 |
| desyncs | qd=1 stall=1 miss=0 |
| hops resync | req=1 apply=1 fail=0 |

Text sample: `Português Brasileiro BRL Log in  |  Registrar-se Categorias Jogos -90% Software eCartões NordVPN Gift Cards Eneba FC27 P`

## Reading

- **T8 OK** when QD>0 implies **ResyncServed≥1** (and ideally client_resync_apply), with populated surface.
- **Silent stall** when FR≫WD, WD>0, QD=0 (forbidden).
- **SoftNav void** when SoftNavObserved≥1 but ownedRules/htmlLen collapse after cut without resync.
- WD>256 alone is **not** recovery if ResyncServed=0 (stuck desync / buffered_while_desynced).
