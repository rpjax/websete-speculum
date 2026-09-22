# IProjectionOracle

**Tipo:** contrato/dirigida · **Escopo:** sessão · **Camada:** ports

## Responsabilidade
Veredito sob freeze: **ida** (`d(VN)` fresco × `d(VTR)` armazenado) + **volta**
(reconstrução × varredura ingênua, três baldes) + `ExclusionLedger`.

## Contrato
```cpp
struct IProjectionOracle {
  virtual Verdict run(FreezeToken) = 0;
};
```

## Veredito (falha)
Não é booleano. Traz: direção (ida|volta), host, **generation + sequence**, linha,
campo, expected/actual, causa (`CauseSpan`), trecho de roteiro, ledger.

## Ida
Leitura fresca × estado armazenado — ver [13 §2](../../13-oraculo-global.md). Não são
“dois algoritmos concordam”.

## Volta — três baldes
1. igual nos dois → ok
2. no DOM, ausente na tabela, política projeta → **defeito**
3. no DOM, ausente na tabela, política não projeta → ok **e listado** no ledger

## Colabora com
[IStateFreezer](IStateFreezer.md) · [IStateCapture](IStateCapture.md) ·
[IReconstructor](IReconstructor.md)
