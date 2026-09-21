# Iteração 3 — teste de estresse do desenho por cenário

**Passo:** pegar quatro situações reais e caras e caminhar por elas contrato a contrato,
perguntando em cada passo: *algum componente precisa saber de algo que ele não deveria saber?*

Resposta positiva significa fronteira errada. É o único jeito honesto de validar
decomposição antes de existir código.

---

## Cenário A — navegação comita durante a montagem de um frame

**Caminho:** `INavigationSink::onLoadStop(true)` chega enquanto `FrameBuilder` está entre
`beginFrame` e `endFrame`.

**O desenho aguenta?** Aguenta, e por um motivo que não foi planejado para isto: a projeção
tem escopo **documento**. O documento morrendo destrói os componentes de projeção — não há
limpeza manual de sete estruturas, há destruição de objeto. É o mesmo raciocínio de
teardown por tempo de vida que já foi decidido no runtime da projeção, aqui obtido de graça
pela declaração de escopo.

**Mas apareceu um buraco.** Um frame construído com a geração *N* não pode ser enfileirado
depois de a geração virar *N+1*. Nada no desenho proibia isso, porque `endFrame` e
`enqueue` eram passos separados e nada dizia que aconteciam no mesmo turno.

**Mudança:** invariante nova, em `FrameClock` e `EgressQueue` —

> Um frame é enfileirado no **mesmo turno** em que é fechado. Não existe frame fechado
> guardado para enfileirar depois.

Sem isso, a geração no carimbo e a geração vigente podem divergir por um intervalo, e o
cliente recebe um frame de uma instalação que já morreu — divergência silenciosa, o pior
tipo.

---

## Cenário B — a ponte rompe no meio de um stream de ativo

**Caminho:** `IEgressLink::write` devolve `Broken` enquanto `AssetStreamMachine` está em
fase `Chunk`, com três streams vivos em dois contextos.

**O desenho não aguentava.** As fases definidas pelo protocolo são `request`, `chunk`,
`denied`, `complete`. Não existe fase para "acabou sem ter sido negado nem completado". O
stream ou fica vivo para sempre no registro, ou é encerrado como `complete` com bytes
faltando — as duas opções mentem.

**Mudanças:**
1. Fase `Cancelled` em `AssetStreamMachine`. Terminal, e **local**: não viaja no fio, porque
   quando ela acontece a ponte já morreu. Existe para que a limpeza seja correta e afirmável.
2. `AssetRegistry::cancelAllOfContext` e `cancelAll`, ambos idempotentes, chamados na
   destruição de contexto e na terminação de sessão.
3. Invariante: `liveCount() == 0` depois de `cancelAll()` — asserção de teste, não esperança.

Vazamento de stream é invisível em produção até virar consumo de memória. Este cenário é o
que o transforma em linha de tabela.

---

## Cenário C — iframe nasce e morre dentro de um intervalo de frame

**Caminho:** host aninhado criado, `NestedContextMinter::mint()` emite `C=7`, o host é
removido antes do primeiro flush.

**O desenho aguenta**, mas revela uma **propriedade do protocolo que não estava escrita**:
como o minter nunca reusa id, `C=7` é consumido e jamais aparece no fio. O espaço de
`contextId` tem buracos.

**Mudança:** registrado explicitamente em
[`NestedContextMinter`](../contratos/dominio/documents.md) como propriedade, não
defeito, com a consequência nomeada: **o supervisor precisa tolerar lacunas na numeração.**

A alternativa — reusar id de contexto morto — foi considerada e recusada: abriria a
possibilidade de um frame atrasado de um contexto morto ser aceito como sendo de outro vivo.
É a classe de bug mais cara que este sistema consegue produzir, e custa um `uint32_t` para
tornar impossível.

---

## Cenário D — dois `Navigate` em rajada, o segundo antes de o primeiro comitar

**Caminho:** `navigate(A)` → `onLoadStart` → `navigate(B)` → `onLoadStop(true)`.

**O desenho quase aguentava.** A tabela de transição já trata `qualquer → navigateRequested`
cancelando a pendência anterior. Mas ninguém removia a correlação do primeiro pedido: ela
ficaria pendente para sempre, e um `Navigated` para A nunca sairia — sem que nada reclamasse.

**Mudança:** a máquina de estado devolve a correlação cancelada, para que o serviço acima a
esqueça no `CorrelationRegistry`. A contagem de pendências volta a fechar, e
`pendingCount() == 0` ao fim de uma sessão limpa vira asserção válida.

**Observação de método:** foi a asserção de contagem que revelou o vazamento, não a leitura
do código. Invariante numérica verificável encontra o que revisão não encontra — vale
preferi-la a invariante em prosa sempre que der.

---

## Saldo das três iterações

| iteração | achados | mudanças de desenho |
|---|---|---|
| 1 — granularidade | interface ≠ unidade pequena | 48 interfaces → 15 contratos + 33 componentes; regra do escopo de vida |
| 2 — lacunas | 6 trechos sem dono | `EnvelopeAssembler`, `IPeerSink`, `onPromptAbandoned`, falha como valor, política movida |
| 3 — cenários | 4 cenários, 3 furos reais | enfileiramento no mesmo turno, fase `Cancelled` + limpeza, lacuna de id documentada, correlação cancelada |

Nenhuma das três encontrou um componente que precisasse saber algo que não deveria — o que é
o sinal de que a decomposição está no lugar certo. Encontraram **trechos sem dono**, que é o
defeito barato de consertar antes de existir código e caro depois.

---

> **Nota de arquivo.** Esta iteração é anterior às iterações 4 e 5. Os nomes de
> componente citados aqui foram consolidados desde então; os links apontam para onde a
> responsabilidade vive hoje. Os **achados** continuam válidos — foi por eles que o
> desenho chegou onde chegou.
