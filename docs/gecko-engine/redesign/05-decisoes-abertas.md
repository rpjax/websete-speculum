# 05 — Decisões

**Status:** as bloqueantes estão fechadas. O que resta é afinação, não desenho.

---

## Fechadas

| # | decisão | resultado |
|---|---|---|
| 1 | forma do erro | **um `Fault` genérico** para qualquer erro: código catalogado, flags, origem, mensagem literal, e até oito pares chave/valor tipados. Sem campo de domínio privilegiado, sem `severity` |
| 2 | handle opaco | template `Ref<Space>`. Não era decisão de arquitetura |
| 3 | neutralidade de motor | **objetivo declarado**, entregue pela regra "nenhum tipo de motor na assinatura" |
| 4 | granularidade | **9 portas, 7 módulos**, pelas regras de `03-portas.md` §2 |
| 5 | portas descobertas × desenhadas | cortada: meta-processo, não arquitetura |
| 6 | `sim` arnês ou engine | **ambos** — engine de primeira classe, usado em teste e em lab |
| 7 | sequenciamento contra o w7s | **do zero**, sem preservar nada do legado |
| 8 | saturação da saída | **inexistente.** Vazão é do supervisor. Um envelope em voo; a sujeira coalesce no ledger |
| 9 | `RetryOnce` no C++ | **não.** Situacional, vai para o supervisor, igual ao resync |
| — | compatibilidade de fio | **nenhuma.** O cliente muda junto |
| — | processo no vocabulário do fio | **não.** Detalhe do motor; o supervisor fala viewport e documento |
| — | documento especial | **não existe.** Raiz é posição, não tipo |

## Afinação — números, não desenho

Parâmetros de lançamento com justificativa escrita (Fase 11 — medição local para achar
gargalo, não certificação de performance). Ver [fase11-afinacao.md](fase11-afinacao.md) e
`tests/phase11/reports/`.

| knob | valor | onde |
|------|-------|------|
| cadência `PatchClock` | `16` ms | `domain/producer/LaunchTuning.hpp` |
| teto streams de ativo | `32` concurrent | `domain/assets/Streams.hpp` |
| scratch de montagem | `256 KiB` | `domain/producer/LaunchTuning.hpp` |

Todos são **parâmetro de lançamento**, nunca variável de ambiente que muda comportamento.

Interning `STR_DEF` (across frames): **`ship_str_def`** — fixture
`tests/phase11/fixtures/markup-vocab.json`, `R_vocab` ≥ limiar declarado. Fio ainda não
ligado. Sinal+baseline em `tests/phase11/baseline.json` (nunca reprovação).

## O que ainda pode virar decisão

Nada em aberto hoje. Se aparecer, entra aqui com o trade-off escrito — nunca decidida por
omissão.
