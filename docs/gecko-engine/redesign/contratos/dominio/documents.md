# `domain/documents` — viewports, frames, documentos

**Programa:** sessão (processo pai) · **Thread:** main

O coração do modelo. Ver [`../../07-modelo.md`](../../07-modelo.md).

> **A frase inteira:** a sessão tem viewports; um viewport tem uma árvore de **frames**; um
> frame tem um **documento**, e navegar troca o documento do host; um documento vive num
> **processo**, que o possui.

---

## `Ids` — três espaços, um minter

```cpp
template <class Space> class Minter { Id<Space> mint(); uint32_t minted() const; };
// Minter<Viewport>   Minter<Host>        // generation é contador por host, não mint
```

Monotônico, sem reuso, nunca zero. **Sem reuso** porque mensagem atrasada de algo morto jamais
pode ser aceita como sendo de algo vivo — a classe de bug mais cara que este sistema consegue
produzir, tornada impossível por um `uint32_t`.

**Consequência declarada:** o espaço tem **lacunas**. Frame que nasce e morre antes de emitir
consome um id que nunca aparece no fio. O supervisor tolera; é propriedade do protocolo.

`ProcessId` vem do motor, não é mintado aqui.

## Identidade do documento — `(HostId, Generation)`

Verdade em [`../../11-identidade.md`](../../11-identidade.md). O `HostId` é o **slot** (frame).
Cada navegação incrementa um contador `Generation` **por host** (nunca zero enquanto há
documento; `0` = slot vazio). O documento vivo é o par:

```cpp
struct DocumentId { HostId host; Generation generation; };
```

Não há mint global de documento. `DocumentRef` como id opaco mintado **não existe**.

## `HostNode` e `Hosts`

```cpp
struct HostNode {
  HostId id, parent;             // parent == 0 → raiz de um viewport
  ViewportId viewport;
  Generation generation;         // 0 = vazio; senão documento = (id, generation)
  Extent     extent;
  NavigationState nav;
};

class Hosts {
  void attach(const HostNode&);
  void detach(HostId);                        // fecha a subárvore
  const HostNode* find(HostId) const;
  void installDocument(HostId, Generation);   // navegou
  void discardDocument(HostId);
  void forEachChild(HostId, Visitor&) const;
  void forEachInSubtree(HostId, Visitor&) const;
  bool checkInvariants() const;                // árvore sem ciclo, pai vivo, viewport vivo
};
```

**Todos entram**, raiz ou não. Nenhum campo existe só para ficar zerado, nenhum diz "sou
especial". `parent == 0` é **posição**.

`forEachInSubtree` é o que dá **alcance** às operações: halt, resume e resync tomam um host e
um alcance (`Self` ou `Subtree`). Não há mais assimetria entre "halt é de aba" e "flush é de
contexto" — há uma operação e um alcance.

**Órfão não é categoria:** pai morre num processo, filho vive em outro, e `detach` fecha a
subárvore atravessando processos. Uma regra, explícita.

## `Documents` — posse, não estrutura

```cpp
class Documents {
  void install(DocumentId, ProcessId);
  void discard(DocumentId);
  void discardAllOfProcess(ProcessId);
  const DocumentRecord* find(DocumentId) const;
  bool checkInvariants() const;                // todo documento com frame vivo e processo vivo
};
```

Registro do eixo de **posse**. A árvore mora em `Hosts`; aqui mora quem hospeda o quê. Os dois
eixos nunca se cruzam por acidente porque estão em dois registros.

## `Viewports`

```cpp
class Viewports {
  ViewportId open(Extent, HostId root);
  void       close(ViewportId);     // fecha a árvore inteira
  size_t     size() const;
};
```

N desde o primeiro dia. O V1 abre um, e nenhuma linha do domínio sabe disso.

## `NavigationState` — do host, não do documento

Uma por **frame** — é ele que sobrevive à navegação.

```cpp
enum class NavPhase  : uint8_t { Idle, Requested, Started, Committed, Failed };
enum class NavEffect : uint8_t { None, EmitLoadStart, EmitNavigated, EmitFailed, Cancelled };
```

| estado | evento | novo | efeito |
|---|---|---|---|
| `Idle` | requested | `Requested` | `None` |
| `Requested` | loadStarted | `Started` | `EmitLoadStart` |
| `Requested` | loadStopped | `Requested` | `None` — é o STOP da carga anterior |
| `Started` | locationChanged(=esperada) | `Started` | `None` |
| `Started` | loadStopped(true) | `Committed` | `EmitNavigated` |
| `Started` | loadStopped(false) | `Failed` | `EmitFailed` |
| `Committed` | loadStarted | `Started` | `EmitLoadStart` — a página navegou |
| qualquer | requested | `Requested` | `Cancelled` + expõe a correlação cancelada |

Fora da tabela é assert, em um lugar.

**Por que existe:** cinco booleanos coordenados representam **32 estados** para uma máquina de
cinco. Os 27 restantes eram alcançáveis, e é onde cada corrida de navegação vivia.

**`RetryOnce` não existe aqui.** Tentar de novo é situacional e mora no supervisor, igual ao
resync.
