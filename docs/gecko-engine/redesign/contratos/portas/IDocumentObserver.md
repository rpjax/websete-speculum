# IDocumentObserver

**Tipo:** contrato/notificação · **Escopo:** documento · **Thread:** main · **Camada:** ports

## Responsabilidade
Ser avisado de toda mutação de um documento — estrutura, atributo, texto, shadow, folha e
regra — no instante em que o motor a comete.

## Não é responsável por
- **emitir qualquer coisa.** Nenhum método desta interface produz saída, e quem a implementa
  não recebe link nem relógio
- consultar a árvore durante a notificação: ela está em estado intermediário
- decidir se a mutação é projetável
- desduplicar

## Contrato
```cpp
struct IDocumentObserver {
  // estrutura
  virtual void onChildInserted(Ref<Node> parent, Ref<Node> child) = 0;
  virtual void onChildRemoving (Ref<Node> parent, Ref<Node> child) = 0;
  virtual void onAttributeChanged(Ref<Node>, uint16_t ns, AtomRef name) = 0;
  virtual void onTextChanged(Ref<Node>) = 0;
  virtual void onNodeDestroyed(Ref<Node>) = 0;
  virtual void onShadowAttached(Ref<Node> host, Ref<Node> shadowRoot) = 0;
  // estilo
  virtual void onSheetAdded(Ref<Sheet>, Ref<Node> owner) = 0;
  virtual void onSheetRemoved(Ref<Sheet>) = 0;
  virtual void onSheetApplicable(Ref<Sheet>) = 0;
  virtual void onRuleAdded(Ref<Sheet>, Ref<Rule>) = 0;
  virtual void onRuleRemoved(Ref<Sheet>, Ref<Rule>) = 0;
  virtual void onRuleTextChanged(Ref<Rule>) = 0;
  // documento aninhado
  virtual void onChildHostAttached(Ref<Node> host, HostId) = 0;
  virtual void onChildHostDetached(Ref<Node> host, HostId) = 0;
  // vida
  virtual void onDocumentClosing() = 0;
  virtual ~IDocumentObserver() = default;
};
```

## Semântica
- **Estrutura e estilo num contrato só, de propósito.** Sempre é o mesmo objeto que
  implementa os dois, e a **ordem entre eles importa** — uma folha adicionada no meio de uma
  inserção de nó tem que chegar na ordem em que aconteceu. Dois contratos transformariam uma
  ordem garantida numa coordenação a manter.
- **Argumentos primitivos, zero alocação.** Não existe `MutationRecord`. O custo é uma chamada
  indireta; materializar e descartar um objeto por mutação seria o custo errado no caminho
  quente, pelo mesmo motivo que matou JSON no controle.
- `onChildRemoving` vem **antes** da remoção, com o nó ainda ligado.
- `onSheetApplicable` não é redundante: regra nascida de parse não gera `onRuleAdded`, e este
  é o único momento em que a lista viva de uma folha carregada passa a existir. A assimetria é
  do motor; o contrato a nomeia em vez de escondê-la.
- O valor antigo do atributo não viaja: a projeção é diferencial sobre estado, não sobre
  transição.
- `onDocumentClosing` é a última chamada. Depois dela o observador é desanexado por destruição
  do documento — não há `detach` a lembrar. Navegar destrói o documento, então **época deixou
  de ser mecanismo**: é só o objeto anterior ter morrido.
- **Nada alcançável daqui roda script.** O motor proíbe rodar script durante notificação de
  mutação, e o grafo de injeção garante: quem implementa isto não tem `IEngineDocument`, que é
  o único lugar que roda.

## Falhas
Nenhuma. Notificação não devolve e não pode recusar.

## Invariantes
1. Nenhum método produz saída observável fora do processo.
2. Reentrante por construção: a implementação só marca, e marcar é reentrante.
3. Nenhuma implementação consulta `IDocumentView` durante a notificação.
4. `onDocumentClosing` é terminal.

## Testabilidade
O teste dirige sequências que o motor produz raramente: inserção seguida de destruição do
mesmo nó antes do flush; folha adicionada dentro de uma inserção; documento filho anexado e
destacado no mesmo intervalo de frame; `onDocumentClosing` com sujeira pendente.

## Colabora com
[IEngineDocument](IEngineDocument.md) · [IDocumentView](IDocumentView.md)
