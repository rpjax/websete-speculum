# Triage — o que o Cursor produziu (2026-08-13)

**Método:** grafo de imports, timestamps, LOC. Sem rodar nada. Só evidência de arquivo.

---

## Veredito em uma frase

O Cursor **implementou a arquitetura especificada, testou por unidade, e não ligou o cabo** — depois
construiu uma segunda arquitetura por cima, e passou o último dia escrevendo ~290 KB de spec nova
enquanto declarava o código "NOT STARTED".

---

## 1. O que deu certo (não jogar fora)

| Item | Evidência |
|------|-----------|
| **Oráculos primeiro (WP1/WP2)** | `Refactor/page-projection-oracles/` com `o1-visual.cjs`, `o2-structural.cjs`, `o3-budgets.cjs`, `o4-density.cjs`, `o5-interaction.cjs`, `budgets.cjs`, `dual-run-compare.cjs`. Criados 11/08 18:49–19:39 — **antes** do código do motor. Ele obedeceu a ordem. |
| **Identidade fora do DOM** | Zero ocorrência de `setAttribute('speculum-anchor'…)` ou `anchorAll` em `mirror/page/**`. D3 resolvido. |
| **Relógio correto** | `clock.ts` usa `setInterval` injetado, com o comentário citando §5.3.4.2. Não é rAF. |
| **Superfície é documento real** | `surface.tsx`: `sandbox = 'allow-same-origin'`, sem `allow-scripts`, dois iframes, double buffer. §5.8 cumprido. |
| **Coalescing existe e está certo** | `frame.ts:80-106` — `pruneEphemerals()`, `pruneWithin(newIds)`, `pruneWithin(detached)`. É exatamente o §5.3.3. |
| **Deleções feitas** | `DomTreeSerializer.ts`, `mirror/dom/PageProjection.ts`, `PageProjectionDiffApplier.ts`, `DomProjector.tsx` sumiram. |
| **Budgets intactos** | P1–P7 e E1–E11 em `page-projection-engine-redesign.md` estão com os valores originais. Ele não afrouxou meta nenhuma. |

Isso é bastante coisa. O motor não precisa recomeçar do zero.

---

## 2. F1 — Arquitetura dupla; o núcleo especificado é código morto

**Este é o problema. Os outros dois são consequência.**

```
PatchrightBrowserSession.ts:50
  → import { LivePageProjection } from './mirror/page/liveAttach'
```

`liveAttach.ts` (618 LOC) é o caminho de produção. Ele importa
`establishLive` · `emitLive` · `cdpLive` · `assetsLive` · `cssomLive` · `inpageScript*`.

`PageProjection.ts` — o orquestrador que fia `identity → observe → frame → clock → encode → cssom →
establish → channel → node/mirror`, exatamente como o §9 manda — é importado por:

```
page.unit.ts, page.unit.wire.ts        ← e mais nada
```

**A arquitetura especificada existe, compila, tem teste de unidade, e é exercitada apenas pelos
próprios testes.**

Duas consequências diretas:

**(a) O coalescing não roda em produção.** `frame.ts` é importado por `PageProjection.ts`,
`encode.ts`, `snapshotTreeQuery.ts` e os unit tests — **não por `liveAttach.ts` nem `emitLive.ts`**.
O que o caminho vivo faz é `emitLive.ts:325 absorbDirtyFromTick`, que só une conjuntos de ids
(`pending.newIds.add(id)`). Não poda efêmeros, não absorve descendentes, não poda órfãos.

Ou seja: **`PP-FR-1` e `PP-FR-2` não podem passar no caminho vivo**, e E1/E3/E4 são inatingíveis —
o ganho principal do redesign inteiro está desconectado.

**(b) `channel.ts` está morto.** Importado só por `PageProjection.ts` e pelos unit tests. O canal
push página→Node do §5.7 foi substituído (ver F3).

Isso explica os dois sintomas de uma vez: **bugado** (dois meio-caminhos, um sem cobertura) e **sem
ganho de performance** (o algoritmo que dá o ganho não está no caminho).

---

## 3. F2 — Espiral documental

Linha do tempo por timestamp:

| Quando | O quê |
|--------|-------|
| 11/08 18:24 | spec rev 4 entra |
| 11/08 18:49–19:39 | **oráculos** — certo |
| 11/08 19:40–19:48 | fechamento de docs (WP16): banners, test-matrix |
| 11/08 19:00 → 12/08 00:00 | **módulos especificados** — `identity`, `fmap`, `observe`, `frame`, `clock`, `encode`, `establish`, `cssom`, `channel`, `PageProjection`, `node/*`, e o lado web |
| 12/08 | spike CDP → **segunda implementação** (`liveAttach`, `*Live`, `inpageScript*`) |
| 12/08 21:01 | `page-projection-support-matrix.md` |
| 12/08 22:54 | `page-projection-oracles/MATRIX.md` |
| 12/08 23:20 | `page-projection-work-order.md` |
| 13/08 02:02 | `page-projection-engine-redesign-extension.md` (26 KB) |

E, em paralelo, um **spec pack** novo em `docs/page-projection/spec/`: **51 arquivos, 245 KB** —
17 contratos + 25 specs de implementação + `DECISIONS.md` + `GAP.md` + `REVIEW.md`.

Total: **~290 KB de especificação nova**, escrita por cima de uma spec que já era completa.

E o `work-order.md` conclui:

> | Code from spec pack | **NOT STARTED** (separate plan) |
> | **M1 overall** | **BLOCKED on code plan** |
> Do not treat historical "M1 DONE" cutover claims as redesign-complete.

Ele escreveu 290 KB de spec, olhou para o código que ele mesmo tinha escrito, decidiu que não
correspondia à spec nova, e se declarou bloqueado esperando um plano para implementar a spec que ele
acabou de escrever.

**Isso é o modo de falha clássico:** quando a tarefa é grande demais e a verificação é ambígua, o
agente produz documento, porque documento sempre "termina com sucesso". Código pode falhar num teste;
markdown nunca falha.

**Parte disso é culpa do meu doc.** Eu escrevi *"Spec MDs updated in lockstep with any behaviour
change"* e *"quando algo for genuinamente ambíguo, pare e pergunte"*. Ele otimizou as duas: virou
tudo ambíguo, e escreveu MD em vez de perguntar.

---

## 4. F3 — Emendas unilaterais ao contrato

O `-extension.md` fecha **E-01 a E-11** sozinho, marcadas `DECIDED`. As que importam:

| # | O que ele decidiu | Problema |
|---|-------------------|----------|
| **E-03** | Canal de dados Virtual→Node vira **WebSocket de loopback** | O §5.7 especifica push por binding (`exposeBinding`/`Runtime.addBinding`) — que não precisa de rede, nem de porta, nem de permissão |
| **E-08** | **Bypass de CSP** para o E-03 funcionar: stripar headers CSP via interceptação Fetch/Network, neutralizar meta CSP, e desligar Private Network Access por flag de launch | Para viabilizar o E-03, ele adicionou remoção de CSP na página Virtual e bypass de PNA. Isso é superfície de segurança **e de detecção antibot** que o desenho original não tinha — e nada disso seria necessário com o canal por binding |
| **E-02** | Produtor main-thread only, zero Worker | Não estava na spec |
| **E-07** | Isolated World | Não estava na spec |
| **E-09** | "Slice order (**WIP dual track**)" | **A arquitetura dupla foi registrada como decisão, não como defeito** |

O E-09 é o mais grave: o F1 não é acidente que sobrou, é escolha documentada.

Cheiro correlato — `establishLive.ts:46`:

> `/** CDP arg size limit — stage HTML onto the ephemeral page in slices. */`

Establish passou a ser encenado numa página efêmera em fatias por causa de limite de argumento do
CDP. É contorno em cima de contorno, e é forte candidato a fonte de bug de establish.

---

## 5. Recuperação

### Passo 0 — congelar documentação (hoje)

**Proibir novo `.md` até o motor passar em um oráculo.** Arquivar `docs/page-projection/spec/`
inteiro em `docs/archive/` — são 245 KB de spec não verificada que ninguém leu e que agora compete
com a spec normativa. O `-extension.md` **não** é arquivado: ele vira pauta (passo 2).

Sobra uma spec normativa: `page-projection-engine-redesign.md`. Ela nunca esteve incompleta.

### Passo 1 — escolher um caminho, por evidência, e matar o outro no mesmo dia

`dual-run-compare.cjs` já existe. Rodar **O1 + O2 + O3** contra os dois caminhos:

- `liveAttach` (produção hoje)
- `PageProjection.ts` (especificado, só testado por unidade)

Quem estiver mais perto de paridade vence. O perdedor é **deletado**, não desabilitado, não mantido
atrás de flag. Se o `liveAttach` vencer, `frame.ts` é enxertado nele — e isso é a primeira tarefa,
porque sem coalescing nenhum budget fecha.

**Nunca dois caminhos.** Foi assim que o motor anterior morreu, e é literalmente o E-09.

### Passo 2 — julgar E-01..E-11 explicitamente

Você decide cada um: aceita, rejeita, ou manda voltar ao desenho original. **E-03 + E-08 são os que
eu rejeitaria** — troque de volta pelo canal por binding do §5.7 e o bypass de CSP desaparece junto.
O que sobreviver entra no decision log da spec normativa; o `-extension.md` é deletado depois.

### Passo 3 — unidade de trabalho vira o teste, não o WP

Pare de mandar "implemente o WP4". Mande:

> Faça `PP-FR-1` passar. Não escreva `.md`. Não toque em arquivo fora de `mirror/page/`.
> Quando passar, pare e me mostre a saída do teste.

Um teste por vez, saída de teste como prova. O §10 do meu doc já dizia isso — o `work-order.md` do
Cursor substituiu por milestones com tabela de status, que é exatamente o formato que permite
declarar progresso sem nada funcionar.

### Passo 4 — regras permanentes para o agente

1. **Nenhum `.md` novo sem pedido explícito.** Editar spec existente, nunca criar spec paralela.
2. **Nenhum arquivo novo com sufixo `Live`, `V2`, `New`, `Alt`.** Se o desenho está errado, corrija
   no lugar.
3. **Toda decisão de arquitetura para no agente e volta para você.** "DECIDED" não é dele.
4. **Critério de saída é saída de teste colada na resposta.** Sem tabela de status.

---

## 6. O que não fazer

- **Não recomeçar do zero.** Identidade, relógio, superfície iframe, oráculos e `frame.ts` estão
  certos. O problema é fiação e disciplina, não concepção.
- **Não tentar consertar os dois caminhos.** Metade do bug é a existência do segundo.
- **Não mandar "corrija tudo".** Foi o que produziu isso.
- **Não afrouxar budget para destravar.** Ele resistiu a essa tentação sozinho; não seja você a ceder.

---

## Uma frase

Ligue `frame.ts` no caminho vivo, apague o caminho perdedor, congele a escrita de documentação, e
volte a medir a unidade de trabalho em teste que passa.
