# speculum-wire — núcleo do produtor, C++ puro

Camada de baixo do produtor de projeção: hash da tabela replicada, modelo de op e
codificador binário do frame. **Zero tipo do Gecko** — compila e roda em qualquer lugar.

Essa separação é deliberada. O risco de escrever C++ dentro do Gecko é o ciclo de build
longo: cada erro custa muito. Aqui a maior parte da lógica é verificada **antes** de
encostar na árvore do motor.

| camada | onde | testável fora do Gecko |
|---|---|---|
| **`speculum-wire`** (esta) — hash, ops, codificação | `gecko-engine/speculum-wire/` | **sim** |
| cola do motor — callbacks do `nsIMutationObserver` → chamadas daqui | `dom/base/Speculum*` no fork | não |

## O que está provado

`./run-tests.sh` faz o caminho inteiro e compara contra o **código real do cliente**:

1. o C++ monta um frame com 20 ops (elemento, texto com emoji, comentário, doctype,
   shadow root, SVG, namespace custom, host de contexto aninhado, attr set/del, text set,
   prop str/bool, remove, node drop, check);
2. `core/decode.ts` — o decodificador que o cliente usa em produção — lê esses bytes;
3. os hashes são recomputados por `core/rowHash.ts` e comparados com os do C++;
4. o `CHECK` que viajou no fio é conferido contra o `tableHash` dos dois lados.

Última execução: **12/12 fixtures de hash idênticos, 20/20 ops decodificadas, CHECK igual
ao `tableHash` em C++ e em TypeScript.**

Se qualquer um desses passos falhar, produtor e cliente discordam — e é exatamente esse
desacordo que o `preTableHash`/`CHECK` existe para detectar em produção. Aqui ele é
detectado no commit.

## Rodar

```
cd gecko-engine/speculum-wire
./run-tests.sh
```

Precisa de `g++` (C++17), `python3` e `npx` (usa `tsx` para carregar o TS do cliente).
Os artefatos vão para `/tmp/speculum-wire` — mude com `SPECULUM_OUT=... ./run-tests.sh`.

## Fonte da verdade

O ABI está selado e é definido por:

- `docs/page-projection/spec/frame-protocol.md` §1–§4
- `packages/page-projection/src/core/opcodes.ts` — lista de opcodes
- `packages/page-projection/src/core/rowHash.ts` — H64 e `rowHash`/`tableHash`
- `packages/page-projection/src/virtual/frame/binaryFrameEncoder.ts` — layout do fio

Este diretório é **port**, não reinterpretação. Valores no fio nunca são renumerados;
divergência de hash não é detalhe de implementação, é quebra de contrato.

## O que ainda não tem

Tabela de linhas própria (o `TableHashTracker` existe, o índice de linhas não), montagem
por partes quando o frame passa do teto, CSSOM (`SHEET_*` / `RULE_*` estão na ISA mas não
no builder), e o tick de frame. Nada disso é bloqueado por design — é ordem de trabalho.
