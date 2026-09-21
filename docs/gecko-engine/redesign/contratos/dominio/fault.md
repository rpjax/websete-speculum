# `domain/fault` — a falha, uma vez só

**Escopo:** chamada · **Thread:** any

Um tipo para **qualquer** erro do sistema. Substitui os quinze enums de erro que o catálogo
anterior tinha espalhados por porta.

---

## `Fault` — o envelope

```cpp
enum class FaultCode : uint16_t { /* catálogo único, estável no fio */ };
enum class FaultKey  : uint16_t { Document, Viewport, Process, Stream, Node, Sheet, Rule,
                                  Correlation, Request, Offset, Expected, Actual,
                                  Phase, Kind, Count, Limit /* … */ };
enum class ValueTag  : uint8_t  { U64, I64, F64, Str };

struct FaultDatum { FaultKey key; ValueTag tag; Value value; };

struct Fault {
  FaultCode   code;
  uint32_t    flags;        // Transient | Retryable | ProtocolViolation | ClientVisible
  const char* origin;       // componente que produziu, literal estático
  const char* message;      // literal estático — sem interpolação, sem alocação
  uint8_t     count;
  FaultDatum  data[8];
};
```

### Por que assim

**Nenhum campo de domínio privilegiado.** A primeira versão tinha `ContextId context` dentro
do `Fault`. Era gambiarra: por que contexto e não stream, nó, offset, correlação? Agora tudo
que identifica "onde" entra em `data`, uniformemente. O documento a que a falha se refere é o
do **envelope do fio** — não se duplica.

**Chave tipada, não string.** String livre não é comparável do outro lado: vira log que
humano lê e máquina ignora. Com `FaultKey` catalogada, o supervisor casa `Expected` contra
`Actual` programaticamente.

**Sem `severity`.** Era o campo onde um componente contrabandearia a decisão de morrer. A
falha diz **o que aconteceu**; o que ela causa é uma tabela em um lugar só (abaixo).

**`message` é literal estático.** Sem formatação, sem buffer, sem truncamento, sem alocação.
O que varia está em `data`.

## `FaultAction` — a escada de falha, como dado

```cpp
enum class FaultAction : uint8_t { Report, DropDocument, DropStream, KillSession };
FaultAction actionOf(FaultCode);          // tabela, em um arquivo, testável
```

| exemplo de código | ação | quem executa |
|---|---|---|
| `InputRejected`, `NavigateRefused` | `Report` | fato catalogado, segue a vida |
| `ResyncCheckFailed` | `Report` | supervisor decide a próxima força |
| `DocumentGone` | `DropDocument` | registro remove |
| `AssetOffsetGap` | `DropStream` | registro cancela |
| `FramingLost`, `CeilingExceeded`, `LinkBroken` | `KillSession` | `Session`, e só ele |

Separar detecção de decisão é o ponto: quem detecta produz `Fault`; a tabela diz o que isso
causa; **um** componente executa a morte.

## Regra de camada

**Nenhum `[[noreturn]]` em `domain/`.** Hoje `FailCatalogued` aborta o processo, o que embute
política de morte dentro do mecanismo e contradiz o próprio contrato da ponte, que diz que
falha não derruba nada por si.

## Caminho quente não falha por valor

`Fault` tem ~160 bytes: é para caminho frio. Leitura de árvore (`IDocumentView`) devolve
**valor neutro**, nunca `Result`. Handle morto é caso normal, não erro.

## Testabilidade

`faultsOf(code)` conta ocorrências por código, para que o teste afirme **qual** falha houve,
não que algo falhou. É a diferença entre "não quebrou" e "quebrou exatamente aqui, com este
código, nesta fase".
