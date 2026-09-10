# Decisao de motor — FECHADA: Gecko no Linux

Fecha o item **K** de `docs/webkit-engine/07-decisoes-pendentes.md`.

Data: 2026-09-10. Decidida por **medicao**, nao por argumento.

---

## A decisao

**Gecko (Firefox ESR 153) rodando em Linux.**

K era formulada como "macOS ou Linux", e a analise mostrou que nao eram duas
decisoes: **Apple -> WebKit, Linux -> Gecko**, porque a plataforma determina qual
motor e' coerente. A plataforma escolhida e' Linux. Logo o motor e' Gecko.

O lado A (WebKit/WPE) **nao e' lixo** — e' o registro que produziu a comparacao, e
fica arquivado em `docs/webkit-engine/` mais a branch `feat/webkit-engine`.

## Os cinco argumentos que sustentavam o WebKit, e o que a evidencia fez com cada um

| # | argumento original | destino | evidencia |
|---|---|---|---|
| 1 | Injecao nativa de input via libwpe | **REVERTIDO** | `HeadlessWidget` do Gecko sintetiza mouse, scroll e **touch** nativamente, em processo, sem Marionette (`02-costura-evidencia.md` §7) |
| 2 | WPE e' feito para embedar; Gecko voce contrabandeia | **EMPATE** | `--headless` + `HeadlessWidget` e' caminho de primeira classe, e' como o Firefox headless roda em CI no mundo inteiro |
| 3 | `nsIMutationObserver` era vantagem do Gecko, depois "recalibrado" para empate | **REVERTIDO — a recalibragem estava errada** | Gecko tem **ponto de registro explicito** (`nsINode::AddMutationObserver`). O WebKit tem maquina interna de MutationRecord sem registro para consumidor nativo (§1) |
| 4 | Paridade de motor com o iPhone | **JA RETIRADO antes da medicao** | fisica de scroll e reconhecimento de gesto vivem na camada UI iOS-especifica, nao no core que o WPE usa |
| 5 | **Custo de fork e build — era a razao PRINCIPAL** | **REVERTIDO, E MEDIDO** | tabela abaixo |

**Nenhum argumento sobreviveu.**

## A medicao que fechou — mesma maquina (WSL, 21 GB, 6 cores, ext4)

| metrica | Gecko ESR 153 | WebKit WPE 2.52.6 | veredito |
|---|---|---|---|
| bootstrap | 170 s | — | — |
| **build a frio** | **6120 s** (1h42) | 8098 s (2h15) | **Gecko** |
| **iteracao, 1a passada** | **14 s** | 93 s | **Gecko, ~6,6x** |
| iteracao, 2a passada | 10 s | 1,2 s | WebKit — **irrelevante**, e' build nulo |
| pico de RAM | 19,6 GB | 7,5 GB | WebKit |
| tamanho do obj dir | 16 GB | 1,5 GB | WebKit |
| headless com GPU ausente | SWGL/GFX falha | GBM/DRM falha | **empate** — e' a WSL, nao o motor |

**A metrica que decide e' a iteracao de 1a passada**, porque e' a que se paga
cinquenta vezes por dia. Build a frio se paga uma vez.

O `10 s` da segunda passada do Gecko contra `1,2 s` do WebKit nao conta: build nulo
nao e' operacao real — ninguem recompila sem ter mudado nada.

## Ganhos do Gecko que nao estavam no placar original

- **Shadow fechado de graca** — `Element::GetShadowRoot()` do C++ nao filtra por
  modo. **O patch de `attachShadow`, a coisa mais detectavel do motor atual, deixa
  de ser necessario.** (§2)
- **CSSOM mais fino, nao mais grosso** — `RuleAdded` / `RuleRemoved` /
  `RuleChanged(rule, change)` por regra, contra "mudou neste escopo" do WebKit. (§4)
- **Fronteira de UA vira predicado** — `IsInNativeAnonymousSubtree()` e' flag de
  primeira classe em todo no. Fecha o item **F**. (§5)
- **`NodeWillBeDestroyed` fecha o item G** — o acumulador guarda identidade e o motor
  avisa quando despejar; dispensa referencia forte. (§3)
- **Coerencia de fingerprint no Linux, por construcao** — voce **e'** um Firefox:
  TLS, canvas/FreeType, fontes, SpiderMonkey, kernel. Nada forjado. WebKit-no-Linux
  e' populacao inexistente e exigiria forjar tudo isso **para sempre**.

## Custos aceitos com a decisao

- **RAM de build: 19,6 GB de pico.** Passou na WSL de 21 GB por **1,4 GB de
  margem**. Especificacao de maquina de build fica **24 a 32 GB**, nao 16.
- **Obj dir de 16 GB**, dez vezes o do WebKit. Disco e' barato, e provavelmente e'
  parte do *porque* o incremental e' rapido.
- **Fork mais pesado de rebasear** (arvore grande, Rust entrelacado). Continua
  verdade, e continua sendo imposto agendavel, nao continuo — politica em
  `01-fork.md`.
- **Fission vem ligado** (`fission.autostart`). Desligar no v1. (§8)

## O que NAO muda com esta decisao

Tudo que foi decidido de forma agnostica de motor sobrevive intacto:

- ABI de frame selada — `webkit-engine/00-foundation.md` §3
- Forma da costura, acumulador de sujo, integridade e desync —
  `webkit-engine/08-costura.md`
- Supervisor, contrato, ponte de controle, principio da marionete —
  `webkit-engine/06-runtime.md`
- Indice de decisoes — `webkit-engine/07-decisoes-pendentes.md`

Esses quatro documentos moram em `docs/webkit-engine/` por acidente historico.
**O conteudo deles nao e' do WebKit.**

## Nota de metodo, para o registro

A decisao original pelo WebKit foi tomada **decidindo o motor antes da plataforma** —
deixando o eixo "custo de fork" escolher o engine e tratando macOS-vs-Linux como
pergunta seguinte. Estava invertido: a plataforma determina qual motor e' coerente,
e coerencia e' o problema de produto que originou o port.

O erro custou um dia de build e nenhuma linha de codigo de motor — porque a regra
"a costura vem antes da primeira linha de codigo" (`08-costura.md`) segurou o
projeto no ponto mais barato possivel para corrigir.
