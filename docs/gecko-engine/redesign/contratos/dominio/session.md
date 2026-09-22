# `domain/session` — a sessão e sua morte

**Escopo:** sessão · **Thread:** main

Processo e sessão são **o mesmo tempo de vida**: browser vivo sem supervisor é estado
proibido, logo o processo morre com a sessão, sempre. São dois nomes, um escopo.

---

## `Session` — a única porta de morte

```cpp
enum class Phase : uint8_t { Booting, Linked, Ready, Terminating, Dead };

class Session {
 public:
  Phase phase() const;
  void  onLinkEstablished();
  void  onHostReady();
  void  onFault(const Fault&);        // aplica actionOf(code)
  bool  mayEmit() const;              // falso fora de Ready
};
```

```
Booting ──link──> Linked ──host pronto──> Ready ──> Terminating ──> Dead
    └────────────── onFault(KillSession) ───────────────┘
```

**Não é responsável por:** detectar falha — detecção é de quem tem o contrato. Nem decidir
caso a caso: aplica a tabela `actionOf` de [`fault.md`](fault.md).

- `mayEmit()` resolve por construção a corrida de emitir antes do `Ready`.
- `Dead` é absorvente. Nenhum outro componente termina o processo.
- Transição fora do grafo é assert, em um lugar.

## `LinkWriter` — um envelope em voo

```cpp
class LinkWriter {
 public:
  bool   offer(const Envelope&, std::span<const uint8_t> payload);  // falso = ocupado
  void   onWritable();
  bool   isIdle() const;
};
```

**Não é fila.** É um cursor sobre **um** envelope pendente.

Não existe política de saturação porque não existe acúmulo: a sujeira coalesce no
`DirtyLedger` em vez de enfileirar no fio, e o ledger é limitado pelo tamanho do documento,
não pelo tempo. Se o anterior não drenou, o próximo host simplesmente sai maior depois.
Vazão é assunto do supervisor; contrapressão é do socket.

Isso apagou quatro coisas do desenho: a fila, o teto, a decisão de política, e a thread de
saída — que some porque `ILink::onWritable` vem do laço de eventos que o motor já tem.

**Invariantes:** bytes de um envelope são contíguos no fio; `offer` recusa se ocupado e nunca
bloqueia; nada sai antes de `Ready` nem depois de `Dead`.

## `Router` — leva o comando ao dono

```cpp
class Router { void onEnvelope(const Envelope&, std::span<const uint8_t>); };
```

Roteia e nada mais: um `switch` cujos braços têm **uma linha**. Braço com `if` dentro é sinal
de que a lógica vazou para o roteador. Direção é conferida antes; opcode desconhecido é log e
ignora, para as pontas avançarem sem lockstep.

**Teste:** tabela dirigida que prova que o conjunto de opcodes roteados é **exatamente** o do
schema — sem buraco e sem sobra.

## `Correlations` — o que está pendente

```cpp
class Correlations {
  void                  remember(CorrelationId, PendingKind, HostId, Generation);
  std::optional<Pending> take(CorrelationId);        // consome
  void                  forgetHost(HostId, Generation);
  size_t                pending() const;
};
```

Identidade de documento é o par `(HostId, Generation)` — sem mint global ([`11-identidade.md`](../../11-identidade.md)).

- `take` consome: uma resposta atende um pedido, uma vez. Segunda é órfã, descartada com log.
- `forgetHost` impede o vazamento quando aquele documento morre com pedidos pendentes.
- `pending() == 0` ao fim de uma sessão limpa é asserção de teste, não esperança — foi ela que
  revelou a correlação vazando no cenário de dois `Navigate` em rajada.

## `Heartbeat`

Cadência fixa via `IClock`, sem jitter adaptativo — batida que se ajusta sozinha vira
diagnóstico impossível. `now()` monotônico, nunca relógio de parede. Nenhuma batida fora de
`Ready`.
