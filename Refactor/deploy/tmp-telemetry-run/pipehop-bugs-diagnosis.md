# Diagnóstico PageProjection — bugs, delays e paridade 1:1

**Última atualização:** 2026-08-11  
**Stack:** dockup `dev` + nouinput · `http://127.0.0.1:8080/` · `MirrorMode.PageProjection`  
**Barra de aceite:** `docs/page-projection-acceptance.md` — Projected ≈ abrir o mesmo site no Chrome Virtual. Protocolo verde **não** conta como accept.

---

## Onde estamos (ler primeiro)

### Em uma frase

**O cano Diff (sidecar → API → cliente) está saudável. A experiência ainda não é 1:1.**  
O atraso dominante no cold/resync Beleza é **fotografar o DOM no sidecar (~6–7 s por passagem)** — não mux, não Cssom OOB.

### Duas perguntas que não se misturam

| Pergunta | Status nesta evidência |
|----------|-------------------------|
| **O cano entrega?** Algum Diff some no caminho? | **Não.** FR = FE = SD = WD; QD = 0. |
| **A experiência é 1:1?** Rápida e correta como no Chrome normal? | **Não.** DomMap ~6 s; recovery OOB ~7 s (quase todo DomMap); mídia/SoftNav ainda abertos. |

### Aceite

**NÃO é aceite 1:1.** Stall/mux e jump adhoc estão limpos; DomMap ainda impõe vários segundos sob Beleza ordinária.

---

## Evidência mais recente (ParityDebug + PageEpoch)

| Campo | Valor |
|-------|--------|
| Sessão | `69851f02-874e-4566-bfa3-cb798e3d2ac1` |
| `pageEpochId` | `73ac6365-6b53-414b-8931-458775003f24` |
| Prefixo artefatos | `parityhop-*` em `Refactor/deploy/tmp-telemetry-run/` |
| Journal | `parityhop-journal-export.json` (~28 324 facts) |
| Front Activity | `parityhop-front-activity.jsonl` (~14 327 hops) |
| Story | `parityhop-page-epoch-story.json` |
| Gate ParityDebug | **OK** (`incomplete: []`) |
| Screenshot | `parityhop-settled.png` |

Prep: Lab Reset + pack **ParityDebug** (Virtual / Establish / Asset / Diff hops) + ClientObservation ON.  
Script: `prep-parity-hopdiag.cjs` → `run-hopdiag.cjs` (`PREFIX=parityhop`) → `build-page-epoch-story.cjs`.

### Contagens Diff (protocolo)

| Sinal | Valor |
|-------|--------|
| FrameReceived / FanOut / StreamDequeued / WireDelivered | **6964** cada |
| QueueDropped | **0** |
| SoftNavObserved | **0** (só cold `goto` home) |
| ResyncRequested / ResyncServed | **1 / 1** |
| client desync / disarm | **1 / 1** |

### Load líquido (boot Chromium descontado)

| Marco | Valor | Significado |
|-------|--------|-------------|
| `bootMs` | **3200 ms** | Chrome Virtual até primeiro `NavCommit` — **não** é “site lento” |
| `NavCommit` | Beleza home, `generation=1`, `goto` | **t0** do load do site |
| Virtual TTFB | **~1593 ms** | Rede/origem no Virtual |
| Styles wait | **~983 ms** | Esperar CSS antes do map (sem timeout) |
| DomMap (establish) | **~5.6–6.2 s**, ~18–23k nós | **Dominante no first paint projetado** |
| Cssom install | **~18 ms**, ~4462 rules | Barato |
| `FirstDiffEmitted` | `tSinceCommitMs ≈ 8680` | Cliente só começa a receber document ~8.7 s após commit |
| Virtual DCL / load | ~27 s / ~39 s após commit | Relógio do Chromium Virtual (página pesada) |

Houve **dois** Establish/DomMap na mesma epoch (re-establish pós backpressure/resync) — cada um paga de novo ~6 s de DomMap.

### OOB ResyncServed (schema v2) — buraco de ~7 s com fases

| Campo | ms |
|-------|-----|
| `durationMs` total | **7270** |
| `domMapMs` | **6609** (~91%) |
| `rewriteMs` | 80 |
| `cssomCloneMs` | 7 (`source=mirror`) |
| `serializeMs` | 16 |

**Cssom OOB já está barato (espelho).** O que esmaga UX no recovery é **remapear o DOM**.

### Cliente (último `client_surface_probe`)

- `htmlLen ≈ 3.2M`, `ownedRules ≈ 4710`, `armed=true`, `lagMsP50 ≈ 19`
- **`brokenImgs=11`** (`brokenImgsInViewport=0` no último probe) — ainda falha paridade de mídia
- Spike transitório `lagMsP50 ≈ 403` mid-run (churn/resync)

### Hints da story

`virtual_ttfb_high`, `establish_dom_map_gt_2s`, `oob_dom_map_dominant`, `virtual_page_errors_present`, `client_broken_imgs_present`, `asset_fetch_failures`

(`PageError` nesta corrida = sobretudo ads/analytics `ERR_ABORTED` / DNS — ruído típico, não explica sozinho layout.)

### O que esta corrida **não** testou

- SoftNav / Eneba (hit-test, address_miss, epoch soft sem `generation++`)
- Interação humana (scroll, clique, busca)
- Comparação visual lado a lado com Chrome normal

---

## O que é o DomMap (explicação completa)

No Chromium **Virtual** a página já existe.

O Speculum precisa de uma **cópia estruturada** dessa árvore (tags, atributos, texto, shadows, iframes…) com **âncoras** em cada nó, para o **Projected** montar a mesma coisa e depois aplicar diffs.

Hoje o caminho é:

1. Script **dentro da página** percorre a árvore (**mais de uma vez** no establish: limpar ledger → `anchorAll` → remint de âncoras duplicadas → `mapNode`).
2. Monta um **objeto JavaScript gigante** (~20k nós na Beleza).
3. O Playwright traz esse objeto **do Chrome para o Node** (`page.evaluate` → retorno).
4. No Node ainda reescreve URLs de assets e manda no fio.

O número `domMapMs ≈ 6 s` mede principalmente o passo **1–3** (o `evaluate` inteiro). **Não** é só “contar nós no CPU”.

### Por que ~7 s parece absurdo — e mesmo assim acontece

Num CPU moderno, **andar 20k nós** deveria ser centenas de ms no pior caso, não vários segundos.

O que estoura o tempo é a **combinação**:

| O quê | Por quê dói |
|--------|-------------|
| **Várias passadas** na mesma árvore | establish limpa + ancora + reminta + mapeia |
| **Objeto enorme** | cada nó vira `{ tag, attrs, children, anchor… }` |
| **Trazer Chrome → Node** | retorno do `evaluate` serializa árvore profunda via CDP; em páginas grandes isso sozinho pode ser **segundos** e aparece misturado em `domMapMs` |
| **Resync refaz o mapa** | Cssom OOB clona espelho (~ms); Dom **não** tem espelho equivalente → desync ⇒ fotografar de novo |

Intuição correta: orçamento absurdo. Causa real: **arquitetura + cópia entre processos**, não “JS fraco contando nós”.

### O que a telemetria **decompõe** no DomMap (a partir de 2026-08-11)

`DomMapCompleted` schema **v2** inclui fases in-page + gap CDP:

| Campo | Significado |
|-------|-------------|
| `takeRecordsMs` | `MutationObserver.takeRecords` |
| `clearLedgerMs` | limpar `anchorToNode` (establish) |
| `anchorAllMs` | carimbar âncoras em toda a árvore |
| `remintMs` | remint de âncoras duplicadas |
| `mapNodeMs` | montar o objeto F da árvore |
| `resetPublishedMs` | reset do ledger published |
| `cssomMs` | Cssom no mesmo evaluate (só establish arm) |
| `pageTotalMs` | soma do trabalho **dentro** da página |
| `durationMs` / evaluate wall | tempo Node em volta do `page.evaluate` |
| `cdpTransferMs` | `max(0, durationMs − pageTotalMs)` ≈ marshalling Playwright/CDP |

Resync também emite `DomMapCompleted` com `path=resync` (sem `anchorAll` full).

### Direção de otimização (sem perder 1:1) — depois de ler as fases

Ordem candidata (produto):

1. **Espelho vivo do DOM** (espelho do que já fizeram no Cssom) → Resync em ms.
2. **Parar de pagar structured-clone da árvore** no retorno do `evaluate` (blob/string/CDP nativo) — se `cdpTransferMs` dominar.
3. **Uma passada só** (fundir walks) — se `anchorAllMs`/`mapNodeMs` dominarem in-page.
4. **Não re-establish completo** em todo resume de backpressure se o espelho ainda é válido.

---

## Histórico — o que já foi consertado

### Mux / stall Diff (Broadcast×Diff)

- **Era:** FE×N, QD em stream errado, Diff que some, stall.
- **Agora:** FE×1 por seq, QD=0, FR=FE=SD=WD.
- **Status:** **FECHADO** nesta evidência (parityhop e pipehop pós-mux).

### `InitialNavigationFailed` (timeout `domcontentloaded` 30s)

- **Fix:** sidecar `page.goto` → `waitUntil: 'commit'`.
- **Status:** **FIXED** (`InitialNavigationCompleted`; Failed=0 nas corridas pós-fix).

### Anel front 2000 DropOldest

- **Era:** boot/resync sumiam do export.
- **Fix:** anel sem teto artificial de diagnóstico.
- **Status:** **FIXED** (`frontRows ≫ 2000`, seq desde 1).

### Cascata Resync (gap enquanto OOB lento)

- **Era:** 3× ResyncServed ~25 s somados; depois picos piores com jump adhoc.
- **Mitigação:** pause emit + resume T5; drain T8; tipicamente **1** Resync no cold.
- **Status:** **MITIGADO** (ainda existe 1 OOB caro; não cascata ×3).

### sequence_jump adhoc

- **Removido:** `allowSequenceJump` / `sequence_jump_after_oob`.
- **Status:** **REMOVED** — drain estrito; `sequenceJump=0`.

### Cssom OOB dump caro

- **Fix:** espelho install-ready no emit live; OOB clona espelho (fallback dump só se vazio).
- **Evidência:** `cssomCloneMs=7`, `source=mirror`.
- **Status:** **FIXED**.

### Virtual-asset site-root (`/virtual-assets/{host}/`)

- **Fix:** `isBareDocumentUrl` — não virtualiza `/`.
- **Status:** **FIXED**.

### Hit-test SoftNav

- **Ship:** `elementsFromPoint` + interactive-first em `DomElementInput`.
- **Status:** **SHIPPED** — validação Eneba SoftNav **ainda necessária**.

### Instrumentação PageEpoch / ParityDebug (2026-08-11)

- Lab Reset admin; catálogo Virtual / Establish / Asset; ResyncServed v2 com fases; ClientObservation `client_epoch_arm` + `client_surface_probe`; `build-page-epoch-story.cjs` + gate em hopdiag/diagnose.
- **Status:** **SHIPPED** — story completa na sessão `69851f02-…`.
- **Próximo:** decompor DomMap (ver acima).

---

## Ainda OPEN (bloqueia aceite 1:1)

| Item | Evidência | Notas |
|------|-----------|-------|
| **DomMap ~6 s (establish + OOB)** | `DomMapCompleted.durationMs` ~5.6–6.2 s; `ResyncServed.domMapMs=6609` | Gargalo #1. Falta decompor fases/CDP. |
| **brokenImgs** | 11 no settle (0 no viewport no último probe) | Paridade de mídia; não é “só protocol green”. |
| **SoftNav wrong-target / banner** | Hit-test shipped; smoke Eneba não re-corrido no hopdiag Beleza | Fechar só após SoftNav home→PDP 1:1. |
| **ResourceSummary.topSlow vazio** | story parityhop | Gap menor de telemetria Virtual (não o DomMap). |

---

## Evidência DomMap fases (2026-08-11 — decomposição)

Sessão: `6af802fe-ad05-41a4-bacb-54e15cd05166` · artefatos `dommaphop-*`  
Gate ParityDebug: **OK**. `DomMapCompleted` schema **2** ×5 (3× establish, 2× resync).

### Primeiro establish (cold, ~18.5k nós)

| Fase | ms | % do wall |
|------|-----|-----------|
| **CDP transfer** (`cdpTransferMs`) | **3944** | **67%** |
| `mapNodeMs` (montar objeto na página) | 1342 | 23% |
| `anchorAllMs` | 599 | 10% |
| `cssomMs` / remint / reset | ~40 | ~1% |
| **Wall `durationMs`** | **5924** | 100% |
| `pageTotalMs` (só in-page) | 1980 | — |

### Resync típico (~27k nós, último)

| Fase | ms |
|------|-----|
| `mapNodeMs` | **4374** (dominante in-page; sem `anchorAll`) |
| `cdpTransferMs` | **1324** |
| Wall | **5723** |

### Leitura (fato, não chute)

1. No **primeiro** establish, o pedágio **Chrome→Node** (`cdpTransferMs`) foi **maior que todo o JS in-page** (~3.9 s vs ~2.0 s).
2. In-page, o vilão é **`mapNode`** (montar a árvore F), depois **`anchorAll`** no establish; remint/cssom/reset são irrelevantes.
3. No **resync**, sem `anchorAll` full, sobra **`mapNode` + CDP** — espelho DOM eliminaria os dois no recovery.

**Otimizar primeiro:** (A) não devolver a árvore gigante via structured-clone do `evaluate`; (B) espelho DOM para OOB; (C) fundir/baratear `mapNode`+`anchorAll` no establish.

## Prioridade atual

1. **P0 — Otimizar DomMap** com base na decomposição `dommaphop-*` (CDP transfer + `mapNode`; espelho DOM no OOB).  
2. **P1 — brokenImgs** / first-viewport media.  
3. **P1 — SoftNav Eneba** smoke com PageEpoch story.  
4. Stall mux / jump adhoc / Cssom OOB / nav commit / anel front / decomposição DomMap: **não reabrir** sem evidência nova.

---

## Artefatos por geração (referência)

| Geração | Prefixo / sessão | Notas |
|---------|------------------|-------|
| Mux pós-fix | `pipehop-*` (várias sessões) | Stall FE×1 confirmado |
| Pós jump-remove + Cssom mirror | `pipehop-*` / `ResyncServed≈6s` | DomMap ainda aberto |
| PageEpoch / ParityDebug | `parityhop-*` / `69851f02-…` | Story completa; DomMap dominante quantificado |
| **DomMap fases** | **`dommaphop-*` / `6af802fe-…`** | CDP vs mapNode vs anchorAll medidos |

Corridas antigas neste arquivo (cascata ×3, anel 2000, InitialNavigationFailed) ficam como **histórico**; o SoT operacional é a seção **Evidência mais recente** + **Evidência DomMap fases** acima.
