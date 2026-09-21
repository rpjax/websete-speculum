# `domain/wire` — o fio, uma implementação só

**Escopo:** chamada (exceto `Framer`, que é sessão) · **Thread:** any

Gerado a partir de **uma** declaração de mensagens, compartilhada por C++, TypeScript e .NET.
Ver [`../../08-fio.md`](../../08-fio.md).

---

## `Schema` — a fonte

A declaração de mensagens é o artefato de origem: opcodes, direção, campos, tipos. O codec de
cada linguagem é gerado dela.

Isso ataca a causa raiz em vez do sintoma. Antes havia três implementações do mesmo formato
escritas à mão só no C++, mais a do TypeScript, mais a do .NET — e a classe de bug "os dois
lados discordam do formato" é a mais cara que existe em protocolo binário. Gerado, ela é
inalcançável.

**Não é responsável por:** semântica. O schema diz a forma; o que a mensagem significa é do
componente que a trata.

## `Cursor` — primitivos

```cpp
class Reader { bool ok(); bool u8(uint8_t&); /* u16 u32 u64 i32 bool */
               bool str(std::string_view&); bool bytes(std::span<const uint8_t>&); };
class Writer { bool ok(); /* simétrico */ size_t length(); };
```

- **Falha pegajosa:** depois do primeiro estouro tudo falha e `ok()` é falso. Elimina a
  checagem por campo, que é onde o esquecimento mora.
- `str` devolve vista para dentro do buffer: sem cópia, sem alocação.
- Nenhuma leitura ultrapassa o span, jamais.

## `Envelope` — 12 bytes alinhados

```cpp
struct Envelope { OpCode op; uint16_t flags; DocumentRef document; uint32_t length;
                  CorrelationId correlation; /* só se flags.HasCorrelation */ };
```

**Não é responsável por:** interpretar payload. Frame é opaco aqui, sempre.

## `Framer` — bytes picados → envelopes

**Escopo: sessão.** Único componente com estado neste módulo.

```cpp
struct IEnvelopeTarget { virtual void onEnvelope(const Envelope&, std::span<const uint8_t>) = 0;
                         virtual void onFramingLost(Fault) = 0; };
class Framer { void feed(std::span<const uint8_t>); size_t buffered() const; };
```

- Um `feed` pode produzir zero, um ou muitos envelopes; um envelope pode chegar em vinte
  `feed`s.
- Entrega payload **contíguo**: realinha no buffer interno quando chega picado.
- `onFramingLost` é terminal — sem confiar no tamanho não há como achar o próximo envelope.

**A propriedade que vira teste:** *para todo particionamento do fluxo, a sequência de
envelopes entregues é a mesma.* O teste gera partições de 1 byte, primas e aleatórias sobre o
mesmo corpus e compara.

## `Limits` — todo teto num lugar

```cpp
static constexpr uint32_t kMaxPayload = 64 << 20;
static constexpr uint32_t kMaxString  =  1 << 20;
static constexpr uint32_t kMaxSnapshot= 16 << 20;
static constexpr uint32_t kMaxChunk   = 256 << 10;
```

Nenhum teto numérico do protocolo existe fora deste arquivo. Estourar é violação de
protocolo — com uma exceção nomeada: snapshot grande demais responde `Fault`, porque ali o
tamanho depende da página, não do par implantado.
