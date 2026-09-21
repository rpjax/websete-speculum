# 02 — Camadas, dependência, vocabulário

**Status:** EM DESENHO.

---

## 1. Árvore

```
domain/        lógica. zero include de engine. compila com g++ -I. e mais nada.
  fault/         UM tipo de erro, e a tabela código → ação      [compartilhado]
  wire/          schema, cursor, envelope, enquadrador, tetos   [compartilhado]
  session/       ← roda no processo PAI
    link, escritor, roteador, correlações
    documents/   ids, viewports, árvore de hosts, navegação
    interaction/ gesto, tecla, geometria, edição de form, admissão
    assets/      classificação, stream, registro, telemetria
  producer/      ← roda no processo de CONTEÚDO, um por documento
    identidade, ledger, relógio, patch, resync, snapshot, política
ports/         as interfaces. nenhuma inclui header de engine.
engines/
  gecko/         implementa as portas sobre Gecko. único lugar com nsI*.
  sim/           implementa as portas em memória. o que os testes usam.
host/          raiz de composição. explícita, um construtor, sem container.
```

## 1.1 São dois programas

`domain/` não é um programa: são **dois**, com vidas e vocabulários diferentes. O produtor
observa o documento, logo roda no processo de conteúdo; a ponte é única e vital, logo vive no
processo pai. Entre eles, `IPatchUplink` — uma fronteira com nome, não uma chamada implícita.

Cada lado tem menos portas, e a incapacidade fica trivial de conferir: o produtor vê
`IDocumentView`, `IDocumentObserver`, `IClock` e `IPatchUplink`. É a lista inteira.

## 2. A regra de dependência

`domain/` → `ports/`. Nada mais. `engines/*` → `ports/` + o engine. `host/` → tudo.

**Nunca** `domain/` → `engines/`. **Nunca** `ports/` → qualquer coisa.

Verificada por grep (`01-alvo.md` §3.1), não por acordo.

### Por que `wire/` fica em `domain/`

Hoje existem três codecs: `SpeculumControlAbi` (reader/writer), `Wire.h` no speculum-wire,
e `ReadU32/ReadU16/ReadStr` copiados dentro de `SpeculumInput.cpp`. Três implementações do
mesmo ABI é a mesma doença das duas listas que produziu os 45 arquivos órfãos
(`22-w7s.md`). Um codec, em `domain/wire/`, consumido por todo mundo.

## 3. Vocabulário — fixado antes do primeiro arquivo

Colisão conhecida: "adapter" é usado com dois sentidos (a fachada que expõe domínio; e o
lado da infra, no jargão hexagonal). Para não divergir do doc na terceira semana:

| termo | significa | onde mora |
|---|---|---|
| **porta** | a interface | `ports/` |
| **engine** | implementação de porta sobre um motor real ou simulado | `engines/gecko`, `engines/sim` |
| **serviço** | componente de lógica que consome portas e expõe linguagem de domínio | `domain/**` |
| **raiz** | o lugar único que constrói e liga tudo | `host/` |

"Adapter" não é usado no código nem nos docs do redesign. Palavra ambígua, custo zero para
trocar agora.

## 4. Tempo de vida — declarado, não emergente

O imposto que o .NET não cobra e o C++ cobra. Hoje ele é invisível porque tudo morre junto
com um `Impl`. No redesign cada componente declara seu escopo:

| escopo | vive enquanto | exemplos |
|---|---|---|
| sessão | a ponte vive — **e o processo com ela**, porque browser sem supervisor é proibido | link, escritor, registros, minters |
| processo | um processo de conteúdo vive | o handle, e os documentos que ele possui |
| documento | o Document vive | visão, observador, projeção, navegação |
| chamada | uma notificação | nada persiste aqui, por construção |

Quatro, não cinco: `processo` no sentido de "o processo base" e `sessão` eram o mesmo tempo de
vida com dois nomes. O escopo `processo` agora nomeia **processo de conteúdo**, que é uma vida
de verdade, com dono de verdade.

**Invariante 3:** serviço de domínio não é dono de nada do engine. Ele fala `NodeRef`
(handle opaco); quem tem tabela de handle e `RefPtr` é o engine. Consequência direta:
`retainPtr`/`releasePtr` **saem da porta** — hoje são dois métodos de interface que existem
só porque não há GC. Posse deixa de ser assunto do contrato.

## 5. Thread — declarada por porta

Transporte tem thread de escrita. Se isso não estiver na cara da porta, é exatamente a
magia escondida que o resto do projeto recusa.

Cada porta declara afinidade: `main` ou `any`. A **única** travessia de thread no sistema é
a fila do transporte. Serviço de domínio é `main` por padrão e não cria thread.

## 6. Descartados

**6.1 Container de DI.** Resolução implícita por tipo é o oposto do princípio do projeto.
A raiz é uma função com construtores explícitos, legível de cima a baixo.

**6.2 Três codecs de fio.** §2.

**6.3 `const void*` como identidade de nó na porta.** Foi o que viabilizou o fake do
produtor e merece o crédito — mas `NodeRef` (handle tipado, opaco) dá o mesmo desacoplamento
com tipo de verdade. Não há motivo para nascer sem tipo.

**6.4 A palavra "adapter".** §3.
