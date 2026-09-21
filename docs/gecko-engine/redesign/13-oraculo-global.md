# 13 — O oráculo global: congelar, capturar, ida e volta

**Status:** EM DESENHO. Completa `12-instrumentacao.md` §3.
**Refinado por [`14-nodedescriptor.md`](14-nodedescriptor.md):** com forma normal, a *ida*
deixa de ser "dois algoritmos concordam" e vira "leitura fresca × estado armazenado" — mais
direto. A *volta* e o livro-razão de exclusões continuam iguais.

Concordo, e o que estava faltando é mais forte do que eu tinha escrito. Deixa eu ser preciso
sobre **o que cada metade prova**, porque é isso que sustenta a frase "o produtor está
impecável".

---

## 1. O que o O1 anterior não provava

Eu tinha escrito: *"caminha o DOM e compara com a tabela, campo a campo"*.

O problema é que essa comparação é **uma segunda implementação de "o que a tabela deveria
conter dado este DOM"**. Se ela tiver um ponto cego — não conferir um atributo, normalizar
algo — o oráculo passa em silêncio. Um oráculo com ponto cego é pior que nenhum, porque
produz confiança injustificada.

A correção é tirar a semântica da comparação: **comparar coisas do mesmo tipo**, onde a
igualdade é exata e barata.

## 2. As duas travessias

```
        estado real do Gecko            X
               │  ida                   │  volta
               ▼                        ▲
        tabela do produtor              Y
```

### Ida — `fresco ≟ armazenado`
Com tudo congelado, compara, para cada nó, `d(VN)` — **lido fresco do vivo** — com `d(VTR)` —
o **estado armazenado**. Comparação entre dois descritores do mesmo tipo: `hash()` contra
`hash()`, exata, sem função semântica no meio.

**Mudou em relação ao desenho anterior.** Antes era "reconstruir a tabela pelo caminho de
construção e comparar com o incremental". Com `emit` unificado
([`14-nodedescriptor.md`](14-nodedescriptor.md)) haveria um algoritmo só, e comparar duas
execuções dele seria comparar uma função com ela mesma. A independência migrou para onde ela
é mais forte: **duas fontes de verdade** (realidade × armazenado), não duas implementações.

Estado derivado (`nextSiblingOf`, `lastChildOf`) não entra aqui — é conferido por
`checkInvariants()` contra `parent`/`prevSibling`, que é mais direto e pega no tick.

### Volta — `Y → X' ≟ X`
Pega a tabela `Y` e **reconstrói** a estrutura que ela descreve, inerte. Compara com uma
varredura do DOM/CSSOM real.

A varredura aqui é deliberadamente **ingênua**: lê tudo que consegue ver, sem política, sem
filtro, sem normalização. Quanto mais burra, menos ponto cego.

## 3. Por que as duas — e não uma delas

Não são redundantes. Cada uma pega o que a outra não vê, e isso é demonstrável com defeitos
reais deste repositório.

| | pega | não pega |
|---|---|---|
| **Ida** | tabela que divergiu da realidade em qualquer campo — comparação fresco × armazenado, por descritor | ponto cego compartilhado: se a leitura do vivo e a gravação ignoram o mesmo campo, os dois descritores concordam e passa |
| **Volta** | defeito de **cobertura da realidade**: algo que existe no DOM, deveria ser projetado, e não está na tabela | estado derivado, que o DOM não tem como contradizer |

**Evidência, do log de decisão do próprio protocolo:** `OPEN-7` e `OPEN-8` foram elos
derivados (`nextSiblingOf`) errados **com o hash do fio verde**. Nenhuma das duas travessias
os pegaria — elo derivado não tem correspondente no DOM nem entra no descritor. É por isso que
eles são caso de `checkInvariants()`, que roda no tick, e não de oráculo.

E o inverso: um ponto cego compartilhado — os dois caminhos ignorando um atributo — deixa a
ida verde e aparece na volta como "existe no DOM, política diz que projeta, não está na
tabela".

**As duas juntas dizem: `Y` é uma codificação fiel e completa de `X`.** Nem fiel só, nem
completa só.

## 4. Congelamento global coordenado

Documentos vivem em processos diferentes. Congelar um de cada vez dá um retrato de cada um
**em instantes diferentes** — e uma relação entre documentos que mudou no meio aparece como
divergência que não existe. Falso positivo em oráculo é fatal: mata a confiança nele, e um
oráculo em que ninguém confia não serve para a frase do §7.

Então é barreira em duas fases, sobre **todos** os hosts:

```
1. Freeze     pedido a todos os hosts
2. Frozen     cada um confirma que parou num ponto conhecido
3. Capture    só depois que TODOS confirmaram
4. Thaw
```

Durante o congelamento a mutação **não é perdida** — ela acumula, como já é a regra do halt
(o relógio para, o acúmulo não). Descongelar é limpo.

### 4.1 Congelamento incompleto invalida a captura
Se um host não confirma dentro do prazo, a captura é **recusada** com `HaltIncomplete`. Não
existe "capturou quase todo mundo". Oráculo que produz veredito sobre retrato inconsistente
é a pior coisa da lista.

## 5. Os contratos

Quatro, cada um com uma responsabilidade e um tempo de vida.

```cpp
// Barreira. Só coordena — não captura, não compara.
struct IStateFreezer {
  virtual Result<FreezeToken> freezeAll(Millis timeout) = 0;   // falha = HaltIncomplete
  virtual void                thawAll(FreezeToken) = 0;
  virtual uint32_t            frozenCount() const = 0;
};

// Captura por host, sob um token válido. Não interpreta.
struct IStateCapture {
  virtual Result<TableImage>  captureTable(FreezeToken, HostId) = 0;
  virtual Result<NaiveImage>  captureNaive(FreezeToken, HostId) = 0;  // varredura burra
  virtual Result<DescriptorImage> captureLive(FreezeToken, HostId) = 0; // d(VN) de todos — a IDA
};

// A VOLTA. Puro: tabela → estrutura inerte. Zero dependência de motor.
struct IReconstructor {
  virtual NaiveImage reconstruct(const TableImage&) const = 0;
};

// O veredito.
struct IProjectionOracle {
  virtual Verdict run(FreezeToken) = 0;
};
```

**`IReconstructor` ser puro é o ponto de apoio de tudo.** Ele é a função inversa, não tem
Gecko dentro, é testável sozinho, e é **a mesma lógica de materialização que o cliente
implementa**. Se ela estiver certa aqui, está certa lá.

## 6. O veredito não é um booleano

```cpp
struct Verdict {
  bool ok;
  Direction failedIn;          // Ida | Volta
  HostId host; Generation gen;
  uint32_t row; FieldId field; // linha e campo exatos
  Value expected, actual;
  SpanId cause;                // a mutação que precedeu
  RoteiroRef excerpt;          // trecho pronto para reexecutar
  ExclusionLedger excluded;    // ver abaixo
};
```

### 6.1 O livro-razão de exclusões
A volta produz três baldes, não dois:

| balde | significado |
|---|---|
| igual nos dois | ok |
| no DOM, ausente na tabela, **política diz que projeta** | **defeito** |
| no DOM, ausente na tabela, **política diz que não projeta** | ok — **e é listado** |

O terceiro balde é o subproduto mais valioso: é a lista completa e revisável de **tudo que o
produtor escolheu descartar**. Hoje nada audita a política de projeção; com isso, ela passa a
ser lida por gente.

## 7. A afirmação completa

> Com tudo congelado num corte coerente:
> a **ida** prova que o caminho incremental chegou onde o caminho de construção chega;
> a **volta** prova que a tabela descreve a realidade sem faltar nada que deveria estar lá;
> e o **livro-razão** mostra o que foi deixado de fora, item por item.
>
> Sustentado sobre a suíte de fixtures, isso estabelece o produtor.
> **Divergência depois disso é do cliente.**

## 8. Custo, e onde roda

O mais caro do sistema: congelamento global, varredura completa, reconstrução completa, diff
completo — e nada disso por tick. **Sob demanda, em lab e na suíte de fixtures.** Capacidades de
`12-instrumentacao.md` §4, habilitado por parâmetro de lançamento.

`oracle.shadow` + `oracle.postcondition` continuam sendo o que fica ligado o tempo todo em dev: barato
e pega regressão na hora. As capacidades caras são o que se roda para **estabelecer** o produtor — e depois
a cada mudança no produtor.

## 9. Descartados

**9.1 Comparar tabela com DOM por função semântica.** §1 — ponto cego silencioso.
**9.2 Congelar host por host.** §4 — retratos em instantes diferentes, falso positivo.
**9.3 Capturar com congelamento parcial.** §4.1.
**9.4 Reconstruir num DOM real.** O DOM real normaliza, e normalização vira diff falso. A
volta produz estrutura inerte.
**9.5 Só a ida, ou só a volta.** §3 — cada uma tem um ponto cego que a outra cobre.
