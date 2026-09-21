# 11 — Linguagem do supervisor (item Q, fechado)

Status: **fechado 2026-09-10**. Fecha o item **Q**.
Decisão: **.NET, compilado com NativeAOT**, com o supervisor cego ao conteúdo do frame.

Este documento registra a decisão, o raciocínio que levou a ela, e os formatos
que foram descartados no caminho — com o motivo de cada descarte, para que
ninguém reabra a discussão pelos mesmos argumentos.

---

## 1. Como a pergunta foi enquadrada

A pergunta não é "qual linguagem é melhor". É:

> Dadas as duas pontes que o supervisor tem, qual linguagem faz sentido?

As duas pontes:

| | ponte | natureza |
|---|---|---|
| **1** | supervisor ↔ navegador | **local.** O binário Gecko expõe uma porta de RPC para receber comandos e um canal para emitir os dados que produz. |
| **2** | supervisor ↔ orquestrador / consumidor | **rede, sempre.** |

Tudo o mais é consequência dessas duas.

## 2. Duas premissas que fecham o formato antes da linguagem

**(a) O supervisor é a interface. Não existe caminho que o contorne.**

O supervisor define um contrato de consumo: para usar o navegador, consome-se o
supervisor. Qualquer desenho em que o consumidor fale direto com o processo C++
não é uma otimização — é um furo na abstração que o supervisor existe para ser.

**(b) O consumidor é remoto, para todos os efeitos.**

Ele vive em outro container e conversa por rede. Não há IPC entre ele e o processo
do navegador. Portanto **alguém tem obrigatoriamente que fazer a adaptação** entre
o processo local do navegador e um consumidor de rede. Esse alguém é o supervisor.
Isso não é escolha; é a única resposta possível para a pergunta "quem faz essa
ponte".

**Consequência direta:** o frame **passa pelo supervisor**. Isso está decidido por
arquitetura, não por medição. O item O (onde os bytes passam) trata de *como* passam,
não de *se* passam.

## 3. O que o navegador sabe (e por que isso importa)

O binário Gecko **não sabe quem está falando com ele**. Ele expõe um protocolo:
uma porta para receber comandos/RPC, um canal para emitir dados. Se o peer é o
supervisor ou qualquer outra coisa é indiferente do ponto de vista dele.

Isso é importante porque destrói um argumento que foi levantado e está errado:
não existe "retrabalho evitado" ao ligar o consumidor direto no C++. Do lado do
C++ nada muda. O trabalho de adaptação existe de qualquer jeito — a única
diferença é se ele fica num lugar nomeado (o supervisor) ou espalhado.

## 4. Formato resultante: o supervisor é um relay

- lê bytes já enquadrados de um socket local;
- escreve num socket de rede;
- RPC nos dois sentidos, para controle;
- mais o trabalho de ciclo de vida, configuração e erro — que é a maior parte do
  código, ainda que não do tempo de CPU.

## 5. Decisão: .NET

Não apenas por homogeneidade com o resto da aplicação (que é razão legítima e foi
a razão original), mas porque **o formato acima é exatamente aquilo em que a
plataforma é forte**:

- `System.IO.Pipelines` existe para o caso "ler de socket, enquadrar, escrever em
  socket sem copiar";
- `Span<T>` / `Memory<T>` / `ArrayPool` permitem o caminho quente sem alocação por
  frame;
- é o mesmo formato de carga do Kestrel — caminho principal da plataforma, não
  gambiarra;
- o frame nosso é **diff, não imagem**. Volume por sessão é modesto. Isto não
  estressa .NET.

## 6. Condição 1 — NativeAOT, decidida agora

**Motivo:** sessão = processo (item N, `10-orquestrador.md`). Cada sessão carrega
um runtime .NET inteiro. NativeAOT reduz muito o baseline de memória e leva o
arranque a milissegundos — relevante porque **se sobe processo por sessão**.

**Por que agora e não depois:** AOT restringe reflection. Na prática isso significa
serialização por *source generator* desde o primeiro dia. Planejado desde o começo,
custa quase nada. Descoberto com o código pronto, é retrabalho real.

**Aceito pelo dono do projeto em 2026-09-10.**

## 7. Condição 2 — supervisor cego ao frame

O supervisor **relaya bytes opacos**. No instante em que desserializa para olhar
dentro, passa a pagar CPU por frame por sessão, e a densidade por host sofre.

Como o produtor já emite `sequence` e `hash` no prefixo do frame, o supervisor
repassa cego — no limite lê os primeiros bytes do prefixo, nunca o corpo.

Isto é regra de desenho, e é o que mantém .NET barato neste caminho.

## 8. Adiado por decisão

**Pegada de memória por runtime × N sessões** (ordem de 20–40 MB de baseline por
processo, antes de AOT). Em densidade alta isso vira número de negócio. **Adiado
explicitamente** — se preocupar com isso em outro momento. Fica pendurado no
item **P** (densidade — sessões por host), que já aguarda medição.

## 9. Formatos descartados

### 9.1 Supervisor = o próprio embedder C++ (descartado)

O supervisor seria a aplicação C++ na árvore do Gecko; não existiria ponte, seria
chamada de função.

**Descartado.** Joga todo o trabalho de ciclo de vida, retry, configuração e
conversa com o orquestrador — a maior parte do código — na linguagem mais cara.
Contraria o princípio da marionete (`06-runtime.md` §7.7): o navegador é
marionete, não sede de lógica. E não resolve nada, porque a adaptação para o
consumidor remoto continuaria tendo que existir.

### 9.2 Supervisor de controle apenas, com o frame saindo direto do C++ (descartado)

O produtor C++ escreveria o frame direto para o consumidor; o supervisor cuidaria
só de controle. O argumento era isolar a decisão de linguagem da medição do item O.

**Descartado, e o descarte é o mais importante deste documento.** Duas falhas:

1. **Fura a interface.** O supervisor deixaria de ser o contrato de consumo. Ter o
   consumidor falando direto com o processo do navegador contradiz a razão de o
   supervisor existir.
2. **O consumidor é remoto.** Ele está em outro container, fala por rede. Um
   processo local C++ não tem como ser o endpoint dele sem que alguém faça a
   adaptação — e esse alguém é exatamente o supervisor. O desenho se auto-anulava.

Além disso, o benefício alegado ("evitar retrabalho no lado C++") **não existe**:
o C++ não sabe para quem emite (§3).

## 10. Correções registradas — não reabrir por estes caminhos

| # | erro cometido | correção |
|---|---|---|
| 1 | Recusar SignalR citando "ponte caiu = crash" (`06-runtime.md` §7.3). | §7.3 é a ponte **supervisor ↔ Gecko**. O link supervisor ↔ caller é outro, e a regra não se aplica a ele. |
| 2 | Prender a decisão de linguagem ao item O (medição de onde passam os bytes). | Falso. O frame passa pelo supervisor por necessidade arquitetural (§2). O é sobre *como*, não *se*. |
| 3 | Propor supervisor = embedder C++. | §9.1. |
| 4 | Propor caminho de dados contornando o supervisor. | §9.2. |
| 5 | Levantar risco de "sessão do SignalR virar sessão do domínio". | Problema inventado. SignalR é detalhe de transporte na camada de adaptação; o que importa é o dado que trafega por ela. |

## 11. Onde isso deixa SignalR

Confirmado como **adaptador padrão para consumidor remoto**, e nada além disso:
detalhe de transporte dentro da camada de adaptação. A interface é do supervisor;
o transporte é escolha de adaptador e pode ter mais de um.
