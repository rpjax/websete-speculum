# 15 — Vida da sessão e queda de ponte (item S, fechado)

Status: **fechado 2026-09-10**. Fecha o item **S**, aberto ao avaliar SignalR.

Pergunta: o link cair mata a sessão, ou ela sobrevive esperando reatar?

---

## 1. Uma regra só, nas três pontes

**Ponte caiu = morre.** Já valia para supervisor ↔ Gecko (`06-runtime.md` §7.3).
Agora vale igual para orquestrador ↔ supervisor. Nada de estado de falha parcial,
nada de lógica de reparo, nada de sessão zumbi.

| ponte | política |
|---|---|
| supervisor ↔ Gecko | caiu = crash, instância se autodestrói (`06-runtime.md` §7.3) |
| orquestrador ↔ supervisor | caiu = supervisor morre. **Sem reconnect.** |
| application ↔ orquestrador | reconnect simples, baixa tolerância; depois disso, degrada |

## 2. Orquestrador ↔ supervisor

**O supervisor não reconecta e não espera. Ele morre com o orquestrador.**

Mecanismo: o supervisor é filho do orquestrador; `PR_SET_PDEATHSIG` faz o kernel
matá-lo quando o pai morre. **Zero linha de lógica**, e funciona no crash e no
`SIGKILL` — não só no desligamento ordeiro.

Isso corrige um furo da primeira formulação, que era "o orquestrador mata todos os
supervisores e depois se mata". O cenário em que essa limpeza importa é exatamente
aquele em que o orquestrador **caiu**, e caído ele não executa código nenhum. A
limpeza nunca aconteceria. O kernel resolve o caso que o código não alcança.

**E reconectar não serviria para nada de qualquer forma:** um orquestrador novo não
tem a sessão, o tenant, nem o estado daquele par. Herdaria processos sobre os quais
não sabe nada.

Na direção oposta o orquestrador tem **SIGKILL sem dó** sobre qualquer supervisor,
a qualquer momento. Assimetria proposital: o orquestrador decide, o supervisor
obedece — mesma linha do princípio da marionete um nível acima.

## 3. Application ↔ orquestrador

Reconnect simples, baixa tolerância temporal. Passado o limite:

- A **application continua de pé**. Ela **não** entra em estado de falha global.
- Ela marca **as sessões daquele orquestrador** como mortas e para de aceitar
  sessão nova nele. **Degradação, não parada.**
- O orquestrador, do lado dele, derruba tudo e reinicia. Reinício completo, sem
  tentativa de preservar nada.

**Por que degradação e não falha global:** com um host é a mesma coisa; com dois é a
diferença entre "uma máquina fora" e "produto fora". Multi-host já está registrado
como coisa que vem (`10-orquestrador.md` §6.1), então a formulação global seria uma
dívida contraída de graça.

## 4. O timer espelhado — sem ele, vaza sessão

O link cair **não prova** que o orquestrador morreu. Pode ser rede.

Nesse caso a application declara as sessões mortas, mas elas continuam vivas na
VPS, consumindo memória, sem ninguém usando.

**Regra espelhada, obrigatória: sessão sem caller atrelado há N, morre.** O
orquestrador é quem conta esse tempo. Sem isso, um piscar de rede deixa lixo
permanente no host.

## 5. Nota

Nada disto deveria acontecer em operação normal. É por isso que vale desenhar: o
objetivo não é evitar o evento, é fazer com que, quando acontecer, ele seja chato e
previsível em vez de misterioso — e que o sistema volte sozinho.
