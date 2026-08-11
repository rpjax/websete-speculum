# Smoke manual — bugs observados (2026-08-10)

Stack: `http://localhost:8080/` · `mirrorMode=pageProjection`  
**Sessão principal (Eneba):** `a354c45d-9441-41c7-ac90-da57c1cb9c5f`  
**Sessão Beleza (early / denied efêmero):** `a2d35ee8-e37c-44db-af7d-b63273f27026`  
**Sessão Beleza (settle OK):** `a6bc9b8c-697e-40a0-adff-ab5626f20596`  
**Método:** browser Cursor como humano (cold → modais → search SoftNav → PDP) + Journal + front Activity.

| Artefato | Path |
|----------|------|
| Report | `smoke-bugs-report.md` (este) |
| Summary hops | `smoke-eneba-summary.json` |
| Journal (session) | `smoke-eneba-journal-export.json` (5306 facts) |
| Front Activity | `smoke-eneba-front-activity.json(l)` (anel 2000, DropOldest) |
| Beleza journal | `smoke-beleza-journal-export.json` |
| Screenshots | `smoke-beleza-denied.png` (efêmero), `smoke-beleza-settled-wait.png`, `smoke-eneba-cold.png`, `smoke-eneba-after-close.png`, `smoke-eneba-after-search.png`, `smoke-eneba-final.png` |

**Config note:** `Navigation.defaultTargetHost` restaurado para **`www.belezanaweb.com.br`**. O “Access Denied” precoce **não** é WAF permanente — basta aguardar o settle (reteste: ~15s → home Beleza OK).

---

## Verdict

Cold paint + CSSOM arm na Eneba **funcionam**. Diff pipe está saudável (`FrameReceived=WireDelivered=2607`, `QueueDropped=0`, `GenerationBumped=0`). SoftNav home→search→PDP **funciona**, mas durante a SoftNav do produto houve **cascata de `address_miss`** (3 desyncs + 3 resyncs joint). Input remoting básico funciona (modais, search, click PDP), com poucos hops no anel front (2000 cheio).

**Correção:** Beleza **não** está bloqueada pelo Akamai de forma estável. No smoke inicial o Access Denied era estado **transitório** (julgamento precipitado). Reteste `a6bc9b8c-…`: após espera, `denied=false`, `ownedRules=4442`, `htmlLen≈2.67M`.

---

## Timeline (humano)

| t | Fase | Visual | Telemetria |
|---|------|--------|------------|
| 0 | Open `/` com Beleza | Access Denied **efêmero** (não esperar) | session `a2d35…`; document+cssom install; Observe 12 |
| +reteste | Beleza wait ~15s+ | Home Beleza OK (`smoke-beleza-settled-wait`) | session `a6bc9b8c-…`; ownedRules=4442 |
| +switch host | PUT Navigation → eneba (smoke principal) | — | — |
| ~cold | Home Eneba | Header/hero/cards OK; geo “Sim” + cookies | `ownedRules≈1832`, `htmlLen≈629k`, `tiny1x1=3` virtual-data |
| | Close geo + Accept cookies | Modais somem | clicks remoted |
| | Search focus | Trending dropdown OK | SoftNav armada |
| | Enter (esperava elden ring) | SoftNav → **resident evil** results (636) | SoftNav #2; paint filtros+grid OK |
| ~PDP | Click RE4 | SoftNav → PDP RE4 (após lag) | SoftNav #3; **3× address_miss** + joint resync |
| final | PDP | Preço/ofertas/hero OK; Observe **2000** | 1 img broken; scrollTop surface=0 |

---

## Findings

### FALSE POSITIVE (corrigido)

| ID | Evidência | Notas |
|----|-----------|-------|
| ~~**TARGET_WAF_ACCESS_DENIED**~~ | Access Denied precoce (`smoke-beleza-denied.png`) — **falso**. Reteste `a6bc9b8c-…`: após ~15s, home Beleza completa (`denied=false`, `ownedRules=4442`, `htmlLen≈2.67M`; `smoke-beleza-settled-wait.png`). | Não tratar Access Denied inicial como WAF permanente; aguardar settle antes de concluir. |

### HIGH (Beleza paint — pós-settle)

| ID | Evidência | Notas |
|----|-----------|-------|
| **BELEZA_HERO_BLANK** | Após settle: carrossel hero com setas/dots mas área central **branca** (sem slide). | Visual em `smoke-beleza-settled-wait.png`. |
| **BELEZA_BROKEN_ICONS** | Ícones quebrados (Outlet BLZ, Brinde, Cupom, Presentes, etc.). | Provável virtual-asset / rewrite — correlacionar com `VIRTUAL_DATA_1x1`. |

### HIGH (Eneba SoftNav — smoke principal)

| ID | Evidência | Notas |
|----|-----------|-------|
| **ADDRESS_MISS_ON_SOFTNAV** | Front: 3× `client_desync` `errorCode=address_miss` `matchCount=0` em `childList` (`phase=parent` depois `removed`), anchors `aaz8xog5a5bta` / `a583xbzx15u4o` / `ab6hx80apymig`. Journal: `ResyncRequested=3` / `ResyncServed=3` (joint, lag 0.6–2.1s). Cascata no SoftNav home→PDP (~tClient 222–226s). | Cliente desarma, buffer drop `buffered_while_desynced` (17), re-arma via resync. UX: possible flicker/lag no PDP. **Não** é `sequence_gap` / QueueDropped. |
| **RESYNC_CASCADE** | Três resyncs seguidos no mesmo SoftNav (coversThrough 1874 → 2066 → 2337). Cada um `joint:true` + `client_resync_apply`. | Recovery funciona (BZ2 OK), mas volume indica ghost miss em nós já removidos/trocados na SPA — selector stale vs tree pós-SoftNav. |

### MEDIUM

| ID | Evidência | Notas |
|----|-----------|-------|
| **VIRTUAL_DATA_1x1** | Cold home: 3× `<img src="/w7s/virtual-data/…">` com `naturalWidth/Height=1` (mesmo id `77a0041c…`). | Recorrente de hunts anteriores. PDP: `tiny1x1=0`, mas 1 broken asset. |
| **FRONT_RING_SATURATION** | Observe **2000** (capacidade). Hops early (lifecycle Start, cold arm) caíram do anel; summary front só cobre cauda. | Debug-only esperado, mas impede correlacionar cold↔final só pelo export front. Preferir Journal + export cedo. |
| **SEARCH_ENTER_WRONG_OPTION** | Clique em “elden ring” + Enter → SoftNav para `text=resident%20evil` (`enb_term=8`). | Pode ser focus/Enter no dropdown (option vizinha) ou intent keyboard mal alinhado. Search SoftNav em si OK. |
| **PRODUCT_CLICK_LAG** | Click RE4 focou o link; SoftNav PDP só consolidou após ~segundos + resync cascade. | Sensação “clique morto” até recovery. |

### LOW / observação

| ID | Evidência | Notas |
|----|-----------|-------|
| **SCROLL_TOOL_NOOP** | `browser_scroll` e `wheel` sintético no surface: `scrollTop` permaneceu 0; Journal tem `ScrollEchoHit=2` (algum scroll chegou). | Cursor automation ≠ wheel DomElementInput fiel; não tratar como bug de scrollViewport sem probe dedicado. |
| **GEO_COOKIE_OVERLAYS** | Geo BR + Cookies cobrem cards no cold. | Site, não Speculum — mas atrapalham smoke humano. |
| **HUB_EDITABLEFOCUS** | (não rechecado neste smoke) | Aberto em hunt anterior. |

### Healthy (esta run)

- `QueueDropped=0` (BZ1 continua verde)
- `FrameReceived == WireDelivered` (2607)
- `GenerationBumped=0` (SoftNav sem bump — contrato D4)
- SoftNavObserved=3 (home, search, PDP) mesmo `documentEpoch`
- Input: DataPlane/Applied=18, Rejected=0, CdpDropped=0, SidecarAdmitted=13
- Resync joint apply + re-arm (`document_or_install` / `resync`)
- `duplicateAnchors=0` no cold e no final
- Cold paint Eneba visualmente bom (`smoke-eneba-cold.png`)
- Search results + PDP visualmente bons

---

## Correlação Diff hops (Journal)

```
FrameReceived 2607
WireDelivered 2607
QueueDropped     0
GenerationBumped 0
SoftNavObserved  3
ResyncRequested  3
ResyncServed     3
```

## Correlação Input hops (Journal)

```
DataPlaneReceived  18
SidecarPushWritten 18
Applied            18
SidecarAdmitted    13
Rejected            0
CdpDropped          0
ScrollEchoHit       2
```

## Front Activity (anel 2000 — cauda)

```
client_recv           1204
client_apply           752
client_drop             17  (buffered_while_desynced)
client_desync            3  (address_miss)
client_resync_request    3
client_resync_apply      3
client_arm               2
client_disarm            1
client_sent              3  (mousedown/mousemove/mouseup — anel saturado)
```

---

## Prioridade sugerida

1. **ADDRESS_MISS_ON_SOFTNAV / RESYNC_CASCADE** — investigar selectors `childList` com `matchCount=0` durante SPA SoftNav (âncora já fora da árvore projetada; race apply vs emit).
2. **VIRTUAL_DATA_1x1** — rastrear ingest/rewrite do blob/data que vira placeholder 1×1.
3. Beleza paint: hero blank + ícones quebrados pós-settle (não confundir com Access Denied precoce).

---

## Sessões

| Host | sessionId | Resultado |
|------|-----------|-----------|
| belezanaweb | `a2d35ee8-…` | Access Denied efêmero (julgamento precipitado) |
| belezanaweb | `a6bc9b8c-…` | Settle OK após espera; hero blank + ícones quebrados |
| eneba | `a354c45d-…` | Smoke completo + address_miss SoftNav |

---

## Pós-fix resmoke (2026-08-10, após Fix A/B/C)

Stack redeployado (`dockup deploy --env dev` + compose nouinput). Script: `run-resmoke-fixes.cjs`. Artefatos: `resmoke-summary.json`, `resmoke-*-journal-export.json`, `resmoke-*-front-activity.jsonl`, `resmoke-beleza-settled.png`, `resmoke-eneba-*.png`.

### Veredicto

| Bug | Status | Evidência |
|-----|--------|-----------|
| **ADDRESS_MISS_ON_SOFTNAV / RESYNC_CASCADE** | **FIXED** | Eneba SoftNav search→PDP: `addressMiss=0`, `desyncs=[]`, `ResyncRequested=0`, `ResyncServed=0`, `SoftNavObserved=2`, `QueueDropped=0`, `GenerationBumped=0`, `FrameReceived=WireDelivered=348`. |
| **BELEZA_HERO_BLANK / BELEZA_BROKEN_ICONS** (causa `srcset` truncado) | **FIXED** | Srcset no Projected preserva Cloudinary completo (`…/upload/f_avif,fl_progressive,q_auto:eco,w_iw/v1/banner/…`). **0** net fails em path truncado `…/f_avif`. `ownedRules=4442`, `accessDenied=false`. |
| **VIRTUAL_DATA_1x1** | **HARDENED** (não eliminado) | `parseDataUrl` + não reescreve `data:` sem ingest. Still `virtualData1x1=5` no settle — placeholders LQIP genuínos, fora do núcleo deste ciclo. |

### Eneba Diff hops (pós-fix)

```
FrameReceived    348
WireDelivered    348
QueueDropped       0
GenerationBumped   0
SoftNavObserved    2
ResyncRequested    0
ResyncServed       0
```

### Beleza notas restantes (fora do escopo deste ciclo)

- `brokenImgs=31` no settle headless (lazy/viewport) — **não** correlaciona com 404 `f_avif` truncado (0).
- 11× `400` em `/w7s/virtual-assets/www.belezanaweb.com.br/` (URL site-root, não Cloudinary srcset) — follow-up separado.
- Navigation restaurada para `www.belezanaweb.com.br`.

