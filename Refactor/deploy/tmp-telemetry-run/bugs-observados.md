# Bugs observados — PageProjection Live

> **SoT operacional (2026-08-11):** ver [`pipehop-bugs-diagnosis.md`](./pipehop-bugs-diagnosis.md) — estado atual, DomMap ~6–7 s, PageEpoch/ParityDebug, o que está fechado vs OPEN.  
> Este arquivo (`bugs-observados.md`) permanece como **histórico** do re-hunt BZ1–BZ4 (2026-08-10).

Stack: `http://127.0.0.1:8080/` · `mirrorMode=pageProjection`  
**Re-hunt pós-fix BZ1–BZ4:** **2026-08-10** · `1657a57f-82d3-4a41-83c1-2dfc8b2d56f6` · host `www.belezanaweb.com.br`  
Baseline pré-fix (referência): `be82de20-69f5-48ba-b2bb-7ed0406289be`

| Artefato | Path |
|----------|------|
| Screenshots | `beleza-early.png`, `beleza-cold.png`, `beleza-settled.png`, `beleza-final.png` |
| Medidas | `beleza-early/cold/settled/final.json`, `beleza-acts.json`, `beleza-summary.json` |
| Journal | `beleza-journal-export.json` |
| Front wire log | `beleza-front-activity.jsonl` |
| Digest | `beleza-digest.json` |
| Scripts | `run-beleza-hunt.cjs`, `analyze-beleza-hunt.cjs` |

---

## Checklist BZ1–BZ4 (re-hunt `1657a57f-…`)

| ID | Aceite | Resultado |
|----|--------|-----------|
| **BZ1** | Sem `QueueDropped sidecar_bridge` / sem `sequence_gap` no boot | **GREEN** — `QueueDropped=0`; FrameReceived=WireDelivered=6008 |
| **BZ4** | `duplicateAnchors=[]`; sem `matchCount>1` | **GREEN** — cold/settled/final `dups=[]` |
| **BZ2** | Resync observável; Served + apply joint | **GREEN** — Served + `client_resync_apply` `joint:true`; `client_resync_failed=0` |
| **BZ3** | Cascata boot fechada | **PARCIAL** — cold/settled limpos; 1× `address_miss` `matchCount=0` tarde (acts) depois recuperado por resync |

Cold armou ~10.7s, `ownedRules=4443`, `htmlLen≈2.27M`, sem Access Denied.

---

## Timeline pré-fix (Beleza `be82de20-…`)

| t | Fase | Visual / estado | Telemetria / front |
|---|------|-----------------|--------------------|
| ~2s | early | superfície vazia (`htmlLen=0`) | — |
| ~9s | cold **armed** | Header+nav+produtos ok; **hero branco**; ícones quebrados na barra inferior | `client_arm` (`document_or_install`); `ownedRules=4443`; `htmlLen≈2.86M`; **sem** desync ainda |
| ~19s | settled | Hero ainda vazio; **imagens de produto esmagadas** em filetes; 1 âncora duplicada | `client_desync` **sequence_gap** seq 1041 vs expected 17; `client_disarm`; drops `buffered_while_desynced` |
| ~+acts | final | Search “shampoo” (mutação local); grid de busca com assets faltando / skeletons | 2º desync **address_miss**; resync parcial; **0** `client_sent` / **0** Input facts |

**Akamai:** `sawDenied=false` em todo o wait (90s budget; armou em 9127ms).

---

## BZ1 — SEQUENCE_GAP / sidecar_bridge overflow (bloqueador)

**Severidade:** blocker · **Status:** **corrigido** (re-hunt `1657a57f-…`)

**Fix:** `PageProjectionDiffQueueCapacity` default **8192** (sidecar+API); DropAll mantido (T5); backpressure Virtual (`pauseLiveEmit`).

**Pré-fix:** bridge 1024 DropAll seq 17–1040 → client `sequence_gap`. Front `client_apply=23` vs `recv=1024`.

**Pós-fix:** `QueueDropped=0`; sem `sequence_gap`.

<details><summary>Evidência pré-fix</summary>

**Journal**
```text
Telemetry.Sessions.PageProjection.Diff.QueueDropped
  stage: sidecar_bridge
  capacity: 1024
  droppedCount: 1024
  sequence: 1041
  lowestDroppedSequence: 17
  highestDroppedSequence: 1040
```

</details>

---

## BZ2 — RESYNC incompleto / falha após gap

**Severidade:** high · **Status:** **corrigido** (observabilidade + joint apply)

**Fix:** `client_resync_failed` em HTTP≠2xx; apply joint (`kind:dom` + `extra.joint`); API/sidecar `phase:capture` quando snapshot null.

**Pré-fix:** resync CSSOM-only + GET **400** silencioso.

**Pós-fix:** `ResyncServed` + `client_resync_apply` joint; re-`client_arm`; sem `client_resync_failed`.

---

## BZ3 — ADDRESS_MISS pós-resync (`matchCount=0`)

**Severidade:** high · **Status:** cascata boot **fechada**; residual tardio possível

**Pré-fix:** `matchCount=0` logo após resync parcial.

**Pós-fix:** cold/settled sem desync. Acts: 1× `address_miss` `matchCount=0` seq 5469 → resync Served/apply/arm.

---

## BZ4 — DUPLICATE_ANCHOR

**Severidade:** high · **Status:** **corrigido**

**Fix:** remint global + claim no map + skip childList de identidade já publicada; mint monotônico.

**Pré-fix:** ~30 dups no cold; desync seq 6 `matchCount=2`.

**Pós-fix:** `duplicateAnchors=[]` em cold/settled/final.

---

## BZ5 — HERO / carousel vazio (visual)

**Severidade:** high · **Status:** confirmado (cold + settled)

**Visual (`beleza-cold.png`, `beleza-settled.png`)**
- Faixa central branca enorme onde deveria estar o banner/carousel
- Settled: setas ←→ e dots do carousel visíveis, **sem** slides/imagens
- Cold já armado com CSSOM (`ownedRules` 4k+) — não é framing `Invalid framed length` (`framedErr=null`)

**Telemetria correlata:** não há op Diff específica “hero”; falha de assets (BZ7) + possível conteúdo só via patch após seq 17 (perdido no gap BZ1).

---

## BZ6 — Imagens de produto esmagadas / layout quebrado pós-desync

**Severidade:** high · **Status:** confirmado

**Visual**
- **Cold:** cards Lançamentos/Promoções/Em alta com thumbnails razoáveis
- **Settled (após sequence_gap):** mesmas seções com imagens em **filetes verticais** (largura ~0); badges “-32%” etc. ainda legíveis
- **Final (busca):** cards com foto ausente / `…` / skeletons cinza; botões roxos sem ícone

**Telemetria:** degradação alinhada ao desync + apply quase parado (`client_apply=23`) enquanto `client_recv` satura.

---

## BZ7 — Assets virtual-assets 400/404 + ícones quebrados

**Severidade:** high · **Status:** confirmado

**Visual:** ícone “Outlet BLZ” quebrado no menu; barra “Ofertas do Dia / Outlet / Brinde / …” com placeholders de imagem quebrada.

**Medidas**
| Fase | brokenImgs | virtualData1x1 | imgCount (implícito) |
|------|------------:|---------------:|----------------------|
| cold | 86 | 21 | — |
| settled | 74 | 21 | — |

**Net fails (`beleza-net-fails.json`)**
| status | URL (amostra) |
|--------|----------------|
| 400 | `/w7s/virtual-assets/www.belezanaweb.com.br/?speculum-session-token=…` |
| 404 | `/w7s/virtual-assets/res.cloudinary.com/beleza-na-web/image/upload/f_avif?…` |
| 404 | `/w7s/virtual-assets/res.cloudinary.com/beleza-na-web/image/upload/f_webp?…` |
| 400 | `/w7s/api/sessions/…/page-projection/resync?…` |

**Console:** vários `Failed to load resource` 400/404/403; preload warnings de CSS Beleza e cloudinary `f_avif`.

**Nota:** paths cloudinary só com `f_avif`/`f_webp` (sem public id) sugerem rewrite/preload incompleto.

---

## BZ8 — VIRTUAL_DATA_1x1

**Severidade:** medium/high · **Status:** confirmado

**Medida:** `virtualData1x1=21` (cold e settled) — `<img src="/w7s/virtual-data/…">` com `naturalWidth≤1`.

Mesmo padrão visto no hunt Eneba (blob/data → stub 1×1).

---

## BZ9 — Input path morto após desync (telemetria + wire)

**Severidade:** high · **Status:** confirmado

**Journal:** **0** facts `Telemetry.Sessions.PageProjection.Input.*` (Applied/DataPlane/CdpDropped/ScrollEcho = 0).

**Front:** **0** `client_sent` em todo o log exportado.

**Acts (após desync já ativo)**
| Act | Δscroll | Δhtml | err | desyncAfter |
|-----|--------:|------:|-----|-------------|
| wheel_down_800 | +1600 | 0 | — | Y |
| wheel_up_400 | −400 | 0 | — | Y |
| click_center | 0 | 0 | — | Y |
| click_navish | 0 | 0 | element not visible | Y |
| search_type | 0 | 0 | — | Y |
| search_enter | 0 | 0 | — | Y |

**Visual final:** campo de busca mostra **“shampoo”** — tipagem provavelmente **local no DOM projetado** (Playwright → nó real), sem intents Speculum (`client_sent=0`). Isso é vazamento de input local pós-`client_disarm`, não o funil PageProjectionIntent.

Scroll Δ±1600 com `scrollHeight≈8758` também pode ser scroll **local** na surface sem eco remoto (sem ScrollEchoHit / Applied).

---

## BZ10 — Click navish / overlays (UX)

**Severidade:** medium · **Status:** confirmado

`click_navish` timeout: elemento com texto de categoria **not visible** (hero vazio / layout / possível overlay). Categorias no texto existem (`Cabelos`, `Perfumes`… em `settled.text`), mas o locator visível falhou.

---

## Resumo de prioridade (Beleza 2026-08-10)

1. **BZ1** — `sidecar_bridge` drop 1024 frames (seq 17→1040) → root do `sequence_gap`
2. **BZ2/BZ3** — resync não recupera DOM; `address_miss` em seguida; resync HTTP 400
3. **BZ4** — âncora duplicada `a6jzaggvsnxe6`
4. **BZ5–BZ7** — hero vazio + assets 400/404 + layout esmagado
5. **BZ8** — virtual-data 1×1
6. **BZ9** — após disarm, zero input telemetria; tipagem local no projected DOM

---

## O que NÃO ocorreu neste run Beleza

- Access Denied / Akamai block (`sawDenied=false`)
- `Invalid framed length` / `framedErr`
- SoftNav / GenerationBumped
- Input `CdpDropped` / `generation_stale` (porque o funil de input nem chegou a emitir)

---

## Apêndice A — Eneba (2026-08-09) — referência

Sessões: `c82ed6e8-…` (hunt), `75ec4723-…` (wheel). Artefatos `bughunt-*`.

| ID | Nota curta |
|----|------------|
| EN1 EMPTY_SHELLS | Cards vazios pós-scroll; spinners no cold |
| EN2 VIRTUAL_DATA_1x1 | Mesmo padrão BZ8 |
| EN3 SOFTNAV_CLICK | SoftNav para `/promo/game-points`; html colapsa/remonta |
| EN4 CDP blur anchor_missing | 1× no hunt; mais no input-diag |
| EN5 editablefocuschanged | Warning SignalR sem handler client |
| EN6 QueueDropped | Histórico `api_fanout_pipe_closed` (outro stage que BZ1) |

Wheel em Eneba **funcionou** quando armado (probe ΔscrollTop=+2781 + `scrollViewport` + `programmaticSuppress`).

---

## Apêndice B — Run Beleza antigo (Access Denied)

Sessão `bd500651-…`: página Akamai projetada corretamente (HTML curto). **Não** repetido em 2026-08-10 — aguardar alguns segundos basta quando o interstitial aparece.
