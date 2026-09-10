# O embedder no Gecko

Fecha o item **B** de `07-decisoes-pendentes.md`, na forma que a troca de motor
reabriu.

---

## O problema da traducao

O WPE dava uma **biblioteca para linkar**. O Gecko da' uma **aplicacao para buildar**.

Mecanismo confirmado na arvore: `--enable-application` / `MOZ_BUILD_APP`
(`build/moz.configure/init.configure`). O Gecko builda uma aplicacao nomeada a partir
da arvore; o `browser/` (Firefox) e' uma delas.

## A decisao

**Nossa propria aplicacao na arvore, ao lado do `browser/`.**

Descartadas:

- **Firefox headless de fabrica, domado por prefs** — carrega o frontend inteiro
  (aba, session restore, addon manager, sync, updater, telemetria, first-run) e
  obriga a suprimir um por um sem garantia de ter achado todos.
- **Dirigir Firefox stock por Marionette** — e' exatamente a superficie de automacao
  que o port existe para eliminar.

## Regra do que se arranca

Mesma regra do item **E**: **corta por observabilidade.**

- **Arranca** o que a pagina nao ve: UI de aba, session restore, sync, addon manager,
  updater, telemetria, first-run.
- **Mantem** tudo que a pagina ve, mesmo parecendo entulho de produto. Parte da
  superficie visivel e' ligada por componente de frontend (registro do pdf.js decide
  `navigator.pdfViewerEnabled`, protocol handlers, etc.).

Motivo: nossa vantagem de fingerprint e' **"a gente E' um Firefox"**. Arrancar demais
e' deixar de ser.

## Fingerprint: configuracao, nao forja

**Nos somos o browser e somos donos do binario. Nao existe nada a forjar — existe
configuracao a fazer.**

E toda a logica de projecao mora dentro do binario, entao nao ha injecao vinda de fora
para alguem detectar.

O que o modo headless entrega de errado sao **valores default**, nao capacidades
ausentes:

| valor | headless entrega | um browser real |
|---|---|---|
| `outerHeight` vs `innerHeight` | iguais | outer maior, pela altura do chrome |
| `screen.avail*` vs `screen.*` | iguais | avail menor, pela barra de tarefas |
| `screenX` / `screenY` | 0, 0 | posicao qualquer, crivel |
| `devicePixelRatio` | 1 | coerente com a tela alegada |
| tamanho de tela | virtual padrao | de um monitor de verdade |
| lista de fontes | curta | a de um desktop |
| `(hover: hover)`, `(pointer: fine)` | — | descrevem um mouse existindo |

**O que importa nao e' cada valor isolado, e' a coerencia entre eles.** `outerHeight`
maior que `innerHeight` por ~74 px e' um navegador; por 0 e' um robo; por 3 px e' um
robo mal disfarcado.

Isso amplia o item **D**: a persona inclui **geometria de janela e a relacao entre os
valores**, nao so strings de `navigator` e `screen`.

E amarra com a decisao de producao sem GPU: a persona alegada tem que ser um desktop
plausivel **rodando software rendering** — existe e e' populacao real (GPU bloqueada,
driver ruim).

## Como derivar a lista sem chutar

> **diff(Firefox com cabeca, Firefox headless) = a lista do que a nossa aplicacao
> tem que configurar.**

Roda os dois, compara o que a pagina ve, e o que diferir e' o backlog. Uma vez.

Nao e' lista que alguem tenta lembrar, e nao e' teoria. E' mecanica.

**A referencia e' o Firefox COM CABECA num desktop de verdade** — nao o headless de
fabrica, porque headless e' ele mesmo uma impressao digital, e ruim.

## Layout de processo

- **Processo pai da nossa aplicacao** = o papel do embedder. A ponte de controle mora
  aqui; e' o processo que o supervisor sobe e com quem ele fala.
- **Produtor no processo de conteudo**, alcancado pelo IPC do proprio Gecko — a estrada
  que ja existe e que nao e' nossa para manter.
- **Supervisor passa o endereco da ponte no argv.** Com aplicacao propria, somos donos
  do argv.
- A aplicacao abre **exatamente um** browsing context, sem aba, e reporta pronto.
  "Standby" e' nome que o **supervisor** da', nao estado que ela conhece
  (`06-runtime.md` §7.7 — principio da marionete).

## Ganho que nao estava previsto

Nao precisamos inventar superficie headless nem caminho de input. O
**`HeadlessWidget` ja existe e ja sintetiza input nativo, incluindo touch**
(`02-costura-evidencia.md` §7).

Parte do **C2** vem junto com a escolha da aplicacao, de graca.
