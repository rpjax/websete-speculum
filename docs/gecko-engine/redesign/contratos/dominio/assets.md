# `domain/assets` — recursos

**Escopo:** sessão (registro) · chamada (classificação) · **Thread:** main

---

## `Classifier`

```cpp
enum class AssetDest : uint8_t { Image, Font, Media, Style, Script, Document, Fetch, Other };
static bool isServable(AssetDest);
```

Decisão **pelo destino, na origem**, virando `AssetDenied` no fio — não filtro de MIME
aplicado depois do lado do supervisor, que é cego ao conteúdo por desenho.

HTML, JS, CSS e XHR são negados: o cliente não os busca, porque a projeção os substitui.
Destino desconhecido é negado — default permissivo em superfície de rede é a decisão errada
por omissão.

Pura, total, oito entradas: tabela-verdade completa como teste.

## `Stream` — a máquina

```cpp
enum class Phase : uint8_t { Requested, Streaming, Denied, Complete, Cancelled };
class Stream {
  Phase    phase() const;
  uint64_t offset() const;
  Result<void> onChunk(uint64_t offset, std::span<const uint8_t>);
  Result<void> onEnd(uint64_t total);
  Result<void> onDenied();
  Result<void> onCancelled();
};
```

### `Cancelled` — a quinta fase, achada na iteração 3
O protocolo antigo tinha quatro: request, chunk, denied, complete. Faltava descrever "acabou
sem ter sido negado nem completado" — o que acontece quando a ponte rompe ou o documento morre
com um stream a meio caminho. Sem ela o registro vaza ou mente: ou o stream fica vivo para
sempre, ou é reportado como completo com bytes faltando.

Terminal e **local**: não viaja no fio, porque quando ela acontece a ponte já morreu. Existe
para que a limpeza seja correta e afirmável.

**Invariantes:** offsets contíguos e crescentes — buraco é falha, não condição a acomodar;
todo stream termina em exatamente um de `Denied`, `Complete`, `Cancelled`; nenhum byte sai
depois de fase terminal.

## `Streams` — o registro

```cpp
class Streams {
  Result<StreamId> open(DocumentRef, AssetDest, std::string_view url);
  Stream*          find(StreamId);
  void             cancelAllOfDocument(DocumentRef);
  void             cancelAll();
  size_t           live() const;
};
```

`StreamId` único por sessão, **nunca reusado** — chunk atrasado de stream morto não pode ser
aceito como sendo de outro vivo, mesmo motivo do id de documento.

`cancelAllOfDocument` e `cancelAll` são idempotentes e fecham o vazamento que o cenário
"socket rompe no meio de um ativo" revelou. **Asserção que fecha a conta:** abrir cinco
streams em dois documentos, matar um documento, afirmar que sobraram os do outro; terminar a
sessão, afirmar `live() == 0`.

**Um chunk em voo:** o próximo só é lido quando o anterior saiu, o que mantém "um envelope em
voo" sem fila nenhuma.

## `Telemetry`

```cpp
enum class CatalogId : uint16_t { FrameEmitted=1, ResyncRequested=2, ResyncCompleted=3,
                                  ResyncFailed=4, ProducerFault=5, InputAdmitted=6,
                                  InputRejected=7 };
bool enabled() const;                       // um atomic, sem alocação quando off
void emit(CatalogId, DocumentRef, std::span<const uint8_t>);
```

Desligado por padrão, e desligado custa **um atomic** — telemetria que custa quando está off é
telemetria que ninguém liga. Capacidade é parâmetro de lançamento, nunca variável de ambiente
que muda comportamento em runtime.

**Invariante que vira teste:** rodar o mesmo roteiro com telemetria ligada e desligada produz
bytes de saída idênticos. Observar não perturba.
