# Decisoes pendentes

> **Nota de branch:** este indice e' **agnostico de motor** e vale para os dois lados
> da avaliacao. Lado A = WebKit (`docs/webkit-engine/`, congelado como registro).
> Lado B = Gecko (`docs/gecko-engine/`, em avaliacao). Onde uma decisao ja tem
> resposta diferente por motor, esta anotado na linha.

Indice unico do que ainda nao foi decidido no port. Cada item tem **status** e
**o que ele destrava**. Fechar um item = mover a decisao para o doc que a comporta
(`00-foundation`, `06-runtime`, etc.) e marcar aqui como FECHADO com o link.

Regra: nada sai daqui por inercia. Sai por decisao registrada.

---

## Destravam outras coisas — decidiveis agora

| id | decisao | destrava | status |
|---|---|---|---|
| **A** | **Onde a costura entra no WebKit.** | C3 inteiro. Custo de rebase **e** ciclo de iteracao. | **FECHADO** → `08-costura.md` |
| **B** | **O embedder / fronteira dos dois pedacos** | **FECHADO 2026-09-10 → `gecko-engine/03-embedder.md`.** Aplicacao propria na arvore ao lado do `browser/`. Fingerprint e' configuracao, nao forja — backlog derivado de `diff(Firefox com cabeca, headless)`. | **FECHADO** |
| **C** | **Vocabulario da ponte de controle** | **FECHADO 2026-09-10 → `gecko-engine/12-ponte-controle-vocabulario.md`.** Vocabulario completo nas duas direcoes; `contextId` compartilhado com o ABI de frame. **Corrige §7 de `06-runtime.md`:** controle **nao** e' baixa frequencia — `Input` e' 60-120 msg/s e latencia de entrada e' a qualidade percebida da projecao. Protocolo **assincrono, id de correlacao, sem bloqueio de cabeca de fila, vazao alta como requisito**. Dialogo/permissao/download sao **features de dia 0**, com a marionete pedindo e esperando. `Resync(contextId, forca)` substitui o evento de barramento; **a forca vem na mensagem — o C++ nao decide**. `ProjectionAttach` **nao existe**: projecao sempre ligada, cliente novo e' `Resync(virtual)`. | **FECHADO** |

**A e' a unica da lista que fica mais caro de mudar depois.** As outras se revertem;
essa se reescreve.

## Decidiveis agora, acoplamento menor

| id | decisao | status |
|---|---|---|
| **D** | **PersonaSpec** | **FECHADO 2026-09-10 → `gecko-engine/06-persona.md`.** Persona e' **args no contrato, preocupacao do consumer** — o browser aplica, nao decide. Modelo: **identidade persistida + sorteio de lista grande quando o profile e' forjado.** A parte nossa: o contrato **deriva em vez de aceitar**, para tornar incoerencia inexprimivel. | **FECHADO** |
| **E** | **O que se corta por observabilidade** | **FECHADO 2026-09-10 → `gecko-engine/05-otimizacao.md`.** Principio: **fazer funcionar primeiro, otimizar depois.** Ausencia (sem tela, sem alto-falante, sem frame de video) entra dia 1; corte de verdade espera C3 + baseline como juiz. Nao e' fundacao, nao entra no caminho critico. | **FECHADO** |
| **F** | **Fronteira autor / UA** | **FECHADO 2026-09-10 → `gecko-engine/14-fronteira-ua.md`.** Regra: **o elemento e' o contrato; o interior e' trabalho do navegador — dos dois lados.** Componente de spec (`<video>`, `<input>`, `<details>`…) projeta **raiz + atributos + propriedades** (`PropSet` 0x63 cobre o estado que nao e' atributo); o navegador projetado constroi o interior. Nada criado pelo navegador e' projetado. Enunciado assim, o design **nao precisa enumerar** tipos de conteudo de UA — a checagem no C++ vira detalhe de implementacao. Duas exigencias sobre ela: vale **na admissao e em cada mutacao**; **shadow fechado do autor continua replicando** (fechado e' escolha do autor, nao fronteira de UA). Limite registrado: pseudo-elemento de UA nao atravessa entre motores. | **FECHADO** |
| **G** | **Identidade de no** + risco de referencia pendurada no acumulador. | **RESOLVIDO no Gecko** — nao ha id nativo (tabela paralela fica), **mas `NodeWillBeDestroyed` avisa antes do no morrer** (`gecko-engine/02-costura-evidencia.md` §3). O acumulador guarda identidade e o motor diz quando despejar; dispensa referencia forte. Com K fechada em Gecko, **isto vale como a resposta do projeto.** |
| **H** | **Relogio de frame** — nasce no commit de style/layout, ou continua timer (`timerFrameClock`)? **De-riscado** pelo acumulador de conjunto sujo: checkpoint vazio = zero trabalho, entao virou otimizacao, nao decisao critica. | ABERTO — baixa criticidade |
| **I** | **Contextos aninhados / Fission** | **FECHADO COM ASTERISCO 2026-09-10 → `gecko-engine/08-fission.md`.** Fission desligado no v1. **Mas desligar nao garante processo unico** — header COOP/COEP do site ainda separa. O produtor **tolera** frame de outro processo. **(*) REABRIR:** checagem de 5 min sobre desligar tambem COOP/COEP sem matar `SharedArrayBuffer`. Nao mexer nessas prefs antes. | **FECHADO (*)** |
| **J** | **Plano de ativos** | **FECHADO 2026-09-10 → `gecko-engine/13-plano-de-ativos.md`.** **Service worker no cliente** intercepta tudo; **ninguem reescreve URL** (o hop `rewritePart` morre — era incompativel com o supervisor cego). O Virtual age como **proxy de rede** para o que so o cliente pede (midia, com `Range` repassado), porque a razao de proxiar pelo navegador e a **identidade** (TLS, cookie, HTTP/2). Sobreposicao real e' so **imagem e fonte** — o resto e' exclusivo de um lado. Plano de ativos e' **tee de stream por offset**, nao cache de corpo inteiro. Limites escritos: stream de script (SSE/WebSocket) nunca e' servido; **MSE nao atravessa** (limite estrutural, nao backlog). **Risco de `<video>`+`Range` por SW foi testado e retirado** — evidencia e harness em `gecko-engine/evidence/sw-range/`. | **FECHADO** |

## Escopo, nao mecanismo — decisao de produto

| id | decisao | nota | status |
|---|---|---|---|
| **K** | **macOS ou Linux + qual motor** | **FECHADA 2026-09-10 → `gecko-engine/00-decisao.md`. Gecko no Linux.** Decidida por medicao: iteracao 14 s vs 93 s, build frio 6120 s vs 8098 s. Os cinco argumentos que sustentavam o WebKit foram todos revertidos ou empatados. | **FECHADO** |
| **L** | **Determinismo / replay** | **DESCARTADO 2026-09-10 → `gecko-engine/09-determinismo-descartado.md`.** Nao adiado, descartado. A projecao **replica estado observado**, nao re-executa: o cliente nunca re-deriva nada, entao nao existe nada a reproduzir. O que se precisa e' produtor e cliente da MESMA execucao concordarem, e isso o `hash` ja garante. A proposta era conveniencia de debug inflada em pilar de desenho. | **DESCARTADO** |
| **M** | **TLS / JA3-JA4 e HTTP/2** | **FECHADO 2026-09-10 → `gecko-engine/07-rede.md`.** Com Gecko e' **de graca** — mesmo NSS e mesmo Necko do Firefox. Virou **proibicao** (nao mexer em `security.tls.*`, nao endurecer, nao trocar NSS) + uma verificacao de JA3 contra Firefox de fabrica. Era projeto grande no plano WebKit. | **FECHADO** |
| **N** | **Granularidade de processo** (`06-runtime.md` §8.1) | **FECHADO 2026-09-10 → `gecko-engine/10-orquestrador.md`.** Fechou junto com R, porque eram a mesma pergunta. **Sessao = processo** (par supervisor + Gecko), dentro de um **container longo por host**. Nao e' container por sessao. | **FECHADO** |

## Precisam de numero, nao de debate

| id | decisao | status |
|---|---|---|
| **O** | **Onde os bytes de frame realmente passam** (`06-runtime` §8.3). **Escopo estreitado 2026-09-10:** e' sobre *como* passam pelo supervisor (copia, pooling, shm vs socket), nao sobre *se* passam — isso ficou decidido por arquitetura em `11-supervisor-linguagem.md` §2. | AGUARDA MEDICAO |
| **P** | **Densidade — sessoes por host.** Recebeu 2026-09-10 a pegada de memoria por runtime .NET × N sessoes (ordem de 20–40 MB de baseline por processo antes de AOT), **adiada por decisao** em `11-supervisor-linguagem.md` §8. | AGUARDA MEDICAO |
| **S** | **Vida da sessao quando o caller cai** — **FECHADO 2026-09-10 → `gecko-engine/15-vida-da-sessao.md`.** Uma regra so nas tres pontes: **caiu = morre**. Supervisor **nao reconecta**: morre com o orquestrador via `PR_SET_PDEATHSIG` (kernel, funciona no crash — que e' justamente o caso em que codigo de limpeza nao roda). Application **degrada aquele orquestrador**, nao entra em falha global. **Timer espelhado obrigatorio:** sessao sem caller ha N morre, senao um piscar de rede vaza sessao viva no host. | **FECHADO** |

## Confirmacoes assumidas — agora declaradas

| id | item | status |
|---|---|---|
| **Q** | **FECHADO 2026-09-10 → `gecko-engine/11-supervisor-linguagem.md`.** Supervisor e Orquestrador em **.NET, com NativeAOT**. Decidido pelas **duas pontes** do supervisor: local (RPC + stream para o Gecko) e rede (consumidor remoto). O supervisor **e** a interface e o consumidor **e** remoto (outro container, rede), logo a adaptacao e obrigatoria e **o frame passa por ele por necessidade arquitetural** — nao por medicao. O formato resultante e um **relay**, que e' exatamente onde .NET e' forte (Pipelines / formato Kestrel). **Duas condicoes:** NativeAOT decidido ja (restringe reflection → serializacao por source generator desde o dia 1) e **supervisor cego ao conteudo do frame** (relay opaco; `sequence`/`hash` ja vem no prefixo). **Adiado por decisao:** pegada de memoria por runtime × N sessoes, pendurado no item P. **SignalR:** adaptador padrao para consumidor remoto, detalhe de transporte. Descartes e correcoes registrados em §9 e §10 daquele doc — nao reabrir por aqueles caminhos. | **FECHADO** |
| **R** | **Arranque — o que significa "subir um supervisor". FECHADO 2026-09-10 → `gecko-engine/10-orquestrador.md`.** Componente novo, o **Orquestrador**: um por host, dentro do container, **escrito por nos** (.NET). Sobe/derruba pares por fork/exec, fala com a application, faz a ponte com os supervisores. Nao ha supervisor de supervisor acima dele — o topo e a politica de restart do host. **Corrige `06-runtime.md`: pool/admissao nao sao do produto; produto pede, Orquestrador aloca.** | **FECHADO** |


---

## Resolvidas desde a primeira versao deste indice

| id | como foi resolvida |
|---|---|
| **S** | Caiu = morre, nas tres pontes; PDEATHSIG; degradacao em vez de falha global; timer espelhado. `gecko-engine/15-vida-da-sessao.md`. |
| **F** | O elemento e' o contrato; o interior e' do navegador. `gecko-engine/14-fronteira-ua.md`. |
| **J** | Service worker no cliente; zero reescrita de URL; navegador como proxy; tee por offset. `gecko-engine/13-plano-de-ativos.md`. |
| **C** | Vocabulario fechado; ponte assincrona de vazao alta; sem `ProjectionAttach`. `gecko-engine/12-ponte-controle-vocabulario.md`. |
| **Q** | .NET + NativeAOT, decidido pelas duas pontes do supervisor; supervisor cego ao frame. `gecko-engine/11-supervisor-linguagem.md`. |
| **R + N** | Container longo por host; sessao = processo; **Orquestrador proprio** faz o arranque e a ponte. `gecko-engine/10-orquestrador.md`. |
| **L** | Descartado — a projecao replica, nao re-executa. `gecko-engine/09-determinismo-descartado.md`. |
| **I** | Fission off no v1, com asterisco. `gecko-engine/08-fission.md`. |
| **M** | De graca no Gecko; virou proibicao. `gecko-engine/07-rede.md`. |
| **D** | Persona e' args do consumer; contrato deriva. `gecko-engine/06-persona.md`. |
| **E** | Fazer funcionar primeiro, otimizar depois. `gecko-engine/05-otimizacao.md`. |
| **B** | Aplicacao propria na arvore. `gecko-engine/03-embedder.md`. Ampliou o D com geometria de janela. |
| **K** | **Gecko no Linux**, por medicao. `gecko-engine/00-decisao.md`. Fechou tambem, por consequencia, F e G. |
| **A** | Fechada em `webkit-engine/08-costura.md` — poucos ganchos atras de interface estreita, implementacao em pasta nossa, observador nulo = upstream, numero de linhas como metrica. **Agnostica de motor.** |
| **C** | Dissolvida: tudo passa pela ponte, entao a lista de mensagens **deriva** do contrato que ja existe em `sidecar/browser/contracts/index.ts`. Virou trabalho, nao escolha. |
| **H** | De-riscada pelo acumulador de conjunto sujo: checkpoint vazio custa zero, logo virou otimizacao. No Gecko os pontos existem (`nsRefreshObservers`, `WillPaint`, `DidDoReflow`). |
| **B** | Estreitada pelo principio da marionete (`06-runtime.md` §7.7). Sobra dividir o que e' de projecao. |
| **A2** (ciclo de iteracao no WebKit) | Medido: **93 s / 1,18 s**. Abaixo da barra de 5 min, entao o experimento de unified builds **nao precisa rodar**. |

## Documentos agnosticos de motor

Valem para os dois lados sem alteracao:

- `webkit-engine/06-runtime.md` — supervisor, contrato, ponte, principio da marionete
- `webkit-engine/08-costura.md` — forma da costura, acumulador, integridade e desync
- este indice
