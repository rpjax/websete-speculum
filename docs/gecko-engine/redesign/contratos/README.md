# Catálogo

**12 contratos · 7 módulos de domínio, em dois programas.**

> **Vocabulário (docs 11 e 14):** `host` é o slot que hospeda um documento; `documento` é o
> que está carregado nele agora; identidade de documento é o par `(hostId, generation)`.
> Emissão é `emit(prev, curr, dirtyMask)` sobre `NodeDescriptor`. Formato em [`../06-taxonomia.md`](../06-taxonomia.md).

Interface existe onde há fronteira de motor, injeção de falha, ou duas implementações reais.
O resto é lógica pura testada diretamente — interface sobre função de hash é custo sem
capacidade nova.

---

## Contratos — `ports/`

A família de handles é uma hierarquia, não uma lista. Lê-se como o domínio fala:
**o host tem processos, o processo tem documentos, o documento tem uma árvore e sabe navegar.**

```
processo PAI                          processo de CONTEÚDO
─────────────────────────────         ──────────────────────────────
IEngine ──── IEngineObserver
   ├─ IEngineHost ─ IHostObserver    o slot: navegar, carga, diálogo
   │     └─ document() ──────────────► IEngineDocument   o conteúdo
   │                                      ├─ view()  → IDocumentView      ler
   │                                      ├─ attach() ← IDocumentObserver ser avisado
   │                                      └─ dispatch()                   agir
   └─ IEngineProcess                   possui os documentos
                       ◄───── IPatchUplink ─────  a fronteira entre os dois
infra: ILink · IClock · IAssetReader
```

| contrato | de que é dono | escopo |
|---|---|---|
| [IEngine](portas/IEngine.md) | o motor como um todo; viewports | sessão |
| [IEngineProcess](portas/IEngineProcess.md) | um processo de conteúdo, **dono** dos seus documentos | processo |
| [IEngineHost](portas/IEngineHost.md) | o **slot**: posição na árvore, e navegar | host |
| [IEngineDocument](portas/IEngineDocument.md) | o **conteúdo** de agora: ler, observar, despachar | documento |
| [IHostObserver](portas/IHostObserver.md) | carga, diálogo, troca de documento | host |
| [IPatchUplink](portas/IPatchUplink.md) | a fronteira produtor → sessão | documento |
| [IDocumentView](portas/IDocumentView.md) | **ler** estrutura: DOM e CSSOM | documento |
| [IDocumentObserver](portas/IDocumentObserver.md) | **ser avisado** de mutação | documento |
| [IEngineObserver](portas/IEngineObserver.md) | nascimento e morte: processos, viewports, hosts | sessão |
| [ILink](portas/ILink.md) | o socket com o supervisor, nos dois sentidos | sessão |
| [IClock](portas/IClock.md) | tempo monotônico e agendamento | sessão |
| [IAssetReader](portas/IAssetReader.md) | abrir recurso e entregar bytes | sessão |

## Domínio — `domain/`

| módulo | de que é dono |
|---|---|
| [fault](dominio/fault.md) | **um** tipo para qualquer erro, e a tabela código → ação |
| [wire](dominio/wire.md) | schema, cursor, envelope, enquadrador, tetos |
| [session](dominio/session.md) | a única porta de morte, o escritor, o roteador, correlações |
| [documents](dominio/documents.md) | ids, viewports, **árvore de hosts**, posse de documentos, navegação |
| [projection](dominio/projection.md) | identidade, sujeira, relógio, **patch**, resync, política |
| [interaction](dominio/interaction.md) | gesto, tecla, geometria, edição de form, admissão |
| [assets](dominio/assets.md) | classificação, stream, registro, telemetria |

---

## Mapa de incapacidade

A coluna que mais importa não é "de que é dono" — é o que **não** foi entregue. Cada linha é
uma classe de erro que ninguém consegue digitar.

| quem | é incapaz de | porque |
|---|---|---|
| a projeção | navegar, redimensionar, despachar entrada | recebe **quatro** portas: view, clock, uplink, e a si mesma como observer. Confere-se com um `ls` |
| a projeção | saber que existe socket | `IPatchUplink::isDrained()` é toda a sua noção de vazão |
| qualquer um | rodar script numa notificação | o motor proíbe; só `IEngineDocument::dispatch` roda, e o observador não o tem |
| o adaptador | vazar a árvore por ciclo | não segura referência forte a nó; vive no processo, não no documento |
| `IDocumentObserver` (impl) | emitir qualquer coisa | nenhum método seu produz saída; não recebe link nem relógio |
| `ILink` (impl) | encerrar a sessão | não conhece `Session`; devolve `Broken` e para |
| qualquer componente | ter um documento de processo morto | o único caminho até o documento passa pelo processo, que o possui |
| qualquer componente | esquecer de desanexar um observador | o observador é anexado ao documento e morre com ele |
| qualquer componente | esquecer de limpar documentos de um processo | eram dele; morreram com ele |
| `Resync` | escolher a força | recebe `Force` como argumento |
| `Policy` | depender de estado, tempo ou ordem | estática e total |
| `Snapshot` | alterar o que observa | `const` de ponta a ponta |
| `Telemetry` | influenciar bytes de saída | provado por teste de igualdade on/off |
| o motor | responder a um diálogo sozinho | `IEngineObserver` não devolve nada |
| `LinkWriter` | acumular fila | aceita **um** envelope; a sujeira coalesce no ledger |
| qualquer componente de `domain/` | terminar o processo | `[[noreturn]]` proibido na camada; morte só em `Session` |
| o código inteiro | perguntar "isto é a raiz?" | não existe frame especial |
| qualquer um | esquecer de resetar época na navegação | o documento é destruído; não há reset |
