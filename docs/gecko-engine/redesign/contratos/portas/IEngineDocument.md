# IEngineDocument

**Tipo:** contrato/dirigida · **Escopo:** documento · **Thread:** main (processo de conteúdo) · **Camada:** ports

## Responsabilidade
O documento carregado **agora** num host: sua identidade, sua leitura, sua observação, e o
despacho de entrada nele.

## Não é responsável por
- navegar, recarregar, parar, redimensionar — isso é do **frame**, que sobrevive à navegação
- decidir o que projetar
- conhecer o fio

## Contrato
```cpp
struct IEngineDocument {
  virtual DocumentRef id() const = 0;
  virtual HostId    frame() const = 0;
  virtual ProcessId  process() const = 0;
  virtual bool       isAlive() const = 0;

  virtual const IDocumentView& view() const = 0;
  virtual void  attach(IDocumentObserver*) = 0;

  virtual Result<void> dispatch(const ResolvedGesture&) = 0;
  virtual Result<Box>  boxOf(Ref<Node>) const = 0;
  virtual ~IEngineDocument() = default;
};
```

## Semântica
- **`DocumentRef` é novo a cada navegação.** O que sobrevive é o `HostId`. Por isso não existe
  `generation`: "o conteúdo do slot foi trocado" é dito por o id do documento ter mudado.
- **Teardown por destruição de objeto.** Navegar destrói este objeto e cria outro. A projeção,
  a tabela de identidade e o ledger são dele e morrem junto — não há rotina de reset limpando
  sete estruturas na mão, e não há a oitava que alguém esqueceu.
- `view()` e `attach()` existem separados **para que a projeção nunca receba este handle**:
  ela lê, é avisada, e fica incapaz de despachar entrada.
- `dispatch` recebe gesto **já resolvido** e é a **única operação do desenho que roda script**.
  Ela é, por construção, inalcançável a partir de uma notificação de mutação — o motor proíbe
  rodar script ali, e o grafo de injeção prova que não há caminho.

## Falhas
Por `Fault`: `NoSuchDocument`, `DocumentGone`, `NoTarget`, `NoWidget`, `NoLayout`,
`DispatchRefused`. Nenhuma é fatal: entrada rejeitada é fato catalogado.

## Invariantes
1. Nenhuma operação decide **se** deve acontecer; só executa.
2. Nenhuma emite no fio.
3. `view()` e `boxOf` não rodam script.
4. O observador anexado morre com o documento.
5. Um documento morto responde tudo com `DocumentGone`, nunca com comportamento indefinido.

## Testabilidade
O `sim` troca o documento de um host sob carga: o teste afirma que a projeção antiga parou de
publicar, que a nova começou do zero, e que nenhum patch da anterior saiu depois da troca.

## Colabora com
[IEngineHost](IEngineHost.md) · [IDocumentView](IDocumentView.md) · [IDocumentObserver](IDocumentObserver.md)
