# 19 — Arquitetura de testes

**Status:** ESTABELECIDO. Regras e camadas. O que não passa por aqui não é
considerado funcionando.

---

## 1. As três regras

**Nenhum teste depende de `mach build`.** Build de Gecko leva de 30 a 80 minutos
e por isso não pode estar no caminho de nenhuma verificação rotineira. O que
precisa ser testado rápido tem que **compilar fora do Gecko** — sem header do
Mozilla, sem `moz.build`, sem objdir. Isso não é conveniência de teste: é
pressão de desenho que mantém o núcleo desacoplado.

**O teste imprime o veredito, não pistas.** Passou, imprime o que foi exercitado
e sai 0. Falhou, imprime **o que esperava, o que recebeu, e os bytes crus** —
com contexto suficiente para consertar sem abrir depurador nem reproduzir. Se
depois de ler a saída ainda for preciso investigar, o teste está incompleto.

**Toda garantia vira teste no mesmo passo em que é conquistada.** Um bootstrap
funcionando que não virou fixture já se perdeu em silêncio uma vez neste projeto.

---

## 2. A escada

A ideia é uma só: **nenhuma parte do programa pode nos trair.** Cada degrau
prova em termos absolutos que tudo até ali funciona. Se um degrau passa, o que
ele cobre está fora de suspeita — e a investigação de qualquer falha começa
sempre no degrau mais baixo que falhou, nunca no sintoma.

| Nível | Natureza | O que prova | Precisa de Gecko? | Tempo |
|---|---|---|---|---|
| **L0 — núcleo** | unidade | Algoritmo: hash, tabela, ops, frames. Paridade C++ ↔ TypeScript. | não | segundos |
| **L1 — ABI** | unidade | Contrato binário: os dois lados produzem e aceitam os mesmos bytes. | não | segundos |
| **L2 — transporte** | unidade | Enquadramento, leitura curta, desconhecido, queda. | não | segundos |
| **L3 — amarração** | integração | Supervisor + lab + cliente real, com browser **falso**: a costura entre os componentes. | não | segundos |
| **L4 — pilha** | ponta a ponta | A stack real de produção: supervisor + Gecko de verdade. | binário já construído | ~1 min |
| **L5 — regressão viva** | regressão | Capturas congeladas de execuções reais que já passaram. | não | segundos |

L0 e L5 já existem (`speculum-wire/run-tests.sh`). L1 a L4 são o que falta.

O **L3 é o degrau que não existia no desenho anterior** e é o que prova a
amarração: um browser falso que fala a ABI corretamente, um supervisor real, o
lab real e o cliente projetado de produção. Exercita a sessão inteira em
segundos, sem browser. Se o L3 passa e o L4 falha, o defeito está no Gecko e em
nenhum outro lugar — e isso sozinho já corta o espaço de busca ao mínimo.

---

## 3. L1 — ABI

Arquivo de **vetores de ouro**: `gecko-engine/tests/control-abi.golden`. Cada
linha traz nome, payload em hexadecimal e envelope em hexadecimal.

Os dois lados fazem duas provas sobre cada vetor:

1. **Codificar** a mensagem descrita e comparar byte a byte com o vetor.
2. **Decodificar** o vetor e comparar campo a campo com o esperado.

Divergência aqui é defeito de **contrato**, não de implementação — e a mensagem
de falha diz exatamente qual byte diferiu, em que posição, com o esperado e o
recebido lado a lado.

O executável C++ desse teste compila direto de `SpeculumControlAbi.cpp`, sem
Gecko. É isso que torna o L1 um teste de segundos e não de uma hora.

Cobertura obrigatória: todo opcode do doc 18 §3; string com UTF-8 multibyte (o
tamanho é em **bytes**, não em caracteres); campo de tamanho zero; mensagem
truncada; opcode desconhecido.

---

## 4. L2 — transporte

Exercita o enquadramento contra um par falso, sem browser e sem supervisor
reais. Casos obrigatórios, todos já observados como defeito real neste projeto:

- **leitura curta** — o par escreve 1 byte por vez; o leitor tem que reconstruir
  a mensagem inteira. Este caso sozinho teria pego o `mensagem truncada` que nos
  custou uma noite.
- **envelopes colados** — dois envelopes num único `write`.
- **payload no limite** — 0 bytes, e o teto de 64 MiB.
- **opcode desconhecido** — registra e segue; a ponte não cai.
- **queda no meio da mensagem** — encerra limpo, sem ler fora de limite.

---

## 5. L3 — amarração

Browser **falso**, tudo o mais real. O falso implementa a ABI do doc 18 com
fidelidade: responde `Ready`, cria contexto, navega, e emite um fluxo de frames
cujos bytes o teste confere intactos ponta a ponta. Ele é o único componente
simulado da pilha, e é lançado *pelo supervisor de produção* — mesmos argumentos,
mesmo socket, sem uma linha alterada no supervisor.

Duas testemunhas independentes são cruzadas: o **diário** do browser falso (o que
o motor viu e respondeu) e os **frames no WebSocket** (o que o supervisor de fato
entregou). Se as duas concordam, a costura está provada.

Prova, sem Gecko e em segundos:

- o supervisor sobe o par e segue para a sessão pela ponte, não por um consumidor
- o `contextId` é atribuído pelo supervisor e chega carimbado no frame
- o comando do consumidor vira comando de browser, com `contextId 0` resolvido
  para a raiz (lido de volta no diário do browser)
- o leque entrega os mesmos frames a mais de um consumidor
- browser morto → o supervisor encerra sozinho (doc 15): a ponte é o link vital

Um browser falso que responde certo é também a especificação executável da ABI:
divergiu dele, divergiu do contrato.

A conferência byte a byte contra o *apply estrito* do **cliente projetado de
produção** roda no L0 e é congelada no L5, sobre o mesmo núcleo do produtor. A
variante do L3 servida pelo **lab** (lab protocol v1 de ponta a ponta) é o próximo
incremento deste degrau; pela regra de entrada do §8, ela chega junto com o teste
que a prova.

---

## 6. L4 — pilha real

Sobe supervisor + Gecko **já construído** e exercita a sessão inteira sem
interface humana. O harness é um consumidor como qualquer outro: conecta no
plano de consumo, manda comando, espera evento, aplica frame com o applier de
produção.

Roteiro:

1. supervisor sobe → browser conecta → `Ready` (implícito: sem isso, nenhum frame chega)
2. `ContextCreate` → `ContextCreated` (o supervisor pede sozinho no `Ready`)
3. `Navigate` → `Navigated` (o supervisor navega sozinho no `ContextCreated`)
4. pelo menos um frame REAL chega, de **um** contexto só, com prefixo selado
   válido (`magic 0x5050`, `version 2`) e `contextId` — carimbado pelo processo
   pai no offset 4 — igual ao contexto raiz da sessão
5. o `Navigate` do consumidor chega ao browser real e **a página nova é
   projetada**: o L4 sobe um HTTP local com `/a` (alpha) e `/b` (bravo), exige
   um frame **diferente** do bootstrap, e lê a tabela local de strings do
   frame — o mesmo layout de `packages/page-projection/src/core/decode.ts` —
   para achar `alpha` no primeiro e `bravo` no segundo. Bytes iguais ou texto
   da página velha = falha, mesmo que o `Navigated` tenha saído.

Roteiro multiplex (segunda sessão, `/host`):

6. página com iframe same-origin: frame `C=1` traz `NODE_NEW` do host com
   `childScopeId=2`; chega frame `C=2` com o texto do filho
7. o iframe navega: mesmo `2`, `generation` sobe; não nasce `3`
8. aba navega para outro host: `C` novo (`3`)
9. um `ContextCreated` só (`1`) — iframe não emite evento de controle

A procedência do frame é lida direto do fio (`SealedFrame`): o `contextId` vem
do prefixo, carimbado pelo pai. É esse carimbo que está sob suspeita — se o pai
registrar a janela **chrome** em vez do contexto do **conteúdo**, ou nenhum frame
chega, ou chega com `contextId` errado, e a saída do L4 diz qual dos dois. Por
isso o L4 é também o instrumento que resolve essa hipótese, não só um teste.

A paridade byte a byte com o *apply estrito* de produção é provada no L0 e
congelada no L5, sobre o MESMO núcleo do produtor; o L4 prova liveness, ciclo de
vida, procedência do frame **e** que o segundo documento (não um eco do
primeiro) é o que sobe no fio. Não re-executa o applier em C#. O passo de
`ContextDestroy` disparado pelo consumidor entra quando existir esse opcode no
plano de consumo (hoje o consumo só expõe `Navigate`); pela regra de entrada do
§8, ele chega junto com o degrau que o prova.

Saída em caso de falha, obrigatória e completa:

```
FALHOU no passo 3 (Navigate -> Navigated)
  esperado: Navigated contextId=1 em até 10s
  recebido: nada (10.0s)
  ultimo evento: ContextCreated contextId=1 bc=42 (t=1.2s)
  enviados:  ContextCreate(id=1) t=0.8s · Navigate(id=2,url=...) t=1.3s
  recebidos: Ready(id=0) t=0.7s · ContextCreated(id=1) t=1.2s
  bytes do ultimo envelope lido: 04 01 00 00 00 12 00 ...
  supervisor (ultimas 10 linhas): ...
  browser (ultimas 10 linhas): ...
```

O critério é esse: quem lê a saída **conserta**, não investiga.

---

## 7. Onde vive

```
gecko-engine/
  speculum-wire/           L0 e L5 (já existe)
  tests/
    control-abi.golden     vetores de ouro do L1
    run.sh                 roda L0, L1, L2, L3, L5. L4 só com --stack.
    abi/                   L1 (lado C++)
      l1_abi_verify.cpp    verificador autônomo dos vetores
      shim/                nsACString e mozilla::LittleEndian mínimos, só p/ compilar
        nsStringFwd.h        o codec de produção FORA do Gecko
        mozilla/EndianUtils.h
    Speculum.Tests/        L1 (lado C#), L2, L3, L4 — um binário só
      Speculum.Tests.csproj
      Program.cs           runner: escolhe o degrau pelo argumento
      Report.cs            instrumentação: byte, posição, esperado, recebido
      AbiTests.cs          L1 — vetores de ouro, C#
      TransportTests.cs    L2 — enquadramento
      WiringTests.cs       L3 — amarração
      StackTests.cs        L4 — pilha real
      FakeBrowser.cs       o browser falso do L3
      FakeFrame.cs         frame sintético do L3
      SealedFrame.cs       leitor do prefixo do frame REAL (L4)
```

**Um binário de teste, não quatro projetos.** O browser falso do L3 é lançado
*pelo supervisor de produção*, que dita os argumentos (`--headless -profile …
about:blank`) e o executável único de `SPECULUM_BROWSER_BIN`. Para o supervisor
subir sem uma linha alterada, o browser falso precisa SER um executável — e o
mais barato é ser um modo do próprio binário de teste, escolhido por
`SPECULUM_TESTS_ROLE=fake-browser` no ambiente. Essa variável é do arnês; nenhum
caminho de produção a lê. Consolidar L1–L4 num binário só é consequência disso,
e ainda dá um build único de segundos em vez de quatro.

Tudo roda pelo **muxer** (`dotnet X.dll`), nunca pelo apphost: o muxer resolve o
runtime a partir do próprio lugar, então o .NET pode estar num diretório privado
(ex.: `/root/.dotnet`) sem instalação de sistema. Como o supervisor lança o
browser como um executável único, o browser falso entra por um wrapper de uma
linha que só relança o muxer + a dll de teste; os argumentos de firefox são
ignorados e o papel vem do ambiente.

O lado C++ do L1 fica à parte porque é outra linguagem: compila o
`SpeculumControlAbi.cpp` REAL contra shims mínimos de `nsACString` e
`mozilla::LittleEndian`. Os shims não podem mentir — qualquer erro deles vira
divergência de byte contra o mesmo golden que o C# usa.

`run.sh` sem argumento é o que se roda antes de todo commit: segundos, sem
Gecko. `run.sh --stack` acrescenta o L4 e exige o Gecko já construído
(`SPECULUM_STACK_BROWSER_BIN` apontando para o firefox do objdir).

---

## 8. Mapa de cobertura

Escada de garantias absolutas exige que **nenhuma célula fique vazia**. Parte do
programa sem degrau é parte que pode trair.

| Componente | Degrau que prova |
|---|---|
| Hash, tabela replicada, ops, montagem de frame | L0 |
| Paridade do núcleo C++ ↔ cliente TypeScript | L0 |
| `NodeSource` sobre `nsINode` (tradução Gecko → núcleo) | L4 |
| Relógio do frame: timer sob demanda, frame vazio não emitido | L0 (produtor) + L4 (real) |
| Codec da ABI de controle, dos dois lados | L1 |
| Enquadramento do envelope, leitura curta, limites | L2 |
| Supervisor: tabela de contextos, atribuição de id | L3 |
| Supervisor: comando de consumidor → comando de browser | L3 |
| Lab: conformidade com lab protocol v1 | L3 — próximo incremento (§5) |
| Cliente projetado aplicando frames sem desync | L0 + L5 |
| Leque de consumidores (fan-out) | L3 |
| Descarte do mais antigo sob pressão | próximo incremento |
| Ciclo de vida: caiu = morre | L3 |
| Falha de ponte ao estabelecer é fatal | próximo incremento |
| Registro de contexto difundido aos processos de conteúdo | L4 |
| Abertura de janela e navegação no Gecko | L4 |
| Admissão: só documento de contexto pedido é projetado | L4 |
| Comportamento em páginas reais | L4 |
| Bootstrap e incremental já conquistados | L5 |

**Regra de entrada:** componente novo não entra no repositório sem o degrau que
o prova. Se não existe degrau possível sem Gecko, o componente está acoplado
demais — e isso é defeito de desenho, não limitação de teste.

---

## 9. O que isto teria pego

Registrado para que a cobertura não regrida ao que é cômodo de testar:

| Defeito real | Degrau que pega |
|---|---|
| `tableHash` incremental divergindo | L0 |
| bytes divergentes entre C# e C++ | **L1** |
| `ContextCreate` chegando truncado | **L2** |
| frame corrompido por escrita não atômica | L2 |
| supervisor esperando consumidor em vez da ponte | **L3** |
| `contextId` colidindo entre processos | L3 |
| ponte conectando só na primeira emissão de frame | **L3** |
| produtor não anexando por registro vazio | **L4** |
| bootstrap funcionando perdido em silêncio | L5 |
