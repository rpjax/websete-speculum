# Decisoes pendentes

Indice unico do que ainda nao foi decidido no port. Cada item tem **status** e
**o que ele destrava**. Fechar um item = mover a decisao para o doc que a comporta
(`00-foundation`, `06-runtime`, etc.) e marcar aqui como FECHADO com o link.

Regra: nada sai daqui por inercia. Sai por decisao registrada.

---

## Destravam outras coisas — decidiveis agora

| id | decisao | destrava | status |
|---|---|---|---|
| **A** | **Onde a costura entra no WebKit.** | C3 inteiro. Custo de rebase **e** ciclo de iteracao. | **FECHADO** → `08-costura.md` |
| **B** | **Fronteira embedder ↔ produtor.** Quem e' dono de persona, viewport, input, emissao de frame. **Estreitada** pelo principio da marionete (`06-runtime.md` §7.7): saude, ciclo de vida, recuperacao e politica saem do WebKit inteiro e sobem pro supervisor. Sobra dividir o que e' de projecao. | D, E, C2 | ABERTO — estreitado |
| **C** | **Vocabulario da ponte de controle.** A forma esta decidida (`06-runtime` §7); o conjunto de mensagens nao. | implementacao de C1 | ABERTO |

**A e' a unica da lista que fica mais caro de mudar depois.** As outras se revertem;
essa se reescreve.

## Decidiveis agora, acoplamento menor

| id | decisao | status |
|---|---|---|
| **D** | **PersonaSpec** — o que entra nela e quem deriva dela | ABERTO |
| **E** | **Lista concreta do que se corta por observabilidade** — a regra existe, a lista nao | ABERTO |
| **F** | **Fronteira de shadow** — autor replica, UA nunca. Precisa ser regra escrita, nao principio | ABERTO |
| **G** | **Identidade de no** — vem do motor, ou continua tabela paralela (`domNodeTable` / `contextIdMint`)? **PRE-REQUISITO do acumulador de CSSOM** (`08-costura.md`): sem identidade que sobreviva a morte do objeto, o acumulador so funciona com referencia forte. | ABERTO — subiu de prioridade |
| **H** | **Relogio de frame** — nasce no commit de style/layout, ou continua timer (`timerFrameClock`)? **De-riscado** pelo acumulador de conjunto sujo: checkpoint vazio = zero trabalho, entao virou otimizacao, nao decisao critica. | ABERTO — baixa criticidade |
| **I** | **Contextos aninhados** — travessia de arvore de frames, ou mantem `contextBus`? | ABERTO |
| **J** | **Plano de ativos** — torneira no resource loader, ou continua reescrita de URL? | ABERTO |

## Escopo, nao mecanismo — decisao de produto

| id | decisao | nota | status |
|---|---|---|---|
| **K** | **macOS ou Linux** | O eixo antibot. Aberta desde `00-foundation` §6. Muda a economia da infra. | ABERTO |
| **L** | **Determinismo / replay entra no v1?** | Maior alavancagem tecnica da lista, mas e' escopo, nao mecanismo | ABERTO |
| **M** | **TLS / JA3-JA4 entra no v1?** | E' pre-JS e pode invalidar todas as camadas acima. Ou e' v1, ou e' divida consciente e escrita | ABERTO |
| **N** | **Granularidade de processo** (`06-runtime` §8.1) | Processo por sessao vs thread. Preco dos dois lados ja registrado | ADIADO POR DECISAO — ultimo da fila |

## Precisam de numero, nao de debate

| id | decisao | status |
|---|---|---|
| **O** | **Onde os bytes de frame realmente passam** (`06-runtime` §8.3) | AGUARDA MEDICAO |
| **P** | **Densidade — sessoes por host** | AGUARDA MEDICAO |

## Confirmacoes assumidas mas nao declaradas

| id | item | status |
|---|---|---|
| **Q** | Supervisor em .NET (uma linguagem a menos; contrato nativo sem IDL) | ASSUMIDO, nao confirmado |
| **R** | Sidecar em container separado (peso de imagem, isolamento de crash, escala independente) | ASSUMIDO, nao confirmado |
