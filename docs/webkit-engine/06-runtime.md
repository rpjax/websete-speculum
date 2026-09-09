# Runtime — desenho do processo e dos contratos

Escopo: como a instancia de WebKit e' hospedada, supervisionada e exposta ao produto.
Este doc registra o que esta **fechado**. O que esta aberto esta na secao final.

Nao decide nada sobre o produtor de frames (C3) nem sobre a ABI de frame, que esta
selada em `00-foundation.md` §3.

---

## 1. Principio

A instancia de WebKit e' **autocontida**. Um contrato define como ela sobe; quem chama
consome esse contrato e nao sabe nada de como a instancia funciona por dentro.
O contrato e' agnostico de transporte.

## 2. Camadas

    adapter do consumer          formato do produto, definido por quem consome
    ───────────────────────────
    contrato do supervisor       estavel, nivel de produto, esconde as entranhas
    ───────────────────────────
    estrategia de transporte     in-process / socket local / remoto
    ───────────────────────────
    ponte de controle            supervisor <-> embedder. interna. secao 7.
    ───────────────────────────
    embedder (C++)               linka WPE, hospeda o produtor, injeta input

## 3. Supervisor por instancia

O supervisor e' **um segundo processo que gerencia o processo do WebKit**. Um supervisor
cuida de **uma** instancia e de mais nada.

Consequencia principal: **sem estado compartilhado entre sessoes.** Nao existe o bug
"o crash da sessao A corrompeu a contabilidade da B". O supervisor fica trivialmente
testavel e o raio de explosao de um crash e' 1.

**Isolacao logica esta decidida. Isolacao de processo NAO** — ver secao 8.1.

## 4. Contrato do supervisor

O supervisor **declara um contrato bem definido** para o caller consumir.

Regra: o contrato e' expresso em **termos de produto**, nao em termos de motor.
Como o supervisor conversa com o C++ **nao aparece** no contrato, em nenhuma forma —
nem vazando conceito, nem vazando nome, nem vazando erro.

O contrato e' o que fica estavel. A ponte de controle abaixo dele e' livre para mudar
sem quebrar ninguem — e' justamente por isso que ela fica escondida.

## 5. Adapter no consumer

Acima do contrato do supervisor existe uma camada de adapter **definida pelo
caller/consumer**, nao pelo supervisor.

Motivo: o supervisor nao adivinha o formato que o produto quer. Ele expoe uma
superficie neutra; quem consome molda.

## 6. Pool e admissao ficam no caller

O supervisor nao decide **quantas** instancias existem. Admissao, cota, colocacao e
recolher instancia morta sao responsabilidade do **caller**.

Motivo: quem sabe de tenant, prioridade e cota e' o produto. Ele deve decidir colocacao.

Consequencia para o contrato: ele precisa expor o suficiente para o caller decidir —
readiness, health, e sinal de consumo de recurso.

Hoje isso vive em `BrowserPool` / `BrowserPoolRegistry` no sidecar. No desenho novo, sobe.

## 7. Ponte de controle supervisor <-> embedder — DECIDIDO

Escopo: a ponte carrega **controle**. Plano de dados e' separado (ver 8.3).
Controle sao poucas mensagens por sessao, entao a performance dele e' irrelevante e a
simplicidade vale tudo.

### 7.1 Forma

**Cano de bytes sobre socket.** A camada de transporte vem de lib — nao se escreve.

**O supervisor escuta. O embedder conecta.**

Motivo, e importa: com o embedder escutando voce paga corrida (o supervisor tem que
retry-connect ate o listener subir), uma janela em que outro processo pode conectar
primeiro, e bind+listen+accept em C++. Com o supervisor escutando, o listener ja esta
de pe antes do spawn, o endereco vai como argumento, e **o lado C++ faz um `connect()`
e passa a so ler e escrever.** Mais simples exatamente onde mais interessa ser simples.

**Endereco e' string, nao porta:** `unix:/caminho` ou `tcp:host:porta`. Mesmo codigo
acima disso.

- Local = **unix socket por default.** Mais rapido, permissao de filesystem, e nao fica
  exposto a qualquer processo da maquina — o que porta TCP em loopback fica.
- TCP so quando for remoto de verdade.

### 7.2 Codec

**Binario compacto e auto-descritivo (CBOR / MessagePack). NAO protobuf, NAO gRPC.**

Motivo: link interno, um consumidor so, declarado como livre para mudar. Schema com
codegen obriga versionar e regenerar as duas pontas por campo novo; auto-descritivo
deixa adicionar campo numa ponta sem tocar na outra. E como controle e' baixa
frequencia, o custo de ser auto-descritivo e' zero na pratica.

gRPC aqui e' a escolha default que as pessoas fazem e se arrependem: cerimonia de IDL
mais framing de HTTP/2 dentro do mesmo container.

### 7.3 Falha — uma regra so

**Ponte caiu = crash.** Nada de estado de falha parcial, nada de logica de reparo.

- Supervisor detecta, emite sinal de crash para o caller (`onCrash(...)`).
- A instancia **se autodestroi**. Cabe ao **caller** subir outra. Recuperacao sem estado.
- O supervisor tem poder de SIGKILL. `accept` com timeout: nao estabeleceu, mata.

**Heartbeat no canal — cobre o caso "travado".** Socket de pe, processo vivo, embedder
mudo (deadlock, loop infinito numa pagina). A ponte nao caiu, entao sem heartbeat isso
viraria sessao zumbi que o caller acha viva. Com heartbeat: batida perdida = tratar como
ponte caida = crash. **Continua sendo um caminho de falha so.**

### 7.4 onCrash carrega causa

Se o sinal de crash chega vazio, todo crash parece igual e o debug e' cego.

Minimo: sinal / codigo de saida, ultimas N linhas de stderr, e a ultima mensagem de
controle enviada. Barato agora, doloroso de retrofitar.

### 7.5 Criterio: dirigivel sem .NET

A ponte tem que ser dirigivel por um script pequeno, sem .NET e sem subir produto nenhum.

Isso e' o que viabiliza **desenvolver e testar o embedder standalone** — e depois do custo
de ciclo de build deste projeto, esse criterio vale mais do que parece. gRPC mata isso,
porque testar passaria a exigir stub gerado.

### 7.6 Distribuicao

**Supervisor e embedder sao um par co-localizado.** A unidade que se distribui entre VPS
e' o **par**, nao o supervisor separado do seu embedder.

Quem pode ser remoto e' o **caller**, e isso ja e' atendido pelo contrato agnostico de
transporte da secao 4.

### 7.7 O WebKit e' marionete — PRINCIPIO

**O WebKit mantem a ponte, emite heartbeat, e implementa as features de projecao.
Nada alem.**

Nao cuida da propria saude, nao gerencia ciclo de vida, nao tenta se recuperar, nao
aplica politica, nao faz retry. **Ele nao resolve problema — ele emite.** E' uma
marionete dirigida por RPC do supervisor.

Motivo: **menos modificacao no WebKit = menor superficie de bug.** Toda
responsabilidade que se empurra para dentro do fork e' codigo que se rebaseia para
sempre e que reconstroi a arvore a cada edicao (ver `08-costura.md`).

Tres consequencias:

- **A maquina de estado inteira vive no supervisor.** "Standby", "ready", "navegando"
  sao nomes que o **supervisor** da. O WebKit nao sabe que esta em standby — ele so nao
  recebeu ordem de navegar ainda. A semantica da sessao e' do supervisor.
- **O heartbeat e' burro.** O WebKit bate. Quem interpreta batida perdida e' o
  supervisor. O WebKit nao tem opiniao sobre estar vivo.
- **Processo orfao nao e' problema dele.** Se o supervisor morre primeiro, quem resolve
  e' quem sobe, nao quem e' subido — e da' para resolver no nivel de processo do SO
  (filho derrubado junto com o pai), **com zero linha no WebKit**. Quem supervisiona os
  supervisores continua em aberto, possivelmente no sidecar.

## 8. Aberto

### 8.1 Granularidade de processo — deliberadamente nao decidido

"Um supervisor por instancia" ja esta fechado como **ownership e estado**. O que nao esta
fechado e' se o supervisor e' **processo do SO** ou **thread/task dentro de um processo**.

- **Processo por sessao:** isolacao maxima, e voce paga um runtime por sessao. A N sessoes
  isso pode virar ordem de grandeza comparavel as proprias instancias de WebKit — o que
  ataca justamente o ganho de densidade que motivou o port.
- **Thread por sessao:** mantem a isolacao de estado (que e' o que mata os bugs) sem pagar
  N runtimes. Perde isolacao de crash **do supervisor** — mas o crash que preocupa e' o do
  WebKit, e esse ja e' processo separado por construcao.

Merece debate proprio. Nao resolver por inercia.

### 8.2 Vocabulario da ponte

A forma esta decidida (secao 7). O conjunto de mensagens de controle ainda nao.

### 8.3 Onde os bytes de frame realmente passam

O contrato da secao 4 e' compativel com duas implementacoes: supervisor repassando frames,
ou supervisor negociando e devolvendo ao consumer um handle que le direto do embedder.

Isso e' **liberdade de implementacao preservada pelo contrato**, nao decisao pendente que
bloqueia alguma coisa. Decidir quando houver numero para decidir com.

Nota: o codigo atual ja pensa em planos (`core/plane/`, `loopbackDataPlane`). Nao perder
essa separacao no port.
