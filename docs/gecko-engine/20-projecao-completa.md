# 20 — Projeção completa (prod-ready)

**Status:** constituição da implementação Gecko. Não é rascunho e não é backlog solto.  
**Barra:** 1:1 com abrir o mesmo site num Firefox normal no Virtual.  
**Se isto brigar com conveniência, isto ganha.**

Isto não substitui a **ISA**. Tabela, opcodes, apply e aceite já estão selados. Este arquivo diz **como o Gecko produz** isso. [`frame-protocol.md`](../page-projection/spec/frame-protocol.md) §5.1–5.7 é o produtor JS injetado — **não** se implementa daí.

**Revisão 2026-09-14 (nativo):** o produtor no Virtual é **C++ no fork**. Não se porta o produtor JS injetado. O fio (opcodes, tabela, `CHECK`) é o mesmo. O apply no browser do **usuário** continua JS — isso não é inject no site.

| Camada | Quem manda |
|--------|------------|
| Tabela, opcodes, apply no Projected, `CHECK`, resync **semântica** (duas forças, halt, `CHECK`) | [`frame-protocol.md`](../page-projection/spec/frame-protocol.md) §§1–4, 5.8, 5.9, 6–9 |
| **Como o Virtual Gecko constrói** o frame (observer, identidade, drain) | **este arquivo** — **não** [`frame-protocol.md`](../page-projection/spec/frame-protocol.md) §5.1–5.7 |
| Aceite 1:1, anti-ad-hoc | [`acceptance.md`](../page-projection/spec/acceptance.md) |
| Cola, ponte, ativos, testes | docs `11`–`19` + **este arquivo** |
| Evento vs probe (princípio) | [`observability.md`](../page-projection/spec/observability.md) §2–§3 — **não** o mecanismo Chromium (bus, inject, CDP) |
| Catálogo / `errorCode` | [`diagnostics.md`](../diagnostics.md) |

**Não manda implementação neste V1:** `virtual.js`, `inject/`, loopback WS, extensão, `cssom-poll-algorithm.md`, `context-bus.md`, `virtual-assets.md` §6.1 `rewritePart`, `input.md` CDP, `browser-session.md` `page.evaluate`, **`frame-protocol.md` §5.1–5.7** (MutationRecord, WeakMap, script injetado, `takeRecords`). Isso é o mundo em que o algoritmo vivia **dentro da página**. Acabou.

Dois produtores no repo (sidecar JS e este fork) **não** se misturam. Este plano só o C++. Cliente projetado = apply + input + SW de ativo, no browser do usuário. Paridade L0 usa a ISA de `core` (tabela, hash, apply) — **não** o diretório `virtual/`.

---

## 0. Completo quer dizer isto

A sessão em `MirrorMode.PageProjection` é indistinguível de abrir o alvo no Virtual: estrutura, texto, estilo depois do settle, mídia, clique, teclado, scroll, iframe (mesmo origin ou não), shadow de autor, formulário vivo.

**Falha**, mesmo com hop verde:

- superfície incompleta, lenta, esmagada, desarmada ou dessincronizada
- CSSOM que não aplica depois do settle
- input que não bate no original
- resync que “serviu” e deixou a página errada

**Não prova aceite:** `200`, `ok: true`, `ResyncServed`, WD, `htmlLen`, L4 só com `Navigated` e um frame.

Canvas e print são **1.1**. Ativos = doc 13 inteiro.

Iframe de terceiro é o mesmo nested: produtor no content process, `C` na `BrowsingContext`. O Projected replica frames; não abre a URL alheia.

### Fronteira C++ vs JS (não misturar)

| Onde | O quê | Tecnologia |
|------|--------|------------|
| Virtual (Gecko) | observar DOM/CSSOM/form, identidade, frame, resync, proxy de rede, input no widget, dump | **C++ do fork** + `speculum-wire` |
| Ponte | envelope, comando, telemetria, bytes de ativo | binário, supervisor cego |
| Projected (browser do usuário) | aplicar frame, pintar, clicar, SW de sub-recurso, K5 | JS **nosso**, não é o site |
| Site no Virtual | JS **dele** | não tocamos |

**Proibido no Virtual:** qualquer JS nosso (`virtual.js`, observer JS, poll de CSS, bus entre iframes, websocket local, content script, `evaluate`). O site não pode distinguir o Firefox de um Firefox normal por causa da projeção.

### Mapa da spec V4 — o que vale neste fork

O fio e o aceite **não mudam**. O **como o Virtual produz** mudou: era script na página; agora é C++. Agente que abrir a spec Chromium e copiar o mecanismo está errado.

| Arquivo | Vale no Gecko Virtual? |
|---------|------------------------|
| `frame-protocol.md` §§1–4, 6–9 | **Sim.** Tabela, opcodes, apply, limites. Exceção: “`SHADOW_ROOT` mode=1 NIT” **não** — L8 / plano 2.5. |
| `frame-protocol.md` §5.1–5.7 | **Não.** Install inject, buffer de `MutationRecord`, WeakMap, DFS do produtor JS. |
| `frame-protocol.md` §5.8 | **Semântica sim** (duas forças, halt, `CHECK`). Gatilho = ABI `Resync`, **não** “bus event”. Nome `resyncVirtual` = walk C++ da árvore viva, **não** `virtual.js`. |
| `frame-protocol.md` §5.9 | **O quê sim** (`VALUE`/`CHECKED`/`SELECTED`). Sensor = amostra C++ no tick, **não** `formPropIndex` JS. |
| `frame-protocol.md` §1.6 `lms` como GC | **Não.** Gecko dá `NODE_DROP` no tick do detach. `lms` no fio pode existir como diagnóstico; não é o GC. |
| `acceptance.md` | **Sim.** 1:1. |
| `cssom.md` | **Materializar** no Projected (C1–C9, owned CSSOM) **sim**. A linha “Sensor = poll (C5)” é o Chromium. Gecko C5 = `RuleAdded*` C++. |
| `cssom-poll-algorithm.md`, `cssom-sensor-journey.md` | **Não.** “Hooks rejected” ali é **JS na página** (antibot). Callback C++ do `StyleSheet` **não** é esse hook. |
| `shadow.md`, `subtrees.md` | **Topologia sim** (dois tipos, root não entra na luz). **Não:** “same JS loop”, hook em `attachShadow`, WeakMap no Virtual. Closed de autor no Gecko = `GetShadowRoot()`; o Projected faz `attachShadow({mode:'closed'})` na fase 2. A frase do protocolo “`mode=1` NIT” **não** vale aqui (L8). |
| `open.md`, `seal-gaps.md`, `test-matrix.md`, `lab-design.md` | Tracker/lab do produto Chromium. Não é backlog deste fork. |
| `packages/.../core/opcodes.ts` | **Lista da ISA** (os 15 opcodes). Não é o produtor. |
| `multi-document.md` (`C`, generation) | **Sim** o contrato. Transporte = campo na BC + IPC. |
| `context-bus.md` | **Não.** Era postMessage entre janelas injetadas. |
| `input.md` (intenção `nodeId` + %) | **Sim** o envelope esparso. Apply = `HeadlessWidget`, **não** CDP. Sem stream de `pointermove`. |
| `loopback.md`, `csp.md` (cirurgia no Document), `runtime-redesign.md` | **Não** no Virtual. Existiam para o script injetado falar com o sidecar. |
| `browser-session.md` / `observability.md` | **Princípio** (evento ≠ probe ≠ aceite). Dump = ABI Halt/Flush/Snapshot. **Não** copiar RPC / `page.evaluate` / Playwright. |
| `virtual-assets.md` §6.1 `rewritePart` | **Não.** Doc 13. |
| `support-matrix.md` (IME / zoom / “DRM”) | **Não copiar** como gap deste V1. Zoom independente é proibido; mídia = doc 13. |
| `packages/page-projection/virtual/**` | **Não portar.** Produtor JS (`cssomPoller`, `mutationBuffer`, `formPropIndex`, bus, loopback, `closedShadowCapture`). |
| `packages/page-projection/core` tabela/hash/apply/opcodes | **Paridade L0.** Não é o produtor. `core/loopback`, `core/contextBus`, `core/closedShadowLookup` **não** entram no Virtual. |
| `packages/page-projection/projected` | **Sim** no browser do usuário (apply, captura, SW de ativo, K5). |

Socket Unix/TCP da ponte Gecko **não** é o loopback WS do inject. SW do **site** roda no Gecko; o SW nosso é só no Projected, para sub-recurso.

---

## 1. Leis — violação é defeito de desenho, não de ticket

Cada lei existe para **uma classe de bug não poder nascer**.

### L0 — Produtor nativo

O algoritmo no Virtual é C++. `speculum-wire` + cola `nsINode` / `StyleSheet` / `HeadlessWidget`. Zero script nosso no documento do site. Portar o produtor JS é regressão, não atalho. Paridade L0 é da ISA (hash, tabela, encode, apply) — **não** tradução do `virtual.js`.

### L1 — Um algoritmo, uma ISA

Quinze opcodes selados. Sem `MOVE`, sem `REPLACE`, sem dump de HTML, sem DomMap, sem `speculum-anchor`, sem bootstrap paralelo depois do seed. Frio = `resyncVirtual`. Meio = ticks. Dessincronia = `emitResyncFrame` ou `resyncVirtual` pela força que o **supervisor** mandou (`Resync`, doc 12). O C++ não escolhe a força.

### L2 — Um caminho feliz

Se o stream quebra, conserta o stream. Segundo caminho que restaura custo banido (dump inteiro “só no frio”, “só no stress”, “só no lab”) é produto defeituoso mesmo verde.

### L3 — Núcleo puro, motor é cola

`speculum-wire` não inclui tipo Mozilla. Gecko implementa `NodeSource` + observer + runtime. Algoritmo novo nasce no header e prova no L0 **antes** de encostar no fork. Cola que contém `if` de ciclo de vida da tabela é o núcleo no lugar errado.

### L4 — A tabela é a verdade; o DOM é projeção

Produtor aplica na **própria** tabela e emite o delta. Cliente aplica o mesmo frame. Concordância = `preTableHash` + `CHECK(scope=Table)`. Telemetria de evento não passa/falha isomorfismo. Snapshot de estado + oráculo.

### L5 — Identidade é ponteiro opaco, id nunca reusa, DROP fecha o mapa

Não existe id nativo em `nsINode`. O mapa é `void* → u32`.

**Correção sobre o item G (docs 00 e 02).** `NodeWillBeDestroyed` no observer **do Document não dispara por filho**. Pendurar o GC nisso vaza linha (MAX_ROWS) e cola id velho quando o alocador reusa o endereço (`TEXT_SET` em elemento).

Lei no Gecko:

1. `onRemoved` emite `REMOVE` e marca o id.
2. No `emitFrame`, se o nó **não** foi reinserido neste tick (`parent == 0`): `NODE_DROP` da raiz destacada + `dropSubtree` + `release` de **toda** a subárvore.
3. Reinserção no mesmo tick = move: `INSERT` do id existente, sem DROP.
4. Mesmo endereço, outro `kind` = ponteiro reusado: aposenta o id velho, `NODE_NEW`.
5. Não chamar `isConnected` em chave do mapa depois do destroy — UAF. O DROP usa a tabela, não o DOM morto.

Identidade aqui é ponteiro cru: DROP no tick do detach. Nó que o JS da **página** ainda segura e reinserir depois ganha id novo. Não se porta WeakMap nem GC por idade do produtor JS.

### L6 — CSSOM pelo motor

Gecko avisa regra a regra (`RuleAdded` / `RuleRemoved` / `RuleChanged`). Isso é o sensor. **Não** se porta poll, idle, `cssomPoll`, CDP CSS. Opcodes `SHEET_*` / `RULE_*` iguais no fio. O cliente projetado aplica; não detecta.

### L7 — Dois tipos de subárvore, nunca um terceiro

Walker de `childNodes` não vê: (1) shadow do host, (2) browsing context aninhado. `template.content` não pinta. Não ramificar por tag, parser vs `attachShadow`, COOP, srcdoc. Classifica pelo que o walker seguiria. [`subtrees.md`](../page-projection/spec/subtrees.md).

### L8 — Elemento é o contrato; interior de UA não sai

`IsInNativeAnonymousSubtree()` na admissão **e** em cada mutação. Sem enumerar `<video>` / `<input>`. Shadow **fechado de autor** continua (não é UA). [`14-fronteira-ua.md`](14-fronteira-ua.md).

### L9 — Supervisor cego ao frame

Envelope carrega `contextId`. Payload de frame é opaco. Ninguém reescreve URL no C++, no supervisor nem no sidecar. Ativo = SW no cliente + proxy no Virtual. [`13-plano-de-ativos.md`](13-plano-de-ativos.md), [`11-supervisor-linguagem.md`](11-supervisor-linguagem.md).

### L10 — Ponte caiu = morre

Uma ponte, um canal, binário. Sem keepalive que muda comportamento. Sem env de “lab vivo”. Lab que testa outro binário é falso positivo. Docs `15`, `17` §8.5.

### L11 — Sempre projetado se o contexto existe

Não existe `ProjectionAttach`. Nested não ganha opcode de controle. `C` mora na `BrowsingContext`. Mint `≥2` sessão-global, nunca reusa. Iframe navega: mesmo `C`, `generation` sobe. Aba navega: `C` novo. Doc 12 §5.2, doc 17.

### L12 — Relógio de frame é timer; frame vazio não existe

Não acoplar emissão ao paint. Ops no tick → um frame ou nada. `sequence` não anda no vazio.

### L13 — Apply no Projected é duas fases, estrito

Isto é o **cliente** (`projected` / `core` apply). Fase 1 valida e muta tabela (`preTableHash`, pré-condição por op, `CHECK`). Falhou → DOM intocado, dessincronia, pedido de resync. Fase 2 materializa e não pode falhar. Apply tolerante esconde encoder defeituoso. O Gecko **não** aplica frame no DOM do site.

### L14 — JS do site só no Virtual (K5)

Superfície projetada: CSP `script-src 'none'`, sem `iframe.sandbox` (quebra toque). Guarda nativa de submit/link. Site JS no Gecko Virtual.

### L15 — Input é intenção, não pixel stream (K1)

Projected captura `nodeId` + `%` local (JS **do cliente**, não do site). Virtual aplica no `HeadlessWidget`. Sem CDP, sem uinput, sem inject. **Sem stream de `pointermove`.** Doc 12 pede ponte sem HOLB (scroll/tecla/resync em rajada) — isso **não** é 120 Hz de mouse. Clique no pixel certo não prova challenge — token no Virtual prova.

### L16 — Prova em escada, nunca o contrário

L0 (núcleo, segundos, sem `mach`) → L1 ABI → L2 transporte → L3 amarração → L4 pilha com Firefox **já** construído → L5 capturas. Componente novo sem degrau não entra. Doc 19. Garantia nova vira teste no mesmo passo.

### L17 — `generation` só troca o Document daquela instância

Soft-nav / SPA / resync **não** inventam bump no pai. Navegação do iframe = reinstall **daquela** instância, mesmo `contextId`.

### L18 — Fission ligado; um socket no pai

Produtor em todo content process; ativa só com documento pedido. Sem injeção. Sem socket por processo filho. Doc 16.

### L19 — Diálogo, permissão, download no dia 0

Marionete pede e espera. Auto-responder no C++ mata o princípio. Doc 12 §4.

### L20 — Otimização depois de correto (item E)

Não projetar off-screen, não pular `CHECK`, não subir `MAX_ROWS` para o stress passar. Mede no item O; não ramifica o algoritmo.

### L21 — Três sinais, nunca um

| Tipo | Quando custa | Pra quê | Pass/fail de tabela/DOM? |
|------|----------------|---------|---------------------------|
| **Evento** | zero se o toggle da capability está off | linha do tempo, percentil, investigação, insumo de O3 | **nunca** |
| **Embutido** | só se o artefato já existe (`buildMs` no `frameEmitted`; hash já no frame) | o mesmo, sem canal extra | **nunca** |
| **Probe** | zero em produção se ninguém chama | estado em um instante nomeado | **nunca no DTO** — o *lab* monta o oráculo |

Misturar os três (assert de `tableSize` do evento, PASS por `applyOk`, dump no log MOZ) é o defeito de 2026-08-14. Lei: [`observability.md`](../page-projection/spec/observability.md) §2–§3, [`diagnostics.md`](../diagnostics.md).

### L22 — Capability, não nível de log

Telemetria de produto é toggle por domínio (`metrics` / `events` / `snapshots` / `probe`), descritor no catálogo, transporte cego a nome. Evento sem descritor não sai. Falha catalogada **obriga** `errorCode` + `phase`.

`MOZ_LOG=Speculum:5` é ferramenta de engenheiro no processo. **Não** é o plano de observabilidade. Logar cada mutação (o observer atual) é custo + PII e some em produção. Debug de último recurso, atrás de flag de build ou de um toggle que o lab liga — nunca no caminho quente default.

### L23 — Relógio e snapshot são a mesma sessão

Probes: Halt / Resume / Flush / Snapshot / Resync **na ABI da ponte** (doc 18), não `page.evaluate`, não bus JS, não `getStateSnapshot` in-page. Dump sai da tabela C++. Nomes iguais aos do contrato de sessão, transporte outro.

Observer Gecko é síncrono. Probe = emitir S e copiar a tabela na mesma função, timer parado. Sem `takeRecords`. `S` por `contextId`.

### L24 — PP-FR-1: cadáver do tick não viaja

Nó que nasceu e morreu no mesmo tick de frame **não** ganha `NODE_NEW`. Halt verde não prova isso ([`observability.md`](../page-projection/spec/observability.md) §8).

A cola atual descreve no callback. No C++ o drain é o `emitFrame`: só aloca quem ainda está na árvore. Não se porta o `takeRecords` + buffer JS.

### L25 — Métrica de correção ≠ métrica de capacidade

P1–P7 e E1–E11 medem folga. Estourar E6 no hammer de CSSOM não é dessincronia. Página inutilizável no browse comum **é** falha de aceite, mesmo com E6 ok. Functional ≠ Perf ([`engineering-standards.md`](../engineering-standards.md)). O3 (CI de budget) é gate à parte, hoje não ligado.

### L26 — Instrumentação nasce com o plano, não depois

Plano sem evento/probe/métrica definidos **não está especificado**. Não se “coloca telemetria no fim”. Cada linha da §2 declara o que emite, o que o probe lê, e o que **não** se afirma daquilo.

---

## 2. Planos — cada um tem que existir, inteiro

Para cada plano: **lei**, **gancho C++**, **fio**, **o que o Projected faz**, **prova**, **proibido**, **estado**.  
Estado = este fork. Verde no sidecar JS **não** conta.

### 2.1 Sessão e navegação

| | |
|--|--|
| Lei | L10, L11, L17. Janela sem URI em `arguments[0]`. `Navigated` = commit da carga **pedida**. |
| Gancho | `SpeculumProjectionRuntime`, `nsIWebProgress` da Canonical, `SpeculumContextId` na BC. |
| Fio | ABI doc 18. Frame selado `PP` v2. |
| Cliente | consumidor do produto anexa; supervisor `Resync(C=1, mapa)`. Não é bind do inject. |
| Prova | L3 + L4 passos 1–5 (página nova no fio, não eco). |
| Proibido | OpenWindow com `about:blank` que mata o Navigate; `Navigated` no STOP errado. |
| Estado | **há** runtime, Navigate, mint nested, L4 de texto. |

### 2.2 DOM (estrutura, texto, atributo)

| | |
|--|--|
| Lei | L1–L5, L8, L12. |
| Gancho | `nsIMutationObserver` no Document: insert/append/remove/attr/text. Posição lida no nó (insert não traz índice). |
| Fio | `NODE_NEW`, `INSERT`, `REMOVE`, `NODE_DROP`, `ATTR_*`, `TEXT_SET`, `CHECK`. |
| Cliente | `applyFrameToTableChecked` + materialize. |
| Prova | L0 `producer_loop` + `producer_lifecycle` (churn, move, ponteiro reusado) + L5 + oráculo de snapshot no lab. |
| Proibido | Bootstrap DomMap; DROP só no destroy; `TEXT_SET` sem conferir kind. |
| Estado | **há** cola + núcleo. DROP no tick do remove. Prova de stress no Firefox = este mach + L4. |

### 2.3 Identidade e GC de linha

Coberta por L5. Sem plano paralelo. Teste obrigatório: churn sem `onDestroyed` nos filhos; placement-new no mesmo endereço com kind diferente.

### 2.4 CSSOM

| | |
|--|--|
| Lei | L6, L12. Completeness no establish/resync; live **percebido** 1:1, não lockstep com o paint. Sensor = mutação do **CSSOM autorado** (`css::Rule` / lista de sheets), não estilo computado. |
| Gancho | `Document::RuleAdded/Removed/Changed`, `InsertSheetAt`, `PostStyleSheetRemovedEvent`. No Firefox 153 o sheet do shadow **não** passa pelo Document: o mesmo `SpeculumNotify*` está em `ShadowRoot::Rule*` / `InsertSheetAt` / `RemoveSheetFromStyles`. Um `Producer` por `window`. Enfileira no callback; drena no `emitFrame` — **igual ao DOM**. |
| Fio | `SHEET_*` / `RULE_*` no **mesmo** frame, `sequence` e teto de 16 ms do DOM. Sem relógio CSSOM à parte. Sem esperar restyle/layout do Servo (`FlushPendingNotifications` não é gate de emissão). |
| Cliente | CSSOM owned + id Map. Sem recarregar URL viva. |
| Prova | L0 fonte falsa; L4 regra visível; iso = tabela×tabela (+ opcional tabela×`StyleSheet` vivo no halt). Paint 1:1 não é este probe. |
| Proibido | poll/idle; ler computed style; emitir no commit de paint; copiar `cssRules` em fatia e “commitar” depois (o pass in-flight do Chromium). |
| Estado | **cola há** (documento e shadow, establish e live). Texto = `css::Rule::GetCssText`. Bootstrap/resync anda `ShadowRoot` (`walkComposed`). |

Por que o aviso de “estilo instável” não se aplica da mesma forma: aquilo é o poll JS (copia a lista, cede, hasheia depois — pass **uncommitted**). Aqui o motor avisa **depois** da mutação no objeto. O conjunto sujo espera o tick; o frame leva o CSSOM que ainda está vivo no drain, como o DOM. Restyle do Servo pode estar sujo — a gente **não lê** isso.

### 2.5 Shadow (tipo 1)

| | |
|--|--|
| Lei | L7. [`shadow.md`](../page-projection/spec/shadow.md) topologia. `GetShadowRoot()` C++ **não** filtra modo — closed de autor entra neste V1. |
| Gancho | `nsIMutationObserver` no `ShadowRoot`. Walk `shadowRoot` no resync. Sem hook JS em `attachShadow`. |
| Fio | kind `SHADOW_ROOT`, `mode` 0 ou 1. Nunca `INSERT`/`REMOVE` do root. |
| Cliente | `attachShadow` na fase 2 (open ou closed). Mapa de root fechado **no Projected**, não no Virtual. |
| Prova | L0 fake shadow + L4 open, named e closed programático. |
| Proibido | MutationObserver JS; `closedShadowCapture`; achatar slot; misturar light+shadow. |
| Estado | **há.** `MaybeObserveShadow` pende o observer no root. `childrenOf` é só luz. CSS live do shadow = plano 2.4. |

### 2.6 Nested browsing context (tipo 2)

| | |
|--|--|
| Lei | L11, L17, L18. `C` na BC; CreateFromIPC herda. Sem bus JS entre janelas. |
| Gancho | `isNestedHost` + `childScopeIdOf`. Hold `NODE_NEW` do host até `C ≥ 2`. Filho = outro `Producer`, mesmo algoritmo. |
| Fio | bit nested no `NODE_NEW` + frames com `contextId` do filho. |
| Cliente | um applier por `C`. Replica frames; **não** carrega a URL do iframe. |
| Prova | L4 multiplex (passos 6–9 do doc 19). Terceiro origin = o mesmo caminho. |
| Proibido | `ContextCreated` por iframe; ContextBus/postMessage no Virtual; packing de generation. |
| Estado | **mint + hold + L4 nested há**. CSSOM do filho = plano 2.4 na instância filha. |

### 2.7 Propriedades vivas (`PROP_SET`)

| | |
|--|--|
| Lei | DOM numérico 1:1, não CSSOM eventual. [`frame-protocol.md`](../page-projection/spec/frame-protocol.md) §5.9. Só `VALUE` / `CHECKED` / `SELECTED` nesta fatia. |
| Gancho | Índice C++ na admissão; amostra no tick (`HTMLInputElement` / `HTMLTextAreaElement` / `HTMLOptionElement`). Sem listener JS. |
| Fio | `PROP_SET` `0x63`. |
| Cliente | property, não attribute. |
| Prova | L0 já emite; L4 forms-state + input que muda `.value`. |
| Proibido | Tratar value digitado como attr; idle de CSSOM para isto. |
| Estado | **núcleo há**; cola `formPropsOf` amostra no drain. Sem listener JS. |

### 2.8 Input

| | |
|--|--|
| Lei | L15, P4 local / P5 autoritativo. |
| Gancho | `HeadlessWidget`. |
| Fio | opcode `Input` na ABI de controle (doc 18): `contextId` + tipo + campos. Mesmo codec da ponte. Nested = o `C` do comando. |
| Cliente | captura esparsa no Projected (JS nosso). K5 intacto. Encoder = os campos da ABI, não JSON. |
| Prova | efeito no Virtual. Clique nested no `C` filho. Challenge: token no Virtual. |
| Proibido | CDP, uinput, inject, `Runtime.evaluate`. JSON/MessagePack neste opcode. `move` no fio. Histórico via `Input`. |
| Estado | **há.** Clique/tecla/scroll no widget. CSS px → LayoutDevice. `nodeId` 0 em down/up não aplica. Nested carimba o `C` do comando. |

### 2.9 Ativos (imagem, fonte, mídia) — V1 completo, doc 13 inteiro

| | |
|--|--|
| Lei | L9. Doc 13 sem recorte. SW no cliente; Gecko é proxy de rede da sessão; ninguém reescreve URL. |
| Só o cliente pede | vídeo/áudio — proxy, `Range` intacto, play no cliente. |
| Os dois precisam | imagem e fonte — tee do stream da busca do Virtual (offset), não cache de corpo inteiro. |
| Só o Virtual | HTML, JS, CSS, XHR — não sai. SSE/WebSocket não se serve. |
| HLS/DASH nativo | manifesto do Virtual; segmentos o cliente pede via proxy. |
| SW | `ready` **antes** do primeiro paint. Token em header, não na query. |
| Supervisor | relay opaco, igual ao frame. |
| Prova | img, fonte, vídeo com seek/`Range`; origem real não vê o Projected. |
| Proibido | `rewritePart`; lista de sinks; supervisor baixar; segunda busca; copiar bitmap. |
| Estado | **há.** Tee do canal da página, ou abre com o principal do documento. Chave `(contextId, URL, Range)`. Zero `NullPrincipal` no registry. |

### 2.10 Superfície projetada e K5

| | |
|--|--|
| Lei | L13, L14. Double-buffer no resync mid-session; swap depois do `CHECK`. |
| Gancho | nenhum no Gecko — é o cliente. |
| Fio | frames. |
| Cliente | apply de frame + CSP K5. **Não** é `virtual.js`. Sem loopback na página. |
| Prova | apply estrito + K5 (`script-src 'none'`, sem sandbox de iframe). |
| Proibido | `virtual.js` na página; loopback WS no Document; furar CSP. |
| Estado | pacote `projected` aplica fio; o Virtual deste plano é Gecko, não Chromium injetado. |

### 2.11 Canvas e print — 1.1, não deste V1

Já estacionados na spec da versão seguinte. Placeholder no `<canvas>`. Este V1 não fica incompleto por isso.

### 2.12 Recuperação

| | |
|--|--|
| Lei | L1, L2. Três gatilhos, duas forças, um mecanismo. Halt do dreno enquanto constrói. |
| Gancho | `Resync` ABI. Cold attach = walk (`resyncVirtual`). Consumidor novo em contexto vivo = mapa (`emitResyncFrame`). |
| Prova | L0 `producer_resync`; L4 dessincronia forçada + superfície igual. |
| Proibido | Resync para tapar bug de tabela; watermark; dump HTML; gatilho por bus JS. |
| Estado | **núcleo + opcode há.** |

### 2.13 Observabilidade

§8. Sem isto o produto é cego. Não é apêndice.

### 2.14 Persona / rede / antibot

Gecko no Linux **é** Firefox: TLS, fontes, SpiderMonkey. Não forjar. Fingerprint = ser o motor. Sem stealth kit paralelo. Doc 00, 06, 07.

### 2.15 Viewport

| | |
|--|--|
| Lei | `ViewportSet` na ABI. Zoom do cliente **proibido** (quebra hit-test). Geometria por sessão (K2). |
| Gancho | `HeadlessWidget` / tamanho interno da BC. |
| Prova | mesmo viewport nos dois lados; layout 1:1. Larguras diferentes invalidam a medição. |
| Estado | **há.** Pai aplica `SetPositionAndSize` no widget da aba. |

### 2.16 Scroll e foco

| | |
|--|--|
| Lei | P4 local no Projected (scroll nativo). P5: `scrollSet` no Virtual. Foco autoritativo = clique/tecla no Virtual; `:focus-within` no Projected é CSS local. |
| Proibido | stream de `pointermove`; `preventDefault` no `touchstart` de link (PP-SCROLL-AXIS). |
| Estado | **há.** `scrollSet` é Input tipo 5 no mesmo apply. |

### 2.17 Histórico e hard-nav

| | |
|--|--|
| Lei | `HistoryGo`, `Reload`, `Stop`. Hard-nav = Document novo, `generation` sobe **nessa** instância. Soft-nav não bump. L17. |
| Prova | L4 `/a` → `/b` texto novo no fio. |
| Estado | **há.** `HistoryGo` / `Reload` / `Stop` no pai, na aba (`ResolveLiveRoot`). Nested `C` neste V1 não é o back da iframe. |

### 2.18 Upload de arquivo — 1.1, não deste V1

| | |
|--|--|
| Lei | `setFiles` no plano de input. **Fora deste V1** (fechado 2026-09-14). Escrito na matriz deste fork — não silêncio. |
| Estado | **1.1.** V1 não escolhe arquivo. `Input` não tem tipo `setFiles`. |

### 2.19 Relógio, halt, flush

| | |
|--|--|
| Lei | L12, L23, L24. Timer 16 ms; vazio não emite. Probe pode flush agora. Halt impede S+1 até o cliente aplicar S. |
| Gancho | `nsITimer` já existe. Halt/Flush/Snapshot na ABI e no IPDL. |
| Proibido | descrever no callback e chamar isso de drain. |
| Estado | **timer, halt, flush e Snapshot há.** Halt para o relógio; a fila continua; Flush chama `emitFrame`. |

### 2.20 Diálogo, permissão, download

| | |
|--|--|
| Lei | L19. Marionete pede e espera. Doc 12 §4. |
| Gancho | C++: `alert`/`confirm`/`prompt`, `nsIPermission`, download do canal. Opcode `*Requested` / `*Respond`. |
| Cliente | UI do produto decide; não o Gecko. |
| Prova | um alerta, um deny de permissão, um download recusado — efeito no Virtual. |
| Proibido | auto-ok no C++ “temporário”. |
| Estado | **há.** `alert`/`confirm`/`prompt` no hunk da janela (`SpeculumAskAndWait`). Permissão e download no `ContentParent`; recusa = `Send__delete__`. Sem auto-ok. |

### 2.21 Pressão e item O

| | |
|--|--|
| Lei | Fila: descarta o **mais antigo**, nunca down/up. Teto 64 MiB. Agulha content→pai é o primeiro volume (doc 17 §7). |
| Métrica | profundidade, bytes/s, atraso IPC, frames dropped. Evento, não iso. |
| Estado | **fora deste V1** (capacidade). Não entra neste mach. |

### 2.22 Fontes (métrica de texto)

Caso “os dois precisam” do doc 13. Sem a fonte o layout mente. Probe: família usada vs 404 no SW.

### 2.23 O que **não** se porta (produtor JS legado)

| Coisa | Por quê |
|-------|---------|
| `virtual.js` / inject / content script / `evaluate` | L0 — o site veria JS nosso |
| `frame-protocol.md` §5.1–5.7 | algoritmo do inject (MutationRecord, WeakMap, DFS JS) |
| Loopback WS, `core/loopback`, extensão, cirurgia CSP `connect-src` | o produtor na página falava com o sidecar. Socket da ponte Gecko é outra coisa. |
| `cssomPoller` / idle / `cssom-poll-algorithm` | Gecko tem callback por regra |
| `contextBus` / postMessage entre iframes | `C` na BC + IPC do Gecko |
| WeakMap + `lms` como GC / DROP por idade | ponteiro + DROP no tick |
| `mutationBuffer` / `takeRecords` | observer C++ síncrono; drain no `emitFrame` |
| `formPropIndex` JS | amostra C++ no tick |
| `closedShadowCapture` / patch de `attachShadow` | `GetShadowRoot()` C++ não filtra modo |
| CDP (input, CSS, Profiler, snapshot) | motor nosso |
| `rewritePart` / lista de sinks | doc 13 |
| Snapshot via `page.evaluate` / Playwright no Virtual | dump da tabela C++, ABI |
| Sidecar Chromium como Virtual deste V1 | outro produto, outro produtor |

Ainda não é plano extra: `ParentChainChanged` (é INSERT/REMOVE); `template.content`; árvore a11y no Projected; pixel da sessão (modo vídeo); site que monta vídeo só no JS (doc 13 §6).

### Instrumentação por plano (L26)

| Plano | Evento | Probe | Não afirma |
|-------|--------|-------|------------|
| 2.1 sessão | `Navigated` / `ContextCreated` ABI | — | hop verde ≠ página certa |
| 2.2 DOM | `frameEmitted` | Snapshot + `frameNewNodes` | `opCount` ≠ iso |
| 2.3 identidade | `Fault` ABI (queda); helper `producerFault` no catálogo, sem caller neste V1 | `rowCount` vs árvore viva | — |
| 2.4 CSSOM | `frameEmitted.opCount` (CSS no mesmo tick) | dump `SHEET`/`RULE` | contagem ≠ paint |
| 2.5 shadow | ops no frame | dump `tree` com root | — |
| 2.6 nested | frames com `C` filho | dump por `contextId` | um frame do pai ≠ filho ok |
| 2.7 form | `PROP_SET` no frame | `formProps` | — |
| 2.8 input | `inputAdmitted` / `Rejected` | efeito no DOM Virtual | envelope ok ≠ site reagiu |
| 2.9 ativos | — | img/fonte/vídeo no settle | 200 do proxy ≠ pixel |
| 2.12 resync | `resync*` | superfície depois do `CHECK` | `ResyncServed` sozinho |
| 2.15 viewport | — | geometria igual nos dois | — |
| 2.19 halt | — | Snapshot em S com relógio parado | halt verde ≠ PP-FR-1 |
| 2.20 diálogo | `DialogRequested` etc. | efeito no Virtual | envelope sozinho |
| 2.21 fila | — (fora V1) | — | — |

---

## 3. O que o Gecko já tem vs o que falta

Leitura honesta do fork (`gecko-engine/patches` + `speculum-wire`), não do sidecar. **Cola V1 no tree 2026-09-14.** Aceite 1:1 = este mach + L4 por efeito, não hop.

| Plano | Núcleo (L0) | Cola Gecko | Aceite |
|-------|-------------|------------|--------|
| Sessão / Navigate / `C` | n/a | sim | L4 |
| DOM + hash + apply | sim | sim | L4 + stress |
| Identidade / GC | sim (lifecycle) | `onRemoved` há | L4 |
| PP-FR-1 (efêmero do tick) | sim (drain no `emitFrame`) | tick do observer | L4 |
| CSSOM | opcodes + drain ordem viva | `Document::Rule*` + `ShadowRoot::Rule*` + `GetCssText` + captura no resync | L4 |
| Shadow | tabela/wire | `MaybeObserveShadow`; CSS live no `ShadowRoot` | L4 |
| Nested | hold `C` | mint + frames; hold desliga se o host sai | L4 |
| PROP_SET | sim | `formPropsOf` amostra no drain | L4 |
| Input nativo | n/a | widget, CSS px → LayoutDevice | L4 por efeito |
| Viewport | n/a | `SetPositionAndSize` no pai | L4 |
| Ativos / SW / proxy | n/a | tee + open com principal da página | L4 (pixel, não 200) |
| Dialog/perm/download | ABI | `SpeculumAskAndWait`; recusa = delete | L4 por efeito |
| Upload | — | — | **1.1** |
| Canvas / print | — | — | **1.1** |
| Halt / snapshot / `frameNewNodes` | sim | IPDL Halt/Flush/Snapshot | L4 iso |
| Telemetria catalogada | Kind `0x05` | `SPECULUM_CAP_EVENTS` (default off); `MOZ_LOG` só boot/tick/resync/attach | debug; **nunca** aceite |
| Métrica P/E (O3) | `buildMs` se `SPECULUM_CAP_METRICS` | — | capacidade, não 1:1 |
| Backpressure (drop oldest) | n/a | **fora deste V1** | — |

**Corte deste V1** = cola “sim” em tudo que não é 1.1. Canvas/print/fila = 1.1. “DOM sobe no fio” não é corte.

---

## 4. Ordem de implementação (sem pular)

Passos 1–7 **no tree** (2026-09-14). Upload do passo 7 ficou **1.1**, de propósito.

8. **Este mach** — overlay `copy-hash-resync-into-checkout.sh`, depois `scripts/build.sh binaries` (IPDL + fontes novas). Não reaplicar `ALL.diff`. Não `mach build` a frio se o objdir já existe.
9. L4 + stress + iso (snapshot, não hop) + aceite 1:1.

Sem canvas/print neste V1. Verde no sidecar Chromium injetado **não** fecha o 9.

Instrumentação da §8 já entra com a cola; não é um passo extra.

---

## 5. Anti-padrões (lista fechada)

Se a frase abaixo aparecer em patch, o patch está errado:

- bootstrap / DomMap / HTML dump / “seed quebrado então manda a árvore”
- `if (isFirstFrame)` / `if (lab)` / env que muda algoritmo
- DROP só no `NodeWillBeDestroyed` do Document
- implementar `frame-protocol.md` §5.1–5.7 (MutationRecord / WeakMap / inject)
- tratar `cssom.md` C5 (poll) ou “hooks rejected” como lei deste fork
- tratar `SHADOW_ROOT` `mode=1` como NIT (é o Chromium sem hook; aqui o C++ vê closed)
- portar `packages/page-projection/virtual` / traduzir `virtual.js` para C++
- poll CSSOM no Gecko
- `page.evaluate` / bus JS como snapshot
- MutationObserver JS no documento do site
- reescrita de URL
- `ProjectionAttach`
- socket por content process
- auto-ok de `alert` / permissão
- PASS por hop / `ResyncServed` / tamanho de HTML / `applyOk`
- skip de assert / propriedade JSON opcional como verde
- furar XFO / CSP `connect-src *` / sandbox no iframe projetado
- segundo produtor “só para recovery”
- `MAX_ROWS` maior para o stress caber
- portar loopback / extensão / `virtual.js`
- `SPECULUM_LOG` em todo callback como telemetria
- assert `tableSize` de evento contra a tabela
- Profiler CDP como prova de iso
- “telemetria no final”
- implementar a partir de `docs/page-projection/archive/`

---

## 6. Relação com os outros docs

Ler isto **depois** de `acceptance.md` e **junto** da série Gecko:

| Doc | Papel |
|-----|--------|
| `00`–`09` | motor, fork, fission, persona, o que não fazer |
| `11`–`13` | supervisor, vocabulário, ativos |
| `14` | UA |
| `15`–`18` | vida, processo, runtime, ABI — **18 precisa dos opcodes de probe/telemetria** |
| `19` | escada de teste — sem ela a §4 é opinião |
| spec V4 | fio e aceite — **mecanismo de produtor JS não** (mapa no §0) |
| `observability.md` / `diagnostics.md` / `oracles.md` / `budgets.md` | como se observa e o que não se afirma |

Comportamento de frame muda → `frame-protocol.md` + linha no `decision-log.md` **no mesmo changeset**. Este arquivo só muda se mudar uma **lei de implementação** Gecko.

---

## 7. Frase de corte

Está prod-ready quando:

1. Não existe segundo caminho no código que o L0 / L4 exercitam.
2. Cada plano da §2 está “sim” na coluna prod-ready, ou está na support-matrix.
3. Stress de DOM não estoura tabela nem cola id; efêmero do tick não pinta (L24).
4. CSSOM no settle é o da página, não um subset.
5. Input e ativos passam por efeito, não por envelope.
6. Snapshot em S + oráculo lab — não hop — é a prova de estado.
7. Eventos de telemetria existem, ligam/desligam, e **ninguém** passa aceite por eles.
8. Um humano não distingue Projected do original no critério da `acceptance.md`.

Qualquer um desses falso = não está pronto. O mach não é o produto; o 9 (L4 + aceite) é.

---

## 8. Instrumentação (debug, telemetria, métrica)

Lei: L21–L26. Quem manda no *como afirmar*: `observability.md`. Quem manda no *catálogo*: `diagnostics.md`.

### 8.1 Debug (engenheiro)

| Sinal | Onde | Default prod | Uso |
|-------|------|----------------|-----|
| `MOZ_LOG=Speculum:5` | processo Gecko | **off** | último recurso; não por mutação |
| `Fault` ABI | ponte | on | queda observável, `errorCode`+`phase` |
| Bytes crus no L1/L2 fail | teste | n/a | doc 19: a saída conserta, não investiga |

Proibido: `SPECULUM_LOG` em todo insert/attr/text. O observer só loga boot/tick/resync/attach.

### 8.2 Eventos (linha do tempo)

Todo evento: `contextId`, `u16 catalogId` no Kind `0x05`. Toggle off → um atomic, sem alloc/IPDL. Default **off**.

`SPECULUM_CAP_EVENTS=1` liga os eventos. `SPECULUM_CAP_METRICS=1` preenche `buildMs` (relógio só se events **e** metrics).

**Produtor (Gecko → supervisor → produto):**

| catalogId | Nome | Quando | Campos |
|-----------|------|--------|--------|
| 1 | `frameEmitted` | frame não vazio saiu | `sequence`, `generation`, `bytes`, `opCount`, `tableSize`, `identitySize`, `buildMs`, `encodeMs`, `dropped`, `resync` |
| 2 / 3 / 4 | `resyncRequested` / `Completed` / `Failed` | `Resync` | `force`; completed/failed: `ok` |
| 5 | `producerFault` | helper existe; **ninguém chama** neste V1. Queda = `Fault` ABI `0x02ff` | `errorCode`, `phase` |
| 6 / 7 | `inputAdmitted` / `inputRejected` | apply nativo | `type`; **não** prova que o site reagiu |

Fora deste V1: `queuePressure`. CSS no mesmo `frameEmitted.opCount` — **não** há evento `cssomTick`.

**Cliente (já existe no pacote, reusar):** `applyResult`, `desynced`, `applyOverrun`, `applyGateDrain` / `Overflow` / `OverflowLoop`.

**Não inventar** evento `cssomPoll` no Gecko.

Heartbeat `0x0202` já existe — liveness da ponte, não da tabela.

### 8.3 Embutido (de graça no artefato)

- Frame: `preTableHash`, `CHECK`, flag resync, `contextId`, `generation`, `sequence`.
- `frameEmitted.buildMs` / `encodeMs` / `applyMs` no cliente: CPU operacional **por `contextId`**. Não é Profiler de processo.

### 8.4 Probes (lab / MotorAssert)

Nomes do dump iguais ao contrato de sessão. Transporte = ABI da ponte (doc 18). **Não** copiar `browser-session.md` RPC, `page.evaluate`, Playwright ou bus. ABI fechada no doc 18:

| Comando | Efeito |
|---------|--------|
| `HaltClocks` | para o timer de **todos** os `C` da aba. Observer/callback **ainda** enfileiram; não emitem sozinhos. |
| `ResumeClocks` | liga de novo |
| `FlushFrame` | drena o sujo **desta** `C` (DOM + CSSOM + PROP) e emite o frame S agora. Relógio continua halt. |
| `Snapshot` | dump da tabela **depois** do flush, estampado com `{ sequence, generation, contextId, tableHash }` desse S |

**Iso (um turno, um `C` ou N `C` da aba já halt):**

1. `HaltClocks` (congela o relógio — senão um tick entra no meio).
2. `FlushFrame` por `C` que o lab vai comparar — drena mutação pendente e **emite** S.
3. `Snapshot` nesse `C`, mesmo S. CSSOM vai **na tabela** (`SHEET`/`RULE` rows). Opcional: ler `StyleSheet` vivos agora (halt, pós-flush) para tabela×live.
4. Cliente recebe S, aplica, tira o snapshot dele. Lab compara os dois dumps.

Sem passo 2 o cliente não tem S. Sem passo 1 o dump rasga. `S` é por `contextId` — nested não alinha sequence entre pai e filho; halt é da aba inteira.

Dump (bytes do `snapshotDump`):

- cabeçalho: `{ sequence, generation, contextId, tableHash, rowCount, lastFrameNewNodes }`
- por linha: `{ id, kind, parent, rowHash }`
- ordem dos filhos entra no `rowHash` (`prevSibling`); o dump **não** lista `liveChildOrder` à parte
- CSSOM: as rows `SHEET`/`RULE` **são** o committed. Não existe pass in-flight.

`getTelemetrySnapshot` (barato, produto): seq/gen, `tableSize`, profundidade de fila, halted, fps recente. **Nunca** iso.

CPU de processo: amostragem do processo de conteúdo — **não** por `contextId`. Profiler de processo não se finge de breakdown por iframe.

### 8.5 Métricas de performance (quando faz sentido)

**Sim — como O3 / capacidade, nunca como substituto de 1:1.**

| Budget | Como se mede no Gecko | Liga? |
|--------|----------------------|--------|
| P1/P2 Δ paint | timestamp `Navigated` / load vs primeiro frame aplicado no cliente | sim, amostrado |
| P3 lag live | `frameEmitted` ts → `applyResult` ts | sim |
| P4 input local | só cliente (sem rede) | já no Projected |
| P5 input autoritativo | ts do `Input` ABI → efeito no Virtual (probe de DOM, não o envelope) | sim |
| P6 hard-nav swap | gen bump → superfície armada sem blank | sim |
| P7 visual | O1 (screenshot mesmo viewport) — **ainda não existe**; não fingir com hash | quando O1 existir |
| E1/E2 walk resync | `buildMs` do `resyncVirtual` | sim |
| E3/E4 µs/op | `buildMs/opCount`, `applyMs/opCount` | sim, percentil |
| E5 encode+wire | `encodeMs` + hop IPC + socket | sim — **item O** |
| E6 CPU sessão | amostragem periódica do processo (toggle `metrics`) | sim |
| E7 memória tabela | `tableSize` + RSS do content | sim |
| E9 apply cliente | `applyOverrun` já existe | reusar |
| E10 boot | `Ready` − launch | sim |
| E11 densidade | O4 — N sessões; **não rodado** | não inventar número |

**Não medir** (não faz sentido / mente):

- FPS de CSSOM lockstep (aceite é percebido)
- `tableSize` vs `identitySize` como igualdade
- CPU por iframe via Profiler
- “log lines per second”

### 8.6 Oráculos (lab monta; sessão não)

| # | Precisa disto no Gecko |
|---|------------------------|
| O1 visual | probe de paint/screenshot no Virtual **e** no Projected, mesmo viewport |
| O2 estrutura | Snapshot §8.4 + apply estrito no cliente |
| PP-PROP-1 | `formProps` no dump, settle, ninguém digitando |
| PP-FR-1 | `frameNewNodes` no dump, **também no meio do churn**, não só halt |
| O3 budget | percentis dos eventos §8.2/§8.5 em CI — hoje não é gate |
| O4 densidade | harness N sessões — não existe |
| O5 latência de gesto | P4/P5 com rede parada — não existe |

### 8.7 ABI fechada (doc 18)

Kind `0x05 Telemetry`: `u16 catalogId` + `bytes` opacos. Supervisor encaminha; não parseia.

Kind `0x06 Asset`, mão dupla: `u32 streamId`, `u8` fase (`request` / `chunk` / `denied` / `complete`), `u64 offset`, `bytes`. Recusa HTML/JS/CSS/XHR é fase `denied` no falso/Gecko, não MIME no supervisor.

Comandos: `HaltClocks 0x010d` (aba, todos os `C`), `ResumeClocks 0x010e`, `FlushFrame 0x010f` (um `C`), `Snapshot 0x0110` (um `C`).

Resposta: Event `SnapshotServed 0x020a`, mesmo `CorrelationId`. Campos: `sequence`, `generation`, `contextId`, `tableHash`, `bytes` do dump. Estoura teto → `Fault` com `errorCode: response_too_large`, nunca dump ilimitado.

Halt ≠ `discardPending`. Halt para o timer; a fila continua; Flush chama `emitFrame`.

---

## 9. Furos que a revisão fechou (papel e cola)

A primeira versão deste doc cobria o desenho e deixava a cola como “ainda não”. Em 2026-09-14 a cola V1 está no tree. O que falta é o mach + L4. Se algo disto ainda estiver vago, para e escreve — não chuta.

| Furo | Fechado como |
|------|----------------|
| `cssom.md` C5 = poll / “hooks rejected” | mapa: poll é Chromium; RuleAdded C++ não é hook JS |
| Closed autor como NIT | 2.5 + L8; sem `closedShadowCapture` |
| `frame-protocol.md` §5 como produtor | mapa no §0 — ISA sim, §5.1–5.7 não |
| Spec V4 de mecanismo (poll, bus, CDP, evaluate) | mapa no §0 — fio sim, produtor JS não |
| Diálogo/perm/download sem plano | 2.20 |
| PP-FR-1 / op no callback | L24, plano 2.19 |
| O que não é plano | 2.23 |
| Viewport, histórico, upload, fontes | 2.15–2.18, 2.22 |
| `MOZ_LOG` como telemetria | L22, §8.1 |
| Evento vs probe vs métrica | L21, L25, §8 |
| Halt/snapshot sem ABI | §8.4, §8.7 |
| Item O / backpressure | 2.21, `queuePressure` |
| O1–O5 no caminho Gecko | §8.6 |
| Instrumentação “depois” | L26, ordem §4 |
| Rebuild no passo 1 | §4: rebuild é o 9 |
| Media `currentTime` como se fosse PROP desta cut | 2.23 |
| `ParentChainChanged` | 2.23 |
| Profiler CDP | §8.4 |

Ainda **de propósito aberto** (não chutar):

- Canvas e print: **1.1**, spec já estacionou. Não entram neste V1.

