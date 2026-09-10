# Fission e separacao de processo

Fecha o item **I** de `07-decisoes-pendentes.md` — **com asterisco.** Ver §"Pendencia".

---

## A decisao

**Desligar Fission no v1** (`fission.autostart = false`).

Uma variavel a menos enquanto o produtor e' novo. Liga depois, quando o caminho de
`generation` ja estiver exercitado por resync.

## Detectavel pela pagina? Praticamente nao

Alocacao de processo e' detalhe de implementacao. A politica de mesma origem nao muda —
iframe cross-origin continua cross-origin dos dois jeitos. A pagina nao tem como
perguntar "estou num processo proprio?".

**Contraponto honesto, e ele nao e' zero:** Fission vem **ligado** no Firefox real.
Desligar e' divergencia do que a populacao tem. Quase certamente invisivel — mas entra
na lista do **diff de snapshot** (`03-embedder.md`), que ja e' o mecanismo que a gente
usa para achar esse tipo de coisa.

Seguranca aqui nao e' criterio: o Virtual e' browser descartavel nosso. So importa se
for detectavel por JS ou se impedir site de abrir.

## Desligar NAO garante todos os frames num processo

Verificado em `modules/libpref/init/StaticPrefList.yaml` — existem prefs de separacao
de processo **independentes** do `fission.autostart`:

- `browser.tabs.remote.useCrossOriginOpenerPolicy` (COOP)
- `browser.tabs.remote.useCrossOriginEmbedderPolicy` (COEP)
- `fission.webContentIsolationStrategy`

**Um site pode mandar header COOP/COEP e forcar separacao de processo mesmo com Fission
desligado.** E' mais raro, mas e' real, e esta sob controle **do site**, nao nosso.

### A consequencia de desenho, e e' a parte que importa

**Nao tratar "um processo = todos os frames" como invariante.**

O caminho de contexto aninhado **nao desaparece — deixa de ser o caminho comum e vira o
caminho raro.** Diferenca enorme de custo, mas nao e' zero.

Quando um frame cair em outro processo, isso e' descontinuidade de estado — que e'
exatamente para o que serve o `generation` (`08-costura.md`, secao de integridade).

**O produtor tolera frame de outro processo. Nao assume que nao existe.**

---

## (*) PENDENCIA — reabrir este tema

**Pergunta em aberto:** da' para desligar tambem as prefs de COOP/COEP e garantir
processo unico, sem quebrar nada visivel?

**O que ja se sabe:**

- As duas prefs sao `RelaxedAtomicBool`, default `true`, `mirror: always` → viraveis em
  **runtime**, sem patch e sem build. **E' one-liner de verdade.**
- Elas vivem no namespace `browser.tabs.remote.*`, que e' o de **escolha de processo**,
  nao o do DOM. Isso **sugere** que mexem so em *qual processo*, e nao em *se o
  documento e' cross-origin isolated*.

**O que NAO se sabe, e e' o que decide:**

`crossOriginIsolated` governa `SharedArrayBuffer`.

- Se as prefs so escolhem processo → desligar nao quebra nada visivel. **One-liner
  seguro.**
- Se elas tambem decidem isolamento → desligar mata SAB, e **isso a pagina ve**. Site
  que precisa de SAB quebra.

Nao foi possivel confirmar lendo o consumidor — os arquivos que leem essas prefs nao
estavam no checkout usado na investigacao. Provavel que a decisao de processo passe por
`E10SUtils` no lado JS privilegiado.

**A checagem, de cinco minutos:**

1. virar as duas prefs para `false`
2. carregar uma pagina servida com COOP + COEP
3. conferir se `self.crossOriginIsolated` continua `true`
4. conferir se `SharedArrayBuffer` continua existindo

**Passou** → o one-liner e' seguro, fecha o assunto de vez e processo unico vira
garantia.

**Falhou** → deixa as prefs quietas, e vale o plano ja desenhado: o produtor tolera
frame de outro processo.

**Nao mexer nessas duas prefs ate essa checagem rodar.**
