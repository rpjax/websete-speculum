# PageProjection — open items (bugs, gaps, rulings)

**Status:** living tracker. Single place for a weaker agent to see what is **not** done.  
**Execution-ordered backlog (pending work):** [PENDING.md](../PENDING.md).  
**Do not** treat a missing row here as permission to invent a workaround. If you find a new defect, **append**.  
**Protocol OPEN-* source of truth** remains the table in [frame-protocol.md](frame-protocol.md) §10; this file copies it plus product/cutover items.

---

## How to use

| Kind | Meaning | Ship rule |
|------|---------|-----------|
| **BUG** | Implementation violates a sealed V4 rule | Must fix before production cutover if tagged **cutover-blocker** |
| **OPEN-n** | Design question in frame-protocol §10 | Do not implement a guess; ask |
| **RULING** | Human decision required (Rodrigo) | Do not pick in code |
| **RESIDUAL** | Docs/tests/budget leftover, not a protocol hole | Can trail cutover unless tagged blocker |
| **PINNED** | Deferred on purpose | Do not pull forward without a site that needs it |
| **ACCEPTED GAP** | Product boundary | Listed in [support-matrix.md](support-matrix.md) — not a bug |
| **SEAL gap** | Current emit/apply path is wrong or unsealed | [seal-gaps.md](seal-gaps.md) §2. Unimplemented opcodes/walks are **features** (§3), not gaps. Live cutover is the **destination** ([roadmap.md](roadmap.md)), not a row there |

---

## Bugs

**OPEN-8** is closed at the table. `takeRecords` before drain is closed. CLI `--iso` proves Virtual O2 + Node table×table; tree×tree needs lab UI DOM apply. **Production cutover is not licensed** by that — see [roadmap.md](roadmap.md) cutover law.

DOM-table path was green through seal lab. **PP-TABLE-SUBTREE-WALK** (recursive `collectSubtreeIds` SO under Binance) → iterative stack+visited **fixed 2026-08-28**; residual = find who corrupts derived links if cycle throw fires live. Stress-churn stacked digits = PP-FR-1 ([observability.md](observability.md) §8). Prepend `child_order` = green at seq 799 (`2026-08-15T00-32-28`). Lab tracker (QA → gaps → features): [seal-gaps.md](seal-gaps.md) — not table OPEN-*. Apply honesty P0 is closed (UI desync attr/ruleset/eof 2026-08-17). SVG namespace **closed 2026-08-17**. Form `PROP_SET` **closed 2026-08-18**. Open named shadow **closed 2026-08-18**. Same-origin nested iframe **lab shipped 2026-08-19** (`iframe-open`). **OPEN-6 observability shipped 2026-08-19**. CSSOM in nested contexts = **same algorithm instance** (not a separate feature). Remaining OPEN-6: XO / srcdoc / sandbox / fenced (NIT). Optional QA: nested `cssomO2` assert — [seal-gaps.md](seal-gaps.md) `SEAL-CSSOM-P2-NESTED-QA`.

### BUG — locale popup / `_blank` skips CSP surgery (**CLOSED 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-CSP-SINGLE-TAB** | After clicking a locale/OAuth-style popup (`target=_blank` / `window.open`), `input_reject … data plane not open`; console: `ws://127.0.0.1` violates `connect-src`. | **Session law:** one tab only — open/_blank → same-tab redirect; orphan page closed immediately. Fix: `session/singleTab.ts` + CSP hook hardening. Fixture `csp-nav-locale-*.html` · lab blueprint `csp-nav-locale` · unit `runSingleTabLocaleCspPlaneUnitTests`. |

### BUG — huge Document + meta-only CSP blocks loopback (**CLOSED 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-CSP-META-HUGE** | Binance-class live: `ws://127.0.0.1` violates strict `connect-src`; `data plane not open` on cold load or post-nav. HTML huge; CSP enforcing only via `<meta http-equiv>` when `Fetch.getResponseBody` fails. | Fix: `cspMetaNeutralizeInitScript.ts` (drop meta CSP before parse) + `continueWithHeaders` no silent fallback · unit `runMetaOnlyHugeCspPlaneUnitTests` · diag `diag-csp-huge-nav.js` (`meta-only`). Related: **PP-CSP-SINGLE-TAB** (popup path). **Residual plane desync** → **PP-LOOPBACK-ESTABLISH** (not CSP). |

### BUG — loopback via extension plane / LNA on page WS (**CLOSED 2026-08-28**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-EXTENSION-PLANE** | Binance-class: page `ws://127.0.0.1` blocked by LNA/CSP → `data plane not established`. | **Closed:** product path = `loopbackCarrier: 'extension'` only ([extension-plane.md](extension-plane.md) EP-15). Units: envelope / bridge / perf smoke / loopbackDataPlane / chromeLnaPolicy. Lab dossiers Superbet + Eneba + assets-matrix: **zero** `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` in Virtual `telemetry/console.ndjson` while frames/assets live (bilateral establish). `input-iframe-click` usable under same carrier. |

### BUG — recursive subtree walk stack overflow (**CLOSED 2026-08-28**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-TABLE-SUBTREE-WALK** | Binance stress after plane establish: Node `RangeError: Maximum call stack size exceeded` in `ReplicatedTable.collectSubtreeIds` (rewrite hop / table apply). | **Fix:** iterative DFS (`walkStack` + `walkVisited`); revisit → `ReplicatedTable: subtree walk cycle`. Units: deep 15k chain; lastChild cycle; shadow→host cycle. Residual: who corrupts `lastChildOf`/shadow links if cycle fires live. |

### BUG — loopback establishment / ghost socket (**CLOSED 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-LOOPBACK-ESTABLISH** | `input_reject … data plane not open` while Virtual reports WS open; sidecar `isOpen=false`; attach churn after nav. | **Fix:** [loopback.md](loopback.md) LB-08…19 — handshake `hello`/`hello-ack`, symmetric `establishConnection`/`waitEstablished`, canonical socket, `detach(true)`. Units: `nodeDataPlane.unit.ts`, `runDataPlaneNavChurnUnitTests`, `chromeLnaPolicy.unit.ts`. LNA policy-only (`["*"]`). |

### BUG — loopback `document.install` / same-socket generation (**CLOSED 2026-08-30**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-LOOPBACK-DOC-INSTALL** | After Turnstile → Eneba redirect: `input_reject … data plane not established`; Projected stuck on CF while Virtual on real page. | **Fix:** `nodeDataPlane.ts` — same socket: higher `hello.generation` → adopt + ack; equal gen → idempotent; lower gen → `hello-reject`. `PageProjectionBrowserSession` chains `waitEstablished({ afterGeneration: prior })` after `document.install`. Units: `testSameSocketGenerationSupersedes`, etc. Dossier class: Eneba Turnstile lab 2026-08-29. |

### BUG — Projected cold-resync apply overrun / self-inflicted `sequence_gap` (**CLOSED 2026-08-30**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-APPLY-GATE-OVERRUN** | After `/br/` cold resync on armed surface: burst `sequence_gap` at gen=7 — frames seq 2+ arrive while `recreateForGenerationAsync` awaits `surface.reset()` with stale `lastSequence=0`; not wire loss. | **Fix:** `ProjectedApplyGate` — queue during async flight; cap **256** (Beleza-class); `discardPending()` on gen bump; overflow streak **3** → `apply_gate_overflow_loop`. **Lag catch-up:** evaluate `highestSeen > lastSequence` only **after** `finishFlight` drain (not in `commitResyncSwap`) — wholesale `reason=lag` only if still behind. Nested parity. Unit: `projectedApplyGate.unit.ts` + `lagCatchUpOrder.unit.ts`. |

### BUG — virtual assets / third-party framed identity (PINNED 2026-08-25)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-ASSET-XFO** | Lab console: `Refused to display 'https://id.unico.io/'` / `idpay.unico.io` — `X-Frame-Options: sameorigin` + `403` | Projected nested browsing contexts that point at Unico (and similar IDP/pay iframes) cannot load in a frame under Speculum’s origin. Not an asset-byte bug — **XO / third-party frame policy**. Treat with OPEN-6 XO work later; do **not** punch `X-Frame-Options` as a workaround. Observed Superbet lab 2026-08-25. |

Virtual-assets V1 path (rewrite + L1 + stamp + Lab/Live serve) is **proven** 2026-08-28 — `lab-assets-stress.js` 4/4 (assets-matrix, demo, Superbet, Eneba; desync 0; fixture 9 virtual attrs). This row remains the Unico/XFO pin only.

### BUG — Gecko geolocation is chrome prompt, not client RPC (OPEN 2026-09-15)

| Id | Symptom | Notes |
|----|---------|-------|
| **GECKO-GEO-RPC** | Lab Betano: native `permission` dialog on `127.0.0.1:4077` (OK/Cancelar). Site asks geolocation; Projected chrome answers, Gecko does not get the **user’s** position. | Designed path: client RPC (`PermissionRequested` / `PermissionRespond`) + relay coords into Gecko so Virtual geolocation **emulates the consumer**. Do **not** auto-ok in C++. Marionette already asks; last hop is client decision + position. Observed 2026-09-15 `demo.betano.bet.br`. Not 1.1 — V1. |

### BUG — Beleza na Web does not surface in Gecko lab (OPEN 2026-09-15)

| Id | Symptom | Notes |
|----|---------|-------|
| **GECKO-BELEZA-COLD** | Lab Start Virtual on `https://www.belezanaweb.com.br/` — surface unusable. | **Fixed 2026-09-16.** (1) Cold LoadURI abort → RetryLoadURIAfterAbort. (2) Resync malformed: skip Gecko `svg:use` impl-shadow + top-level `::-moz-*` (Projected=Chromium; design NIT in shadow.md). (3) sequence_gap: claim `lastSequence` on enqueue; soft gap; **lag catch-up pós-drain** (gate first; wholesale `lag` only if still behind); gate cap 256. (4) **INSERT id missing:** `onInserted` reserved id before `NODE_NEW`; `describeAndInsertChildren` treated identity hit as indexed (§5.5). Fix: describe when table row missing; `linkAfter` no stub rows. Unit: `producer_lifecycle` pai+filho mesmo tick; `lagCatchUpOrder.unit.ts`. **Prova:** capture pós-fix 73 frames → table apply OK (19403 rows) + `projected-replay` applyOk=73 desynced=false armed bodyLen≈1.3M. **Residual:** cold lag storm (pre-drain) closed 2026-09-16 — re-prove Beleza HUD `reason=lag` bounded; accept 1:1 still separate. |
| **GECKO-CSSOM-STYLE-DOUBLE** | Author `<style>` rules emitted on CSSOM plane **and** painted via projected DOM → dual cascade. | **Fixed 2026-09-16.** `SpeculumIsCssomPlaneSheet` skips `ownerNode` HTMLStyleElement; `<link>` + constructed stay on CSSOM (doc 13 — client does not fetch CSS). Sheet 6→1 / Rule 4915→4656 on Beleza same-S. |
| **GECKO-ASSET-SVG-MIME** | Projected logo/SVG `complete && naturalWidth=0` → alt text blows header (~344px), overlaps. | **Residual OPEN 2026-09-16 (cold ainda falha).** Mitigações na raiz do tee/MIME: wait complete; NoteMime; sniff se mime vazio/**genérico**/não-`image/*`; deny `empty-image`; retry se tee `failed`; SW `Cache-Control: no-store` + 502 se corpo não cheira a imagem. **Prova same-S iso (Beleza cold):** DOM filtrada PASS; CSSOM contagem PASS; logo ainda `nw=0` / header **344** / `brokenImgs≈68`. Diagnóstico: `fetch`+blob no iframe decodificam 120×51; `?cachebust` no mesmo `<img>` recupera — primeiro response da URL original gruda decode falho. **Não** marcar Fixed até cold estável (logo nw>0, header&lt;120, brokenImgs=0) sem cache-bust. Accept 1:1 **não**. |

### BUG — Gecko click hit-tests root; keys go to `<html>` (**click proven 2026-09-17**)

| Id | Symptom | Notes |
|----|---------|-------|
| **GECKO-INPUT-NODE-TARGET** | Eneba: cookie/header/`<a>` near the top work; store cards, `Ver ofertas`, sidebar rows do not. Client sends `down/up` (`nodeId` set). Virtual often does not navigate. | **Cause:** `SpeculumInput` click used `PresShell::HandleEvent` on the **root frame** (coordinate hit-test). Protocol is `nodeId` + local% ([input.md](input.md)). **Fix:** click → `HandleEventWithTarget` on the named element’s primary frame (local% in that box). Key → focused element in this document + `keypress` on character/Enter. **Lab 2026-09-17 session `446ff61c8fab` after mach:** store card Zomboid navigated; `Ver ofertas` opened 16 ofertas; `Comprar agora` → checkout cart. DESYNC 0 through that path. **Residual:** typing in search/email does not insert (`value` stays `""`); not marked done for keyboard. |

### BUG — nested COMPLETE before host bound (OPEN 2026-09-17)

| Id | Symptom | Notes |
|----|---------|-------|
| **GECKO-NESTED-HOST-BIND** | After using Eneba (checkout email click/type): `desync precondition pending nested frames ctx25 host node 14143 never bound (1 queued)` → `resync requested reason=precondition`. HUD DESYNC 1. This is the “usei o site e os cliques morreram” class: nested iframe (payment/captcha/ads) emits while the host node is not bound on Projected. | **C++ emit-allow wired.** Chrome `SendSpeculumNestedEmitAllow` after parent frame on the socket; child `C≥2` mute until that IPDL (per-context). Lab 2026-09-17 `086560142b48`: gate live (`bootstrap held` / `standby` / `allow sent` ctx 2–22); checkout email visível. Residual: still `never bound ctx20 host 7031` → root desync — host was marked (NODE_NEW on the wire) but `installNestedHost` did not bind; audit still kills root. That is Projected establish/audit, not child COMPLETE before the host frame. Do not paper over by dropping nested frames. |

### BUG — Eneba in-site navigation (OPEN 2026-09-15)

| Id | Symptom | Notes |
|----|---------|-------|
| **GECKO-ENEBA-NAV** | Opening Eneba is not enough: **navigating inside** the site breaks the surface. Lab chrome (“Projected surface empty”, connect/browse instructions) leaks into the store page. Console: same nested `projected blank` 5000ms class; CSP inline noise; `static.eneba.games` CSS `403` `speculum-denied` (asset path — separate). | Observed 2026-09-15 after in-site nav. Shares nested-host establish failure class with BELEZA until proven otherwise; gen-bump resync may also need apply-gate (Chromium Eneba dossier). Do not treat DESYNC 0 / APPLY+ as accept. Residual after 2026-09-17: see **GECKO-INPUT-NODE-TARGET** (click/key apply). Nested unarmed empty iframes (ctx 2/18) still open. |

### BUG — Gecko producer port: entrega, época, tick (OPEN 2026-09-16)

Auditoria do produtor C++ contra o produtor TS fechado. Mesmo algoritmo, sensor nativo — não se porta o JS. Redesenho: [21-fluxo-de-entrega-e-epoca.md](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) (aguarda ruling). Não consertar mais nada no cliente para compensar estas linhas.

| Id | Symptom | Notes |
|----|---------|-------|
| **GECKO-SEQ-BUILD-NOT-DELIVERY** | `sequence` avança no build (`Producer.h:394`), não na entrega. Frame descartado depois disso deixa buraco permanente → `sequence_gap` auto-infligido. | TS avança só quando o transporte aceitou todas as partes (`frameEmitter.ts:294`) e não constrói enquanto há parte pendente (`:160`). Raiz das cascatas de resync. |
| **GECKO-NO-DELIVERY-CREDIT** | Nenhum freio entre produtor e ponte. `appliedSequence` / `ack` / `backpressure` / `queueDepth`: zero ocorrência no fork. | TS freava no watermark do loopback (`deferred`). Sem isso o produtor inunda e o cliente vira `reason=lag` — compensado hoje por `ProjectedApplyGate` + lag catch-up, que é compensação, não conserto. |
| **GECKO-FRAME-SILENT-DROP** | Três descartes mudos: `fd < 0` (`SpeculumProjectionRuntime.cpp:1929`), falha de `SendEnvelope` (`:1933`), frame curto com `fprintf` + `IPC_OK()` (`ContentParent.cpp:1283`). | Perda de fio sem `errorCode`/`phase`/evento — proibido por [diagnostics.md](../../diagnostics.md). Ponte caiu = sessão morre (L10); seguir viva perdendo frame é o defeito. |
| **GECKO-EPOCH-PARENT-STAMP** | Produtor nasce `generation = 0` e nunca atualiza (`Producer.h:61`); o pai remenda bytes no offset 8 (`StampGenerationLocked`, `:1902`) a partir de `docToken` que é `static` **por processo de conteúdo** (`SpeculumNodeSource.cpp:70`). | Viola `frame-protocol.md` §2 ("The producing context writes it… never derived or packed") e L9. Troca de processo reinicia o token ⇒ pode não bumpar época ("a página nova chega como continuação da anterior", comentário `:1900`). Dump de snapshot reporta gen 0 contra fio ≠ 0 ⇒ oráculo same-S compara coisas diferentes. **Colisão no Beleza é hipótese; a forma do defeito é código.** |
| **GECKO-PRODUCER-LIMITS-ABSENT** | `MAX_OPS_PER_FRAME` / `MAX_CHILDREN_PER_OP` / `MAX_STR_BYTES` / `MAX_ROWS` não existem no produtor; só o cliente aplica. Sem divisão de partes: `partIndex`/`partCount` no header nunca recebem valor ≠ 0/1. | §8 manda checar **antes de qualquer alocação**. Efeito medido: `captures/battery-20260914-155314.txt` — `MAX_ROWS (200000) exceeded` recusando frame após frame. |
| **GECKO-TICK-NO-COALESCE** | Um `ATTR_SET`/`TEXT_SET` por callback (`Producer.h:228`, `:246`), sem dedup por `(nó, nome)` e sem pular `!isConnected` na emissão. | Fura L24 para atributo/texto (cadáver do tick viaja) e multiplica volume, alimentando o item acima. Doc 20 §2.2 já manda drenar no `emitFrame`. |
| **GECKO-BRIDGE-HOLB** | Frame, controle, ativo e telemetria num `fd` + um mutex com `send()` bloqueante (`WriteAll`). | Controle/resync enfileira atrás de escrita de frame grande; doc 12 pediu ponte sem HOLB. Prioridade menor que os itens acima. |
| **GECKO-INSERT-DUPLICADO** | Sem o `visited` por tick do §5.3, pai e filho inseridos no mesmo tick geram **dois** `INSERT` do filho: um em `describeAndInsertChildren` (`Producer.h:827`), outro no drain do registro próprio (`Producer.h:507`). | `insertBatch` trata id já ligado como move (`Table.h:231`), então não quebra `CHECK` — dobra ops, agita `unlink` (que tem OPEN-8, `Table.h:356`) e faz o Projected re-materializar. **Não aparece como desync**; é candidato a árvore errada com protocolo verde. §5.3 é correção, não otimização. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §11 P6. |
| **GECKO-INSERT-NAO-LOTEADO** | Uma op `INSERT` por nó e uma varredura de `childrenOf` por nó no drain (`Producer.h:507`, `beforeIdOf` `:413`); `ContentAppended` enfileira por nó (`SpeculumMutationObserver.cpp:462`). | É o O(batch²) que o TS achou com `prepend-stress.html`, mediu em **34% do CPU do produtor** com lote de 1600 e consertou em 2026-08-13 (`tableFrameBuilder.ts:338-342`). O port voltou para a versão descartada. Lote existe em `describeAndInsertChildren`/`insertLiveChildren` — falta no caminho incremental. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §11 P7. |
| **GECKO-FORMPROPS-VARREDURA** | `drainFormProps` copia `ids_.allIds()` e varre o espaço inteiro de ids a cada tick de 16 ms (`Producer.h:583`). | TS mantinha `formIndex` (`tableFrameBuilder.ts:401`). Doc 20 §2.7 pede amostrar os **controles**, não a tabela. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §11 P8. |
| **GECKO-CSSOM-POLL-NO-DRAIN** | `drainCssom` descarta `pendingSheets_`/`pendingRules_` e re-itera todas as folhas × todas as regras por tick, com vetores por valor (`Producer.h:554`, `SpeculumNodeSource.cpp:517`). | Poll disfarçado de drain — "poll CSSOM no Gecko" está nos anti-padrões do doc 20 §5; §2.4 manda drenar a fila. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §11 P9a. |
| **GECKO-CSSOM-CALLSITE-AUSENTE** | **CORRIGIDO 2026-09-16.** `SpeculumCssom.cpp` compilava no checkout (`moz.build` lista) e **nenhuma** das cinco funções tinha call site: as chamadas em `Document.cpp` existiam só no espelho do repo. Binário sem call site ⇒ CSSOM vivo emitia zero op. | Violação do done bar em produção, não no papel: código na árvore, último hop morto. Espelho **à frente** do checkout inverte o fluxo documentado (`devpath/README.md` regra 1). Conserto: `_apply-cssom-hooks-to-checkout.py` (6 linhas + nomear `aRule` em `Document::RuleChanged`). Medido depois: `sheetNew` 0 → 2. |
| **GECKO-CSSOM-DRAIN-SO-VE-mSheets** | **CORRIGIDO 2026-09-16.** `NoteRule` não registrava a folha em `mSheets`, e `drainCssom` só varre `mSheets` ⇒ regra de folha construída/adotada era enfileirada, ignorada no drain e tinha o id **solto**. Folha adotada não passa por `Document::InsertSheetAt`, único chamador de `NoteSheet`. | Prova do conserto (`captures/cssom-late-1789610575*`): `insertRule` pós-load em folha construída passou de **0** para **20 regras no fio**, `rules=21` na tabela, e a superfície projetada pinta o marcador azul. Corolário: o drain re-derivar do mundo em vez de drenar a fila é **correção**, não só custo — reforça §11 P9a. |
| **GECKO-CSSOM-LIVE-MORTO** | **Medido no lab frio (2026-09-16); duas causas achadas, duas corrigidas, uma parte segue aberta (folha por parse — ver `GECKO-CSSOM-FOLHA-TARDIA`).** Antes do conserto: nenhuma mudança de CSSOM depois do bootstrap produzia op. Folha presente antes do bootstrap → 40 regras `CTRLMARK` + 40 `HTTPMARK` no fio, `sheets=2 rules=42` na tabela, superfície 1:1. Mesma folha injetada depois do `load` → **0 ops**, `sheets=0 rules=0`. Folha construída + `insertRule` também some, e ela só tem esse caminho. | Contraria o aceite: `acceptance.md` promete CSSOM live percebido 1:1 eventual; medido, live é **ausente** — só bootstrap/resync carregam CSSOM. Ganchos existem e chamam certo (`SpeculumMutationObserver.cpp:180`), mas a notificação não chega ao produtor (`mSheets` vazio) ⇒ `Document::InsertSheetAt`/`RuleAdded` não são os caminhos que a mutação viva toma. Gancho no lugar errado. Evidência: `captures/cssom-late-1789609558751/`, `captures/cssom-late-1789609728077/`. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §11 P9b. |
| **GECKO-CSSOM-FOLHA-TARDIA** | **ABERTO, medido.** Depois dos dois consertos acima, `<link>` injetado pós-`load` emite `SHEET_NEW` e **zero** `RULE_NEW`: as regras nascem de *parse*, e parse não tem notificação por regra. Vale para `data:text/css` e para http (`captures/cssom-late-1789610575*`: `sheetNew=3`, `DATAMARK=0`, `HTTPMARK=0`, marcador http cinza na superfície). Não existe gancho de "folha ficou aplicável". `SpeculumNotifySheetAdded` sai no `InsertSheetAt` (`Document.cpp:7921`), antes do fetch do `<link>`; regras só entram por `CaptureLiveCssom` (bootstrap/resync). `Document::StyleSheetApplicableStateChanged` (`:7928`) não tem gancho. | Folha externa inserida **depois** do bootstrap chega como `SHEET_NEW` vazio e as regras nunca viajam. Não existe no sidecar, onde `<link>` pinta pelo DOM projetado (`cssomSheetList.ts:3`); no fork o CSS não é servido (doc 13 §32), então a réplica é o único caminho. **Candidato direto ao "visual fodido".** [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §11 P9b. |
| **GECKO-CSSOM-IMPORT** | `CaptureLiveCssom` caminha `SheetCount()` + `AdoptedStyleSheets()` (`SpeculumNodeSource.cpp:375`); folha filha de `@import` está em `ChildSheets()` e nunca é lida. | Texto da regra viaja como `@import url(...)` e o cliente não busca CSS (doc 13) ⇒ CSS importado não chega por caminho nenhum. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §11 P9c. |
| **GECKO-TICK-SPLIT** | Callback processa `REMOVE`/`ATTR`/`TEXT` na hora (`Producer.h:222`, `:228`, `:246`); `INSERT`/`DROP` vão pra fila. O original: callback só empilha, drain decide contra o DOM vivo (`frame-protocol.md` §5.2–§5.6). | O corte não existe no algoritmo. P4, P6 e o move são o mesmo furo. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §12 P10. |
| **GECKO-MOVE-REMOVE** | Remove+reinsere no mesmo tick emite `REMOVE`+`INSERT`. O papel pede **um** `INSERT` (§5.6). TS: `emitDeferredRemoves` pula se `isConnected`. C++: `onRemoved` já emite (`Producer.h:222`); o comentário na linha seguinte só defere o DROP. | Carrossel/vitrine/keyed list. Não aparece necessariamente como `precondition` — o cliente aplica os dois. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §12 P10. |
| **GECKO-MINT-HELD-AUSENTE** | Nested host sem `C` ≥ 2: TS `mintHeld` → não emite o frame. | **Pai:** `emitFrame` já faz `if (hasMintHold()) return {}`. **Filho** emitia COMPLETE sozinho — ver **GECKO-NESTED-HOST-BIND**. Resync nested sem allow é no-op. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §12 P10. |
| **GECKO-DROP-MESMO-TICK** | `flushPendingDrops` faz `NODE_DROP` no fim do mesmo tick se a linha ainda está solta (`Producer.h:654`). TS espera `NODE_DROP_AGE_SEQUENCES` (20). `collectDroppableIds` existe em `Table.h` e o Producer nunca chama. | Ressuscitar no tick seguinte não reusa o id. OPEN-2. Encaixa no ruling 2 (GC sob `MAX_ROWS`). [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §12 P11. |
| **GECKO-ATTACHSHADOW-SEM-GANCHO** | `attachShadow` depois do insert não é `childList`. TS lê `.shadowRoot` nos vivos (`discoverShadowRoots`). C++ só olha no describe/insert (`Producer.h:631`); **não** há gancho em `Element::AttachShadow`. | Equivalente nativo do poll, não o poll. Shadow criado tarde some. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §12 P12. |
| **GECKO-SHADOW-INITFLAGS-ZERO** | `NODE_NEW SHADOW_ROOT` sempre `initFlags=0` (`Producer.h:774`). TS lê `delegatesFocus`/`clonable`/`serializable` (entra no `rowHash`). | `attachShadow` projetado sem as flags; hash diverge. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §12 P13. |
| **GECKO-CSSOM-PIERCE-HOST-ZERO** | `emitSheetNew` manda `host=0, scope=0` (`Producer.h:600`). TS manda `PIERCE_HOST` + id do host (`cssomOps.ts:47`). | Folha adopted de shadow materializa no documento. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §12 P14. |
| **GECKO-RESYNC-SEM-PROP** | `emitResyncFrame` C++: DOM + CSSOM, sem amostrar form (`Producer.h:102`). TS: `formIndex.sample` (`resync.ts:60`). | Checkbox/`value` voltam ao default no resync. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §12 P15. |
| **GECKO-INSERT-AT-END-SUBTREE** | `describeAndInsertChildren` / `insertLiveChildren` sempre `kInsertAtEnd` (`Producer.h:803`). Âncora só no insert de topo. | Bloco novo no meio da lista sai no fim. Fecha com P7 se a âncora for a do vivo. [21](../../gecko-engine/21-fluxo-de-entrega-e-epoca.md) §12 P16. |

### BUG — Gecko lab viewport resize (OPEN 2026-09-15)

| Id | Symptom | Notes |
|----|---------|-------|
| **GECKO-VIEWPORT-RESIZE** | Resizing the lab/Projected surface does not update Virtual geometry. Layout / hit-test drift. | Designed: `client.resize` → `ViewportSet` → `HeadlessWidget` / BC size ([20](../../gecko-engine/20-projecao-completa.md) §2.15). ABI and L3 journal exist; last hop live on the lab surface does not. Zoom on the client remains forbidden. Observed 2026-09-15. |

### BUG — Virtual console not relayed to client DevTools (OPEN 2026-09-15)

| Id | Symptom | Notes |
|----|---------|-------|
| **GECKO-CONSOLE-RELAY** | Page `console.*` from Virtual Gecko does not show in the user’s/lab client console. Old Chromium-lab feature; well-defined; dropped on the Gecko path. | Designed: Virtual console → Kind `0x05` / session events → client `console`. Not a new invention. Wire last hop; do not scrape CDP `page.evaluate`. Observed 2026-09-15. |

### LAB — B5c iso oracle false red (OPEN 2026-08-31)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-ISO-ORACLE-B5C** | Tree oracle **fixed at root** (2026-08-31): dossier `2026-08-31T18-09-26-437Z-eneba-turnstile` — `iso.tree` **identical**; `nestedContext` correctly fails on stale index vs `liveIframes=0`. **Still open:** widget absent; `iso.table` hash≠ with rows 93=93 (digest bytes, not tree). Root fixes: `structuralDiff.ts` post-align shell + `peelVirtualAssetPath`; `turnstileDiagnostic.ts` atomic halt + `buildIsomorphismFromCaptures`. **No classification** (gate open; not ambiente). See [LIVE-PP-0.3.0-IMPLEMENTATION.md](../LIVE-PP-0.3.0-IMPLEMENTATION.md) §B5c. |

### BUG — hard-nav hello-ack / Port race after extension carrier (OPEN 2026-08-29)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-HARDNAV-PLANE-ACK** | After in-page hard nav (link / `location.replace` / 202→200), Node adopts new `generation` but Virtual stays on `producer_booting` / no hello-ack through the extension Port; units log the race and still assert gen bump + cold carrier. | Cutover delivered C2 + MAIN content script; socket still opens per document. Closing this = finish SW-owned loopback across nav ([runtime-redesign.md](runtime-redesign.md) §5). Softened: `runMetaOnlyHugeCspPlaneUnitTests` / `runDataPlaneNavChurnUnitTests`. |

### BUG — swipe vertical over horizontal scroller does not page-scroll (**CLOSED 2026-09-02**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-SCROLL-AXIS** | Swipe vertical starting on a horizontal carousel (Eneba `NAV.zyqj8m`) did not page-scroll on Projected. | **Cause:** `projectedNativeGuard` `preventDefault` on cancelable `touchstart` when target ∈ `a[href]` cancelled Chrome native pan. **Fix:** suppress navigable activation on `touchend` instead; `touchstart` metrics-only. Lab `FIXED` — `sidecar/lab-runs/2026-09-02T23-11-38-017Z-input-touch-scroll-axis/probes/touch-scroll-axis.json`. PENDING P5 resolved. |

### BUG — inject dual-boot / isolate lateBoot (**CLOSED 2026-08-28**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-INJECT-BOOT-DUAL** | (was) lateBoot probed Patchright isolate → always “empty” while main already booting → redundant evaluate / dual-producer risk | **Fixed + SEALED:** main-world probe/inject; inject arm IIFE; lateBoot miss-detect with fail-closed + per-doc token. [browser-session.md](browser-session.md) · decision-log 2026-08-28. |

### BUG — injected `virtual.js` on third-party origin (**CLOSED 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-INJECT-THIRD-PARTY-MIME** | (was) third-party `*/__speculum/virtual.js` MIME/CSP console noise | **Fixed:** was CDP-only inject; **superseded 2026-08-29** by extension MAIN content script (`speculum-pp`). Document hook CSP-only. |

### BUG — Projected nested load-after-drop census ghost (**CLOSED 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-INPUT-NESTED-DROP-LOAD** | After iframe churn, click dead; S6 census includes orphan `contextId`; Phase A ~2s timeout or ABS never fires | `dropNestedHost` cleared `nestedHostAwaitingLoad` but left the `load` listener → late bind → ghost in `ProjectedInputRuntime`. **Fix:** `cancelPendingNestedHost` (flag + `removeEventListener`) + drop pending frames. [multi-document.md](multi-document.md) §4.1 · [input.md](input.md) §4. Repro: `diag-click-ghost-context.js`. **Not** the same as Virtual mint-without-dropHost (wire ghosts in census `[1,N]`). |

### BUG — Virtual mint-without-drop census hang (**CLOSED-BY-DELETION 2026-08-27**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-INPUT-VIRTUAL-MINT-GHOST** | (was) Real site clicks die via `apply_scroll_failed:invoke idle timeout` on OS census path. | **Closed by deletion** (OS census) + **live deliverable index 2026-08-27:** `isDeliverableDestination` is now child-scope live (`windowOf`), not `hasMinted`. Carrier routes O(1) via index — no DOM `querySelectorAll` / hopeful broadcast. |

### BUG — nested iframe lab click oracle (`input-iframe-click`) (**CLOSED 2026-08-28**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-INPUT-IFRAME-CLICK-NESTED** | (was) Lab blueprint `input-iframe-click` (`contextId=2`, `#inner-click`) → `keyOfSelector` **`node_unmapped`**. | **Fix:** nested contexts `await waitDocumentSeedReady(document)` before cold `rebuildAndResync` (`packages/page-projection` `virtual/bootstrap.ts`) — seed during `loading` walked a partial tree; MO then dropped childList under unmapped parents. **Proof:** Docker blueprint PASS (`click:#inner-click` + `assert-inner`); dossier `lab-runs/input-iframe-click-close2/…`. |

**Lab (2026-08-15 / 2026-08-16):** CSSOM poll **algorithm** — [cssom-poll-algorithm.md](cssom-poll-algorithm.md).
**Accept:** DOM numerical 1:1; CSSOM live perceived ([acceptance.md](acceptance.md)).
Why: [cssom-sensor-journey.md](cssom-sensor-journey.md). `SHEET_*`/`RULE_*` are on the wire (phase 1
table). **C6 lab apply is shipped** for constructed sheets on `adoptedStyleSheets` + `CSSStyleRule`
(`client/applyDom.ts`). Child-document CSSOM is OPEN-6 — [multi-document.md](multi-document.md). Conditional CSSOM seal ≠ production cutover —
kill list: [seal-gaps.md](seal-gaps.md). Telemetry `cssomPoll` sealed for the foundation —
[observability.md](observability.md) §9 (idle + resync + snapshot scan). **No** CDP CSS domain. **C5 = poll**
(canonical 2026-08-18). Nested inners ride grouping `cssText` (own-row walk = later opt). C6 apply telemetry is **not** the foundation cut.

---

## Protocol OPEN-* ([frame-protocol.md](frame-protocol.md) §10)

| # | Question | Status |
|---|----------|--------|
| **OPEN-1** | `NODE_DROP` of an absent id: `malformed` vs tolerated? | **CLOSED 2026-08-17 — `malformed`.** Unit `testApplyFrameToTableCheckedRejectsNodeDropAbsentId`. |
| **OPEN-2** | Detached-row lifetime | **CLOSED 2026-08-17** — end-of-tick move/detach, deferred `lms`-age GC (`NODE_DROP_AGE_SEQUENCES` = 20), no per-row versioning. |
| **OPEN-3** | `CHECK.scope` granularity | **CLOSED 2026-08-17** — id ranges (§4.1). Units: `testApplyFrameToTableCheckedRangeScope`, `testCheckScopeRangeEncodeDecode`. |
| **OPEN-4** | Establish HTML vs table | **CLOSED — moot.** Establish deleted (§4.7). |
| **OPEN-5** | Recovery / mid-session attach | **CLOSED — §5.8.** Residuals below. |
| **OPEN-6** | Multi-document | **Lab same-origin iframe + observability shipped 2026-08-19** — [multi-document.md](multi-document.md). XO / `srcdoc` / sandbox / fenced NIT. Child-doc CSSOM feature open. **Production not cutover.** |
| **OPEN-7** | `insertBatch` reverse-link | **CLOSED** — `nextSiblingOf.set(prev, before)` on insert-before-existing; unit falsifier in `unit.ts`. |
| **OPEN-8** | `unlink` last-child leaves `nextSiblingOf[prev]` | **CLOSED 2026-08-14** — tail REMOVE after prepend; see frame-protocol §10. |

---

## Rulings (do not decide in code)

| Id | Topic | Why it blocks | Notes |
|----|-------|---------------|-------|
| **CUTOVER-FULL** | Production cutover completeness | Live switch when V4 is the **only** path with **CSSOM + shadow + OPEN-6 + OS unified input + canvas** on Live — then Integration. Nested CSSOM is not a second algorithm. DOM-only lab is not M1. Input hot path = EventApplier + registered v0 adapter (`os-abs`) ([input.md](input.md)); Mode A/B CDP purged 2026-08-26. | [roadmap.md](roadmap.md) |
| **CUTOVER-SESSION** | Session sealed mirror contracts on Live | **DONE (shape 2026-08-21)** — `PageProjectionBrowserSession` + sealed factory; product gaps remain (antibot/assets/…). | [browser-session.md](browser-session.md); [roadmap.md](roadmap.md) gate 6.6 |
| **E-03 / E-08** | Loopback WS data plane (canonical) | **REVISED 2026-08-26 — loopback WS is the sole Virtual↔sidecar carrier** (lab and Live). CDP `exposeBinding` data plane **purged**. Surgical Document CSP Response-stage surgery remains normative for Virtual `connect-src`/nonce — see [csp.md](csp.md). **Still rejected:** blunt CSP/`connect-src *` / disable-PNA *punch* as an antibot-visible enablement hack. **Inject boot (SEALED 2026-08-28):** CDP-only unified bundle via `ProjectionRuntimeInstaller`; main-world; lateBoot miss-detect. | [csp.md](csp.md) · [browser-session.md](browser-session.md) · [roadmap.md](roadmap.md) gate 8 |
| **Contracts pack fate** | Archive vs delete historical `contracts/` + `implementation/` | Already moved to `archive/`. Confirm deletion vs keep-for-provenance. | Default this pass: **keep in archive**, never implement from. |

---

## Residuals (docs / tests / budgets)

| # | Item | Blocker? |
|---|------|----------|
| 1 | Pre-V4 prose in adjacent layer files. **[input.md](input.md)** — OS unified hot path banner; historical CDP body not for implement. **[cssom.md](cssom.md) still pending** — "establish/install" CSSOM vocabulary needs a careful separate pass (sheet-snapshot semantics). | No — agents follow banners |
| 2 | [test-matrix.md](test-matrix.md) `PP-EST-*` / `PP-REC-2/3` / some `PP-FR-*` still named for childList/establish — **re-authored in place as V4 intent** this pass; WP exit table still historical | Prefer before MotorAssert live-path coverage |
| 3 | Synchronous-walk latency budget at `MAX_ROWS` for `resyncVirtual` (not `emitResyncFrame`) | Before relying on walk-based rebuild in production at huge tables |
| 4 | `contracts/07-recovery.md` full rewrite | **Dropped** — file archived; §5.8 is the spec |
| 5 | Bounded resync retry on **production** session layer with catalogued `errorCode`+`phase` | Lab root + nested Projected clients have 3-attempt backoff + `resyncFailed{exhausted}`. Production: **`requestResync({ contextId?, reason? })`** → producer `emitResyncFrame` → client awaits frame on data plane. No get-pull / no sendControl bag. **Contract SEALED** — [browser-session.md](browser-session.md). |
| 6 | Dual live paths (`LivePageProjection` vs lab engine) | **DONE (path)** — sealed factory + stub-delete LivePageProjection; product canvas/antibot still open |
| 7 | Lab probe: `NODE_NEW` in frame S ⇒ `isConnected` — **closed** as **SEAL-DOM-P0-PROBE** (`frameNewNodes` / legacy `probe.nodeNewConnected` + `iso.tree` fail-with-client). Halt iso alone still does not prove the class. | No |
| 8 | Lab DOM/CSSOM tracker | [seal-gaps.md](seal-gaps.md) — nested SO closed 2026-08-19. Open: XO/NIT; nested cssomO2 QA; CSS paint iso; scale. |
| 9 | Lab telemetry: `applyGateDrain` / `applyGateOverflow` / `applyGateOverflowLoop` kinds in dossier fold | Wire kinds exist on client; lab sink/fold not yet cataloguing — observability only. |

### RESIDUAL — nested generation interim pack (**CLOSED 2026-08-30**)

| Id | Symptom | Notes |
|----|---------|-------|
| **PP-NESTED-GEN-PACK** | Nested contexts showed `generation = (rootGen << 16) \| installIndex` via `setRootGeneration`. | **DONE** — parent mints monotonic per-`contextId` in the same `initContext` answer; packing removed. [frame-protocol.md](frame-protocol.md) §2 · [motor-0.3.0.md](motor-0.3.0.md). |

---

## Accepted product gaps

See [support-matrix.md](support-matrix.md). Canvas/WebGL pixels, MSE/DRM, IME, timing-critical games, independent client zoom. **Iframes:** lab same-origin is shipped. Pierced XO iframes stay **unsupported** (NIT) until that cut — not “working.”

### RESIDUAL — lab `document-churn` start-churn flake

| Id | Symptom | Notes |
|----|---------|-------|
| **LAB-CHURN-START** | x10 run: gen=1 install logged, establish OK, then no further installs / empty verdicts. | Not CLI early exit — **`start-churn` virtual eval** did not fire or page navigated before churn chain. Inspect blueprint `evaluate` + `mode=hold` → `__documentChurnStart` step before blaming establish. |

---

## Closed recently (do not reopen)

| Date | Item |
|------|------|
| 2026-08-30 | **PP-NESTED-GEN-PACK** — nested generation packing removed; parent mint monotonic per contextId in initContext answer. |
| 2026-08-30 | **PP-LOOPBACK-DOC-INSTALL** — same-socket hello generation supersede + session `waitEstablished` after install. |
| 2026-08-28 | **PP inject boot SEALED** — onNewDocument happy path; main-world; arm; lateBoot miss-detect (fail-closed + token). Dual-boot isolate probe closed. [browser-session.md](browser-session.md) |
| 2026-08-13 | Establish deleted; cold start = resync frame |
| 2026-08-13 | OPEN-5 recovery design |
| 2026-08-27 | PP inject CDP-only cutover — tag mutators removed; `inject/projectionRuntimeInstaller.ts` |
| 2026-08-13 | 48 KB first-frame = injected `<script>` leak; scrub sentinel + single bundle (2026-08-27) |
| 2026-08-13 | `resolvedBefore` O(N²) → `walkSiblingRun` |
| 2026-08-14 | NODE_DROP subtree resurrection + same-tick reattach race |
| 2026-08-14 | Stage 4 lab: client resync + real double buffer; `everArmed` cold-start vs mid-session |
| 2026-08-14 | Spec tree reorganized to V4 live + `archive/` |
| 2026-08-14 | OPEN-7 `insertBatch` reverse `nextSiblingOf` — fixed + unit falsifier |
| 2026-08-14 | O2 local oracle (table × live DOM) wired in lab |
| 2026-08-14 | Lab Chromium path folded into `V4ProjectionBrowserSession`; lab is caller only |
| 2026-08-14 | Torn O2 (split `page.evaluate`) → `flushAndSnapshot` one JS turn |
| 2026-08-14 | Telemetry-as-assert (`table_size_matches_telemetry`) removed; digest probe at sequence S |
| 2026-08-14 | OPEN-8 `unlink` last-child `nextSiblingOf[prev]` — prepend-stress O2 / table walk `[118]` |
| 2026-08-14 | PP-FR-1 V4 walk (`!isConnected` at drain); stress-churn stacked digits; phase-2 `REMOVE` desync |
| 2026-08-14 | prepend-stress O2/tree at halt — green seq 799 (OPEN-8 / takeRecords era; not a live bug) |
| 2026-08-16 | Lab seal kill lists: [seal-gaps.md](seal-gaps.md). Doc falsehood: C6 phase-2 “still no-op” corrected (constructed/`adopted` + `CSSStyleRule` shipped in lab) |
| 2026-08-17 | Inject honesty ATTR/RULESET/EOF: harness, not apply. UI 4077 PASS. [observability.md](observability.md) §7 |
| 2026-08-17 | QA closed (human looks + CHECK range + CSSStyleRule folds + detached-row GC / OPEN-2 / OPEN-3). SVG namespace closed same day. Next: [seal-gaps.md](seal-gaps.md) §3 |
| 2026-08-17 | OPEN-1 **CLOSED** — `NODE_DROP` absent id is `malformed` |
| 2026-08-19 | OPEN-6 lab same-origin iframe shipped — `iframe-open` `iso.nested` / `iso.nested.blank`. XO/srcdoc NIT. |
| 2026-08-19 | **OPEN-6 observability shipped** — telemetry v2 + `contextId`, bus snapshot RPC, lab context index, iso N-way, Stream HUD per context ([observability.md](observability.md) §10). |
| 2026-08-21 | **BrowserSession contract SEALED** — [browser-session.md](browser-session.md): core + PP + video; raw `getStateSnapshot`; `requestResync` only; no diagnostics facade. |
| 2026-08-19 | **Resync single entry path** — `PlaneChannel.Control` `requestResync` only; removed `emitResyncRequest` / upward loose bus / empty `forwardResyncToSidecar` stub. |
| 2026-08-19 | **`parityFingerprint` removed** — not in telemetry v2 schema; iso probes are the assert source. |
