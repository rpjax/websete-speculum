# IReconstructor

**Tipo:** contrato/pura · **Escopo:** oráculo · **Camada:** ports

## Responsabilidade
A **volta**: `TableImage` → estrutura inerte (`NaiveImage`). Função inversa, testável
sozinha. **Zero** dependência de motor / `IDocumentView`.

## Contrato
```cpp
struct IReconstructor {
  virtual NaiveImage reconstruct(const TableImage&) const = 0;
};
```

## Semântica
- Não reconstrói num DOM real (normalização viraria diff falso).
- É a mesma lógica de materialização que o cliente implementa.

## Colabora com
[IProjectionOracle](IProjectionOracle.md)
