# IClock

**Tipo:** contrato/dirigida · **Escopo:** sessão · **Thread:** main · **Camada:** ports

## Responsabilidade
Tempo monotônico e agendamento de disparo único. Única fonte de "agora" e de "daqui a N ms".

## Não é responsável por
- decidir **quando** agendar
- repetição: não há timer periódico, reagendar é explícito
- ordenar disparos além da ordem de vencimento

## Contrato
```cpp
using Millis  = uint64_t;
using TimerId = uint32_t;                    // 0 = inválido

struct ITimerTarget { virtual void onTimerFired(TimerId) = 0; };

struct IClock {
  virtual Millis  now() const = 0;
  virtual TimerId scheduleOnce(Millis delay, ITimerTarget*) = 0;
  virtual void    cancel(TimerId) = 0;
  virtual ~IClock() = default;
};
```

## Semântica
- `now()` nunca regride e não tem relação com relógio de parede.
- `cancel` de id já disparado é **no-op**, não erro — idempotência aqui evita a corrida
  clássica de cancelar durante o disparo.
- O alvo nunca é chamado depois de `cancel` retornar.
- Disparo acontece na `main`, fora de qualquer notificação de mutação.

## Falhas
`ScheduleRefused` — o motor não conseguiu criar o timer. Fatal.

## Invariantes
1. `now()` é não-decrescente.
2. `TimerId` não é reusado enquanto houver disparo pendente com aquele id.

## Testabilidade
Fake `ManualClock`: o teste avança o tempo e dispara explicitamente. Torna determinística a
propriedade `halt + N mutações + resume → exatamente um host, digest avançou uma vez`, que
hoje é verificada por script de texto, binário externo e `python` comparando hash.
Cenário de atraso: disparar 300 ms depois do vencimento prova que nada assume pontualidade.

## Colabora com
[projection](../dominio/projection.md) · [session](../dominio/session.md)
