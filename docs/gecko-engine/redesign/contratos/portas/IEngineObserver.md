# IEngineObserver

**Tipo:** contrato/notificação · **Escopo:** sessão · **Thread:** main · **Camada:** ports

## Responsabilidade
Nascimento e morte no nível do motor: processos, viewports, e a entrada e saída de frames na
árvore.

## Não é responsável por
- progresso de carga, diálogo, troca de documento — isso é `IHostObserver`, anexado ao host
- mutação — isso é `IDocumentObserver`, anexado ao documento
- decidir o que fazer com nada disso

## Contrato
```cpp
struct IEngineObserver {
  virtual void onProcessAttached(IEngineProcess&) = 0;
  virtual void onProcessGone(ProcessId) = 0;

  virtual void onViewportOpened(ViewportId, IEngineHost& root) = 0;
  virtual void onViewportClosed(ViewportId) = 0;

  virtual void onHostAttached(IEngineHost&) = 0;
  virtual void onHostDetached(HostId) = 0;
  virtual ~IEngineObserver() = default;
};
```

## Semântica
- Encolheu de doze métodos misturando quatro escopos de vida para seis que compartilham um.
  Cada observador agora se pendura no que observa, e morre com ele.
- **Todo host anuncia**, raiz ou não, e o pai vem do handle. Não há mensagem que só valha
  para a raiz, nem campo que exista só para ficar zerado.
- `onProcessGone` vem **depois** dos documentos daquele processo terem morrido. A ordem é
  garantida porque a posse a garante: destruir o processo destrói o que era dele primeiro.

## Falhas
Nenhuma.

## Invariantes
1. `onProcessGone` e `onHostDetached` são terminais por id.
2. Nenhum `onHostAttached` chega sem o viewport dele estar aberto.
3. Nenhum método produz saída observável fora do processo.

## Testabilidade
O cenário caro e hoje inalcançável: processo morre com três documentos, dois deles em frames
cujos filhos vivem em processo vivo. O teste afirma a ordem exata dos avisos, um aviso por
entidade sem duplicata, e a subárvore fechada por regra única.

## Colabora com
[IEngine](IEngine.md) · [IEngineProcess](IEngineProcess.md) · [IEngineHost](IEngineHost.md)
