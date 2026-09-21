# PageProjection — PENDING (execution order)

**What this is:** single consolidated backlog of work still open, in the order it must be done.  
**What this is not:** a fix plan, a schedule, or a speculative investigation.

**Rules:** each claim is **VERIFICADO** (measurement or `file:line`) or **NÃO VERIFICADO** (suspicion / human statement without this agent re-measuring). Unknown state is written as such — never guessed.

**Related trackers:** [spec/open.md](spec/open.md) · [LIVE-PP-0.3.0-IMPLEMENTATION.md](LIVE-PP-0.3.0-IMPLEMENTATION.md)

**Last written:** 2026-09-02.

---

## P0 — Estado da release

### 0.1 Tag `v0.3.0`

| | |
|--|--|
| **O que é** | Decidir se dívidas de carimbo de input entram como patch da 0.3.0 ou como 0.3.1. Nada abaixo se classifica em release sem isto. |
| **Evidência** | Local: `git tag -l` → `v0.3.0`. Remoto: `git ls-remote --tags origin` → `refs/tags/v0.3.0` → `787ff4cb9e3c15053d7e6875cdba09df0e718c32` (annotada; peeled `8005496bf67ba23cdbefeee4dd029e84fd3d9f89`). |
| **Por que nesta posição** | Primeira decisão de produto/release; classifica o resto. |
| **Feito quando** | Documento registra explicitamente: tag cortada **sim** (este registro) e a regra de destino para o carimbo. |
| **Marcação** | Existência da tag: **VERIFICADO**. Destino: **0.3.1** (**VERIFICADO** — tag já cortada; não reabre `v0.3.0`). |

---

## P1 — Regressões possíveis do mesmo bug (antes do piloto)

### 1.1 Admit / carimbo — scroll, digitação, iframe aninhado

| | |
|--|--|
| **O que é** | `AdmitPageProjectionInput` no Api (`Speculum.Api/Sessions/Services/LiveSession.Streams.cs` ~108–138) admite `PageProjectionIntent` via `WithAdmissionNormalization()` (`PageProjectionIntent.cs` ~62–68). Relato: ViewportW/H, SchemaVersion e Census caíam no mesmo buraco que o clique. O bug descartava esses campos — `cdp_applied` sai idêntico com ou sem SchemaVersion/Census; hop final **não** é o critério. |
| **Evidência** | Código de admit + normalização: **VERIFICADO**. Campos no sidecar após os quatro gestos via harness: **VERIFICADO** — `PP1b_admit_stamp_survives_scroll_key_and_nested_click` (SessionsTest 2026-09-02): scrollSet página, scrollSet `#scroller`, keyDown, down `contextId=2` — cada um com `lastIntent.schemaVersion` / `viewportW/H` / `census` iguais aos enviados (`DumpInputClickDiagnosticAsync`). |
| **Por que nesta posição** | Depois do P2 (harness/instrumento). Piloto Live; regressões do mesmo buraco de carimbo. |
| **Feito quando** | Para cada um dos quatro gestos: intent no sidecar carrega schemaVersion + census (+ viewport) enviados — via `lastIntent`. **FEITO** (PP1b). |

---

## P2 — Buraco de cobertura que deixou o bug passar verde

### 2.1 Gate de clique monta intent no servidor

| | |
|--|--|
| **O que é** | PP2 / asserts de clique usam `resolveAndClickDomInputByNodeId` (`sidecar/browser/mirror/projection/session/PageProjectionBrowserSession.ts` 972–1008), que monta o intent **no servidor** com `viewportW: this.width`, `viewportH: this.height`, `x`/`y` de `resolveNodeHit`, `localX`/`localY` 0.5 — passa nas validações do EventApplier por construção. Nenhum teste do gate exercitava intent com carimbo admitido (não resolve-click). |
| **Evidência** | Gap anterior: **VERIFICADO ausente**. Cobertura nova: **VERIFICADO** — `PP2b_admit_intent_forwards_stamp_and_applies_click` + `PP2c_admit_intent_stale_viewport_rejects_without_click` (SessionsTest 2026-09-02). |
| **Por que nesta posição** | Antes do P1 — o harness é o instrumento. |
| **Feito quando** | (1) admit carimbo completo → `cdp_applied` + `lastIntent` schemaVersion/viewport/census; (2) viewport divergente → `stale_viewport`. **FEITO** (PP2b/PP2c). |
| **Limitação** | O POST harness chama `AdmitPageProjectionInput` direto: cobre **.NET → sidecar**. **Não** cobre o salto cliente → wire (`intentToWire`, `dataStreams.ts`, MessagePack). P2 pegaria o bug de admit de hoje; não pegaria bug de nome de campo no cliente. Item separado — não neste ciclo. |

---

## P2.2 — Configuração de `Sessions`: banco manda, env é semente

| | |
|--|--|
| **O que é** | **Comportamento esperado, não bug.** A autoridade das configurações de `Sessions` é o banco. Variáveis `Sessions__*` no compose/dockup são **semente de first-boot**: se a chave já existe no banco, o valor persistido prevalece e o env é ignorado. Decisão de produto fechada — não reabrir. |
| **Consequência prática** | Em ambiente já existente, mudar o dockup/compose não altera nada: `GET /api/configurations/Sessions` segue com o valor do banco. Para mudar, use a API/tela de configuração (`PUT /api/configurations/Sessions`). |
| **Referência** | `Speculum.Api.SessionsTest.Tests/SessionsTestFixture.cs` → `EnsureSessionsInputPathTelemetryAsync`: o fixture faz GET → patch → PUT. Isso é o **uso correto da API**, não contorno. |
| **Ação** | Nenhuma. Item existe só para quem esbarrar no sintoma não abrir investigação. |

---

## P3 — Dívidas do hot path de input (pequenas, conhecidas)

### 3.1 `intentToWire` manda `generation: 0` hardcoded

| | |
|--|--|
| **O que é** | Cliente Live serializa intent com `generation` da superfície projetada. |
| **Evidência** | **VERIFICADO** `web/src/features/sessions/live/SessionMirrorSurface.tsx` — `intentToWire(intent, client.getGeneration())` / nested `info.getGeneration()`. |
| **Por que nesta posição** | Não mata input; telemetria / ordenação. |
| **Feito quando** | `generation` no wire reflete a generation da superfície projetada. **FEITO**. |

### 3.2 `sidecar_enqueued` / `enqueued` = enfileirado, não aplicado

| | |
|--|--|
| **O que é** | `pushInput` retorna `{ status: 'enqueued' }` imediatamente após `eventApplier.enqueue`, antes da validação/aplicação CDP. Fase de path e journal: `sidecar_enqueued` / `…Input.SidecarEnqueued` (PP + Video). |
| **Evidência** | **VERIFICADO** rename em sidecar contracts, proto, Api journal, SPA catalog. Sem shim do nome antigo; volumes de config destruídos e ressemeados. |
| **Por que nesta posição** | Contrato / semântica. |
| **Feito quando** | Decisão = rename honesto; código/docs alinhados. **FEITO**. |

---

## P4 — Fidelidade de layout

### 4.1 Divergência visual Projected vs original (a confirmar)

| | |
|--|--|
| **O que é** | A projeção diverge visualmente do original. Relatado pelo dono. |
| **Evidência** | Existência da divergência: **relatada pelo dono**, a confirmar com medição válida. Números antigos (BODY 8420→7540 −880; MAIN −589; FOOTER −291; NAV.zyqj8m 78→60) e dumps de identidade de nó sob larguras diferentes: **NÃO CONFIÁVEIS** — site responsivo em largura diferente reflui e muda de altura por definição. Isso também explica `elementFromPoint` na “mesma coordenada” pegar nós diferentes na 1ª rodada. |
| **Primeiro passo quando for atacar** | Remedir com viewport **idêntico** nos dois lados (mesma largura e mesma altura); comparar por **identidade de nó**, não por coordenada. |
| **Por que nesta posição** | Aceite 1:1 / layout; **separado** de scroll relativo (fração de range) e de scroll-axis. |
| **Feito quando** | Medição válida no mesmo viewport; causa identificada; Projected ≈ original no critério documentado no accept. |
| **Marcação** | Divergência: relatada, a confirmar. Números atuais: **NÃO CONFIÁVEIS**. Conserto: **não iniciado**. |

---

## P5 — PP-SCROLL-AXIS — **RESOLVIDO**

Tracker: [spec/open.md](spec/open.md) **PP-SCROLL-AXIS**.

| | |
|--|--|
| **O que era** | Swipe vertical sobre carrossel horizontal (links) não rolava a página no Projected; no original rolava. |
| **Causa** | `projectedNativeGuard` chamava `preventDefault()` no `touchstart` (não-passivo) quando o alvo estava em `a[href]`, cancelando o pan nativo do Chrome. |
| **Conserto** | Cancelamento de ativação de link movido para `touchend`; `touchstart` só métrica (`onTouchStartSeen`). |
| **Prova** | Lab `FIXED` — artefato `sidecar/lab-runs/2026-09-02T23-11-38-017Z-input-touch-scroll-axis/probes/touch-scroll-axis.json` (matriz V1–V4 × A/B/C × G1+G4). |
| **Marcação** | **RESOLVIDO** (2026-09-02). |

### 5.1–5.3 (histórico — instrumento pré-fix)

Os itens 5.1–5.3 abaixo documentam a investigação anterior; não reabrir salvo regressão.

#### 5.1 Sintoma (pré-fix)

| | |
|--|--|
| **O que é** | Swipe vertical iniciado sobre carrossel horizontal não rola a página (Eneba); no original a página rola. |
| **Evidência** | **VERIFICADO** pré-fix; causa fechada no conserto acima (rodada 2 `CONFIRMED_NAVIGABLE_GUARD` → fix `FIXED`). |

#### 5.2 Bloqueadores de instrumento

| | |
|--|--|
| **O que é** | Harness de coords iframe / Build B `frame detached` — superados pelo probe `touchScrollAxis` (CDP na página do lab + surfaceHost). |
| **Marcação** | Instrumento de matriz no lab; TEMP-DIAG legado descartável (5.3). |

#### 5.3 Limpeza diag

| | |
|--|--|
| **O que é** | Branch `diag/scroll-axis-temp` e TEMP-DIAG são descartáveis. Build B (`?touchCapture=off`) **não é conserto**. |
| **Feito quando** | Após merge do fix: limpar TEMP-DIAG / branch conforme costume. |

---

## P6 — Dívidas do oráculo iso (levantadas e não feitas)

### 6.1 `inferPageBaseFromVirtualAssetAttrs`

| | |
|--|--|
| **O que é** | Base do documento inferida por host majoritário + `scoreVirtualAssetKey` (extensões hardcoded) em vez da URL de documento que a sessão conhece. |
| **Evidência** | **VERIFICADO** `sidecar/browser/mirror/projection/lab/probes/structuralDiff.ts` 129–172 (`inferPageBaseFromVirtualAssetAttrs`, `scoreVirtualAssetKey`). Substituição por plumbing de URL: **não feita**. |
| **Por que nesta posição** | Oráculo / iso; não bloqueia P1–P5. |
| **Feito quando** | Page base vem da URL de documento da sessão (sem allowlist estatística de attrs). |

### 6.2 `iso.table` compara digest opaco sem normalização de URL

| | |
|--|--|
| **O que é** | `isomorphism.ts` compara `ReplicatedTableDigest` (hash) sem importar `classifyAndRewriteUrl` / `httpUrlToVirtual` / predicado de scaffold — mesmas causas do tree num segundo caminho. |
| **Evidência** | **VERIFICADO:** `isomorphism.ts` importa `ReplicatedTableDigest` e não importa `classifyAndRewriteUrl` (grep). Tree path usa rewrite em `structuralDiff.ts` (import `classifyAndRewriteUrl`). Decisão digest normalizado vs abandonar hash opaco: **estado desconhecido — confirmar**. |
| **Por que nesta posição** | Oráculo; acoplado a 6.1. |
| **Feito quando** | Decisão registrada e implementada: digest sobre forma normalizada nos dois lados, **ou** deixar de comparar hash opaco. |

---

## P7 — Aceitos como limitação (não são trabalho agora)

### 7.1 B5c — Turnstile nested sob desafio Cloudflare

| | |
|--|--|
| **O que é** | Nested sob desafio: não verificável nesta versão; contexto nested vive menos que a latência da sonda do lab. Instrumento, não produto. Reabrir quando verdicts nested vierem do journal/wire. |
| **Evidência** | **VERIFICADO** como limitação registrada em [LIVE-PP-0.3.0-IMPLEMENTATION.md](LIVE-PP-0.3.0-IMPLEMENTATION.md) §B5c / disposition. |
| **Por que nesta posição** | Aceito; piloto entra em `/br/`. |
| **Feito quando** | N/A nesta fila — reabrir só com instrumento journal/wire. |

### 7.2 STALE de spec restantes (fora do DoD 0.3.0)

| | |
|--|--|
| **O que é** | Linhas STALE do M0 audit restantes — follow-up pós-0.3.0. |
| **Evidência** | **VERIFICADO** nota em LIVE-PP-0.3.0 (M0 hygiene / D STALE disposition). Contagem “7”: **estado desconhecido — confirmar** no `spec-audit-0.3.0.md` atual. |
| **Por que nesta posição** | Explicitamente fora do DoD. |
| **Feito quando** | Cada STALE restante reescrito ou arquivado com pairing `file:line` (trabalho pós-0.3.0). |
