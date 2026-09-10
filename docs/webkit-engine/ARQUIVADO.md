# Lado A — WebKit / WPE — ARQUIVADO

Este diretorio (`docs/webkit-engine/`) e a branch `feat/webkit-engine` sao o
**registro do lado A** da avaliacao de motor.

**Nao e' lixo, e nao foi descartado.** Foi o trabalho do lado A que produziu a
comparacao que fechou a decisao — inclusive as medicoes de build e iteracao que
serviram de referencia.

Decisao final: **Gecko no Linux**. Ver `docs/gecko-engine/00-decisao.md`.

## O que aqui esta CONGELADO como registro historico

| arquivo | conteudo |
|---|---|
| `01-fork.md` | pin `wpewebkit-2.52.6`, politica de serie par |
| `02-build.md` | mozconfig equivalente, flags, numeros medidos (8098 s, 93 s / 1,18 s) |
| `03-riscos.md` | riscos por camada, com a secao de recalibragem |
| `05-baseline.md` | baseline PARCIAL / BLOQUEADA, bucket ambiente 61% |

Nao editar mais. Se algo aqui estiver errado, corrige-se no lado Gecko.

## O que aqui NAO e' do WebKit e continua VIGENTE

Estes quatro sao **agnosticos de motor** e valem integral para o Gecko. Moram aqui
por acidente historico — foram escritos antes da avaliacao.

| arquivo | conteudo |
|---|---|
| `00-foundation.md` | **ABI de frame selada** (§3), camadas C1/C2/C3. As partes sobre WPE e flags de cmake sao historicas; a ABI nao |
| `06-runtime.md` | supervisor por instancia, contrato, ponte de controle, **principio da marionete** (§7.7) |
| `08-costura.md` | forma da costura, acumulador de conjunto sujo, **integridade e desync** (`sequence` / `hash` / `generation`), filtro de escopo do fork |
| `07-decisoes-pendentes.md` | indice de decisoes, agnostico |

**Regra: nao duplicar esses quatro no lado Gecko.** Referenciar. Duplicacao vira
divergencia.
