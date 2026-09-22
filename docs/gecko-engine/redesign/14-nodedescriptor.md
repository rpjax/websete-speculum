# 14 — `NodeDescriptor`: a forma normal, e a emissão como função pura

**Status:** EM DESENHO. Refina `13-oraculo-global.md`.

Concordo com a direção. E ela é menos arriscada do que parece, porque **o código já caminha
para lá sozinho** — falta nomear e fechar.

---

## 1. O que já existe

| achado no repositório | o que significa |
|---|---|
| `virtual/dom/domNodeDescribe.ts` — *"ler um nó vivo, produzir seu descritor"*, **compartilhado entre o construtor incremental e o resync** | o descritor já existe para o caso de criação, e já unifica dois caminhos |
| `readAttrs` lê **todos** os atributos numa passada de `NamedNodeMap` | "ler o nó inteiro" já é o que acontece; o custo do descritor não é novo |
| linha da tabela = `{kind, parent, prevSibling, contentHash, rowHash}` | topologia de **tamanho constante**, sem lista de filhos |
| `contentHash` = **soma** de hashes por campo, add/remove em O(1) | o descritor já tem resumo incremental |
| `rowHash.ts` é *deliberadamente a mesma implementação* nos dois lados, num módulo sem DOM | a filosofia de convergência já está escrita |

A ideia não é uma reescrita. É terminar o que começou.

## 2. O que o descritor é — e o que ele não é

```cpp
struct NodeDescriptor {
  NodeKind   kind;
  ElementNs  ns;
  AtomRef    name;          // tag, ou nome do doctype
  ValueHash  value;         // texto / comentário
  NodeId     parent;
  NodeId     prevSibling;   // topologia de tamanho CONSTANTE
  FieldHash  attrs;         // soma por campo
  FieldHash  props;
  ShadowInit shadow;
  uint64_t   hash() const;  // == rowHash de hoje
};
```

Três restrições, e as três decidem se isso funciona ou vira armadilha:

**2.1 Topologia de tamanho constante, nunca lista de filhos.**
Se o descritor contivesse a lista de filhos, um nó com mil filhos materializaria mil entradas a
cada tick sujo, e o diff seria O(n) para achar uma inserção. `parent + prevSibling` faz toda
edição estrutural tocar **dois** descritores. Esta já é a escolha do protocolo, tomada por
outro motivo (índice posicional renumera e re-hasheia todos os irmãos seguintes) — o que é um
bom sinal: duas linhas de raciocínio independentes chegam na mesma restrição.

**2.2 O descritor é relativo a um resolvedor de identidade.**
`d(VN)` não tem como inventar ids; ele os obtém do mapa de identidade. Isso parece circular —
estaríamos confiando no que queremos testar — mas não é: se o mapa está errado, `d(VN)` sai com
o id 5 carregando o conteúdo de A enquanto `d(VTR_5)` carrega o de B, e **os descritores
diferem**. Mapa errado aparece como divergência de conteúdo. O único caso invisível é A e B
terem conteúdo idêntico — e aí a próxima mutação em qualquer um dos dois expõe.

**2.3 O descritor tem resumo canônico.**
`d(x).hash()` é o `rowHash` que já existe. Igualdade de descritor é **uma comparação de u64**.
É isso que torna qualquer verificação baseada em descritor barata o bastante para ficar ligada.

## 3. Convergência: quatro fontes, um tipo

```
d(VN)  ── nó vivo no Gecko          ┐
d(VTR) ── linha da tabela produtora ├─→  NodeDescriptor
d(PTR) ── linha da tabela cliente   │
d(PN)  ── nó materializado          ┘
```

E o pipeline inteiro vira **três igualdades do mesmo tipo**, cada uma com significado exato:

| igualdade | prova |
|---|---|
| `d(VN) == d(VTR)` | o produtor registrou a realidade |
| `d(VTR) == d(PTR)` | o fio carregou o que a tabela dizia |
| `d(PTR) == d(PN)` | o cliente materializou o que recebeu |

Isso **substitui** a comparação semântica que o `13` tentava evitar: não se compara mais tabela
com DOM por uma função que pode ter ponto cego — comparam-se dois valores do mesmo tipo.

### 3.1 O que sai do descritor: estado derivado
`nextSiblingOf` e `lastChildOf` são índices derivados, não hasheados, e **não entram no
descritor**. Eles são conferidos por `checkInvariants()` contra a sua própria fonte de verdade
(`parent`/`prevSibling`), que é mais direto e mais barato que qualquer oráculo.

Isto é exatamente o que teria pego `OPEN-7` e `OPEN-8` — elos derivados errados com o hash do
fio verde — e pega **no tick em que acontece**, não na próxima varredura.

## 4. A emissão como função pura

```cpp
// Total sobre ausência dos dois lados. Sem estado, sem DOM, sem motor.
// DirtyMask (projection.md) limita quais campos o diff toca — O(sujos).
RowChanges emit(const NodeDescriptor* prev, const NodeDescriptor* curr, DirtyMask);
```

| entrada | saída |
|---|---|
| `(nullptr, curr)` | criar |
| `(prev, curr)` | diff campo a campo |
| `(prev, nullptr)` | remover |

**Onde mora o `prev`: na própria tabela.** `prev = d(VTR)` e `curr = d(VN)` lido fresco. Não há
armazenamento extra — a tabela **é** o memorando do último descritor emitido.

### 4.1 O ganho estrutural
`P8` — *sem ramo de ciclo de vida* — deixa de ser disciplina e vira **propriedade do tipo**.
Partida a frio é `prev = nullptr` para todo nó. Resync é `prev = nullptr` para o conjunto
reconstruído. Não existe o `if (isFirstFrame)` para alguém esquecer de não escrever, porque
não existe onde escrevê-lo.

### 4.2 O ganho que eu acho o maior: pós-condição por nó
```
aplicar(emit(prev, curr)) na tabela  ⇒  d(VTR) == curr
```
Uma comparação de u64, por nó sujo, por tick. **O(sujos), não O(tabela).**

Isso é a garantia de que o codificador não mente — antes só obtida por tabela-sombra — agora
barata o suficiente para ficar **sempre ligada em dev**, e apontando o nó exato no tick exato.

### 4.3 `OPCODE(X)` × `OPCODE(prev, curr)`
Vale separar as duas ideias: **descritor converge de quatro fontes; emissão toma dois
descritores.** Opcode descreve uma *transição*, não um estado. `OPCODE(X)` de uma fonte só faz
sentido como o caso `(nullptr, d(X))`.

## 5. Performance por modelagem, não por passagem extra

Um coalescedor depois do `emit` seria abrir espaço para o lote. O certo é modelar de um jeito
em que ele **já esteja lá**. Três movimentos, e os três tiram complexidade em vez de somar.

### 5.1 O descritor é uma **vista preguiçosa**, não um struct materializado

```cpp
struct NodeDescriptor {                     // interface, não registro
  virtual NodeKind   kind() const = 0;
  virtual AtomRef    name() const = 0;
  virtual FieldHash  attr(AtomRef) const = 0;
  virtual FieldHash  value() const = 0;
  virtual NodeId     parent() const = 0;
  virtual NodeId     prevSibling() const = 0;
  virtual uint64_t   hash() const = 0;      // completo: O(campos)
};
```

`d(VN)` lê do nó vivo sob demanda; `d(VTR)` lê da linha armazenada. **O custo é exatamente o
que se pede.**

| quem pergunta | pede | custo |
|---|---|---|
| emissão (caminho quente) | só os campos sujos | **O(alterados)** |
| oráculo (sob demanda) | tudo, e o `hash()` | O(campos) |

Mesmo tipo, mesma função, mesmo código. O que separa barato de caro é **quanto o chamador
pede**, nunca um ramo dentro. Materializar o descritor inteiro seria reintroduzir o `record`
por mutação que o desenho já tinha recusado no `IDocumentObserver`.

### 5.2 A sujeira é tão granular quanto a notificação

O motor entrega **o nome do atributo que mudou**. Jogar isso fora e reler o nó inteiro é
descartar informação que já estava na mão.

```cpp
void mark(Ref<Node>, DirtyKind, AtomRef field);   // o campo, quando existe
```

Então `emit` de atributo toca **os atributos nomeados**, não os vinte que o elemento tem.
Casa com §5.1: o chamador só pede o que a marca disse.

### 5.3 Sujeira estrutural é indexada por pai — e o lote cai da iteração

Mudança estrutural é, por natureza, **sobre um pai**; mudança de conteúdo é sobre um nó. O
ledger reflete isso em vez de tratar tudo como conjunto plano:

```
dirtyFields  : nó   → campos sujos          (atributo, texto, prop)
dirtyChildren: pai  → filhos sujos          (inserção, remoção)
```

Drenar `dirtyChildren` **em ordem de irmão** produz as corridas sozinho:

```
para cada pai sujo:
  caminhar os filhos sujos em ordem de prevSibling
    corrida de novos consecutivos  → UM  INSERT(parent, before, [ids])
    corrida de removidos           → UM  REMOVE(parent, [ids])
```

**Não há coalescedor.** O lote não é um agrupamento feito depois: é a forma que as mudanças já
têm quando lidas na ordem da topologia. Uma corrida de irmãos novos sob o mesmo pai **é** um
`INSERT` em lote — os `prevSibling` encadeados são o lote.

E `before` é calculado **uma vez por corrida**, não uma vez por nó. Que é exatamente o que a
correção do `resolvedBefore` fez (`walkSiblingRun`, ~190×): ela já era "iterar na ordem da
topologia". O modelo aqui **generaliza aquela correção** em vez de substituí-la — e o que lá
foi conserto pontual, aqui é a única forma de escrever.

### 5.4 A pós-condição também é por campo

`d(VN).hash()` completo é caro — é modo oráculo. No caminho quente a pós-condição é do mesmo
tamanho da mudança:

```
depois de aplicar: table.fieldHash[id][campo] == o hash que emit leu do vivo
```

Os dois valores já estão na mão. **Custo zero, por campo alterado, todo tick.** A verificação
cara existe, mas não é a que roda sempre — e as duas são o mesmo código, pedindo mais ou menos.

### 5.5 O que isso fecha

| preocupação | onde some |
|---|---|
| lote perdido | §5.3 — o lote é a forma dos dados, não uma passagem |
| reler nó inteiro por um atributo | §5.2 + §5.1 — pede-se o campo marcado |
| descritor alocado por mutação | §5.1 — vista, não struct |
| verificação cara no caminho quente | §5.4 — por campo, com valores já em mão |

Resiliência e performance param de competir porque **não são dois mecanismos**: são a mesma
função pedida em duas granularidades.

### 5.6 A independência do oráculo muda de lugar

Único ponto a aceitar de olhos abertos. Se `emit` vira o **único** algoritmo, a "ida" do `13`
— reconstruir pelo caminho de construção e comparar com o incremental — vira comparar uma
função com ela mesma. Perde-se.

O que ela pegava não se perde: drift é pego por `d(VN) == d(VTR)`, que compara *leitura fresca
da realidade* com *estado armazenado* — duas fontes de verdade, não duas implementações. É
mais direto. O `13` passa de "ida e volta" para "**fresco × armazenado**, mais a volta".

## 6. Ordem de implantação

Isto mexe no código mais maduro e lacrado do repositório — o construtor incremental, que já
pagou quatro correções medidas. Reestruturar a emissão significa **reconquistar** aquela
confiança.

Por isso a ordem não é negociável:

1. `NodeDescriptor` + `hash()`, e as três igualdades do §3 como verificação;
2. o oráculo e a suíte de fixtures, verdes sobre a emissão **atual**;
3. só então `emit(prev, curr)` substituindo a emissão, **sob** a suíte;
4. o ledger em duas formas (§5.3) — e o lote passa a sair da drenagem, sem passagem nova.

O passo 2 é o que transforma o passo 3 de aposta em refactor verificado.

## 7. Descartados

**7.1 Lista de filhos no descritor.** §2.1.
**7.2 Estado derivado no descritor.** §3.1 — é invariante, não oráculo.
**7.3 Armazenar o descritor anterior separado da tabela.** §4 — a tabela já é ele.
**7.4 Passagem coalescedora depois do `emit`.** §5.3 — seria abrir espaço para o lote em vez de
modelar para ele caber. O lote sai da ordem de iteração.
**7.5 Descritor como struct materializado.** §5.1 — é o `record` por mutação já recusado.
**7.6 Marcar nó sujo sem o campo.** §5.2 — descarta informação que o motor entregou.
**7.7 Reestruturar a emissão antes do oráculo estar verde.** §6.
