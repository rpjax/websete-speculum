# Bugs observados — PageProjection Live (bug hunt)

Anotações a partir dos smokes em `Refactor/deploy/tmp-telemetry-run/`  
Data: **2026-08-09** (retest Eneba) · stack local `http://127.0.0.1:8080/` · `mirrorMode=pageProjection`

| Sessão | Host | Papel |
|--------|------|--------|
| `bd500651-3c7e-47e2-8dc1-14e48ace08c6` | belezanaweb (WAF) | 1ª passagem — Access Denied |
| `c82ed6e8-30ab-4c06-8304-74726ae71c93` | eneba | Hunt completo (cold + acts) |
| `75ec4723-04b1-4050-9ed6-18698513b7cc` | eneba | Probe wheel-only |
| `61da7bc4-1159-4584-90b8-4ff4341a4b93` | eneba (input-diag anterior) | Funil de input / SoftNav |

Artefatos: `bughunt-*`, `bughunt-wheel-probe.json`, `input-journal-export.json`, `bughunt-front-activity.jsonl`.

---

## B1 — TARGET_WAF_ACCESS_DENIED

**Severidade:** blocker (ambiente) · **Status:** confirmado

**O que se vê:** tela preta com “Access Denied” (Akamai / `edgesuite.net`). Árvore projetada “esparsa”, sem nav/search, `scrollHeight === clientHeight`.

**Telemetria / evidência**
- `Telemetry.Sessions.Start.UrlResolved` → `https://www.belezanaweb.com.br/…`
- `Sessions.InitialNavigationCompleted` no mesmo URL
- Só **2** Diffs: `dom/document@seq1` + `cssom/install@seq2` (FrameReceived + WireDelivered); sem storm de `childList`
- Cold snapshot (`bughunt-cold.json` da 1ª passagem): `text` = Access Denied; `bodyKids=3`; `htmlLen≈1599`; `ownedRules=0`
- Inputs ainda passam (`Applied` em wheel/mousemove) sobre a página de erro — sem efeito visual útil

**Nota:** não é falha de paint do Speculum; o host default estava em Beleza. Query `?_bughunt=…` no Live era mapeada para o remote start URL e agravava o risco de WAF.

---

## B2 — EMPTY_SHELLS_AFTER_SCROLL / cold spinners

**Severidade:** high · **Status:** confirmado (visual + cold)

**O que se vê**
- Cold: header/nav ok; cards de produto com **spinner**; hero com faixa vazia
- Após wheel: seções tipo “Upcoming games” com **cards roxos vazios** (`bughunt-wheel-only.png`)

**Telemetria / evidência**
- Sessão hunt: cold `ownedRules=1832`, `htmlLen≈311k`, `client_arm` + `cssom/install` — DOM/CSSOM **ok**
- Front hops (hunt): `client_apply≈948`, `client_recv≈939` — Diffs fluindo
- Wheel probe: HTML cresce `150k → 938k` enquanto scroll anda; layout shell permanece, conteúdo de card atrasa/falha
- Imagens `virtual-assets` amostradas: HTTP **200** (não é 401 de token neste run)
- Vários `<img>` em `/w7s/virtual-data/…` com `naturalWidth/Height=1` → ver **B3**

**Hipótese:** lazy-load / intersection / rewrite de mídia; não desync (`client_desync=0` neste run).

---

## B3 — VIRTUAL_DATA_1x1

**Severidade:** high · **Status:** confirmado (DOM projetado)

**O que se vê:** placeholders 1×1 onde deveria haver mídia real.

**Telemetria / evidência (front DOM, pós-settle ~8s)**
- `imgCount=83`, `broken≈10` (critério `!complete || naturalWidth===0`)
- Amostra repetida: `src=/w7s/virtual-data/77a0041c6516f10f7086818e?speculum-session-token=…` com `nw=1`, `nh=1`, `complete=true`
- Contraste: `virtual-assets` (logo, flags, imgproxy) com dimensões reais e status 200

**Hipótese:** rewrite blob/data → `virtual-data` colapsa bytes ou serve stub.

---

## B4 — SOFTNAV_CLICK_COLLAPSE (+ overlays)

**Severidade:** medium (UX / percepção de bug) · **Status:** confirmado

**O que se vê:** click no centro “apaga” a home e remonta outra página; modal geo (“Achamos que você está em Brasil”) e cookies cobrem CTAs.

**Telemetria**
- Act `click_center`: `hrefChanged=true`, `htmlLen` **539714 → 267587** (`textLen` −2234)
- Journal:
  - `Telemetry.Sessions.PageProjection.Diff.SoftNavObserved`  
    - `url=https://www.eneba.com/`, `documentEpoch=eqm9k4848msmfgfxu`, `liveArmed=false`
  - SoftNavObserved  
    - `url=https://www.eneba.com/promo/game-points?…`, mesmo `documentEpoch`, `liveArmed=true`
- Front: `hop=lifecycle` kind SoftNav/url sync para o promo
- `GenerationBumped=0` neste SoftNav (epoch estável) — alinhado ao contrato SoftNav, não hard nav
- `click_navish` falhou: elemento não visível (overlay)

**Nota:** comportamento do site + SoftNav; não é `address_miss`. Ainda assim explica “tá bugado” ao clicar.

---

## B5 — CDP_DROPPED anchor_missing (blur / focus / input)

**Severidade:** medium (ruído) · **Status:** confirmado, recorrente

**Telemetria — hunt Eneba (`c82ed6e8-…`)**
- `Telemetry.Sessions.PageProjection.Input.CdpDropped` ×1  
  - `kind=blur`, `reason=anchor_missing`, `generation=1`, `anchor=null`

**Telemetria — input-diag anterior (`61da7bc4-…`)**
| kind | reason | gen |
|------|--------|-----|
| blur | `anchor_missing` | 1 |
| focus | `generation_stale` | 1 |
| blur | `anchor_missing` | 2 |
| input | `anchor_missing` | 2 |
| keyup | `anchor_missing` | 2 |

Funil input-diag (saudável no geral): DataPlane/Applied/Push **26**; `ScrollEchoHit=1`; `GenerationBumped` 1→2 em `main_frame_navigated` para `/br/`.

**Nota:** drops em foco/blur sem âncora; `generation_stale` em torno de hard nav (mitigado em parte pelo disarm de generation).

---

## B6 — HUB_EDITABLEFOCUS_MISSING

**Severidade:** medium · **Status:** confirmado (console)

**O que se vê:** warning no browser.

**Evidência**
```
[warning] Warning: No client method with the name 'editablefocuschanged' found.
```
(`bughunt-browser-console.txt`)

**Hipótese:** hub emite `EditableFocusChanged` sem handler MessagePack/SignalR no client Live.

---

## B7 — QueueDropped api_fanout_pipe_closed

**Severidade:** medium (capacidade / detach) · **Status:** visto em journals anteriores; não no hunt Eneba principal

**Telemetria (input-diag / full-diag)**
- `Telemetry.Sessions.PageProjection.Diff.QueueDropped`
  - `stage=api_fanout_pipe_closed`
  - `capacity=1024`, `droppedCount=1`, plane `dom`, op `childList` / `patch`
- Correlato histórico: `FrameReceived` ≫ `WireDelivered` (ex.: 1704 vs 1024) quando o pipe fecha

**Nota:** funcional ≠ perf; indicar quando a sessão desconecta/timeout no meio do fanout.

---

## B8 — (histórico) DESYNC address_miss matchCount=2

**Severidade:** blocker quando ocorre · **Status:** **não reproduzido** no hunt Eneba 2026-08-09

**O que se viu antes (Beleza pintando):** `client_desync` `address_miss` com seletor `speculum-anchor=…` e `matchCount: 2` (contrato exige exatamente 1) → disarm → `buffered_while_desynced` em massa.

**Neste run Eneba:** `desync=null`, `duplicateAnchors=[]`, front sem `client_desync`.

Manter na lista até retest em host que gerava âncora duplicada.

---

## B9 — (histórico / mitigado) FRAMED_LENGTH / MaxMessageBytes

**Severidade:** blocker se Diff > teto · **Status:** mitigado localmente (teto **10 MB**); não visto no hunt

**Antes:** `Invalid framed length` com Diff Beleza ~3–4 MB vs teto 1 MB → superfície vazia.  
**Agora:** bundle com `10485760`; hunt Eneba sem `framedErr`.

---

## Falsos positivos do analyzer

| Flag do analyzer | Por que descartar |
|------------------|-------------------|
| `WHEEL_NO_EFFECT` no hunt principal | Medição após SoftNav / página curta (`scrollHeight=900`) ou mid-rebuild. Probe dedicado: **ΔscrollTop=+2781**, vários `dom/scrollViewport` FrameReceived+WireDelivered+`client_apply`+`programmaticSuppress`. |
| `SPARSE_PROJECTED_TREE` (Beleza) | HTML da página WAF, não falha de apply. |
| `NO_SCROLL_RANGE` no final do hunt | Estado pós-promo/modal; cold/wheel-probe tinham `scrollHeight ≫ clientHeight`. |

### Telemetria de scroll que **funcionou** (probe `75ec4723-…`)
- Intent: `client_sent` `kind=wheel` (âncora presente) → lifecycle `push` / `grpc_pushed` / `sidecar_admitted`
- Diff: `FrameReceived` + `WireDelivered` `operation=scrollViewport` (seqs 199, 231, 262, 263, 295, 402, …)
- Front: `client_apply` `target=scrollViewport` + `programmaticSuppress` `target=viewport`
- Hunt: `ScrollEchoHit` viewport (`scrollX=0`, `scrollY=0` num sample — eco de posição; não prova sozinho falha de scroll)

---

## Sinais saudáveis (baseline Eneba hunt)

| Métrica | Valor |
|---------|--------|
| Cold phase | `armed` ~4.6s |
| ownedRules | 1832 |
| Desync / framed / dups | 0 |
| factCount | 2221 |
| Applied inputs | 27 |
| SoftNavObserved | 2 |
| GenerationBumped | 0 |
| ScrollEchoHit | 1 |
| programmaticSuppress (front) | 2 |
| CdpDropped | 1 |

Front `client_sent` kinds (hunt): mousemove, mousedown/up, focus/blur, wheel×2, scrollViewport×1, keydown/keyup, input.

---

## Prioridade sugerida

1. **B3** virtual-data 1×1 (+ impacto em **B2** shells vazios)  
2. **B6** handler `editablefocuschanged`  
3. **B5** âncora nula em blur/focus (se afetar edição)  
4. Repro **B8** em host que gerava âncora duplicada  
5. Tratar **B1** como config/host (não como bug de Diff)

---

## Config local após o hunt

`Navigation.defaultTargetHost` ficou em **`www.eneba.com`** (antes Beleza). Restaurar Beleza só se quiser revalidar WAF / B8.
