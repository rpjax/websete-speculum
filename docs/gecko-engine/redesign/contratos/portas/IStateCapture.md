# IStateCapture

**Tipo:** contrato/dirigida · **Escopo:** host · **Camada:** ports

## Responsabilidade
Captura sob `FreezeToken` válido. Não interpreta.

## Contrato
```cpp
struct IStateCapture {
  virtual Result<TableImage>       captureTable(FreezeToken, HostId) = 0;  // d(VTR)
  virtual Result<NaiveImage>       captureNaive(FreezeToken, HostId) = 0;  // varredura burra
  virtual Result<DescriptorImage>  captureLive(FreezeToken, HostId) = 0;   // d(VN) — a IDA
};
```

## Semântica
- Token inválido / não frozen ⇒ `StaleFreezeToken`.
- **CaptureKind no fio:** enum permanece `Table` / `Rebuilt` / `Naive`. No domínio,
  `captureLive` é o dump de descritores vivos (`d(VN)`). No fio, `Rebuilt` mapeia a essa
  captura até revisão formal do schema (sem inventar opcode).

## Colabora com
[IStateFreezer](IStateFreezer.md) · [IProjectionOracle](IProjectionOracle.md)
