# Full smoke — bugs observados (2026-08-10 pós-fix)

Stack: `http://localhost:8080/` · `mirrorMode=pageProjection` · Telemetry + ClientObservation ON  
**Método:** browser Cursor como humano (visual) + Journal session export + front Activity ring.

| Host | sessionId | Fase |
|------|-----------|------|
| belezanaweb | `80d95e95-1162-4cc4-b18e-c55c26e3d26e` | Cold settle + scroll visual |
| eneba | `3a6dafab-1d53-4dd9-9ba0-7b23eca02795` | Cold → SoftNav home→PDP Spider-Man |

| Artefato | Path |
|----------|------|
| Este report | `fullsmoke-bugs-report.md` |
| Beleza journal | `fullsmoke-beleza-journal-export.json` (22681 facts) |
| Beleza front | `fullsmoke-beleza-front-activity.jsonl` + `fullsmoke-beleza-front-summary.json` |
| Beleza summary hops | `fullsmoke-beleza-summary.json` |
| Eneba journal | `fullsmoke-eneba-journal-export.json` (1733 facts) |
| Eneba front | `fullsmoke-eneba-front-activity.jsonl` + `fullsmoke-eneba-front-summary.json` |
| Eneba summary hops | `fullsmoke-eneba-summary.json` |
| Screenshots | `fullsmoke-beleza-t8.png`, `fullsmoke-beleza-scrolled.png`, `fullsmoke-eneba-cold.png`, `fullsmoke-eneba-after-click.png` |

`Navigation.defaultTargetHost` restaurado para **`www.belezanaweb.com.br`**.

---

## Verdict

**Paint Beleza (srcset):** regenerado — hero Frete Grátis + Cloudinary `f_avif,fl_progressive,q_auto…` intacto; brand logos/nav imgs `naturalWidth>0`; front **sem** `client_desync`.

**SoftNav Eneba:** PDP Spider-Man **visualmente OK** (preço, offers, reviews). Pipe `FR=WD=836`, `QueueDropped=0`, `GenerationBumped=0`. Ainda assim **1× `address_miss` + 1× `sequence_gap`** no SoftNav home→PDP (2 resyncs) — regressão parcial vs resmoke automatizado anterior (0 miss).

**Novo HIGH Beleza:** `FrameReceived` continua até **14445** enquanto `WireDelivered` **para em 8192** (capacidade Diff) — **6253** frames FrameReceived sem WireDelivered e **sem** `QueueDropped` no journal.

> **Update (Fix D/E resmoke):** ambos HIGHs acima **fechados** — ver secção [Pós-fix D/E resmoke](#pós-fix-de-resmoke-2026-08-10). Beleza: `api_fanout_backpressure` QD (sem stall silencioso @8192). Eneba SoftNav search: `addressMiss=0`, Resync=0.

---

## Timeline (humano)

| t | Fase | Visual | Telemetria |
|---|------|--------|------------|
| 0 | Open `/` Beleza | Loading… | nova session `80d95e95-…` |
| ~8s | Settle | Header + hero Frete Grátis OK; Observe **2000** | `ownedRules=4443`, `htmlLen≈3.0M`, `denied=false`, srcset Cloudinary completo |
| +scroll | Surface `scrollTop=900` | Conteúdo abaixo (produtos); scroll tool página = noop | broken complete=0; `virtualData1x1=41` |
| switch | PUT Navigation → eneba; stop Beleza | — | Beleza journal FR=14445 WD=8192 |
| cold | Eneba home | Hero carousel + categories OK; Observe ~265 | SoftNav#1 (home, `liveArmed=false`); arm OK |
| click | Product card Spider-Man | SoftNav → PDP (preço R$87.30, See offers) | SoftNav#2; **address_miss** seq=611; depois **sequence_gap** 616→678; Resync×2 |
| final | PDP | Completo (offers/reviews/descr) | FR=WD=836; Input Applied=11 Rejected=0 |

---

## Findings

### HIGH

| ID | Evidência | Notas |
|----|-----------|-------|
| **WIRE_STALL_AT_8192** | Beleza: `FrameReceived` maxSeq=**14445**, `WireDelivered` maxSeq=**8192** (hard stop). Último WD `childList` @ seq 8192; FR 8193…14445 continuam (`childList`/`patch`). `QueueDropped=0`. | Capacidade Diff (8192) — frames pós-capacidade não chegam ao client; **falta** fato `QueueDropped` / desync observável no anel front (saturado). UX: settle inicial OK; updates tardios podem congelar. |
| **ADDRESS_MISS_ON_SOFTNAV** (residual) | Eneba SoftNav home→PDP: front `client_desync` `address_miss` seq=611=`expected`, `phase=parent`, selector `[speculum-anchor="a2dsxeyvthim7"]`. Journal `ResyncRequested=2` / `ResyncServed=2` (coversThrough 615→682). | Recovery OK (PDP paint). Ledger+drain reduziram cascata (era 3×) mas **não eliminaram** miss neste SoftNav direto. |
| **RESYNC_AFTER_GAP** | Segundo desync `sequence_gap` got=678 expected=616 após o primeiro resync. | Provável mid-storm / buffered live vs watermark — cascata curta (2), não 3. |

### MEDIUM

| ID | Evidência | Notas |
|----|-----------|-------|
| **VIRTUAL_DATA_1x1** | Beleza settle: `virtualData1x1=41` (`/w7s/virtual-data/` com nw≤1). | Prováveis LQIP/placeholders genuínos pós-harden `parseDataUrl`; polish `data-src` fora do núcleo. |
| **FRONT_RING_SATURATION** | Beleza Observe **2000** (cap). Eneba Observe chegou a ~1623. | Debug-only; cold hops caem do anel. Preferir Journal. |
| **SCROLL_TOOL_NOOP** | `browser_scroll` na página: sem efeito; `surface.scrollTop=` via CDP move o Projected localmente (não remota Virtual). | Automação ≠ DomElementInput wheel fiel. |
| **SEARCH_CLICK_INTERCEPT** | Clique no combobox Search interceptado por `<svg>` (ícone). | Layout mobile / hit-target; input remoting OK em outros alvos (product click Applied=11). |

### LOW / observação

| ID | Evidência | Notas |
|----|-----------|-------|
| **TRUSTPILOT_BLACK_STRIP** | PDP: faixa preta atrás das estrelas Trustpilot. | Possível CSS/background no Projected; cosmético. |
| **APP_BANNER_CLOSE_LAG** | Close do banner “Use Eneba App” demorou a sumir no snapshot. | Remoting/apply lag leve. |

### FIXED / regenerado (vs smoke pré-fix)

| ID | Status | Evidência |
|----|--------|-----------|
| **BELEZA_HERO_BLANK / srcset `f_avif` truncado** | **OK nesta run** | Hero pintou; srcset com `f_avif,fl_progressive,q_auto…`; imgs nav `nw>0`. |
| **BELEZA_BROKEN_ICONS (truncação)** | **OK nesta run** | `broken` complete+nw0 = 0 no probe pós-settle. |
| **SoftNav generation bump** | **OK** | `GenerationBumped=0` em ambas as sessões. |
| **QueueDropped storm (Eneba)** | **OK nesta run** | Eneba `QueueDropped=0`, FR=WD. |

---

## Correlação Diff hops

### Beleza `80d95e95-…`

```
FrameReceived  14445
WireDelivered   8192   ← stall
QueueDropped       0   ← ausente apesar do stall
GenerationBumped   0
SoftNavObserved    0
ResyncRequested    0
ResyncServed       0
```

Front (anel 2000, cauda): `client_recv≈983`, `client_apply≈990`, `client_desync=0`, `client_sent=8`.

### Eneba `3a6dafab-…`

```
FrameReceived    836
WireDelivered    836
QueueDropped       0
GenerationBumped   0
SoftNavObserved    2
ResyncRequested    2
ResyncServed       2
Input.Applied     11
Input.Rejected     0
```

Front: `client_desync=2` (address_miss + sequence_gap), `client_resync_*=2`, `client_drop=4`.

---

## Prioridade sugerida

1. **WIRE_STALL_AT_8192** — por que WD para em 8192 sem `QueueDropped` / pauseLiveEmit / client desync? Effect assert: FR−WD sob carga Beleza.
2. **ADDRESS_MISS residual SoftNav** — miss `phase=parent` ainda em home→PDP; reforçar unpublish / timing vs MO burst.
3. **VIRTUAL_DATA_1x1** — classificar LQIP vs fantasma; opcional `data-src` polish.
4. Front ring / search hit-target — não bloqueadores de produto.

---

## Sessões

| Host | sessionId | Resultado |
|------|-----------|-----------|
| belezanaweb | `80d95e95-…` | Settle visual OK; **wire stall 8192** |
| eneba | `3a6dafab-…` | SoftNav PDP OK visual; **2 resync** (miss+gap) |

---

## Pós-fix D/E resmoke (2026-08-10)

Stack redeployado (`dockup deploy --env dev` + compose nouinput). Script: `run-resmoke-next.cjs`. Artefatos: `nextfix-summary.json`, `nextfix-*-journal-export.json`, `nextfix-*-front-activity.jsonl`, `nextfix-*-settled.png` / `nextfix-eneba-*.png`.

### Veredicto

| Bug | Status | Evidência |
|-----|--------|-----------|
| **WIRE_STALL_AT_8192** | **FIXED** | Beleza: `QueueDropped=1` stage=`api_fanout_backpressure` (FanOut target 256 ≪ 8192). `silentStallForbidden=false` — FR≫WD com QD=0 **não** ocorre. WD deixa de avançar com fato QD (T5/D13). |
| **ADDRESS_MISS residual SoftNav** | **FIXED** | Eneba SoftNav home→search (`SoftNavObserved=2`, mesmo `documentEpoch`): `addressMiss=0`, `desyncs=[]`, `ResyncRequested/Served=0`, `GenerationBumped=0`. |
| SoftNav `generation++` | **OK** | `GenerationBumped=0` em ambas. |

### Diff hops (nextfix)

**Beleza** `8078fd76-…` / última run session no summary:

```
FrameReceived   ~6938
WireDelivered    256
QueueDropped       1   api_fanout_backpressure
GenerationBumped   0
```

**Eneba** `662616b1-…`:

```
FrameReceived   1237
WireDelivered    256
QueueDropped       1   api_fanout_backpressure
SoftNavObserved    2
ResyncRequested    0
ResyncServed       0
GenerationBumped   0
address_miss       0
```

### Fix D (API)

- `SequencedDiffChannels.FanOutTargetCapacity = 256`
- `SessionOutputFanOut.WriteFanOutDiffAsync`: budget 15s → `api_fanout_backpressure` + Complete pipe (não Wait forever no blind zone)
- Diff pump fault → `api_wire_stall` QD

### Fix E (sidecar)

- `flushPendingRetires` + re-check published host antes/depois de `emitChildList`
- `emitWire` (sem flush implícito) + T7 live `qSA===1` / `isConnected` / `publishedAncestorPathOk`
- DOM-walk `unpublishPublishedUnderElement` em todo remove; `sweepDisconnectedPublished`
- Units: retire-before-childList, unpublished wrapper wipe

### Ainda fora deste ciclo (igual fullsmoke)

`FRONT_RING_SATURATION`, `SCROLL_TOOL_NOOP`, `SEARCH_CLICK_INTERCEPT`, `TRUSTPILOT_BLACK_STRIP`, polish `VIRTUAL_DATA_1x1`.
