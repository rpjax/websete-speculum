# IAssetReader

**Tipo:** contrato/dirigida · **Escopo:** sessão · **Thread:** main · **Camada:** ports

## Responsabilidade
Abrir um recurso sob um principal e entregar seus bytes em pedaços.

## Não é responsável por
- decidir se o recurso pode ser servido
- numerar stream ou montar envelope
- cachear

## Contrato
```cpp
struct IAssetChunkTarget {
  virtual void onChunk(StreamId, uint64_t offset, std::span<const uint8_t>) = 0;
  virtual void onEnd(StreamId, uint64_t totalBytes) = 0;
  virtual void onError(StreamId, Fault) = 0;
};

struct IAssetReader {
  virtual Result<void> open(StreamId, std::string_view url, DocumentRef,
                            IAssetChunkTarget*) = 0;
  virtual void         cancel(StreamId) = 0;
  virtual ~IAssetReader() = default;
};
```

## Semântica
- O principal vem do **documento**, não é passado solto: pedir em nome de um documento é a
  linguagem certa e fecha a porta para pedir em nome de ninguém.
- Chunks chegam em offset crescente e contíguo. Buraco é violação de contrato.
- `cancel` é idempotente e garante que nada chega depois do retorno; o que já estava a caminho
  vira `onError`.
- O próximo chunk só é lido quando o anterior saiu — é o que mantém "um envelope em voo" sem
  fila nenhuma.

## Falhas
Por `Fault`: `AssetNotFound`, `AssetForbidden`, `AssetReadFailed`, `AssetCancelled`.

## Invariantes
1. Um `StreamId` tem no máximo um `open` vivo.
2. Todo stream termina em exatamente um de `onEnd` ou `onError`.
3. Nenhum byte de recurso passa pelo domínio sem `StreamId`.

## Testabilidade
Fake com roteiro: leitura parcial, erro no meio, arquivo de zero bytes, cancelamento entre
dois chunks. Truncamento de stream deixa de ser bug de produção e vira linha de tabela.

## Colabora com
[assets](../dominio/assets.md)
