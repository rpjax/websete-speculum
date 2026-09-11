# speculum-wire — núcleo do produtor, C++ puro

Camada de baixo do produtor de projeção: hash da tabela replicada, modelo de op e
codificador binário do frame. **Zero tipo do Gecko** — compila e roda em qualquer lugar.

Essa separação é deliberada. O risco de escrever C++ dentro do Gecko é o ciclo de build
longo: cada erro custa muito. Aqui a maior parte da lógica é verificada **antes** de
encostar na árvore do motor.

| camada | onde | testável fora do Gecko |
|---|---|---|
| **`speculum-wire`** (esta) — hash, tabela replicada, ops, codificação | `gecko-engine/speculum-wire/` | **sim** |
| cola do motor — callbacks do `nsIMutationObserver` → chamadas daqui | `dom/base/Speculum*` no fork | não |

## O que está provado

`./run-tests.sh` faz o caminho inteiro e compara contra o **código real do cliente**:

1. o C++ monta um frame com 20 ops (elemento, texto com emoji, comentário, doctype,
   shadow root, SVG, namespace custom, host de contexto aninhado, attr set/del, text set,
   prop str/bool, remove, node drop, check);
2. `core/decode.ts` — o decodificador que o cliente usa em produção — lê esses bytes;
3. os hashes são recomputados por `core/rowHash.ts` e comparados com os do C++;
4. o `CHECK` que viajou no fio é conferido contra o `tableHash` dos dois lados;
5. um **roteiro único** (`test/table_script.txt`, lido pelos dois lados — não são dois
   roteiros que por acaso concordam) roda na tabela replicada em C++ e no
   `ReplicatedTable` de produção em TypeScript, comparando `tableHash`, contagem de linhas
   e **ordem de filhos** depois de *cada* comando.

Última execução: **12/12 fixtures de hash idênticos, 20/20 ops decodificadas, CHECK igual
ao `tableHash` nos dois lados, e 49/49 passos da tabela idênticos.**

O roteiro da tabela exercita de propósito o que costuma quebrar: prepend antes do primeiro
filho, mover um nó já ligado para outro pai, remover do meio, reinserir antes do último,
`shadow root` (que tem `parent = host` mas fica **fora** da cadeia de luz), derrubar
subárvore destacada que ainda tem filhos, e o caso **OPEN-8** (evict da cauda logo depois
de um prepend) — que é exatamente onde um `lastChildOf` mal consertado passa despercebido
até a projeção mostrar um filho só.

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
- `packages/page-projection/src/core/replicatedTable.ts` — linhas, índices derivados, topologia

Este diretório é **port**, não reinterpretação. Valores no fio nunca são renumerados;
divergência de hash não é detalhe de implementação, é quebra de contrato.

## O que ainda não tem

Montagem por partes quando o frame passa do teto, CSSOM (`SHEET_*` / `RULE_*` estão na ISA
mas não no builder nem na tabela), validação de precondição no lado do cliente, e o tick de
frame. Nada disso é bloqueado por design — é ordem de trabalho.
