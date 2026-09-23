# 01 — O alvo e os critérios de aceite

**Status:** EM DESENHO.

---

## 1. O alvo

Componente atrás de interface é meio, não fim. O fim é:

> **Uma sessão Speculum inteira roda sem Gecko nenhum, dirigida por script, e produz os
> mesmos bytes de fio.**

Não "cada classe tem teste". Sessão inteira: controle, contexto, navegação, mutação,
CSSOM, entrada, ativos, época. Suíte de unidade verde com sistema quebrado é o modo de
falha padrão de arquitetura componentizada; o alvo acima é o que fecha essa porta.

A semente disso já existe e já funciona: `speculum-wire/test/producer_cli.cpp` recebe um
script de texto (`boot / snapshot / halt / mk div parked / append body parked / flush`) e
produz frames, sem libxul. O redesign generaliza aquilo para a sessão inteira.

## 2. O oráculo que nasce junto

Quando o Gecko é **uma** implementação das portas e o `sim` é **outra**, aparece uma
asserção que hoje não existe:

> **Mesmo script → mesmos bytes, nos dois engines.**

Divergência entre `sim` e `gecko` deixa de ser investigação e vira bug com endereço: está
na porta X, porque é a única que os dois implementam diferente. É o mesmo tipo de oráculo
que `compare.py` e `live_frames.ts` já aplicam entre C++ e TypeScript, um nível abaixo.

## 3. Critérios de aceite

Três, todos mecânicos. Nenhum depende de alguém lembrar de alguma coisa.

### 3.1 Camada — grep no CI

```
grep -rlE 'ns[A-Z]|mozilla/|nsI[A-Z]' domain/ ports/ && exit 1
```

Camada violada = build vermelho. Sem convenção implícita, sem revisão humana no caminho
crítico.

Complementos em `gecko-engine/scripts/ci/assert-observer-no-script.sh`:

- cola `engines/gecko/xul/*` sem símbolos de entrada de script (gate **textual**, não grafo);
- `domain/session/` e `domain/producer/` sem Traits / includes de motores concretos;
- `engines/gecko/**` sem `#include` de `domain/producer/Policy.hpp` (incapacidade de política).

### 3.2 Paridade com o corpus de evidência

`gecko-engine/speculum-wire/evidence/live-frames/` e `live-incremental/` são captura de
sessão real (27 frames + ndjson). No redesign eles deixam de ser histórico e viram
**regressão**:

> A implementação nova replica o corpus byte-idêntico.

Sem isso, reescrita de C++ dentro de fork é fé. Com isso é verificável no primeiro dia e
não depende de ninguém lembrar o que a versão anterior fazia.

### 3.3 Oráculo sim × gecko

Todo cenário de script roda nos dois engines e compara byte a byte. Cenário que só roda em
um dos dois é declarado como tal, com motivo — não passa calado.

## 4. O que NÃO é alvo

**Cobertura.** Percentual de linha coberta não é critério aqui. O critério é: *a sessão
inteira é instanciável com portas falsas*. Um sistema com 95% de cobertura de unidade e
nenhuma montagem completa fakeável não atende; o inverso atende.

**Paridade de estrutura com o código atual.** O redesign não precisa ter os mesmos
arquivos, os mesmos nomes nem a mesma decomposição. Precisa produzir os mesmos bytes.

## 5. Custo conhecido

O sistema não funciona enquanto a reescrita não fecha. É o preço declarado do greenfield e
não tem mitigação boa além de §3.2 — o corpus de evidência é o que transforma "não
funciona ainda" em "faltam N cenários", que é uma frase com número.
