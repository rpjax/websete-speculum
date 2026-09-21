# Iteração 8 — são dois programas, não um

**Passo:** perguntar, para cada componente, **em qual processo ele roda**.

---

## O que apareceu

A projeção observa o documento, então roda no **processo de conteúdo**. A ponte com o
supervisor é única e vital, então vive no **processo pai**. Os patches atravessam IPC entre
os dois.

Ou seja: `domain/` não é um programa. São **dois**, com vocabulários e vidas diferentes, e eu
vinha desenhando como se fosse um só — o que embaralhava tempo de vida e escondia uma
fronteira real.

```
domain/producer/      roda no processo de CONTEÚDO, um por documento
   identidade · ledger · relógio · construtor de patch · resync · snapshot · política
        │
        │  IPatchUplink        ← a fronteira, explícita
        ▼
domain/session/       roda no processo PAI, um por sessão
   link · escritor · roteador · correlações · viewports · árvore de frames · ativos · falha
```

`domain/wire` e `domain/fault` são compartilhados: os dois lados falam a mesma linguagem de
bytes e o mesmo tipo de erro.

## `IPatchUplink` — a fronteira ganha nome

```cpp
struct IPatchUplink {
  virtual void publish(DocumentId, uint32_t sequence, std::span<const uint8_t> patch) = 0;
  virtual void publishSnapshot(DocumentId, CorrelationId, const SnapshotHeader&,
                               std::span<const uint8_t>) = 0;
  virtual bool isDrained() const = 0;     // o anterior já saiu?
  virtual ~IPatchUplink() = default;
};
```

É a única coisa que o produtor recebe capaz de produzir saída — e ela **não conhece o
supervisor, nem o fio, nem a sessão**. O produtor publica para cima e não sabe para onde vai.

`isDrained()` é o que faz a regra de "um envelope em voo" atravessar o IPC sem o produtor
saber que existe socket: se não drenou, não publica, a sujeira continua coalescendo, e o
próximo patch sai maior.

## O que isso simplifica

**Cada lado tem menos portas.** O produtor vê `IDocumentView`, `IDocumentObserver`, `IClock` e
`IPatchUplink`. Só. Não tem link, não tem host, não tem frame, não tem ativo.

**A incapacidade fica trivial de conferir.** Antes era argumento sobre injeção; agora é a
lista de portas de um diretório.

**O teste do produtor não precisa de sessão nenhuma**, e o teste da sessão não precisa de
documento — os dois lados são exercitáveis sozinhos, e juntos quando o `sim` colapsa o IPC
num processo só.

## Observador se pendura no que observa

Consequência da iteração 7, aplicada em todo lugar: `IHostObserver` encolhe para o que é
realmente de nível de host — processo nasceu/morreu, viewport abriu/fechou, frame entrou/saiu
da árvore. Progresso de carga e diálogo vão para `IFrameObserver`, anexado ao frame. Mutação
vai para `IDocumentObserver`, anexado ao documento.

Saiu de um contrato de doze métodos que misturava quatro escopos de vida para três contratos
em que **cada um morre junto com aquilo que observa**.
