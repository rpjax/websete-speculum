# IPatchUplink

**Tipo:** contrato/dirigida · **Escopo:** documento · **Thread:** main (processo de conteúdo) · **Camada:** ports

## Responsabilidade
A fronteira entre os dois programas: o produtor publica patches para cima e não sabe para onde
vão.

## Não é responsável por
- conhecer supervisor, fio, sessão ou socket
- enfileirar
- interpretar o patch

## Contrato
```cpp
struct IPatchUplink {
  // DocumentId = { HostId, Generation } — 11-identidade; sem DocumentRef mintado.
  virtual void publish(DocumentId, uint32_t sequence, std::span<const uint8_t> patch) = 0;
  virtual void publishSnapshot(DocumentId, CorrelationId, const SnapshotHeader&,
                               std::span<const uint8_t>) = 0;
  virtual bool isDrained() const = 0;
  virtual ~IPatchUplink() = default;
};
```

## Semântica
- É a **única** coisa que o produtor recebe capaz de produzir saída. Toda a incapacidade da
  projeção se resume a isto: ela tem `IDocumentView`, `IDocumentObserver`, `IClock` e este
  uplink, e mais nada.
- `isDrained()` faz a regra de "um envelope em voo" atravessar o IPC **sem o produtor saber
  que existe socket**. Não drenou, não publica: a sujeira continua coalescendo e o próximo
  patch sai maior. É assim que não existe fila e não existe política de saturação.
- O `span` não sobrevive à chamada.
- No `sim` o uplink é uma chamada direta, e o IPC colapsa — que é o que permite rodar a sessão
  inteira num processo só, nos testes.

## Falhas
Nenhuma por valor. Publicar não pode falhar; o que regula é `isDrained`.

## Invariantes
1. `sequence` é estritamente crescente por documento.
2. Nada é publicado enquanto `isDrained()` for falso.
3. O produtor nunca aprende o destino.

## Testabilidade
Fake que conta publicações e controla `isDrained`. O cenário que ele prova: **segurar o dreno
por N intervalos produz um patch, não N** — a coalescência que substitui a fila.

## Colabora com
[projection](../dominio/projection.md) · [session](../dominio/session.md)
