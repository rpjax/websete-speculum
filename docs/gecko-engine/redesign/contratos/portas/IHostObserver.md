# IHostObserver

**Tipo:** contrato/notificação · **Escopo:** host · **Thread:** main · **Camada:** ports

## Responsabilidade
Ser avisado do que acontece **com o slot**: progresso de carga, troca de documento, e o que a
página pede a um humano.

## Não é responsável por
- decidir o que é "o commit da carga pedida" — isso é `NavigationState`
- filtrar `about:blank`, carga anterior ou redirecionamento
- responder pedido
- observar mutação — isso é do documento

## Contrato
```cpp
struct IHostObserver {
  virtual void onLoadStarted() = 0;
  virtual void onLoadStopped(bool succeeded) = 0;
  virtual void onLocationChanged(std::string_view url) = 0;

  virtual void onDocumentInstalled(IEngineDocument&) = 0;
  virtual void onDocumentDiscarded(DocumentId) = 0;  // { host, generation }

  virtual void onPromptRequested(PromptKind, RequestId, std::span<const uint8_t> description) = 0;
  virtual void onPromptAbandoned(RequestId) = 0;

  virtual void onHostClosing() = 0;
  virtual ~IHostObserver() = default;
};
```

## Semântica
- **Anexado ao host, morre com o host.** Sem `detach` a lembrar, e sem o caso "chegou
  notificação de frame que já morreu" — ele é inalcançável.
- Progresso chega **cru**, incluindo pares start/stop de cargas que ninguém pediu. Filtrar é
  do domínio: é por não haver essa separação que o desenho antigo tinha cinco booleanos.
- `onDocumentInstalled` / `onDocumentDiscarded` são o par que torna a troca de documento um
  evento **nomeado** em vez de uma inferência a partir de progresso de carga.
- **A marionete pede e espera.** Não há auto-resposta possível: a interface não devolve nada.
  `onPromptAbandoned` cobre a página sumir com o pedido pendente — sem ele o `RequestId` vaza
  e o supervisor espera para sempre.

## Falhas
Nenhuma.

## Invariantes
1. `onHostClosing` é terminal.
2. Todo pedido termina em resposta **ou** abandono, nunca nos dois.
3. Nenhum método produz saída observável fora do processo.
4. `onDocumentDiscarded` sempre precede o `onDocumentInstalled` do próximo.

## Testabilidade
Sequências maldosas dirigidas direto: STOP da carga anterior chegando depois do START da
nova; location change sem start; start-stop-start dentro de um intervalo de patch; pedido
pendente + navegação → abandono → resposta atrasada descartada sem efeito.

## Colabora com
[IEngineHost](IEngineHost.md) · [documents](../dominio/documents.md)
