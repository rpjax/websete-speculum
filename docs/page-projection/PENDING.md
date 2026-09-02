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

## P2.2 — `Sessions__*` env não sobrescreve SQLite persistido

| | |
|--|--|
| **O que é** | Variáveis `Sessions__*` no compose/dockup aplicam só no first-boot. Se a chave já existe no SQLite de configurações, o valor persistido ganha — o env **não** sobrescreve. Vale para qualquer chave de Sessions (não só `InputPathTelemetry`). Sintoma típico: dockup/compose muda o env e `GET /api/configurations/Sessions` continua no valor velho. |
| **Evidência** | **VERIFICADO** — comentário e contorno em `Speculum.Api.SessionsTest.Tests/SessionsTestFixture.cs` 28–30 (`EnsureBaselineAsync` → `EnsureSessionsInputPathTelemetryAsync`): *"compose env is first-boot only; SQLite volume may keep a prior false"*. O PUT do fixture é **contorno consciente** de teste, não o conserto de produto. |
| **Por que nesta posição** | Bug de configuração de produto (já mordeu dockup); não é escopo do carimbo P1/P2. Registrado aqui para não perder. |
| **Feito quando** | Regra de load documentada e implementada: env de deploy sobrescreve (ou merge explícito) o persistido para Sessions — ou decisão documentada de first-boot-only com procedimento de migração. Contorno de teste removido ou reduzido ao que o produto garantir. |
| **Marcação** | Existência do buraco + contorno no fixture: **VERIFICADO**. Conserto: **não feito** (proibido neste ciclo). |

---

## P3 — Dívidas do hot path de input (pequenas, conhecidas)

### 3.1 `intentToWire` manda `generation: 0` hardcoded

| | |
|--|--|
| **O que é** | Cliente Live serializa intent com `generation: 0` fixo. |
| **Evidência** | **VERIFICADO** `web/src/features/sessions/live/SessionMirrorSurface.tsx` 74–99 (`generation: 0`). Impacto em telemetria (não distinguir atual vs obsoleto): **NÃO VERIFICADO** como falha observada em produção; apenas o hardcode. |
| **Por que nesta posição** | Não mata input; telemetria / ordenação. |
| **Feito quando** | `generation` no wire reflete a generation da superfície projetada (ou decisão documentada de não enviar). |

### 3.2 `sidecar_admitted` / `dispatched` = enfileirado, não aplicado

| | |
|--|--|
| **O que é** | `pushInput` retorna `{ status: 'dispatched' }` imediatamente após `eventApplier.enqueue`, antes da validação/aplicação CDP. |
| **Evidência** | **VERIFICADO** `PageProjectionBrowserSession.ts` 955–956. Fase `sidecar_admitted` no bridge: **VERIFICADO** como símbolo em `sidecar/host/EventBridge.ts` ~470. Decisão rename vs manter contrato: **estado desconhecido — confirmar**. |
| **Por que nesta posição** | Contrato / semântica; já documentável. |
| **Feito quando** | Decisão registrada (renomear ou manter) e código/docs alinhados. |

---

## P4 — Fidelidade de layout

### 4.1 Página projetada ~880px mais curta (Eneba mobile 390×844)

| | |
|--|--|
| **O que é** | BODY scrollHeight 8420 → 7540 (−880). Sob `#app`: `MAIN.YGeqb0` 6991 → 6402 (−589), `FOOTER.xCd0YY` 1373 → 1082 (−291). `NAV.zyqj8m` altura 78 → 60 (−18). |
| **Evidência** | **VERIFICADO** por identidade de nó (diag 2026-09-02, branch `diag/scroll-axis-temp`; dumps em `sidecar/lab-scroll-identity-diag.txt` / `sidecar/lab-scroll-app-kids.txt`). Causa: **desconhecida — não investigada**. |
| **Por que nesta posição** | Aceite 1:1 / layout; separado de scroll-axis. |
| **Feito quando** | Subárvore(s) causadoras identificadas e altura Projected ≈ original no mesmo viewport (critério numérico documentado no accept). |

---

## P5 — PP-SCROLL-AXIS (parado; instrumento antes)

Tracker: [spec/open.md](spec/open.md) **PP-SCROLL-AXIS**.

### 5.1 Sintoma e o que já está estabelecido

| | |
|--|--|
| **O que é** | Swipe vertical iniciado sobre carrossel horizontal não rola a página (Eneba); no original a página rola. |
| **Evidência** | **VERIFICADO:** `NAV.zyqj8m` replicado com CSS de scroll idêntico (`overflowX/Y` auto/auto, `touchAction` auto, `overscrollBehavior` auto, sw×cw 2030×390, `sh == ch` ambos). **VERIFICADO:** toque chega e não é cancelado (`touchstart` `defaultPrevented=false`, `preventedMoves=0` em 10 moves) — hipótese `preventDefault` em `pointerdown` **REFUTADA**. **VERIFICADO (mesmo gesto A-carrossel):** `pointercancel` dispara; nenhum evento `scroll` no TEMP-DIAG (`sidecar/lab-scroll-ab-four.txt`). Causa da anomalia: **desconhecida**. |
| **Por que nesta posição** | Produto de scroll; depende de P5.2 antes de medir de novo. |
| **Feito quando** | Gesto vertical determinístico sobre o NAV no Projected produz scroll de página (como no original), com dump TEMP-DIAG / journal mostrando scroll no scroller de página — sem `pointercancel` espúrio, ou com causa do cancel documentada e aceita. |

### 5.2 Bloqueadores de instrumento (antes de qualquer nova rodada)

| | |
|--|--|
| **O que é** | (a) Harness mapeia coords do doc projetado → página do lab sem compensar offset do iframe — ponto projetado (195,171) → pageY −114. (b) Variante `?touchCapture=off` aborta com `frame detached` em `waitNav`. |
| **Evidência** | **VERIFICADO** dump A-comum + abort B em `sidecar/lab-scroll-ab-four.txt` / script `sidecar/scripts/lab-scroll-axis-ab-gestures.js`. |
| **Por que nesta posição** | Enquanto (a)(b) existem, medição nova nasce inválida (três rodadas já perdidas). |
| **Feito quando** | (a) pagePoint = iframeBox + projected − scroll, com assert pageY dentro do rect do iframe; (b) open Build B completa `waitNav` sem `frame detached`. |

### 5.3 Limpeza diag

| | |
|--|--|
| **O que é** | Branch `diag/scroll-axis-temp` e TEMP-DIAG são descartáveis. Build B (`?touchCapture=off`) **não é conserto** — o bloco `preventDefault`/`capturePointer` existe para capturar down/up com nodeId no sparse-cdp. |
| **Evidência** | Branch e gate: **VERIFICADO** no histórico `diag/scroll-axis-temp` / `projectedInputCapture.ts`. |
| **Por que nesta posição** | Após P5.2 / decisão de fechar ou arquivar o diag. |
| **Feito quando** | TEMP-DIAG e branch removidos ou arquivados; nota de “Build B ≠ fix” permanece neste PENDING ou em open.md. |

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
