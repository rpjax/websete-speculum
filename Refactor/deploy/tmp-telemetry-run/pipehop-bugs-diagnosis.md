# Diagnóstico PageProjection — bugs, delays e paridade 1:1

**Última atualização:** 2026-08-11 (stream establish — **adhoc bootstrap rejeitado**)  
**Stack:** dockup `dev` + nouinput · `http://127.0.0.1:8080/` · `MirrorMode.PageProjection`  
**Barra de aceite:** `docs/page-projection-acceptance.md` — Projected ≈ abrir o mesmo site no Chrome Virtual. Protocolo verde **não** conta como accept.

**Lei:** código **adhoc / workaround é estritamente proibido** (`AGENTS.md`, `docs/engineering-standards.md`). O bootstrap DomMap (~17 s) após seed foi adhoc — **a reverter**; não é o algoritmo.

---

## Onde estamos (ler primeiro)

### Em uma frase

**OOB DomMap em ms (espelho) permanece. O “stream establish” atual está contaminado por bootstrap-dump adhoc (~17 s) — pior que o DomMap cold anterior (~6 s). FirstDiff em ms não conta.**  
Aceite 1:1 **não**.

### Duas perguntas que não se misturam

| Pergunta | Status nesta evidência |
|----------|-------------------------|
| **O cano entrega?** | Parcialmente (FR=WD, QD=0 em `streamfix`); 1× address_miss → resync. |
| **A experiência é 1:1?** | **Não.** Bootstrap adhoc ~17 s; shell cedo não é sync. |

### Aceite

**NÃO.** Próximo trabalho: **remover** `__speculumDomBootstrapMap` / upgrade document no cold e implementar catch-up/stream **correto** (sem dump).

---

## Evidência stream establish (`streamfix-*`, 2026-08-11) — **CONTAMINADA / ADHOC**

| Campo | Valor |
|-------|--------|
| Sessão | `c467b95e-5388-4f45-9cff-bcb6880916a4` |
| Prefixo | `streamfix-*` |

### Veredicto

**Regressão no sync cold.** Seed (~9 ms) + **bootstrap DomMap adhoc (~17.6 s)** — pior que DomMap único ~5.6 s. FirstDiff em ms **não** é vitória. **Remover bootstrap; implementar stream/catch-up correto.**

### O que permanece válido

- Espelho OOB (~47 ms) da mudança DomMap ms path anterior.
- Proibição: full DomMap no cold happy path (seed stream apenas; MapAndArm só fail-safe/lab).

### Números (para não repetir o erro)

| Marco | ms | Nota |
|-------|-----|------|
| Seed | **9** | ok como shell |
| Bootstrap DomMap | **~17626** | **adhoc — reverter** |
| OOB mirror | **47** | manter |
| QD | **0** | — |

---

## Plano de ataque — desfazer adhoc + stream establish correto

**Lei:** zero novos workarounds. Cada marco ou fecha o algoritmo ou deixa o defect aberto com evidência — nunca um “segundo DomMap pra parecer vivo”.

### Algoritmo alvo (produto)

```text
commit / hard-nav
  → seed document raso (html/head/body) em ms + Cssom seed leve
  → arm Dom+Cssom live cedo o bastante que mute≈0 (parse MO vira stream)
  → catch-up dos nós já presentes sob head/body via childList (ledger correto)
  → diffs naturais até sync útil
  → full DomMap SÓ: OOB mirror-miss + lab/fail-safe (MapAndArm)
```

Não: seed → **BootstrapMap dump** → arm. Isso é a cagada.

### Fase 0 — Reverter adhoc (obrigatório, primeiro)

| # | Ação | Onde |
|---|------|------|
| 0.1 | Apagar `__speculumDomBootstrapMap` e qualquer call | `DomTreeSerializer.ts` |
| 0.2 | Remover bloco `path: 'bootstrap'` + 2º `document`/`install` + `ArmStreamLive` pós-dump | `PageProjection.ts` `enqueueStreamEstablish` |
| 0.3 | Remover/no-op morto `__speculumDomStartBootstrapCatchUp` se só aponta pro dump | page script |
| 0.4 | Comentários: seed **não** “espera bootstrap”; cold = seed + catch-up + arm | serializer + sidecar |
| 0.5 | Rebuild sidecar dist / unit se o pipeline local exigir | `dist/` |
| 0.6 | Hopdiag Beleza **sem** bootstrap: esperar QD/flood/address_miss de novo — isso é o defect real a atacar, não a desculpa pra dump | `tmp-telemetry-run/` |

**Gate Fase 0:** nenhum `path: 'bootstrap'` / `__speculumDomBootstrapMap` no cold path. `MapAndArm` só fail-safe/lab. OOB mirror ms intacto.

### Fase 1 — Catch-up correto (raiz do address_miss)

Hipótese do defect (pré-adhoc): catch-up shallow sob head/body emite `childList` com nós profundos / índices / anchors que o DiffApplier não resolve (`address_miss`), ou emite contra host ainda não publicado.

| # | Ação |
|---|------|
| 1.1 | Instrumentar catch-up: host selector, `added.length`, anchors mintados vs `publishedAnchors`, generation |
| 1.2 | Garantir seed publica anchors de html/head/body **antes** de qualquer catch-up |
| 1.3 | Catch-up **BFS / por nível**: um `childList` por host já publicado; filhos profundos só depois do pai no wire (não um subtree map disfarçado de um único added blob se o applier espera flat) |
| 1.4 | Alinhar `fChildEntries` + `markPublishedMapped` com o que `PageProjectionDiffApplier` aplica (selector = parent op; index semantics T7) |
| 1.5 | Reproduzir address_miss em unit/lab com árvore mínima; falha = assert, não soft-skip |

**Gate Fase 1:** seed + catch-up (liveEmit ainda gated se preciso) aplica sem `address_miss` em Beleza shell; sem DomMap.

### Fase 2 — Arm cedo sem flood (raiz do QD DropAll)

Hipótese: arm imediato + parse MO → milhares de records → bridge DropAll → `sequence_gap` → desync.

| # | Ação |
|---|------|
| 2.1 | `takeRecords()` no arm; descartar só o que o catch-up já cobriu (sem mute hole longo) |
| 2.2 | Pacing / batch no **emitter** (já no design de stream) — coalescer **dentro** das regras T5/T7, sem reordenar ops cross-record proibidas |
| 2.3 | Backpressure existente (`PauseLiveEmit`) deve **re-establish stream** (seed+catch-up), nunca DomMap cold |
| 2.4 | Medir QD / FR-WD / FirstDiff / tempo até “árvore útil” (não só FirstDiff) |

**Gate Fase 2:** cold Beleza sem QD DropAll; mute hole ≈0; sync útil em ms–centenas ms de Speculum cost (site wall separado).

### Fase 3 — Cssom com Dom

| # | Ação |
|---|------|
| 3.1 | `cssomLive` com Dom no arm de stream (sem gate “styles all ready”) |
| 3.2 | Seed sheets leves ok; sheets tardios via stream Cssom ops |
| 3.3 | Não segundo `install` full via DomMap |

**Gate Fase 3:** Cssom stream sem bloquear Dom; sem install-dump.

### Fase 4 — Prova (parity, não protocolo)

| # | Ação |
|---|------|
| 4.1 | Hopdiag Beleza (+ Eneba se baseline) — story: seed ms, **zero** DomMap cold, OOB mirror ms |
| 4.2 | Journal: sem bootstrap path; fail harness se cold `MapAndArm`/`bootstrap` |
| 4.3 | Screenshot / brokenImgs / SoftNav — parity defects abertos se existirem |
| 4.4 | Atualizar este diagnosis: remover “contaminada”; marcar stream como algoritmo |

**Aceite:** Projected usável ≈ original; FirstDiff ms **e** catch-up sem dump. Protocolo verde sozinho = **não**.

### Explicitamente fora / proibido neste plano

- Qualquer “bootstrap DomMap”, “upgrade document completo”, “um Map pra estabilizar”
- Soft-skip de `address_miss` / QD
- Declarar PASS por FR=WD enquanto árvore incompleta
- Tocar espelho OOB ms path (manter)

### Ordem de execução

`0 → 1 → 2 → 3 → 4`. Não pular 0. Se 2 reaparecer flood, **não** voltar ao dump — reduzir taxa / corrigir catch-up coverage / backpressure stream.

## Evidência DomMap ms path (`dommapfix-*`, 2026-08-11) — espelho OOB

| Campo | Valor |
|-------|--------|
| Sessão | `8c7555f1-aa4e-4aff-8464-a8deab98355b` |
| Prefixo | `dommapfix-*` |
| Gate ParityDebug | **OK** (`incomplete: []`) |
| Story | `dommapfix-page-epoch-story.json` |

### Marco A — transporte `rootJson` / `sheetsJson`

Establish devolve a árvore como **string JSON** (stringify na página + `JSON.parse` no Node).

| Fase (establish) | ms |
|------------------|-----|
| `durationMs` | **5612** |
| `pageTotalMs` | **1997** (`mapNodeMs≈1332`) |
| `cdpTransferMs` | **3615** |

**Leitura:** o gap CDP **continua na casa dos segundos** para ~18k nós mesmo como string. Marco A não tirou o cold dos “vários segundos”. Corte seguinte (fora deste plano): comprimir / chunkar / baratear `mapNode` in-page.

### Marco B — espelho Dom (`domInstallRoot`)

| Sinal | Antes | Depois (`dommapfix`) |
|-------|--------|------------------------|
| OOB `DomMapCompleted path=resync` | `mapNodeMs` ~3–4 s + CDP | **`durationMs=50`, `mirror:true`** |
| `ResyncServed.domMapMs` | **~6609** | **50** |
| `ResyncServed.cssomCloneMs` | ~7 | **9** |
| Re-establish pós-OOB (2º DomMap) | sim (~6 s) | **não** (resume dos espelhos) |

Fail-safe: `childList` com host introuvável invalida o espelho. Patch miss / `childAt` oob = soft-skip (padrão Cssom).

### Cold vs OOB

- **Cold / first paint:** ainda ~5–6 s de DomMap — **não** resolvido neste plano.
- **Recovery OOB:** DomMap ~50 ms (clone), alinhado ao Cssom OOB.

### Ainda aberto para aceite 1:1

brokenImgs · SoftNav Eneba · cold DomMap · comparação visual com Chrome normal.

---

## Evidência anterior (ParityDebug + PageEpoch, pré–DomMap fix)

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

### OOB ResyncServed (schema v2) — buraco de ~7 s com fases (pré-fix)

| Campo | ms |
|-------|-----|
| `durationMs` total | **7270** |
| `domMapMs` | **6609** (~91%) |
| `rewriteMs` | 80 |
| `cssomCloneMs` | 7 (`source=mirror`) |
| `serializeMs` | 16 |

**Cssom OOB já estava barato.** Pré-fix, o recovery remapeava o DOM — **resolvido** em `dommapfix` (`domMapMs=50`, `mirror:true`).

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

1. Script **dentro da página** percorre a árvore (**mais de uma vez** no establish: limpar ledger → `anchorAll` → remint → `mapNode`).
2. Monta um objeto F (~20k nós na Beleza) e **stringifica** (`rootJson`) antes do retorno.
3. Playwright traz a string Chrome → Node (`page.evaluate`) — ainda caro no cold Beleza (`cdpTransferMs` ~3–4 s).
4. Node: `JSON.parse`, rewrite de assets, fio.
5. **OOB / resume:** se `domInstallRoot` quente, **não** remapeia — clona o espelho (como Cssom).

Cold `domMapMs` ≈ passo 1–3. Resync com espelho ≈ clone (~dezenas de ms).

### Por que o cold ainda é lento

| O quê | Por quê dói |
|--------|-------------|
| **Várias passadas** in-page | establish limpa + ancora + reminta + mapeia (`pageTotalMs` ~2 s) |
| **Payload enorme** | JSON de ~18–23k nós; CDP ainda ~3–4 s mesmo como string |
| **OOB (pré-fix)** | remapeava de novo — **já mitigado** pelo espelho Dom |

### Telemetria DomMap (`DomMapCompleted` schema **v3**)

Fases in-page + `cdpTransferMs` + **`mirror`** (true = clone de `domInstallRoot`, sem `page.evaluate` map).

### Próximos cortes (cold / aceite)

1. Comprimir ou chunkar `rootJson` no cold (CDP ainda domina).
2. Fundir walks in-page (`anchorAll` / `mapNode`).
3. brokenImgs + SoftNav Eneba + paridade visual.

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
