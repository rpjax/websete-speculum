# IDocumentView

**Tipo:** contrato/dirigida · **Escopo:** documento · **Thread:** main · **Camada:** ports

## Responsabilidade
Leitura de tudo que é estrutura de um documento: árvore DOM e grafo CSSOM.

## Não é responsável por
- **qualquer ação.** Não navega, não redimensiona, não despacha, não muta. É a capacidade de
  ler, entregue sozinha e de propósito
- posse: não retém, não solta. A tabela de handles é do motor
- decidir o que é projetável

## Contrato
```cpp
struct IDocumentView {
  // árvore
  virtual Ref<Node>    root() const = 0;
  virtual NodeKind   kindOf(Ref<Node>) const = 0;
  virtual ElementNs  namespaceOf(Ref<Node>) const = 0;
  virtual AtomRef    localNameOf(Ref<Node>) const = 0;
  virtual bool       isConnected(Ref<Node>) const = 0;
  virtual void       textOf(Ref<Node>, TextVisitor&) const = 0;
  virtual void       attributesOf(Ref<Node>, AttributeVisitor&) const = 0;
  virtual void       childrenOf(Ref<Node>, NodeVisitor&) const = 0;
  virtual bool       isUserAgentOwned(Ref<Node>) const = 0;
  virtual HostId    childHostOf(Ref<Node>) const = 0;   // 0 = não é host
  // shadow
  virtual Ref<Node>    shadowRootOf(Ref<Node>) const = 0;
  virtual Ref<Node>    shadowHostOf(Ref<Node>) const = 0;
  virtual ShadowMode shadowModeOf(Ref<Node>) const = 0;
  virtual void       formPropertiesOf(Ref<Node>, FormPropVisitor&) const = 0;
  // estilo
  virtual void       sheetsOf(SheetVisitor&) const = 0;
  virtual void       rulesOf(Ref<Sheet>, RuleVisitor&) const = 0;
  virtual void       childSheetsOf(Ref<Sheet>, SheetVisitor&) const = 0;
  virtual void       ruleTextOf(Ref<Rule>, TextVisitor&) const = 0;
  virtual Ref<Sheet>   sheetOf(Ref<Rule>) const = 0;
  virtual Ref<Node>    hostOf(Ref<Sheet>) const = 0;           // nulo = documento
  virtual bool       isAlive(Ref<Sheet>) const = 0;
  virtual bool       isAlive(Ref<Rule>) const = 0;
  virtual ~IDocumentView() = default;
};
```

## Semântica
- **Visitor, nunca coleção devolvida.** Devolver `vector` e `string` por valor custava quatro
  ou mais alocações por nó, por varredura. Visitor custa zero.
- `childHostOf` é a **ponte entre os dois eixos**: dá o host filho a partir do nó
  hospedeiro. Única operação que cruza de estrutura de nó para estrutura de frame — um lugar
  só, para o cruzamento nunca virar implícito.
- Handle morto responde neutro. Nó sumir entre a marcação e a leitura é o caso normal.
- `isAlive` distingue "este handle nomeia objeto vivo" de "este ponteiro já foi uma folha" —
  é o que permite derrubar id morto sem reinterpretar o handle.

## Obrigações do adaptador (iteração 6)
1. **Nenhuma referência forte a nó.** Ponteiro cru, limpo em `NodeWillBeDestroyed`. Referência
   forte segurada por objeto que a coleta de ciclos não enxerga vaza a árvore inteira, calada.
2. **Folha e regra não têm notificação de destruição**, então ali a referência é forte — e a
   tabela é possuída pelo **processo**, nunca pelo documento, para não fechar ciclo.
3. **Shadow root tem lista de observadores própria.** Ao ver shadow anexado, o adaptador anexa
   também lá, recursivamente. Esquecer é falha silenciosa: metade da página some.

## Falhas
Nenhuma por valor. Handle **morto** devolve neutro em silêncio — é o caso normal. Handle
**nunca visto** incrementa contador de diagnóstico e é assert em build de depuração: era a
única classe de bug que conseguia se esconder atrás de um caso legítimo (iteração 9, D5).

## Invariantes
1. Pura: duas chamadas sem mutação no meio dão o mesmo resultado.
2. Nenhuma operação roda script nem dispara mutação.
3. Espaços de chave não se cruzam: um handle é nó, folha **ou** regra.

## Testabilidade
Fixture construída por script de texto, sem motor. Cenários que no Gecko real são corrida
rara: nó destruído entre duas consultas, folha que vira aplicável depois de já ter regras,
host aninhado sem documento filho ainda.

## Colabora com
[IEngineDocument](IEngineDocument.md) · [IDocumentObserver](IDocumentObserver.md)
