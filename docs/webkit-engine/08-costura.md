# A costura — onde nosso codigo encosta no WebKit

Decisao **A** de `07-decisoes-pendentes.md`. **FECHADA.**

Esta e' a decisao que fica mais caro de mudar depois: as outras se revertem, esta se
reescreve. Por isso ela vem antes da primeira linha de codigo.

---

## O problema

Nosso codigo precisa rodar dentro do WebKit. Onde a gente encosta no codigo deles, e
como o nosso codigo se conecta ali.

## O que NAO fazer, e por que

O caminho obvio e' achar os lugares onde as coisas acontecem e escrever nossa logica
ali mesmo, espalhada. Tres custos, todos permanentes:

1. **Rebase.** Cada lugar editado e' um conflito possivel quando o upstream mexer.
   Cem edicoes = cem conflitos possiveis, para sempre.
2. **Ciclo de build.** Editar um arquivo que mil outros usam reconstroi tudo. Vinte
   minutos por edicao. Voce para de testar porque testar custa caro, e o projeto morre
   de atrito, nao de bug.
3. **Legibilidade.** Logica em quarenta lugares nao e' logica que alguem le como um todo.

## A forma decidida

**Minimo possivel de pontos de contato no WebKit. Cada ponto e' so um aviso de que algo
aconteceu — sem logica, sem estado, sem decisao. Toda a logica de verdade fica em
arquivos nossos, numa pasta nossa.**

O WebKit conhece apenas uma **declaracao pequena** — um contrato minimo, em arquivo que
quase nunca muda. Ele nunca conhece nossa implementacao.

E' isso que faz a conta de build fechar: quando mexemos na nossa implementacao, o WebKit
nao recompila, porque o que ele viu nao mudou. Recompilam os nossos arquivos, e liga.

## A propriedade que mais importa: desligado = upstream

O WebKit guarda uma referencia para o nosso observador. **Se ela estiver vazia, o motor se
comporta exatamente como o upstream.**

Consequencia direta, e e' o que amarra isso ao objetivo de baseline: **com o observador
desligado, o motor E' a baseline.** Roda-se a suite do upstream na arvore modificada e
recebe-se o resultado do upstream, porque nada nosso esta registrado.

A pergunta "isso sempre esteve quebrado ou fomos nos?" continua respondivel **para
sempre**, nao so uma vez no comeco. Liga, desliga, compara.

## Reusar antes de adicionar

Onde o WebKit **ja avisa**, consumimos o aviso dele e nao adicionamos ponto nenhum.
Onde nao existe aviso, adicionamos um ponto.

**Regra: primeiro procurar se ja existe. So adicionar se nao existir.**

Verificado na arvore (`wpewebkit-2.52.6`):

- **DOM — ja existe, e com diff pronto.** `MutationRecord`, `MutationObserverInterestGroup`,
  `MutationObserverRegistration`, `ChildListMutationScope`. O motor ja calcula o que mudou,
  porque a plataforma web obriga. **Zero pontos novos no caminho de mutacao de DOM.**
- **CSSOM — existe aviso, nao existe diff pronto.** `Style::Scope` expoe
  `didChangeStyleSheetContents()`, `didChangeActiveStyleSheetCandidates()`,
  `didChangeStyleSheetEnvironment()`, `flushPendingUpdate()`. Diz "mudou neste escopo",
  nao "esta regra virou aquela". O delta fino ainda pode ser nosso — mas calculado
  **quando muda**, nao a cada N ms.
- **Invalidacao fina existe e pode valer mais que diff de regra:**
  `AttributeChangeInvalidation`, `ChildChangeInvalidation`, `ClassChangeInvalidation`,
  `IdChangeInvalidation`, `PseudoClassChangeInvalidation`. Dizem **quais elementos
  precisam recalcular**.

## Como nosso codigo le DOM e CSSOM

Nosso codigo e' C++ compilado dentro do WebKit. O DOM e' uma arvore de objetos C++ no
mesmo processo, no mesmo espaco de enderecos. **Ler e' andar em ponteiro** — o mesmo
acesso que o codigo deles tem, porque a essa altura somos codigo deles.

Hoje o `virtual.js` pergunta ao JS, que pergunta a binding, que pergunta ao objeto C++.
O port remove duas das tres camadas.

Folha de estilo e regra tambem sao objeto C++. E estilo computado — que hoje o produtor
pede propriedade por propriedade — passa a ser estrutura resolvida que se le inteira.

**Ressalva: ler e' de graca, ler no momento errado nao e'.** O motor tem momentos em que a
arvore esta no meio de uma operacao e os invariantes nao valem. Vale a regra dos ganchos
abaixo.

## Regra de cada gancho

- **uma chamada so**, sem logica
- **protegido**, para que o comportamento padrao seja o do upstream
- **colocado onde o motor ja esta em estado consistente**, nunca no meio de uma operacao
- leitura pesada acontece em **checkpoint**, nao dentro da mutacao

## Onde nosso codigo mora

Pasta propria dentro da arvore, separada do codigo deles. O upstream nunca mexe nela,
entao **conflito na nossa pasta e' impossivel.** So as poucas linhas de gancho conflitam.

## O numero que se acompanha

**Quantidade de linhas adicionadas dentro de arquivos existentes do WebKit.**

E' um numero, nao uma opiniao. Cresceu, o desenho esta se corroendo e voce ve antes de doer.
Ficou pequeno, rebase e' barato e edicao e' rapida — as duas coisas de uma vez.

Medir a cada PR do port.

---

## Acumulador de CSSOM

Decorrencia direta de "reusar antes de adicionar": no CSSOM **existe aviso, nao existe
diff pronto.** Como o delta e' nosso, o padrao e':

- **O gancho guarda apenas identidade, nunca conteudo.** Chamada O(1), sem alocacao, sem
  leitura. Compativel com a regra do gancho.
- **O delta e' calculado no checkpoint, nao no gancho.** Trabalho proporcional a mudanca,
  nao ao tempo. Cinquenta mudancas na mesma folha entre dois checkpoints = um calculo.
- **O acumulador e' um CONJUNTO de identidades sujas, nao uma lista de eventos.** Dedup
  por construcao, e imune a pergunta de ordem — nao se replica a sequencia, se **recalcula
  o estado do que sujou**.
- **A base de comparacao e' a tabela replicada** — o que o cliente ja sabe. **Nao se
  snapshota o CSSOM.** Escrito explicito porque sem isso alguem implementa snapshot dobrado.

### Risco: referencia pendurada

Guardar referencia crua e resolver depois e' o bug classico deste padrao, e e' da classe
**crash / corrupcao**, nao da classe "saiu valor errado". Se o objeto morre entre o gancho
e o checkpoint, le-se memoria liberada.

Duas saidas:

- **Referencia forte (contada)** — seguro e simples. Custo: segura vivo o que a pagina
  removeu, e pode-se calcular delta de algo que ja nao existe.
- **Identidade que sobrevive a morte do objeto** — semanticamente correto (folha removida
  aparece como *removida*, nao com o conteudo velho). Exige o item **G**.

**Consequencia: G (identidade) e' pre-requisito para o acumulador estar correto.
Nao e' decisao independente.**

### Efeito colateral bom: de-risca o H

Conjunto sujo vazio = **zero trabalho** no checkpoint. Logo o custo e' proporcional a
mudanca e nao ao tempo, e um checkpoint por timer passa a ser aceitavel.

**H (relogio de frame no commit vs timer) deixa de ser decisao critica e passa a ser
otimizacao.**

---

## Integridade e desync

### Nomenclatura adotada

Estes sao os nomes oficiais do projeto para os tres niveis de deteccao. **Ja sao os nomes
da ABI** (`00-foundation.md` §3 — o cabecalho do frame carrega `generation`, `sequence`,
`preTableHash`), entao adotar nao custa nada e mantem doc e wire falando a mesma lingua.

| nome | pergunta que responde | acao do cliente |
|---|---|---|
| **`sequence`** | perdi um frame? | detectar lacuna |
| **`hash`** | meu estado esta de fato certo? | invalidar e pedir resync |
| **`generation`** | isso ainda e' a mesma sessao de estado? | jogar tudo fora e reconstruir o applier |

**O produtor e' dono dos tres.** Nao sao opcionais e nao sao "melhoria depois".

Mecanismo, tudo ja existente e selado: `preTableHash` no cabecalho, opcode `Check`
(`scope` / `lo` / `hi` / `hash`, soma de `rowHash` sobre o escopo, e mismatch **aborta o
frame inteiro antes da fase 2**), mais `rowHash`, `tableDigest`, `domResync`, `resync`
e `snapshot` no `core/`.

### O hash obriga o produtor a manter a propria tabela

Se todo frame carrega hash da tabela, o produtor **nao pode** recalcular hash sobre a
tabela inteira a cada frame — isso e' O(tabela) por frame e mata o ganho todo do port.

E' por isso que o desenho e' **soma de hash por linha**: ele e' atualizavel
incrementalmente. Muda a linha, subtrai o hash velho, soma o novo. **O(mudanca), nao
O(tabela).**

Consequencia: **o produtor guarda a propria copia da tabela e um hash corrente.**
O produtor **nao e' stateless** — ele segura a mesma tabela que o cliente segura.

### Correcao: DOM tambem passa pela tabela

Registro do motor **nao** e' "traduz para op e esquece". O fluxo correto e':

    registro do motor -> op -> aplica na NOSSA tabela -> atualiza hash corrente -> emite

O que continua valendo e' que no DOM a tabela **nao serve para descobrir o delta** — o
registro do motor ja diz o que mudou. Ela serve para **manter o hash**.

No CSSOM ela faz as duas coisas: descobre o delta (comparando com o que o cliente ja sabe)
e mantem o hash.

### Resync e' o unico caminho de recuperacao

Nao existe reparo parcial. Cliente detectou problema, pede resync, produtor reconstroi.

Isso obriga o produtor a ter um **segundo caminho de codigo**: montar estado completo a
partir do **motor vivo**, nao incrementalmente. Sao dois produtores da mesma tabela.

### O invariante que vem de graca — e vale muito

**Os dois caminhos tem que dar o mesmo hash.**

Isso e' um detector automatico para o **maior risco de C3**: "esqueci um caminho de
mutacao" (`03-riscos.md`). Roda o incremental, roda o snapshot completo, compara o hash.
Divergiu = **existe gancho faltando**, e voce sabe *quando* aconteceu e *sobre qual
escopo*.

O hash deixa de ser so deteccao de desync no cliente e passa a ser **o teste que valida o
produtor nativo contra si mesmo**, continuamente.

Regra: esse invariante e' **assert ligado por default em build de desenvolvimento.**
Nao e' teste que se roda quando lembra.


---

## Filtro de escopo do fork

Companheiro do numero de linhas: aquele mede **quanto**, este define **o que**.

> **Modificacao no WebKit so e' aceita se for:**
> **(a)** a ponte,
> **(b)** heartbeat, ou
> **(c)** uma feature de projecao.
>
> Qualquer coisa sobre **saude, ciclo de vida, recuperacao, retry ou politica** e'
> **recusada** e sobe para o supervisor.

Checavel em code review, sem depender de julgamento. Vem do principio da marionete
(`06-runtime.md` §7.7): o WebKit nao resolve problema, ele emite.

E' isto que evita o escopo do fork inchar ao longo de anos — que e' como forks morrem.
