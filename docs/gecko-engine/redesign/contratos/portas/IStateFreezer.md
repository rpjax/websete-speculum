# IStateFreezer

**Tipo:** contrato/dirigida · **Escopo:** sessão · **Camada:** ports

## Responsabilidade
Barreira global de congelamento: pedir halt a **todos** os hosts vivos e só emitir
`FreezeToken` quando todos confirmam. Não captura, não compara.

## Contrato
```cpp
struct IStateFreezer {
  virtual Result<FreezeToken> freezeAll(Millis timeout) = 0;  // HaltIncomplete se parcial
  virtual void                thawAll(FreezeToken) = 0;
  virtual uint32_t            frozenCount() const = 0;
  virtual uint32_t            expectedCount() const = 0;
};
```

## Semântica
- Congelamento **host-a-host como caminho de captura é proibido** (retratos em instantes
  diferentes → falso positivo).
- Mutação durante freeze **acumula** (relógio parado; `PatchClock::halt`).
- Congelamento incompleto ⇒ captura recusada; sem veredito sobre retrato inconsistente.

## Colabora com
[IStateCapture](IStateCapture.md) · [IProjectionOracle](IProjectionOracle.md)

## Identidade
`DocumentId = (HostId, Generation)` — [11-identidade](../../11-identidade.md).
