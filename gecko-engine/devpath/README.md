# devpath — como se trabalha neste projeto

Escrito depois de um dia em que a gente queimou horas por um motivo bobo: o
checkout do Gecko fica fora do repo, ninguém além de quem está naquela máquina
consegue ler o código, e o diagnóstico virou adivinhação por prompt — cinco
hipóteses, cinco builds de 40 minutos, e a resposta estava em 20 linhas de diff.

Este diretório existe para que isso não se repita.

---

## As quatro regras

**1. Mexeu em arquivo do Gecko, espelha no mesmo commit.**
O checkout é descartável; o conjunto de patches no repo é a fonte da verdade do
fork. Sem ele ninguém reproduz o build e ninguém revisa o que mudou.
`./install-hooks.sh` põe isso num hook — espelho por disciplina quebra.

**2. Instrumentação e mudança de comportamento nunca no mesmo passo.**
Foi assim que a gente perdeu um bootstrap que funcionava: um diagnóstico foi
adicionado e o caminho funcional saiu junto, em silêncio. Um passo muda
comportamento, outro passo observa. Nunca os dois.

**3. Captura mora no repo, não em `/tmp`.**
E mais: **o processo de conteúdo roda em chroot** — ele não enxerga o `/tmp` do
host, e `fopen` ali falha calado. Foi isso que escondeu onze frames por horas.
O que atravessa é `stderr`; por isso o frame também sai em base64 e o
`capture.sh` extrai. É andaime: o caminho definitivo é o frame subir por IPC até
o processo pai (`docs/gecko-engine/16-multiprocesso.md` §3).
Frame capturado de página real é evidência e é teste. Em `/tmp` ele evapora e a
regressão passa despercebida.

**4. Lógica nova nasce em `speculum-wire`, não no fork.**
Lá o ciclo é de segundos e o cliente de produção é o juiz. No Gecko o ciclo é de
40 minutos. O que fica no fork é cola — leitura de árvore e nada mais.
Isso não é preferência, é o que torna o projeto iterável.

---

## Os comandos

```
./capture.sh [url] [rotulo]   # sobe o Gecko, junta frames + logs em captures/<carimbo>
./verify.sh  [captura]        # veredito do CLIENTE sobre a captura (apply estrito)
./doctor.sh  [captura]        # por que não saiu frame — em ordem, sem pular etapa
./mirror.sh                   # espelha os arquivos tocados do Gecko no repo
./install-hooks.sh            # faz o espelho acontecer sozinho
```

Sem argumento, `verify.sh` e `doctor.sh` usam a captura mais recente.

`GECKO=<caminho>` aponta para outro checkout (default `~/speculum-gecko/checkout`).

---

## O que cada um responde

**`verify.sh`** não dá opinião nossa. Ele decodifica cada frame com o
`core/decode.ts` do cliente e aplica com `applyFrameToTableChecked` — o apply
**estrito**, que valida a precondição de cada op e confere o `CHECK`. Se o
produtor emitir algo incoerente, reprova aqui pelo mesmo critério que reprovaria
em produção. Frames de documentos diferentes são agrupados por
`contextId`+`generation`, como o cliente faz.

**`doctor.sh`** existe porque "não saiu frame" tem várias causas possíveis e a
gente ficou pulando entre elas. Ele força a ordem:

0. existe processo `-contentproc`? → se não, a página não roda onde você pensa
1. existe log de documento? → se não, o attach não roda **ou o processo é chrootado**
2. existe documento com `content=1`? → se não, só chegou chrome
3. existe `[SPECULUM-FRAME]` no `stdout.log`? → é por aí que o conteúdo fala
4. existe linha de bootstrap? → se não, o bootstrap não dispara

Responda **na ordem**. Não pule para a hipótese seguinte sem fechar a anterior.

---

## Fluxo de um ciclo

```
editar → ./mach build binaries → ./capture.sh → ./verify.sh
                                              └→ ./doctor.sh   (se 0 frames)
```

Captura boa vira fixture: copie `captures/<carimbo>/frames/` para
`../speculum-wire/test/fixtures/live/` e ela passa a rodar no `run-tests.sh`.
A partir daí, regressão falha alto em vez de sumir em silêncio.
