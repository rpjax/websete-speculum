# IEngine

**Tipo:** contrato/dirigida · **Escopo:** sessão · **Thread:** main · **Camada:** ports

## Responsabilidade
O motor inteiro, como uma coisa só. Abre e fecha viewports, e é a raiz por onde se chega a
processos e frames.

## Não é responsável por
- navegar e redimensionar — isso é de `IEngineHost`; despachar entrada, de `IEngineDocument`
- decidir quantos viewports existem
- terminar a sessão
- conhecer o fio

## Contrato
```cpp
struct IEngine {
  virtual Result<ViewportId> openViewport(Extent) = 0;
  virtual Result<void>       closeViewport(ViewportId) = 0;
  virtual void               attach(IEngineObserver*) = 0;
  virtual IEngineHost*      frame(HostId) = 0;        // árvore: lado do processo pai
  virtual IEngineProcess*    process(ProcessId) = 0;    // posse: lado do conteúdo
  virtual void               forEachProcess(ProcessVisitor&) = 0;
  virtual ~IEngine() = default;
};
```

## Semântica
- `openViewport` é a única forma de um host raiz passar a existir. Ele nasce em branco; quem
  navega é `IEngineHost::navigate`.
- **As duas entradas refletem os dois eixos.** `frame()` entra pela árvore, que vive no
  processo pai; `process()` entra pela posse, que é de quem hospeda o documento. Não são dois
  caminhos para a mesma coisa: são os dois eixos declarados do modelo.
- **N viewports desde o primeiro dia.** O V1 abre um, mas nada no código sabe disso — não há
  ramo "o viewport" contra "os viewports", logo não há ramo para errar.
- Documento só se alcança por `process()`. É por isso que documento de processo morto é
  inalcançável em vez de ser um caso a tratar.

## Falhas
Todas por `Fault`. Códigos possíveis: `ViewportOpenRefused`, `NoSuchViewport`,
`NoSuchProcess`.

## Invariantes
1. Nenhum host existe fora de um viewport.
2. Fechar um viewport fecha sua árvore inteira, atravessando todos os processos envolvidos.
3. Nenhuma operação daqui navega.

## Testabilidade
O `sim` abre três viewports com árvores diferentes e o mesmo código roda — prova, sem motor,
que nada no domínio assume viewport único.

## Colabora com
[IEngineHost](IEngineHost.md) · [IEngineProcess](IEngineProcess.md) · [IEngineObserver](IEngineObserver.md)
