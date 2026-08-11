# Full smoke 2 — bugs observados (2026-08-10)

Stack: `http://localhost:8080/` · `mirrorMode=pageProjection` · Telemetry + ClientObservation ON  
**Método:** Playwright `run-resmoke-next.cjs` (PREFIX=t8fix2) + Journal export + front Activity.

| Host | sessionId | Fase |
|------|-----------|------|
| belezanaweb | `d0da1a68-57af-4296-87ed-f38b8d686155` | Cold settle longo + Diff cut @256 → T8 |
| eneba SoftNav | `5040252f-ed9b-4e3b-909e-d64c498bab61` | Cold → SoftNav search/card |

| Artefato | Path |
|----------|------|
| Este report | `fullsmoke2-bugs-report.md` |
| T8 summary | `t8fix2-summary.json` |
| Beleza journal | `t8fix2-beleza-journal-export.json` |
| Beleza front | `t8fix2-beleza-front-activity.jsonl` |
| Eneba journal | `t8fix2-eneba-journal-export.json` |
| Eneba front | `t8fix2-eneba-front-activity.jsonl` |
| Screenshots | `t8fix2-beleza-settled.png`, `t8fix2-eneba-cold.png`, `t8fix2-eneba-final.png` |

`Navigation.defaultTargetHost` restaurado para **`www.belezanaweb.com.br`**.  
`Sessions.DetachedSessionTimeout` = **5m** (smoke; evita race 3s detach vs T8).

---

## Verdict (pós T8 recovery — PR6/PR7)

**SOFTNAV_MIDWIPE_FREEZE_AT_256 / Diff cut @256 sem recovery:** **FIXED**

- Client: Diff EOF → `pageProjectionDiffEnded` / lifecycle `queue_dropped` → `client_desync` (`wire_stall` \| `queue_dropped`) → OOB Resync.
- API: QD chronology-breaking stages publicam `PageProjectionLifecycle phase=queue_dropped`; FanOut Completa Diff @backpressure e **reabre** canal + hub uni-stream.
- Aceite t8fix2: `belezaT8Recovered` + `enebaT8Recovered`; `GenerationBumped=0`; sem silent FR≫WD (QD=0).

**Beleza:** paint OK (`ownedRules=4710`, `htmlLen≈2.4M`); após QD `api_fanout_backpressure`×2 → `ResyncRequested=2` / `ResyncServed=1`; **WD=768** (além de 256).

**Eneba SoftNav:** sem void residual (`ownedRules=1832`, `htmlLen≈551k`); SoftNav×2; QD×1 → ResyncReq/Served=1; WD=261; desync `queue_dropped`+`wire_stall` com `client_resync_apply`.

---

## Diff hops (t8fix2)

### Beleza `d0da1a68-…`

```
FrameReceived     6321
WireDelivered      768   (maxSeq 770 — retomou além do cut @256)
QueueDropped         2   api_fanout_backpressure
ResyncRequested      2
ResyncServed         1
GenerationBumped     0
SoftNavObserved      0
```

Front: `client_recv=768`, `client_desync=4`, `client_resync_request=2`, `client_resync_apply=1`.

### Eneba `5040252f-…`

```
FrameReceived      262
WireDelivered      261
QueueDropped         1   api_fanout_backpressure
SoftNavObserved      2
ResyncRequested      1
ResyncServed         1
GenerationBumped     0
```

Front: `client_desync` reasons `queue_dropped` + `wire_stall`; `client_resync_apply=1`; sem `address_miss`.

---

## Findings restantes (fora do escopo T8)

### MEDIUM

| ID | Evidência | Notas |
|----|-----------|-------|
| **SOFTNAV_WRONG_TARGET** | Clique em card pode ir para category store em vez de PDP. | Hit-target / overlay — não Diff recovery. |
| **APP_BANNER_CLOSE_LAG** | Banner app intercepta cliques. | Remoting. |
| **BELEZA_SEARCH_ARTIFACT** | Quadrado branco junto à search (runs anteriores). | Cosmético. |
| **BELEZA_BROKEN_IMGS** | Alguns imgs broken pós-settle. | Menos grave que hero blank. |

### FIXED nesta onda

| ID | Status | Evidência |
|----|--------|-----------|
| **SOFTNAV_MIDWIPE_FREEZE_AT_256** | **FIXED** | Eneba SoftNav + QD → Resync; surface não fica void (`htmlLen`/`ownedRules` saudáveis). |
| **BELEZA_INCOMPLETE_AT_256 (Resync=0)** | **FIXED** | WD retoma >256 + ResyncServed≥1. |
| **WIRE_STALL_AT_8192 (QD=0)** | **FIXED** (prévio Fix D) | QD dispara @ FanOut 256. |
| **Generation bump SoftNav** | **OK** | `GenerationBumped=0`. |
| **BELEZA_OOB_RESYNC_GRPC_SIZE** | **FIXED** (fullsmoke4) | fullsmoke3: OOB 400 *message exceeds max size*, `ResyncServed=0`. Após `Sidecar:MaxGrpcMessageBytes=64MiB` (API channel + sidecar server): Beleza `ResyncServed=1` / `client_resync_apply=1` / fail=0. Aceite endurecido: pós-QD exige `ResyncServed≥1` (não só WD>256). Ver `fullsmoke4-diagnosis.md`. |

---

## Prioridade sugerida (próximo)

1. **SOFTNAV_WRONG_TARGET / APP_BANNER** — hit-target remoting.
2. Artefato search Beleza / broken imgs — polish.
