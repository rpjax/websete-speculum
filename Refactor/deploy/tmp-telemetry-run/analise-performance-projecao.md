# Análise — performance do algoritmo de projeção (PageProjection)

**Data:** 2026-08-11 · **Base:** docs `page-projection-*.md`, `telemetry.md`, e os diagnósticos
`pipehop-bugs-diagnosis.md` / `bugs-observados.md` / `dommaphop-*`.
**Método:** partiu dos docs; código só foi consultado para *confirmar* três hipóteses (marcadas
como **verificado**). Nada aqui é chute sobre implementação sem citar arquivo/linha.

**Idioma:** português, seguindo a convenção desta pasta (`tmp-telemetry-run/` = notas de trabalho).

---

## 1. Resumo executivo

O diagnóstico atual (`pipehop-bugs-diagnosis.md`) está **correto no que mede** e a priorização
"P0 = DomMap" está certa. Mas ele mede **um** dos dois custos do algoritmo e, no que mede, o número
que virou alvo (`cdpTransferMs`) é um **resíduo**, não uma medição — há risco concreto de otimizar
a coisa errada no próximo corte.

Três buracos na análise atual:

| # | Buraco | Por quê importa |
|---|--------|-----------------|
| **A** | `cdpTransferMs` = `evaluateWall − pageTotal`. Inclui **agendamento na main thread** do site. | O plano "comprimir/chunkar `rootJson`" ataca bytes. Se o custo for fila de main thread, comprimir não move nada. |
| **B** | O **caminho live** nunca foi decomposto. Cada op emitida faz `querySelectorAll` de documento inteiro **no Virtual** e **de novo no cliente**. | ~7.000 ops por load. É o único custo do sistema que é **O(nós × ops)**. O establish é O(nós), pago uma vez. |
| **C** | Não existe **baseline sem projeção**. | Beleza com projeção: DCL ~27 s, load ~39 s após commit. Se sem projeção for ~5 s, o produtor é o gargalo do próprio site e todos os números downstream medem o observador. |

Ordem que eu proporia: **C** (30 min, decide tudo) → **A** (1 h, decide o P0) → **B** (o teto de
escala) → só então compressão/chunk.

---

## 2. Onde o tempo vai hoje (o que os docs já provam)

### 2.1 Cold establish — Beleza, ~18,5k nós (`dommaphop-*`)

| Fase | ms | % |
|------|-----|---|
| `cdpTransferMs` (resíduo) | **3944** | 67% |
| `mapNodeMs` (in-page) | 1342 | 23% |
| `anchorAllMs` (in-page) | 599 | 10% |
| remint / cssom / reset | ~40 | ~1% |
| **wall `durationMs`** | **5924** | |
| `pageTotalMs` (só in-page) | 1980 | |

### 2.2 Orçamento até o primeiro pixel projetado (`parityhop-*`)

```
bootMs 3200 (Chromium) ──┐  não é load de site
                         ├─ NavCommit = t0
Virtual TTFB    ~1593 ms │
styles wait      ~983 ms │  bloqueante, antes do map
DomMap        ~5600 ms   │  DOMINANTE
Cssom install     ~18 ms │  4462 regras — barato, não é problema
                         └─ FirstDiffEmitted ≈ 8680 ms após commit
```

### 2.3 Anomalia não explicada

| Corrida | nós | `mapNodeMs` | `cdpTransferMs` |
|---------|-----|-------------|-----------------|
| establish cold | 18,5k | 1342 | **3944** |
| resync tardio | 27k | **4374** | 1324 |

1,46× mais nós → **3,26×** mais `mapNode`, e o "transfer" **cai** 3× com payload maior.
Isso não é comportamento de custo linear em bytes. É exatamente o que se espera se o que está
sendo medido for **contenção de main thread** (cold = thread do site saturada; resync tardio =
thread livre, mas outra coisa ficou cara). Enquanto isso não for explicado, `cdpTransferMs` não
sustenta uma decisão de arquitetura.

---

## 3. Achados novos

### A. `cdpTransferMs` não mede transferência — **verificado**

`PageProjection.ts:232` e `:955`:

```ts
cdpTransferMs = Math.max(0, evaluateWallMs - pageTotalMs)
```

É o resíduo do `page.evaluate`. Contém, indistinguíveis:

1. tempo até o Chromium **agendar** o callFunctionOn na main thread (atrás das long tasks do site);
2. serialização do resultado pelo Chromium (**na main thread**);
3. websocket DevTools;
4. deserialização Playwright/Node.

Em cold, (1) e (2) competem com um site cujo DCL é 27 s. Comprimir o payload ataca só (3).

**Como separar (barato, ~1 h):** dentro do `evaluate`, marcar `t_ret = performance.now()` **depois**
do `stringify` e antes do `return`; no Node marcar `t_recv`. `t_recv − t_ret` é transferência real.
`t_evaluateStart_node → t_pageStart_inpage` é a fila de agendamento. Três números em vez de um
resíduo. Só depois disso decidir entre comprimir, chunkar, ou tirar o trabalho da main thread.

### B. O caminho live é O(nós × ops) — **verificado**

Este é o achado que não está em nenhum doc.

`DomTreeSerializer.ts:1070 selectorForElement` → `:1040 queryFor` → `:983 isUniqueQuery`:

```js
function isUniqueQuery(node, query) {
  ...
  return scope.querySelectorAll(query).length === 1;   // documento inteiro
}
```

Por **cada** op emitida (`patch` em `:1325`, `childList` em `:1292`, e **cada entrada de
`removed[]`**), o Virtual:

- monta `[speculum-anchor="…"]` e roda **um `querySelectorAll` de documento inteiro** para provar
  unicidade;
- se não for único, **sobe até 64 níveis**, e em cada nível roda **outro `querySelectorAll`** mais
  um `nthChildIndex` que aloca a lista de irmãos inteira (`fChildEntries`).

E no cliente, `PageProjectionDiffApplier.ts:709`:

```ts
matches = Array.from(this.host.querySelectorAll(query))
if (this.host.matches(query)) matches.unshift(this.host)
```

Sem índice. Mesmo custo, de novo, sobre um DOM de `htmlLen ≈ 3,2 M`.

**Escala medida:** 6964 diffs (`parityhop`), 7721 (`pipehop`), 6008 (`beleza`) — **por load de uma
página**. São ~7k varreduras de documento no Virtual **durante o load do site** + ~7k no cliente.
`lagMsP50 ≈ 19 ms` hoje esconde isso porque o cliente está ocioso; o pico transitório de 403 ms é a
mesma coisa aparecendo sob churn.

**O ponto:** T5 selou "emit imediato, sem coalesce" e T4 selou "1 MutationRecord = 1 diff".
Isso torna o **número de ops** irredutível por contrato. Então o custo **por op** tem que ser O(1),
e hoje é O(N).

**Correção proposta (não viola contrato):** as âncoras já são únicas por construção — o fix do BZ4
introduziu mint monotônico + remint global + claim no map. `isUniqueQuery` está **verificando um
invariante que o mint já garante**, com uma varredura de documento. Trocar por um
`Map<anchor, Element>` mantido no stamp dá a **mesma** garantia em O(1); colisão vira erro do mint,
não descoberta por varredura. No cliente, o mesmo `Map<anchor, Element>` mantido no apply resolve
`[speculum-anchor="x"]` em O(1) e **preserva a semântica do T7** (`length !== 1` → desync) se o mapa
guardar lista e desincronizar quando `size > 1`; qSA fica como fallback só para queries posicionais.

### C. Falta o baseline sem projeção

`parityhop`: Beleza DCL ~27 s e load ~39 s **após o commit**, com `virtual_ttfb_high` (1593 ms) já
descontado. Beleza não é um site de 27 segundos.

Candidatos a estarem inflando o próprio Virtual:

- `anchorAll` = ~18k `setAttribute` numa passada (599 ms de CPU **e** ~18k MutationRecords
  entregues aos observers do próprio site, mais invalidação de estilo);
- LMS (`speculum-last-mutation-sequence`) escrito antes de cada emit — segunda escrita de atributo
  por nó tocado, no hot path;
- ~7k `querySelectorAll` de documento inteiro na main thread (achado B);
- `mapNode` + `JSON.stringify` de ~20k nós, síncronos, na main thread.

**Experimento:** mesmo site, mesma stack, `MirrorMode.VideoStreaming` (ou projeção desligada),
comparar `Virtual.NavTiming` DCL/load. Se a diferença for grande, **o produtor é o gargalo** e o
DomMap de 6 s é sintoma, não causa raiz.

### D. Volume de envelopes é caro fora do algoritmo

6964 diffs × (`FrameReceived` + `FanOutEnqueued` + `StreamDequeued` + `WireDelivered`) = ~28k fatos
Journal, mais fan-out, mais um frame MessagePack por op. Foi isso que estourou a bridge (BZ1) e a
resposta foi subir a capacidade para **8192** — buffer maior, não menos trabalho.

T5 proíbe **coalesce semântico** (juntar records num diff). Não proíbe **batching de transporte**:
N envelopes íntegros, com seus `sequence` próprios, num único frame de wire. Atomicidade ACID por
envelope fica intacta, cronologia fica intacta, e o custo por op cai uma ordem de grandeza. Vale
como item de contrato a debater, porque hoje o doc de coalesce (`page-projection-coalesce.md`,
`idleGap`/8 ms/`maxWaitMs` 50) descreve um mundo que o T5 matou, sem substituto escrito.

### E. Trabalho desperdiçado no OOB (menor)

`PageProjection.ts:936-937`:

```ts
JSON.stringify(root);
JSON.stringify(sheets);   // resultado descartado — só para medir serializeMs
```

Full stringify da árvore e das folhas cujo resultado é jogado fora. Instrumentação pagando custo
real no caminho de recovery. Trocar por medição amostrada ou estimativa de tamanho.

---

## 4. Recomendações, em ordem

| # | Ação | Custo | Risco de contrato | Ganho esperado |
|---|------|-------|-------------------|----------------|
| 1 | **Baseline sem projeção** (achado C) | ~30 min | nenhum | decide se o alvo é o DomMap ou o produtor inteiro |
| 2 | **Decompor `cdpTransferMs`** em fila / serialize / wire (achado A) | ~1 h | nenhum | impede otimizar bytes quando o custo é main thread |
| 3 | **`isUniqueQuery` → registry O(1)** no Virtual (achado B) | médio | nenhum (mesma garantia) | tira ~7k varreduras da main thread do site durante o load |
| 4 | **Índice de âncoras no applier** (achado B) | médio | preserva T7 se o mapa detectar duplicata | apply O(1); remove o teto de escala do cliente |
| 5 | **Fundir as passadas in-page** — hoje o establish faz reset ledger → `anchorAll` → remint → `mapNode` (4 walks) | médio | nenhum | ataca os ~2 s de `pageTotalMs` |
| 6 | **`document` progressivo**: emitir `html`/`head`/`body` + N níveis, preencher o resto com `childList` na mesma sequence | alto | **legal no T3** ("emit ASAP; tree may still be loading" + updates incrementais) | converte 6 s bloqueantes em ~centenas de ms + preenchimento incremental — maior ganho possível de tempo-até-usável |
| 7 | **Batching de transporte** (achado D) | médio | precisa de decisão de contrato explícita | ~10× menos overhead por op; torna a capacidade 8192 desnecessária |
| 8 | **Âncora em WeakMap no Virtual**, atributo materializado só no payload `F` | alto | **muda o T4** — precisa de debate | elimina ~18k escritas de atributo e o ruído nos observers do site |

Itens 1 e 2 são pré-requisito honesto para 3–8: sem eles, cada otimização é aposta.

---

## 5. Perguntas abertas que valem responder antes de codar

1. **O LMS está pagando por si?** `speculum-last-mutation-sequence` é escrito em cada nó tocado antes
   de cada emit (`PageProjection.ts:1549`) e viaja no payload. O parking lot do T7 descreve o uso
   pretendido ("usar como landmark só nós com `LMS < currentSequence` ao montar querystring
   estrutural"). Se esse uso ainda não existe, é escrita de atributo + bytes + churn de MO no hot
   path sem consumidor.
2. **Por que `mapNode` é super-linear?** 1,46× nós → 3,26× tempo. Alocação/GC do objeto intermediário
   antes do stringify é o suspeito óbvio (materialização dupla: objeto + string). Um walk que escreve
   direto num buffer de string elimina uma das duas.
3. **`styles wait` de 983 ms precisa ser bloqueante?** Com `document` progressivo (item 6), a espera
   por CSS deixa de estar no caminho crítico do primeiro paint.
4. **`brokenImgs` é performance ou correção?** Os docs listam junto; `virtualData1x1=21` e os 404 de
   cloudinary `f_avif`/`f_webp` sem public id parecem bug de rewrite, não de custo. Vale separar as
   listas para o P1 não competir com o P0.

---

## 6. Higiene de doc que está atrapalhando

Estes pontos fazem qualquer um (humano ou agente) trabalhar a partir de contrato errado:

| Doc | Problema |
|-----|----------|
| `page-projection-diff-pipeline.md` | Diz "**this file remains the implemented F contract**". T11 está **DONE** (a fila do T0 no diff-streams marca DONE; `PageProjection.ts` existe). O doc descreve dirty-climb + CSSOM por reload de URL — nada disso é o código de hoje. |
| `page-projection-coalesce.md` | Documenta `idleGap` / 8 ms / `maxWaitMs` 50 como "V1 implementado". T5 matou coalesce por tempo. Não há doc que descreva o que existe no lugar (emit imediato + capacidade 8192 + DropAll → desync). |
| `page-projection-diff-streams.md` | A fila do T0 marca T11/T12 **DONE**, mas as seções T11 e T12 continuam com cabeçalho **OPEN**. T12 ainda diz "renomear `page-projection-*.md` → `page-projection-*.md`" (frase que virou no-op depois do rename). |
| `wip-dom-projection-triage.md` | Ainda é a "live plan" segundo a memória do projeto, mas o SoT operacional real virou `tmp-telemetry-run/pipehop-bugs-diagnosis.md`. P-* / D-* não foram reconciliados com BZ* / achados novos. |

Sugestão mínima: banner de supersessão em pipeline + coalesce, fechar T11/T12 no diff-streams, e uma
linha no triage apontando para o SoT operacional.

---

## 7. Uma frase

O DomMap de ~6 s é real e é o P0 certo, mas antes de comprimir payload vale gastar duas horas
provando **quanto do custo é main thread e não bytes** e **quanto do load do site é a própria
projeção** — e o teto que ninguém mediu ainda não é o establish, é o caminho live, onde cada uma das
~7.000 ops paga uma varredura de documento inteiro dos dois lados do fio.
