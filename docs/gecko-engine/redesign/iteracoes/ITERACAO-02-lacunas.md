# Iteração 2 — lacunas encontradas ao percorrer os fluxos reais

**Passo:** pegar cada mensagem do vocabulário de controle e segui-la de ponta a ponta,
perguntando em cada trecho "quem é dono disto?". Trecho sem dono é lacuna.

---

## L1 — Ninguém era dono do enquadramento de entrada

O desenho tinha `IIngressSink` entregando bytes e `ControlCodec` decodificando mensagem.
Entre os dois falta o passo que importa: **bytes chegam picados em fronteira arbitrária.**
Um `onBytes` pode trazer meio header de 9 bytes, ou três envelopes e meio.

Sem dono nomeado, essa remontagem acaba dentro de quem recebe — que é como um god-object
começa, sempre.

**Mudança:** criado [`EnvelopeAssembler`](../contratos/dominio/wire.md), com a
propriedade que vira teste: *para todo particionamento do fluxo, a sequência de envelopes
entregues é a mesma.*

## L2 — Ninguém era dono da morte de processo de conteúdo

Frames sobem de N processos de conteúdo. Um deles morre. No desenho inicial não havia
contrato que anunciasse isso, e o tratamento cairia inevitavelmente dentro do registro de
contexto como consulta ad-hoc.

**Mudança:** criado [`IPeerSink`](../contratos/portas/IHostObserver.md), e
`ContextRegistry::contextsOfPeer` para que a limpeza seja operação exata em vez de varredura.
Invariante adicionada: morte de peer destrói seus contextos **exatamente uma vez**.

## L3 — Saturação da fila de saída não tinha política — e ainda não tem

Os docs de protocolo afirmam "vazão alta é requisito" e "sem bloqueio de cabeça de fila", mas
nenhum deles responde: **e quando o consumidor é mais lento que o produtor por tempo
suficiente?**

Uma fila sem limite troca uma falha visível por consumo de memória até o OOM — o pior modo de
falha possível, porque não tem sintoma até ser terminal.

As três saídas são incompatíveis e a escolha é de política:

| saída | ganha | perde |
|---|---|---|
| matar a sessão | falha visível, imediata, com causa | derruba sessão que talvez se recuperasse |
| descartar frame coalescível (nunca controle) | sessão sobrevive a um pico | cliente dessincroniza; exige resync |
| contrapressão no produtor | nada é perdido | reintroduz acoplamento da saída no caminho quente |

**Mudança:** o campo `Rejected_Saturated` existe no contrato de
[`EgressQueue`](../contratos/dominio/session.md) e a decisão foi registrada como aberta
em `../05-decisoes-abertas.md`. Não é decidida por omissão.

## L4 — `Fault` como `[[noreturn]]` contradiz o próprio protocolo

`FailCatalogued` aborta o processo. O ABI de controle diz que `Fault` não derruba nada por si
e que quem decide é o supervisor. O mecanismo atual contradiz o contrato atual.

**Mudança:** [`FaultReporter`](../contratos/dominio/fault.md) produz valor; a morte
tem uma porta só, em [`SessionLifecycle`](../contratos/dominio/session.md).
Invariante de camada: **nenhum `[[noreturn]]` em `domain/`.**

## L5 — Pedido de diálogo pendente vazava

`IPromptSink` anunciava o pedido, o supervisor respondia. Faltava o caso real: a página some
com o pedido pendente (navegação, fechamento de contexto). Sem nada, o `RequestId` vaza e o
supervisor espera para sempre.

**Mudança:** `onPromptAbandoned` no contrato, e `CorrelationRegistry::forgetContext`.
Invariante: todo pedido termina em resposta **ou** abandono, nunca nos dois.

## L6 — `<style>` vs `<link>` era política no lugar mais acoplado do sistema

A regra de double-emit vive hoje dentro do header de hook do motor. É política de produto no
arquivo mais próximo do Gecko que existe, e é intestável ali.

**Mudança:** movida inteira para
[`ProjectionPolicy`](../contratos/dominio/projection.md) — funções estáticas, totais,
com tabela-verdade completa como teste.

---

> **Nota de arquivo.** Esta iteração é anterior às iterações 4 e 5. Os nomes de
> componente citados aqui foram consolidados desde então; os links apontam para onde a
> responsabilidade vive hoje. Os **achados** continuam válidos — foi por eles que o
> desenho chegou onde chegou.
