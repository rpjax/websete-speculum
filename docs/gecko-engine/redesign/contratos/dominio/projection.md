# `domain/producer` — a projeção

**Programa:** produtor (processo de conteúdo) · **Escopo:** documento · **Thread:** main

Uma instância por documento. Recebe **exatamente quatro coisas**: `const IDocumentView&`,
`IClock`, `IPatchUplink`, e a si mesma como `IDocumentObserver`.

É a lista inteira de portas deste diretório, e é por isso que a incapacidade da projeção deixa
de ser argumento e vira algo que se confere olhando um `ls`: ela não tem `IEngineHost`, não
tem `IEngineDocument`, não tem `ILink`, não tem host. Logo não navega, não despacha entrada,
não fala com o supervisor.

**Nasce e morre com o documento.** Navegar destrói o documento e cria outro — então destrói
esta instância e cria outra. Época deixou de ser mecanismo: é o objeto anterior ter morrido.

---

## `NodeDescriptor` — a forma normal

Ver [`../../14-nodedescriptor.md`](../../14-nodedescriptor.md).

**Interface, não registro materializado.** O custo é exatamente o que o chamador pede.

```cpp
struct NodeDescriptor {
  virtual NodeKind  kind() const = 0;
  virtual ElementNs ns() const = 0;
  virtual AtomRef   name() const = 0;
  virtual FieldHash value() const = 0;
  virtual FieldHash attr(AtomRef) const = 0;
  virtual FieldHash prop(PropId) const = 0;
  virtual NodeId    parent() const = 0;
  virtual NodeId    prevSibling() const = 0;   // topologia de tamanho CONSTANTE
  virtual uint64_t  hash() const = 0;          // == rowHash; O(campos)
};
```

Duas implementações, e nada além delas:
`LiveDescriptor` sobre `IDocumentView` · `RowDescriptor` sobre a linha da tabela.

**Não é responsável por:** lista de filhos (renumeraria O(n)); estado derivado
(`nextSiblingOf`, `lastChildOf` — isso é invariante, não descritor); identidade (vem do
resolvedor, e resolvedor errado aparece como divergência de conteúdo).

## `emit` — a emissão como função pura

```cpp
RowChanges emit(const NodeDescriptor* prev, const NodeDescriptor* curr, DirtyMask);
```

| entrada | saída |
|---|---|
| `(nullptr, curr)` | criar |
| `(prev, curr)` | diff **só dos campos em `DirtyMask`** |
| `(prev, nullptr)` | remover |

`prev` é `RowDescriptor` (a tabela **é** o memorando do último emitido — sem armazenamento
extra); `curr` é `LiveDescriptor`.

**`P8` deixa de ser disciplina e vira propriedade do tipo:** partida a frio é `prev = nullptr`
para todo nó, resync idem. Não existe `if (isFirstFrame)` para alguém esquecer de não escrever.

**Pós-condição, por campo, todo tick:** depois de aplicar,
`table.fieldHash[id][campo] == o hash que `emit` leu do vivo`. Os dois valores já estão na
mão — **custo zero**, e aponta o nó e o campo exatos.

## `Identity` — handle ↔ id

```cpp
enum class KeySpace : uint8_t { Node, Sheet, Rule };
class Identity {
  NodeId assign(OpaqueRef, KeySpace);        // idempotente
  NodeId lookup(OpaqueRef, KeySpace) const;  // 0 = sem identidade
  OpaqueRef resolve(NodeId) const;           // nulo se esquecido
  void   forget(NodeId);
  size_t live(KeySpace) const;
  bool   checkInvariants() const;
};
```

Espaços não se cruzam — interpretar handle de regra como nó é a categoria de erro que o espaço
tipado elimina. **Não retém nada:** a posse é do motor, e o adaptador de leitura nem referência
forte a nó segura (iteração 6).

## `DirtyLedger` — duas formas, porque são duas naturezas

Mudança de conteúdo é sobre **um nó**; mudança estrutural é sobre **um pai**. O ledger reflete
isso em vez de tratar tudo como conjunto plano — e é daí que o lote sai de graça.

```cpp
class DirtyLedger {
  void markField(OpaqueRef node, DirtyKind, AtomRef field);  // o campo que o motor nomeou
  void markChild(OpaqueRef parent, OpaqueRef child, ChildChange);
  bool empty() const;
  void drainFields(FieldVisitor&);
  void drainChildren(ParentVisitor&);   // por pai, filhos em ordem de prevSibling
  void discardPending();                // só durante reconstrução de resync
};
```

**Marcar é a única operação disponível durante notificação.** Nenhum método lê a árvore, nenhum
produz saída — a reentrância deixa de ser problema, e nada alcançável daqui roda script.

**A granularidade segue a notificação.** O motor entrega o nome do atributo que mudou;
descartá-lo e reler o nó inteiro é jogar fora informação já entregue.

**O lote cai da drenagem, sem passagem nova.** `drainChildren` visita cada pai e caminha os
filhos sujos **em ordem de irmão**: corrida de novos consecutivos vira **um** `INSERT`,
corrida de removidos vira **um** `REMOVE`, e `before` é calculado uma vez por corrida. Uma
corrida de irmãos novos sob o mesmo pai **é** o lote — os `prevSibling` encadeados são ele.

É a generalização da correção `walkSiblingRun` (~190× sobre o defeito O(N²) do
`resolvedBefore`), que já era "iterar na ordem da topologia". Lá foi conserto pontual; aqui é
a única forma de escrever.

`discardPending` é só do resync. **Não** é usado no halt: halt para o relógio, não o acúmulo.

## `PatchClock` — quando o patch sai

```cpp
class PatchClock : public ITimerTarget {
  void onDirty(); void halt(); void resume(); void flushNow();
};
```

- `onDirty` arma o timer se não estiver armado — não reagenda a cada mutação, o que colapsaria
  a cadência sob rajada.
- **Só publica se `IPatchUplink::isDrained()`.** Se o anterior não saiu, não publica: a sujeira
  continua coalescendo e o próximo patch sai maior. É daí que vem "sem fila, sem saturação" —
  e o produtor obtém isso **sem saber que existe socket**.
- Halt e resume tomam alcance; flush é de um documento.

**Invariante:** `halt` + N mutações + `resume` produz **exatamente um** patch contendo as N.

## `PatchBuilder` — mudanças → bytes

Duas fases: nada é observável até `end`, então abortar a construção é seguro e patch
meio-construído nunca sai. Escreve em `scratch` fornecido — sem alocação por patch. Ordem de
opcode vem do schema, não da ordem de chegada da sujeira: é o que garante bytes idênticos para
estados idênticos.

**Invariante (iteração 3):** o patch é **publicado no mesmo turno em que é fechado**. Não
existe patch fechado guardado para enviar depois.

## `PatchSequence` e `Digest`

`PatchSequence`: monotônica **por documento**. Documento novo recomeça — não há `generation`
porque o id do documento já diz que é outro. **Não alinha entre frames**, por desenho.

`Digest`: resumo de 64 bits, ordem-dependente, estável entre plataformas e entre linguagens —
ele cruza a fronteira C++/TypeScript e é comparado dos dois lados. Nenhum ponteiro entra no
cálculo.

## `Resync`

```cpp
enum class Force : uint8_t { FromMap = 0, FromWalk = 1 };
```

**Executa a força que recebeu. Nunca escolhe** — escolher é política do supervisor. Fecha com
verificação de escopo; não bater é `Fault` reportado, **não** segunda tentativa automática.

**Não existe caminho alternativo de "anexar cliente novo":** anexar é resync pelo mapa, o mesmo
código. Dois caminhos para a mesma coisa divergem, e o bug resultante — sessão que nasce torta
e só se conserta quando dessincroniza — é caríssimo de achar.

## `Snapshot`

Observação **pura**: não altera sequência nem sujeira. Instrumento que muda o que observa é
instrumento inútil — daí ser `const` de ponta a ponta.

**Invariante:** dois snapshots consecutivos sem mutação no meio são idênticos byte a byte.

## `Policy`

```cpp
static bool  isProjectable(NodeKind, bool userAgentOwned);
static Plane planeOfSheet(bool authorStyleOwner, bool constructed, bool linked);
static bool  isFrameHost(NodeKind, bool hasChildFrame);
```

Estáticas, totais, sem estado. **A regra de double-emit mora aqui**, não no arquivo de gancho
do motor: `<style>` de autor pinta pelo DOM projetado e não entra no plano CSSOM; `<link>` e
construída/adotada ficam no plano. Hoje isso vive dentro de um header colado no Gecko, onde é
intestável.

Nada criado pelo navegador é projetado: o elemento é o contrato, o interior é trabalho do
navegador, dos dois lados.

**Teste: tabela-verdade completa** — a regra mais sutil do sistema, exaustivamente verificada.
