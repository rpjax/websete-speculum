# 21 — Fluxo de entrega e época (redesenho do produtor C++)

**Status:** **PROPOSTA.** Não é lei. Nada aqui autoriza patch antes do ruling do Rodrigo.
**Escopo:** produtor nativo do fork (`speculum-wire` + `gecko-engine/patches`). Não mexe no ISA, não mexe no apply do Projected.
**Base:** [`20-projecao-completa.md`](20-projecao-completa.md) (leis L0–L26) · [`frame-protocol.md`](../page-projection/spec/frame-protocol.md) §2, §6, §8 · [`acceptance.md`](../page-projection/spec/acceptance.md).

---

## 0. Por que este doc existe

O produtor JS do sidecar era um algoritmo fechado. O produtor C++ é um port dele — **mesmo algoritmo, sensor nativo**. Não se porta o JS.

Três garantias do desenho original não vieram. Sem elas, a quantidade de defeitos no Beleza (`reason=lag`, `sequence_gap`, apply-gate, cascata de resync, visual quebrado) não é ruído de cola:

1. **Entrega** — `sequence` só anda quando o frame saiu (`frameEmitter.ts`). §2.
2. **Época** — o produtor escreve a própria `generation`. §3.
3. **Tick** — o callback **não processa**; o drain decide contra o DOM vivo (`frame-protocol.md` §5.2–§5.6). §12.

Todas as correções até agora foram no **cliente**, compensando do lado errado. Este doc nomeia as três, propõe o conserto na raiz e diz o que se apaga depois.

---

## 1. O diff que importa

| Garantia | Sidecar (TS) | Fork C++ | Consequência |
|---|---|---|---|
| `sequence` | contador de **entrega** — só avança quando o transporte aceitou todas as partes (`frameEmitter.ts:294`); enquanto há parte pendente **não constrói frame novo** (`frameEmitter.ts:160`) | contador de **build** — `h.sequence = ++sequence_` (`Producer.h:394`), sem qualquer retorno da entrega | frame descartado depois do build = buraco permanente ⇒ `sequence_gap` no cliente |
| Freio | transporte devolve `deferred` no watermark (256 KiB) e o produtor para de construir | **não existe.** `appliedSequence` / `ack` / `backpressure` / `queueDepth`: zero ocorrência no fork | produtor inunda; cliente fica atrás ⇒ `reason=lag` em cascata |
| Descarte | não há — ou entrega, ou fica pendente | três caminhos silenciosos: `fd < 0` (`SpeculumProjectionRuntime.cpp:1929`), falha de `SendEnvelope` (`:1933`), frame curto com `IPC_OK()` (`ContentParent.cpp:1283`) | perda de fio sem `errorCode`, sem `phase`, sem evento |
| `generation` | vem do `initContext` **antes** do build; produtor conhece a própria época | produtor nasce `generation = 0` e nunca atualiza (`Producer.h:61`); o **pai remenda bytes** no offset 8 (`StampGenerationLocked`, `:1902`) a partir de um `docToken` que é `static` **por processo de conteúdo** (`SpeculumNodeSource.cpp:70`) | payload opaco reescrito por quem devia ser cego (L9); troca de processo pode não bumpar época |
| Partes | `BinaryFrameEncoder` divide o frame; partes compartilham gen/seq | `partIndex`/`partCount` existem no header e são escritos, mas **nada seta valor ≠ 0/1** | tick pesado = um frame único sem teto |
| Limites §8 | compartilhados produtor↔cliente (`core/limits.ts`) | **ausentes no produtor**; só o cliente aplica | produtor emite além do permitido; cliente recusa para sempre (`captures/battery-20260914-155314.txt`: `MAX_ROWS (200000) exceeded`) |
| Coalescing por tick | atributo por `(nó, nome)`, texto por nó, valor vivo lido **uma vez** na emissão, `!isConnected` pulado | um `ATTR_SET`/`TEXT_SET` por callback do observer (`Producer.h:228`, `:246`), sem dedup e sem checar se o nó sobreviveu ao tick | volume multiplicado; L24 furada para atributo/texto |
| Conjunto `visited` por tick (§5.3) | `this.visited` barra o nó já caminhado (`tableFrameBuilder.ts:356`) | **não existe** | **INSERT duplicado** — §11 P6 |
| `INSERT` em lote | uma op por corrida contígua de irmãos, **uma** âncora por corrida (`walkSiblingRun`) | uma op **por nó** + uma varredura de `childrenOf` **por nó** (`Producer.h:507`) | o O(batch²) que o TS mediu e matou — §11 P7 |
| Form props | índice de controles (`formIndex.addIfIndexed`) | varre **todo** o espaço de ids por tick (`Producer.h:583`) | §11 P8 |
| CSSOM | poll incremental em `requestIdleCallback`, fora do tick | itera **todas** as folhas × **todas** as regras a cada tick (`Producer.h:560`) | poll disfarçado de drain — §11 P9 |
| Tick (§5.2) | callback só empilha; drain congela e decide | `INSERT`/`DROP` na fila; `REMOVE`/`ATTR`/`TEXT` no callback | o corte não existe no original — §12 P10 |
| Move no mesmo tick (§5.6) | se ainda `isConnected`, **sem** `REMOVE` | `REMOVE` no callback (`Producer.h:222`); DROP espera o tick | `REMOVE`+`INSERT` no fio; o comentário lembrou o DROP e esqueceu o `REMOVE` |
| Mint nested pendente | `mintHeld` → `return null` (não emite) | `hasMintHold()` → `emitFrame` vazio; host fica em `pendingHosts_` | **hold do pai há.** Furo restante: filho emite COMPLETE antes do host no socket (emit-allow) |
| `NODE_DROP` | idade `NODE_DROP_AGE_SEQUENCES` (20 ticks), OPEN-2 | DROP no fim do **mesmo** tick se ainda solto | id morto; ressuscitar no tick seguinte não reusa |
| `attachShadow` tardio | lê `.shadowRoot` nos vivos a cada tick (`discoverShadowRoots`) | só no caminho de describe/insert; **sem** gancho em `Element::AttachShadow` | shadow criado tarde some |
| Shadow `initFlags` | lê `delegatesFocus` / `clonable` / `serializable` | sempre `0` (`Producer.h:774`) | `rowHash` e `attachShadow` projetado errados |
| Folha adopted de shadow | `PIERCE_HOST` + id do host | `host=0, scope=0` (`Producer.h:600`) | CSS do shadow pinta no documento |
| Resync `PROP_SET` | `formIndex.sample` no `emitResyncFrame` | DOM + CSSOM, **sem** form | input/checkbox voltam ao default no resync |
| Subárvore no meio da lista | âncora `resolvedBefore` | `describeAndInsertChildren` sempre `kInsertAtEnd` | bloco no meio sai no fim |

**Segunda passada (2026-09-16):** walk — §11 (P6–P9).
**Terceira passada (2026-09-16):** o tick como ponto de congelar — §12 (P10–P16). P4, P6 e o move caem juntos no P10; não são três patches.

**Provado por código:** todas as linhas acima.
**Hipótese ainda não provada:** que o Beleza colida `docToken` na troca de processo (a forma do defeito está no código; o gatilho no site não foi medido).

**Não entra neste plano (não é defeito de port):** CHECK em todo frame incremental (o C++ é **mais** fiel ao protocolo que o TS v0); filtro `::-moz-` (NIT de produto: Projected aplica no Chromium); `<style>` autoral fora do plano CSSOM (os dois fazem de propósito).

---

## 2. P1 — `sequence` é crédito de entrega

### Defeito

O número sai no build e o frame pode evaporar depois. O cliente então descobre sozinho, por buraco, algo que o produtor já sabia.

### Lei proposta (L27)

> **Frame emitido é frame entregue.** `sequence` só avança quando a ponte aceitou os bytes. Não existe terceiro estado entre entregue e sessão morta. Produtor não constrói frame que a ponte não tem como escoar.

### Algoritmo

**P1a — matar o descarte silencioso.** Os três caminhos viram falha catalogada com `errorCode` + `phase` ([`diagnostics.md`](../diagnostics.md)). Ponte caiu = sessão morre (L10) — que já é a lei; o defeito é continuar viva perdendo frame.

**P1b — crédito de janela.** O pai é dono do socket, então é o pai que dá crédito:

- o pai mantém, por `contextId`, **janela em bytes em voo + teto de frames em voo** (ruling 2026-09-16): bytes controlam a ponte, o teto de frames impede rajada de frames pequenos passar pela janela;
- concede crédito ao produtor por IPDL assíncrono (`SpeculumFrameCredit`);
- sem crédito, o produtor **não chama `emitFrame`**. O timer continua, a fila continua, a tabela continua coalescendo — isso já é o desenho (§2.19: "Halt para o relógio; a fila continua"). Nada se perde: o próximo frame carrega o efeito acumulado.

**Não é ack do cliente.** O sidecar nunca teve ack do cliente — tinha `bufferedAmount` do transporte. Paridade aqui é crédito da ponte, não confirmação de apply. Manter isso honesto evita inventar acoplamento que o original não tinha.

### Prova

Beleza cold com `reason=lag` **zero**, sem depender da fila de 256 do cliente. Unit em `speculum-wire`: sem crédito, `sequence` não anda e nenhum efeito se perde no frame seguinte.

### Proibido

Rolar `sequence` para trás. Reenviar frame já contado. "Pular" o frame perdido e seguir.

---

## 3. P2 — a época nasce no produtor

### Defeito

Autoridade no lugar errado, por um caminho que o próprio protocolo proíbe. `frame-protocol.md` §2: *"allocated by the context authority … Never derived or packed from another value … The producing context writes it."* Hoje o produtor escreve `0` e o pai sobrescreve o campo remendando o payload — e a decisão de bumpar depende de um contador `static` por processo, que reinicia em 1 quando o Gecko troca de processo de conteúdo. O comentário em `SpeculumProjectionRuntime.cpp:1900` descreve exatamente o risco que o mecanismo não cobre: *"Sem isto, a página nova chega como continuação da anterior."*

### Algoritmo

- No attach do Document, o conteúdo **pede** a época: IPDL sync `SpeculumClaimGeneration(contextId)` — mesmo formato do `SpeculumMintContextId` que já existe.
- O pai devolve monotônico por `contextId`, incrementando **por claim**. Um claim por Document daquela instância. Fim do `docToken`.
- `StampGenerationLocked` e o remendo de bytes **saem**. Payload volta a ser opaco (L9).
- `Producer::generation_` passa a ser real ⇒ dump de snapshot e `CHECK` param de divergir do fio.
- L17 intacto: resync não pede época; soft-nav não pede época.

### Prova

Navegação com troca de processo: época sobe **exatamente 1**. `generation` do snapshot igual à do frame no mesmo S. Iframe navegando mantém `contextId` e sobe época daquela instância.

---

## 4. P3 — limites e partes no lado que emite

`frame-protocol.md` §8 diz que os limites são checados **antes de qualquer alocação**. Hoje só o cliente checa, então o produtor produz o que o cliente é obrigado a recusar.

- `Limits.h` em `speculum-wire` com os mesmos números do cliente: `MAX_OPS_PER_FRAME` 65536, `MAX_CHILDREN_PER_OP` 8192, `MAX_STR_BYTES` 1 MiB, `MAX_ROWS` 200000.
- Divisão de partes de verdade, usando o `partIndex`/`partCount` que já está no header: teto por ops **e** por bytes.
- `MAX_ROWS` estourado deixa de ser recusa infinita do cliente. **Ruling 2026-09-16:** o produtor primeiro faz **GC de linha morta** (linha destacada que ninguém mais referencia — o `pendingDrop_`/`NODE_DROP` já é o mecanismo, o que falta é varrer sob pressão); só se ainda estourar depois do GC é que vira **falha catalogada** com `errorCode` + `phase`. Nunca emitir além do teto e deixar o cliente recusar.

### Prova

Bateria de stress sem nenhum frame `RECUSADO` por limite. Frame grande chegando em partes e aplicado como **uma** transação.

---

## 5. P4 — coalescing por tick (fatia do P10)

O §2.2/§2.4 do doc 20 já mandam: *"Enfileira no callback; drena no `emitFrame`"*. O caminho de atributo e texto enfileira **op**, não **sujeira** — então churn não colapsa e nó que morre no mesmo tick ainda leva `ATTR_SET`, o que é L24 furada.

Isto **não é um passo isolado**. É o que o P10 (§12) faz para atributo/texto. Listado aqui para não perder a prova:

- `dirtyAttrs_` por `(nó, nome)` e `dirtyText_` por nó; uma leitura do valor vivo na emissão.
- Pular `!isConnected` na emissão, igual ao que o walk estrutural já faz.

### Prova

Unit L0: 1000 `setAttribute` no mesmo nó/nome = **1** op. Nó criado e destruído no mesmo tick não leva `NODE_NEW` **nem** `ATTR_SET`/`TEXT_SET`.

---

## 6. P5 — ponte sem head-of-line blocking

Frame, controle, ativo e telemetria dividem um `fd` e um mutex, com `send()` bloqueante (`WriteAll`). Escrita de frame grande atrasa entrega de resync — o doc 12 pediu ponte sem HOLB justamente para resync/scroll/tecla em rajada. Com P1b a pressão cai muito; ainda assim controle não deve enfileirar atrás de frame.

Menor prioridade que P1–P4. Não misturar no mesmo passo.

---

## 7. Dívida de compensação no cliente

Depois que P1–P4 estiverem provados, isto volta para a mesa — **não antes**, e não de uma vez:

| Peça | Hoje | Depois |
|---|---|---|
| `maybeRequestLagCatchUp` / `reason=lag` | compensa produtor sem freio | deve deixar de disparar; se ainda disparar, é sinal, não conserto |
| `ProjectedApplyGate` cap 256 + `overflow streak 3` | absorve inundação | reavaliar teto e heurística |
| `sequence_gap` | dispara por perda auto-infligida | **fica** — perda real de fio tem que continuar detectável |
| `precondition` | divergência de estado | **fica** |

Regra: nada sai do cliente sem prova de paridade primeiro. Tirar o amortecedor antes de consertar a suspensão é o mesmo erro na direção oposta.

---

## 8. Ordem (escada L16, sem pular)

Três eixos. Não misturar no mesmo passo. Aceite 1:1 do Beleza **não** é passo desta lista — mede-se depois, por superfície e same-S, nunca por HUD.

**Eixo A — entrega**

| Passo | O que | Degrau de prova |
|---|---|---|
| 1 | P1a — zero descarte silencioso | falha catalogada com `errorCode` + `phase`; nenhum `IPC_OK()` mudo |
| 2 | P1b — crédito de janela | unit L0 + Beleza cold `lag = 0` |
| 3 | P3 — limites + partes | bateria de stress sem recusa por limite |

**Eixo B — época**

| Passo | O que | Degrau de prova |
|---|---|---|
| 4 | P2 — época no produtor | unit L0 + nav com troca de processo (época +1) + snapshot == fio |

**Eixo C — o tick** (um conserto, não cinco)

| Passo | O que | Degrau de prova |
|---|---|---|
| 5 | **P10** — callback só enfileira; drain decide contra o DOM vivo. Absorve P4 (attr/texto), P6 (`visited`), move §5.6 (sem `REMOVE`), mint hold | unit L0: move = 1 `INSERT`; pai+filho = 1 `INSERT` cada; mint pendente = **zero** frame; cadáver do tick não viaja |
| 6 | P7 + P16 — `INSERT` em lote + âncora (não `INSERT_AT_END` cego) | prepend em bloco, `ops/nó` plano; bloco no meio da lista na posição certa |
| 7 | P11 — `NODE_DROP` por idade (OPEN-2), não no mesmo tick | unit: destaque + reattach no tick seguinte reusa o id |

**Eixo D — o que o tick ainda não vê** (sensor nativo faltando, não poll)

| Passo | O que | Degrau de prova |
|---|---|---|
| 8 | P12 + P13 — gancho `AttachShadow` + `initFlags` reais | shadow criado tarde aparece; `delegatesFocus` no fio ≠ 0 |
| 9 | P9b + P9c + P14 — folha tardia, `@import`, pierce host | oráculo de regras Virtual × tabela; CSS adopted de shadow no shadow |
| 10 | P8 + P15 + P9a — índice de form, PROP no resync, drain da fila CSSOM | resync preserva value/checked; custo por tick não escala com a tabela |
| 11 | P5 — HOLB da ponte | resync em rajada sem atraso atrás de frame |

---

## 9. Rulings

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Crédito por bytes, por frames, ou os dois? | **Os dois** — janela em bytes em voo + teto de frames em voo (Rodrigo, 2026-09-16). §2. |
| 2 | `MAX_ROWS` estourado no produtor | **GC de linha morta primeiro**; falha catalogada só se ainda estourar (Rodrigo, 2026-09-16). §4. |
| 3 | Ack do cliente entra no fluxo? | **Pendente.** Recomendação: não — paridade com o sidecar é crédito de transporte, não confirmação de apply. |
| 4 | `docToken` sai de vez? | **Pendente.** Recomendação: sim, substituído pelo claim de época (§3). |
| 5 | Tick: callback só enfileira? | **Não pede ruling novo.** Já é `frame-protocol.md` §5.2–§5.6 e doc 20 §2.2 ("não descrever no callback"). P10 é compliance. |

**Estado:** doc em revisão pelo Rodrigo (2026-09-16). Implementação **não** liberada, nem o passo 1 da §8. Terceira passada (§12) incorporada a pedido; eixos A–D na §8.

**Estado:** doc em revisão pelo Rodrigo (2026-09-16). Implementação **não** liberada, nem o passo 1 da §8.

---

## 10. Emendas que este redesenho exige nos docs vigentes

Só depois do ruling:

- **doc 20 §2.21** — "Pressão e item O … fora deste V1 (capacidade)" está errado de classificação: fluxo de entrega é **correção**, não capacidade. Era o que mantinha `sequence` coerente no sidecar.
- **doc 20 §2.19** — "Halt impede S+1 até o cliente aplicar S" não está implementado (o Halt só para o relógio). Implementar ou corrigir o texto.
- **doc 20 §3** — linha `Backpressure (drop oldest) … fora deste V1` vira crédito de entrega **dentro** do V1.
- **doc 20 §5** — anti-padrões ganham: descartar frame com `sequence` já consumido; estampar campo do protocolo fora do produtor.
- **doc 20 §1** — nova lei L27 (§2 deste doc).
- **`frame-protocol.md` §2 / §8** — reafirmar que quem produz escreve a época e que os limites valem para o produtor.
- **doc 20 §2.2** — "Proibido: descrever no callback e chamar isso de drain" já está escrito. `REMOVE`/`ATTR`/`TEXT` ainda descrevem no callback (`Producer.h:222`, `:228`, `:246`). P10 fecha isso.

---

## 11. Segunda passada (2026-09-16) — o miolo do walk

A §1–§6 olhou o fluxo (entrega, época, limites). Esta passada leu o **algoritmo de construção** linha por linha contra `tableFrameBuilder.ts`. Lembrete do que o port devia ser: **mesmo algoritmo**, nativo. Não é "outra implementação com a mesma ISA" — é o mesmo desenho.

### P6 — conjunto `visited` por tick era correção, não otimização

`frame-protocol.md` §5.3 manda um `Set<Node>` por tick. O TS usa em `walkSiblingRun`:

```356:359:packages/page-projection/src/virtual/dom/tableFrameBuilder.ts
      if (!node.isConnected || this.visited.has(node)) {
        i += 1;
        continue;
      }
      this.visited.add(node);
```

O C++ **não tem**. E aí acontece isto: pai `P` e filho `C` inseridos no mesmo tick entram **os dois** em `pendingInserts_` (`onInserted` reserva o id de `P` cedo, então `idFor(P) != kNone` quando `C` chega — `Producer.h:196`). No drain:

1. item `P` → `ensureDescribed(P)` → `describeAndInsertChildren(P, idP)` já emite **`INSERT` de `C` sob `P`** (`Producer.h:827`);
2. o laço chega no item `C` → a linha existe, então pula o describe — **mas emite `INSERT` de `C` sob `P` de novo** (`Producer.h:507-509`).

`ReplicatedTable::insertBatch` trata id já ligado como **move** (`Table.h:231`: desliga de onde estiver e religa), então na posição normal o segundo `INSERT` é um move para o mesmo lugar: não quebra o `CHECK`, não aparece como desync. O que ele faz é (a) dobrar ops de estrutura no fio, (b) rodar `unlink`/`linkAfter` de graça — e `unlink` tem o **OPEN-8** conhecido (`Table.h:356-359`, prepend + evict da cauda), (c) fazer o Projected re-materializar o nó na fase 2.

O comentário do `ensureDescribed` (`Producer.h:427`) mostra que já passaram por aqui — "Beleza/criteo: pai+filho no mesmo tick" — e consertaram a **ordem** (`NODE_NEW` antes do `INSERT`) sem consertar a **duplicação**. Sem o `visited`, o registro do filho continua sendo processado depois do walk do pai.

**Conserto:** `visited` por tick, marcado em `describeAndInsertChildren`/`insertLiveChildren` e conferido no drain. É o §5.3 do papel.

**Prova:** unit L0 — pai + filho inseridos no mesmo tick produzem **um** `INSERT` de cada nó. Contagem de ops do frame contra a árvore.

### P7 — `INSERT` em lote e uma âncora por corrida (o port voltou num bug já morto)

O TS documenta a medição no próprio código:

```338:342:packages/page-projection/src/virtual/dom/tableFrameBuilder.ts
   * Found empirically 2026-08-13 (`prepend-stress.html`, a block-prepend fixture — the
   * "load older messages" / virtualized-list-reorder shape): the old one-`resolvedBefore`-
   * per-node walk was O(batch²) for a single large sibling block and measured as 34% of
   * total producer CPU at a 1600-node batch. This makes it O(batch) — one anchor lookup per
   * contiguous run, not per node.
```

O C++ faz exatamente a versão descartada. `ContentAppended` percorre os irmãos e chama `onInserted` **por nó** (`SpeculumMutationObserver.cpp:462`), então um fragmento de N nós gera N `pendingInserts_`. No drain, **por nó**: `beforeIdOf` (que monta o vetor de **todos** os filhos do pai — `Producer.h:413` → `SpeculumNodeSource.cpp:183`, retorno por valor) e uma op `INSERT` de um id só (`Producer.h:507`).

Fragmento de 1600 nós = 1600 vetores de 1600 ponteiros + 1600 ops `INSERT` onde o desenho pede **uma**. `MAX_CHILDREN_PER_OP` (8192) existe justamente porque `INSERT` carrega lista.

Note que o lote **existe** no C++ — `describeAndInsertChildren` e `insertLiveChildren` montam `batch` (`Producer.h:791`, `:808`). Só o caminho de mutação incremental, que é o quente, ficou sem.

**Conserto:** agrupar corrida contígua de irmãos no drain (contiguidade conferida ao vivo, como o TS faz, nunca assumida da ordem do registro) e uma resolução de âncora por corrida.

**Prova:** fixture de prepend em bloco; `ops/nó` plano quando o lote cresce 16×.

### P8 — form props precisa de índice, não de varredura

```583:596:gecko-engine/speculum-wire/include/speculum/Producer.h
    const std::vector<uint32_t> ids = ids_.allIds();
    for (uint32_t id : ids) {
```

Todo tick de 16 ms: cópia do espaço **inteiro** de ids da sessão, e para cada elemento uma chamada virtual + um vetor novo em `formPropsOf`. Numa página de dezenas de milhares de nós isso é O(linhas) a 60 Hz para amostrar meia dúzia de inputs. O TS mantinha `formIndex` e registrava só o controle (`tableFrameBuilder.ts:401`).

O §2.7 do doc 20 diz "amostra C++ no tick" — amostrar os **controles**, não a tabela.

**Conserto:** índice de controles alimentado no describe/`NODE_DROP`.

### P9 — CSSOM: o drain do C++ é um poll (e dois furos que o sidecar não tinha)

**P9a — poll disfarçado.** `drainCssom` recolhe `pendingSheets_`/`pendingRules_` e **descarta**, depois itera `source_.cssomSheets()` × `source_.cssomRulesOf(sheet)` inteiros para achar quem não tem linha (`Producer.h:554-571`). As duas leituras retornam vetor **por valor** (`SpeculumNodeSource.cpp:517`, `:521`). Isso roda a cada tick, mesmo quando só um atributo mudou. É O(todas as regras) por tick — e "poll CSSOM no Gecko" está na lista fechada de anti-padrões do doc 20 §5. As filas ficaram só como contabilidade de id.

**Conserto:** drenar a fila (que é o que o §2.4 manda), não re-derivar o mundo.

**P9b — medido: o plano CSSOM vivo não emite nada.** A hipótese abaixo era "folha externa tardia perde as regras". A medição no lab frio mostrou algo **maior**: nenhuma mudança de CSSOM depois do bootstrap produz op — nem folha construída com `insertRule`, que só tem esse caminho para chegar.

A/B na mesma fixture, provado pelo **fio** (frames decodificados), não por HUD:

| Caso | Virtual tem | Regras no fio | Tabela do produtor | Superfície |
|------|-------------|---------------|--------------------|------------|
| Folha presente **antes** do bootstrap (`<link>` no HTML + construída no parse) | 21 + 21 | `CTRLMARK` **40**, `HTTPMARK` **40** (2 resyncs × 42 regras) | `sheets=2 rules=42` | pinta os dois — **1:1** |
| Mesma folha injetada **depois** do `load` | 21 + 21 + 21 | **0, 0, 0** | `sheets=0 rules=0` | só o `data:` pinta, e só porque o browser Projected parseia o `<link>` que veio pelo **plano DOM** |

O caso `CTRLMARK` é o que fecha: folha construída não tem representação no DOM, então o plano CSSOM é o **único** caminho. Presente no bootstrap: 40 regras no fio, marcador azul. Injetada depois: zero no fio, marcador cinza.

Consequência de aceite: `acceptance.md` promete **CSSOM live percebido 1:1 (eventual)**. Medido, CSSOM live não é eventual — é **ausente**. Só bootstrap e resync carregam CSSOM.

Os ganchos existem e chamam certo (`SpeculumMutationObserver.cpp:180-224` faz `source.NoteSheet` + `producer.onSheetAdded`). Como frames **foram** emitidos nos mesmos ticks (o texto de fase chegou na superfície) e `drainCssom` roda dentro do `emitFrame`, a notificação não chegou ao produtor: `mSheets` ficou vazio. Ou seja, `Document::InsertSheetAt` / `Document::RuleAdded` não são os caminhos que a mutação viva de CSSOM realmente toma (folha adotada não passa por `InsertSheetAt`; `<link>` inserido depois entra por `LinkStyle`). **Gancho no lugar errado** — é o padrão "último hop morto": o hook está na árvore de patch, o caminho vivo não bate nele.

**Causa fechada no checkout, e não era desenho.** O gancho está no lugar certo: a macro `NOTIFY` de `StyleSheet.cpp` percorre `mAdopters` e chama `Document::RuleAdded` (cobre folha construída/adotada), e `Loader::InsertSheetInTree` chama `mDocument->InsertSheetAt` (cobre `<link>`). O que faltava eram duas coisas:

1. **Os call sites não existiam no checkout.** `SpeculumCssom.cpp` compila (está no `moz.build`) e **nenhuma** das cinco funções era chamada — as chamadas viviam só no espelho do repo. Done bar furado em produção: código na árvore, último hop morto. Aplicado com `devpath/_apply-cssom-hooks-to-checkout.py` (5 linhas + nomear `aRule` em `Document::RuleChanged`, que o checkout deixa sem nome). Efeito medido: `sheetNew` 0 → 2.
2. **`NoteRule` não registrava a folha em `mSheets`**, e `drainCssom` só varre `mSheets` — então a regra da folha adotada era enfileirada, ignorada no drain e tinha o id solto. Uma linha em `SpeculumNodeSource::NoteRule`. Isto prova que **P9a é correção, não só custo**: o drain re-derivar do mundo em vez de drenar a fila perde trabalho.

Estado medido depois dos dois consertos (mesmas fixtures, lab frio, `mach build binaries`):

| Caso | Regras no fio | Tabela | Superfície |
|------|---------------|--------|------------|
| Folha antes do bootstrap | `CTRLMARK` 40, `HTTPMARK` 40 | `sheets=2 rules=42` | pinta os dois — sem regressão |
| Construída + `insertRule` pós-`load` | `CTRLMARK` **20** (era 0) | `sheets=3 rules=21` | marcador **azul** — CSSOM vivo chega à superfície |
| `<link>` pós-`load` (`data:` e http) | **0** | folha sim, regra não | marcador http **cinza** — **segue aberto** |

O que sobra é exatamente a hipótese original abaixo: regra que nasce de *parse* não tem notificação. Precisa de gancho onde a folha fica aplicável/completa.

Evidência: `gecko-engine/devpath/captures/cssom-late-1789609558751/` (tardio, tudo zero) e `cssom-late-1789609728077/` (bootstrap, 1:1). Fixtures `cssom-late-sheet.html` / `cssom-early-sheet.html`; runner `_run-cssom-late-sheet.sh` / `_run-cssom-early-sheet.sh`.

Nota lateral, também medida: o dump do produtor traz `generation: 0` nas duas corridas, enquanto o fio carrega época costurada pelo pai — corrobora `GECKO-EPOCH-PARENT-STAMP` (§3) com medida, não só leitura.

**P9b (hipótese original) — não existe gancho de "folha ficou aplicável".** `SpeculumNotifySheetAdded` sai no `Document::InsertSheetAt` (`Document.cpp:7921`), que para `<link>` acontece **antes** do fetch terminar — `GetCssRulesInternal()` ainda vazio. As regras só entram por `CaptureLiveCssom`, e essa só roda no bootstrap e no resync (`SpeculumMutationObserver.cpp:301`, `:320`). O Gecko **não** emite `RuleAdded` para regra que veio de parse de folha. `Document::StyleSheetApplicableStateChanged` existe (`Document.cpp:7928`) e **não tem** gancho Speculum.

⇒ Folha externa inserida **depois** do bootstrap (chunk de CSS lazy, `<link>` injetado, widget de terceiro) chega no fio como `SHEET_NEW` **vazio** e as regras nunca viajam até algum resync acontecer. O bootstrap no `COMPLETE` salva a carga inicial (folha bloqueia `load`); o que carrega depois, não.

Isto **não existe no sidecar**: lá `<link>` não vai pelo plano CSSOM — o browser Projected busca o CSS (`cssomSheetList.ts:3`: *"Author `<style>`/`<link>` (`ownerNode`) paint via the projected DOM element"*). No fork, doc 13 §32 decidiu **não servir CSS** ("regras são replicadas"), e `SpeculumIsCssomPlaneSheet` põe `<link>` no plano (`SpeculumCssom.cpp:37`). A decisão é legítima; o gancho que ela exige não foi feito.

**P9c — `@import` não é caminhado.** `CaptureLiveCssom` percorre `root->SheetCount()` + `AdoptedStyleSheets()` (`SpeculumNodeSource.cpp:375-389`). Folha filha de `@import` não está em nenhuma das duas (é `ChildSheets()`). O texto da regra `@import` viaja como `@import url(...)`, e o cliente **não** busca CSS (doc 13). Resultado: CSS importado não chega por nenhum caminho.

**Prova de P9b/P9c:** oráculo de folhas — contagem de regras no Virtual × na tabela projetada, depois de injetar um `<link>` pós-load e depois de uma folha com `@import`. Não aceitar contagem de `SHEET_NEW` como prova.

### Suspeita não fechada

`styleEl.sheet.insertRule(...)` numa folha de `<style>` autoral: o plano CSSOM recusa (`SpeculumCssom.cpp:39`) e o texto do elemento `<style>` no DOM não muda, então a regra não viaja. O sidecar tem a mesma arquitetura para `<style>` (pinta pelo DOM), então **pode** ser furo compartilhado e não regressão do port. Não medi. Não tratar como port defect sem prova.

### Ordem sugerida para esta passada

Absorvida pela §8 eixo C (passo 5–7) e eixo D passo 9–10. Não há ordem paralela.

---

## 12. Terceira passada (2026-09-16) — o tick é o ponto de congelar

Lembrete: o port **não** é outra implementação com a mesma ISA. É o mesmo algoritmo, nativo. `frame-protocol.md` §5.1–§5.7 descreve o walk do inject (MutationRecord, WeakMap) — **não se porta o sensor**. Porta-se a **disciplina do tick**:

> Callback só enfileira. No tick, congela, olha o DOM **vivo**, decide move / detach / efêmero / PATCH, emite **um** frame, aplica a tabela do produtor **uma** vez.

O C++ fez isso pela metade: `INSERT` e `DROP` vão para a fila; `REMOVE`, `ATTR_SET` e `TEXT_SET` saem no callback. Esse corte não existe no original. P4, P6 e o move do §5.6 são o mesmo furo.

### P10 — um drain, não dois caminhos

**O que o callback pode fazer:** anotar o ponteiro (inseriu, removeu, sujou atributo X, sujou texto). Sem `builder_`. Sem `table_`.

**O que o `emitFrame` faz, nesta ordem, contra o DOM vivo:**

1. `visited` por tick (§5.3 / P6).
2. Walk de insert: `NODE_NEW` + `INSERT` (lote / P7).
3. Move vs detach (§5.6): ainda ligado → **sem** `REMOVE`; solto e tinha id → `REMOVE`; nunca teve id → nada (L24).
4. PATCH de atributo/texto no valor vivo, uma vez por `(nó, nome)` (P4). Pular `!isConnected`.
5. Nested host sem `C` ≥ 2 → **não emite o frame** (`hasMintHold` / `emitFrame` vazio). Ops ficam; o próximo tick tenta de novo. O TS: *"waiting for the real id is the protocol"* (`tableFrameBuilder.ts:213`). O filho (`C ≥ 2`) só emite depois do chrome liberar — frame do pai com o host já no socket.
6. Aplica a tabela **depois** de montar as ops, **antes** do sweep de DROP — o comentário longo em `tableFrameBuilder.ts:227-239` existe porque a ordem inversa emitia `INSERT`+`NODE_DROP` do mesmo id.

Hoje, `onRemoved` já emite (`Producer.h:222`) e o comentário na linha seguinte admite o move — para o DROP, não para o `REMOVE`. `onAttrChanged` / `onTextChanged` idem (`:228`, `:246`).

**Conserto:** uma função. Não um `if` em `onRemoved` "se reinseriu, não REMOVE" — isso reintroduz o callback como decisor.

**Prova:** unit L0 — `appendChild` + `removeChild` + `appendChild` no mesmo tick = **um** `INSERT`, zero `REMOVE`. Pai+filho no mesmo tick = um `INSERT` cada. `setAttribute` 1000× = uma op. Frame com mint nested pendente = vazio (sequence não anda).

**Proibido:** segundo caminho "só para move". Descrever no callback e chamar isso de drain (já está no doc 20 §5).

### P11 — `NODE_DROP` por idade, não no mesmo tick

OPEN-2 fechado no TS: linha destacada vive `NODE_DROP_AGE_SEQUENCES` (20) ticks; `emitNodeDropSweep` + `collectDroppableIds`. A tabela C++ **já tem** `collectDroppableIds` e o Producer **nunca chama**. `flushPendingDrops` mata no mesmo tick se `parent == kNone`.

Ressuscitar no tick seguinte (portal, keyed list) no original é `INSERT` do mesmo id. Aqui o id já morreu.

Encaixa no ruling 2 (`MAX_ROWS`: GC de linha morta **primeiro**): a varredura sob pressão é esta, não um DROP imediato.

**Prova:** destaque + reinsert no tick seguinte reusa o id. Sweep não emite `NODE_DROP` no mesmo frame do `REMOVE`.

### P12 — `attachShadow` não é mutação de `childList`

O TS: *"attachShadow is not a mutation record"* (`tableFrameBuilder.ts:429`) e lê `.shadowRoot` nos elementos vivos a cada tick. Isso no inject é poll porque não há outro sensor.

No Gecko o equivalente nativo é o gancho em `Element::AttachShadow` / `AttachShadowWithoutNameChecks` (o que não for UA). **Não** portar o poll. **Não** deixar só no caminho de `ensureDescribed` (`Producer.h:631`) — shadow criado depois do insert nunca aparece.

**Prova:** elemento já projetado chama `attachShadow` depois; o próximo frame tem `NODE_NEW SHADOW_ROOT` + filhos.

### P13 — `initFlags` reais

O fio carrega `delegatesFocus` / `clonable` / `serializable` (`frame.ts` bits; entra no `rowHash`). O TS lê (`shadowAdmit.ts` → `domNodeDescribe.ts:71`). O C++ escreve `0` (`Producer.h:774`). Projected faz `attachShadow` sem as flags; hash diverge.

**Prova:** host com `delegatesFocus: true` viaja `initFlags ≠ 0`; Projected foca dentro do shadow como o Virtual.

### P14 — folha adopted de shadow tem host

`emitSheetNew` manda `host=0, scope=0` (`Producer.h:600`). O TS manda `CSSOM_SCOPE_PIERCE_HOST` + id do host (`cssomOps.ts:47`). Sem isso o apply põe a folha na lista adopted do **documento**.

**Prova:** shadow com `adoptedStyleSheets`; a folha materializa no shadow projetado, não em `document`.

### P15 — resync amostra form

`emitResyncFrame` no TS: DOM + `formIndex.sample` + CSSOM + CHECK (`resync.ts:51-68`). O C++: DOM + CSSOM (`Producer.h:102-191`). Checkbox/value voltam ao default da tabela nova.

Cai de graça se P8 (índice) existir e o resync chamar `drainFormProps` **depois** de descrever. Sem o índice, vira de novo a varredura de todos os ids.

**Prova:** form preenchido; resync force 0; Projected mantém `value`/`checked`.

### P16 — subárvore nova no meio da lista

`describeAndInsertChildren` sempre `kInsertAtEnd` (`Producer.h:803`). `beforeIdOf` só no insert de topo (`:507`). Bloco inserido no meio (não append) sai no fim. P7 (lote + uma âncora por corrida) fecha isto se a âncora for a do **vivo**, não "sempre no fim".

**Prova:** inserir um fragmento **antes** de um irmão já projetado; ordem no Projected = ordem no Virtual.

### O que esta passada **não** pede

- Portar `takeRecords` / `MutationRecord` / WeakMap / poll de CSSOM / ContextBus. Sensor nativo continua nativo.
- Tirar o CHECK de todo frame incremental. O C++ aqui está **à frente** do TS v0.
- Filtro `::-moz-` (NIT: Projected é Chromium).
- Author `<style>` no plano CSSOM (os dois excluem de propósito).

