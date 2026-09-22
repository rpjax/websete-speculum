# 12 — Instrumentação: telemetria, sondas e o oráculo

**Status:** EM DESENHO.

Objetivo declarado, e tudo aqui existe para ele:

> **Estabelecer o produtor como correto, para que qualquer divergência futura seja, sem
> dúvida, do cliente.**

Isso não se obtém com "mais logs". Obtém-se removendo, um a um, cada estágio do produtor da
lista de suspeitos — e cada estágio precisa do **seu** oráculo, senão um "check" genérico diz
que há bug sem dizer onde.

---

## 1. Telemetria — três formas, e só três

| forma | direção | quando serve |
|---|---|---|
| **Embutida** | dentro do próprio quadro | custo do que acabou de acontecer: `buildMs`, contagem de ops, tamanho da tabela |
| **Emissão** | produtor → supervisor, sem pedido | fato catalogado no instante em que ocorre |
| **Sonda** | consumidor → runtime, com resposta | perguntar ao motor vivo o que ele acha que sabe |

As três já são a filosofia da implementação atual. O desenho novo as preserva e dá nome a cada
uma, em vez de deixar a terceira implícita.

### 1.1 Embutida — lista contada, não campo condicional

```
patch.metrics : list<Metric> max=16      Metric { id: enum<MetricId>, value: u64 }
```

Lista vazia quando desligada: **um byte**. Ligada, só as métricas habilitadas entram.

Por que lista e não campos no cabeçalho: campo condicional exigiria bit de presença e **ramo
no decodificador** — o que a regra P5 (despacho por tabela, leituras alinhadas) existe para
evitar. Lista contada usa o mesmo decodificador que já existe, e fica granular por construção:
cada métrica liga sozinha.

### 1.2 Emissão — o catálogo

Já desenhado: `Telemetry(id, payload)`, catálogo estável, desligado por padrão, e desligado
custa **um atomic** — sem alocação, sem construir payload.

**Invariante que vira teste:** rodar o mesmo roteiro com telemetria ligada e desligada produz
bytes de quadro **idênticos**. Observar não perturba.

### 1.3 Sonda — perguntar ao motor vivo

Novo no desenho, e é a peça que faltava.

```
Probe(id, args)  →  ProbeResult(id, payload)      correlacionado
```

A sonda entra pelo fio, atravessa até o runtime embutido no processo raiz do Gecko, **é
resolvida lá dentro**, e a resposta volta. O supervisor não interpreta: encaminha.

Regras duras, e elas são o que torna sonda confiável em vez de mais uma fonte de dúvida:

1. **Sem efeito colateral.** Sonda que altera o que observa é instrumento inútil — mesma regra
   que faz `Snapshot` ser `const` de ponta a ponta.
2. **Sonda desabilitada responde `ProbeDisabled`**, nunca silêncio nem resposta vazia. Silêncio
   é indistinguível de sonda quebrada.
3. **Sonda nunca é caminho de produto.** Se alguma funcionalidade precisar de uma sonda para
   funcionar, ela virou dependência escondida e o desenho quebrou.

Sondas previstas: tabela de um host, hash de um intervalo de ids, mapa de identidade, estado
dos registros, profundidade do escritor, fila de sujeira pendente.

## 2. Tudo por parâmetro de lançamento

Toda capacidade — cada métrica, cada id de catálogo, cada sonda, cada nível de oráculo — liga
por **parâmetro de lançamento do processo Gecko**. Granular, um por um.

**Nunca por variável de ambiente que muda comportamento, nunca por alternância em runtime.**
Comportamento que muda sem alguém ter lançado o processo daquele jeito é magia escondida, e
lab que exercita um binário diferente do de produção é falso positivo por construção.

Desligado tem que custar **zero**: um atomic na emissão, um byte no quadro, nenhuma alocação.

---

## 3. Os três oráculos

O produtor tem três estágios onde pode mentir. Um oráculo para cada, porque um genérico não
diz qual mentiu.

```
         DOM/CSSOM vivo
               │  ← O1: o produtor registrou certo?
          tabela do produtor
               │  ← O2: os quadros carregam o que a tabela diz?
          quadros emitidos
               │  ← O3: os bytes decodificam de volta nos mesmos ops?
             bytes
```

### O1 — tabela × estado real do Gecko
**Reformulado em [`13-oraculo-global.md`](13-oraculo-global.md).** Não é "caminhar o DOM e
comparar": essa comparação seria uma segunda implementação da semântica, com ponto cego
silencioso. É congelamento global coordenado + duas travessias — **ida** (`d(VN)` fresco ×
`d(VTR)` armazenado, hash contra hash) e **volta** (reconstruir a estrutura a partir da
tabela e comparar com varredura ingênua do real). Texto antigo que falava em "dois
algoritmos" / "reconstruir a tabela do estado congelado" para a ida está **superado** por
13 §2.
**Custo: o mais alto do sistema.** Sob demanda, nunca por tick.

### O2 — quadros × tabela
O produtor mantém uma **tabela-sombra** e aplica nela cada quadro que emite, exatamente como o
cliente faria. Se a sombra diverge da tabela do produtor, o codificador mentiu.

Remove o codificador da lista de suspeitos — que é o estágio mais difícil de culpar de fora.

**Custo: quase zero, e isto é o achado que torna o modo caro desnecessário na maior parte do
tempo.** Os dois lados já mantêm `tableHash` incremental em O(1). Comparar é **dois `u64` por
tick**. O diff linha a linha só roda quando os hashes discordam.

### O3 — bytes × ops
Decodifica o próprio quadro emitido e compara com os ops construídos. Pega defeito de
codificação de campo.
**Custo: O(ops) por tick.** Barato.

### A afirmação, precisa

> Se **O1 ∧ O2 ∧ O3** se mantêm continuamente sobre a suíte de fixtures, então: o produtor
> registrou o que aconteceu, disse o que registrou, e escreveu o que disse.
> **Qualquer divergência restante é do cliente.**

Essa é a frase inteira. Vale o custo porque ela move a depuração para fora do Gecko — que é o
lugar mais caro do sistema para depurar.

## 4. Capacidades, não níveis

`docs/engineering-standards.md` já decidiu isto para o resto do sistema: **toggle de
capacidade por domínio, nunca nível**. Nível é um botão que liga coisas que ninguém escolheu
individualmente, e vira exatamente o default escondido que o projeto recusa.

Cada verificação é sua própria capacidade, ligada por parâmetro de lançamento:

| capacidade | o que roda | custo |
|---|---|---|
| `oracle.invariants` | `checkInvariants()` nos registros | O(alterado) |
| `oracle.postcondition` | pós-condição por campo do `emit` (doc 14 §5.4) | **zero — valores já em mão** |
| `oracle.encode` | O3: decodifica o próprio patch e compara com os ops | O(ops) |
| `oracle.shadow` | O2: tabela-sombra, comparada por hash | ~2 `u64` por tick |
| `oracle.freeze` | congelamento global coordenado | sob demanda |
| `oracle.forward` | ida: `d(VN)` fresco × `d(VTR)` armazenado | O(nós) |
| `oracle.reverse` | volta: reconstrução × varredura ingênua | O(DOM) |
| `oracle.ledger` | livro-razão de exclusões | O(DOM) |

**Presets são nomes, não mecanismo.** `--oracle=dev` e `--oracle=lab` expandem para conjuntos
destes toggles e nada mais; o que roda continua sendo a lista, e ela é imprimível.

O achado prático: `oracle.postcondition` + `oracle.encode` + `oracle.shadow` custam quase nada
e pegam a classe mais valiosa — o codificador mentindo. Ficam ligadas o tempo todo em dev. As
quatro últimas são o modo caro, sob demanda.

## 5. Falha do oráculo tem que apontar o dedo

Oráculo que diz "as tabelas diferem" é um oráculo que custou caro e não resolveu nada. Toda
falha reporta, obrigatoriamente:

1. **qual oráculo** (O1, O2 ou O3);
2. **qual linha e qual campo** — id, campo, valor esperado, valor obtido;
3. **qual mutação precedeu** — via o span de causa (`09-observabilidade.md`);
4. **o `sequence` e a geração** em que aconteceu;
5. **o roteiro do trecho**, já gravado, pronto para reexecutar.

Os cinco juntos são a diferença entre "tem bug" e "é esta linha, depois desta mutação, e aqui
está o arquivo para reproduzir".

## 6. A suíte de fixtures

Roda N fixtures — correção, estresse e adversárias — com todas as capacidades de oráculo ligadas, continuamente.

| classe | o que caça |
|---|---|
| correção | cada forma de mutação, uma por vez |
| estrutural | lista longa, prepend em bloco, remoção de cauda, reordenação |
| CSSOM | folha por `<link>`, construída, adotada, regra por API, shadow |
| aninhamento | host nasce e morre, documento troca, árvore profunda |
| ciclo | navegar sob carga, geração trocando com sujeira pendente |
| estresse | volume de mutação sustentado, tabela grande |
| adversária | o que já quebrou uma vez. Todo bug encontrado vira fixture, permanentemente |

A última linha é a que faz a suíte crescer em valor em vez de envelhecer.

**Critério de aceite da suíte:** todas as capacidades de oráculo verdes em todas, e o roteiro de cada uma reexecuta
byte-idêntico no `sim`.

**Implementação (Fase 7):** fixtures em `gecko-engine/tests/phase7/fixtures/<classe>/`;
replay das linhas `>` via `SpecDriver`; gate `scripts/phase7/run.ps1`. Todo defeito novo vira
`.spec` permanente em `adversaria/`.

## 7. Descartados

**7.1 Um "oráculo" único.** §3 — não diria qual estágio mentiu.
**7.2 Alternância de telemetria em runtime.** §2.
**7.3 Sonda com efeito colateral.** §1.3.
**7.4 Oráculo que reporta booleano.** §5.
**7.5 Tabela-sombra escrita só para o teste, divergente do que o cliente faz.** Ela aplica os
quadros pela mesma lógica de tabela replicada que o cliente implementa; se divergir disso,
está testando outra coisa.
