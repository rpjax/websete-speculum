# ILink

**Tipo:** contrato/dirigida + notificação · **Escopo:** sessão · **Thread:** main · **Camada:** ports

## Responsabilidade
O socket com o supervisor: escrever bytes, entregar bytes que chegam, dizer quando morreu.

## Não é responsável por
- **decidir encerrar a sessão** — devolve `Broken` e para aí
- conhecer envelope, opcode ou documento: recebe e entrega `span<uint8_t>`
- enquadrar o que chega — vem picado em fronteira arbitrária
- reconectar: não existe reconexão

## Contrato
```cpp
enum class WriteOutcome { Complete, Partial, WouldBlock, Broken };
struct WriteResult { WriteOutcome outcome; size_t written; };

struct ILinkSink {
  virtual void onBytes(std::span<const uint8_t>) = 0;
  virtual void onWritable() = 0;                 // dá pra continuar escrevendo
  virtual void onBroken() = 0;
};

struct ILink {
  virtual WriteResult write(std::span<const uint8_t>) = 0;
  virtual void        attach(ILinkSink*) = 0;
  virtual void        close() = 0;
  virtual bool        isOpen() const = 0;
  virtual ~ILink() = default;
};
```

## Semântica
- **Leitura e escrita do mesmo fd num contrato só.** Separá-los em dois era fatiar um objeto
  ao meio: mesma vida, mesma morte, mesmo dono.
- `Partial`: o chamador completa em laço. `WouldBlock`: `written == 0`, espera `onWritable`.
- `Broken` é pegajoso: toda chamada seguinte devolve `Broken`. O `written` de um `Broken`
  conta — o supervisor pode ter recebido bytes parciais.
- `onWritable` é o que elimina a thread de saída: o motor já tem laço de eventos, e o fd
  registrado nele dispensa fila entre threads, lock e travessia de thread no sistema inteiro.
- `onBytes` pode trazer um byte ou 64 KiB; o `span` não sobrevive à chamada.

## Falhas
| resultado | quem decide |
|---|---|
| `Partial` | o escritor — completa em laço |
| `WouldBlock` | o escritor — espera `onWritable`, sem bloquear |
| `Broken` | `Session` — a sessão morre |

## Invariantes
1. Nunca bloqueia indefinidamente.
2. `written` é sempre exato.
3. Depois do primeiro `Broken`, nunca devolve outra coisa; `onBroken` chega no máximo uma vez
   e nenhum `onBytes` vem depois.
4. Ordem preservada nos dois sentidos.

## Testabilidade
Fake com roteiro de resultados. É o que transforma em asserção as três propriedades que hoje
não têm teste: escrita curta completada em laço, ausência de bloqueio sob rajada, e morte da
sessão quando a ponte rompe no meio de um host. Na entrada, o teste pica um envelope em
fronteiras maldosas e afirma que o resultado é idêntico à entrega inteira.

## Colabora com
[Session](../dominio/session.md) · [wire](../dominio/wire.md)
