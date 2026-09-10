# 12 — Vocabulário da ponte de controle (item C, fechado)

Status: **fechado 2026-09-10**. Fecha o item **C**.
A *forma* da ponte já estava decidida em `06-runtime.md` §7 (socket, supervisor
escuta, embedder conecta, codec auto-descritivo). Este doc fecha o *conteúdo*.

---

## 1. Correção de premissa em `06-runtime.md` §7

O texto original dizia que controle é "poucas mensagens por sessão, então a
performance dele é irrelevante e a simplicidade vale tudo".

**Isso está errado e foi corrigido na fonte.** Entrada de usuário viaja por esta
ponte: movimento de ponteiro é 60–120 mensagens por segundo, contínuo, durante
toda a sessão. E **latência de entrada é a qualidade percebida da projeção
inteira** — não é um detalhe interno.

A premissa correta: **a ponte precisa aguentar vazão alta com conforto, com
paralelismo e sem engasgo.** Simplicidade continua valendo, mas não à custa disso.

## 2. Propriedades do protocolo — DECIDIDO

1. **Assíncrono, com id de correlação.** Nada de pergunta-resposta em lockstep.
2. **Sem bloqueio de cabeça de fila.** Uma operação lenta não pode segurar o
   `Input` que vem atrás. Esta é a razão de ser do item 1.
3. **Vazão alta é requisito, não bônus.** Dimensionar para isso desde o começo.
4. Codec auto-descritivo (§7.2): campo novo numa ponta não quebra a outra.

## 3. Vocabulário

### 3.1 Supervisor → navegador (ordens)

| grupo | mensagens |
|---|---|
| contexto | `ContextCreate(geometria de viewport)`, `ContextDestroy`, `ViewportSet` |
| navegação | `Navigate(url)`, `Reload`, `Stop`, `HistoryGo(delta)` |
| entrada | `Input(evento)` — ponteiro, teclado, roda, toque |
| projeção | `Resync(contextId, força)` |
| resposta | `DialogRespond`, `PermissionRespond`, `DownloadRespond` |
| vida | `Shutdown` |

### 3.2 Navegador → supervisor (emissões)

| grupo | mensagens |
|---|---|
| vida | `Ready`, `Heartbeat` |
| contexto | `ContextCreated(id, parentId)`, `ContextDestroyed(id)` |
| navegação | `Navigated(id, url)`, `LoadStateChanged` |
| pedido | `DialogRequested`, `PermissionRequested`, `DownloadRequested` |
| diagnóstico | `Fault(causa)` — ver §7.4 de `06-runtime.md` |

### 3.3 Identidade

`contextId` é **o mesmo** do ABI de frame (`CONTEXT_ID_ROOT = 1`, `0` inválido).
Controle e dados falam dos mesmos objetos com os mesmos nomes. Não existe segundo
espaço de ids.

## 4. Diálogo, permissão e download — dia 0, explícito

`alert()`, `confirm()`, pedido de câmera/microfone/notificação, download iniciado
pela página: **a página vai fazer isso.** Faz parte da premissa inicial de
features, não é caso de borda.

A marionete **pede e espera**. Ela não responde sozinha, não tem política, não tem
default embutido. Quem responde é o supervisor.

**Implementar desde o dia 0.** O risco de deixar para depois é concreto: alguém
coloca um auto-responder dentro do C++ "temporariamente" e o princípio da
marionete (`06-runtime.md` §7.7) morre ali, sem ninguém decidir isso.

## 5. Resync

O mecanismo **já está inteiramente especificado** em
`docs/page-projection/spec/frame-protocol.md` §5.8 e não muda: mecanismo único,
três gatilhos, duas forças, halt do dreno durante a construção, fechamento com
`CHECK(scope: Table)`, pedido carimbado com `contextId` (portanto por contexto,
não global).

**O que o item C muda é só o transporte do gatilho.** Hoje é evento de barramento
em processo, dentro do JS. Na arquitetura nova o cliente detecta a dessincronia e o
pedido sobe: cliente → produto → orquestrador → supervisor → produtor C++.
`Resync(contextId, força)` na ponte de controle substitui o evento de barramento.

### 5.1 A força vem na mensagem — DECIDIDO

`força ∈ { mapa, virtual }`, correspondendo a `emitResyncFrame` e `resyncVirtual`
da §5.8.

Escolher entre "barato e parcial" e "caro e completo" é **política**, e política é
do supervisor. **O C++ não decide.** Ele executa a força que recebeu.

Ganho concreto: política mais esperta no futuro (tentar `mapa`, cair para
`virtual` se o `CHECK` não fechar) nasce inteira no supervisor, em .NET, sem tocar
uma linha do fork.

### 5.2 `ProjectionAttach` não existe — DECIDIDO

A projeção está **sempre ligada em todo contexto**. Se um contexto existe, é porque
a página o criou; ou a gente replica, ou o cliente está errado. Não há estado útil
"contexto existe mas não é projetado".

Cliente novo anexando é, pela própria §5.8, o mesmo mecanismo com tabela vazia —
ou seja, `Resync(virtual)`. Não é caso especial e não ganha mensagem própria.

**Motivo real do corte:** dois caminhos que fazem a mesma coisa divergem com o
tempo. Alguém conserta um bug no resync e não no attach, e passa a existir sessão
que nasce torta e só se conserta quando dessincroniza — categoria de bug caríssima
de achar.

Não projetar contexto fora de tela é **otimização**, e cai na regra já fechada no
item E (`05-otimizacao.md`): fazer funcionar primeiro, otimizar depois.
