# 16 — Multiprocesso: como o produtor atravessa (item I, fechado sem asterisco)

Status: **fechado 2026-09-10**. Remove o asterisco do item **I**.
Fecha também o item **H** (sem mudança).

---

## 1. O asterisco, e por que ele cai sem checagem

`08-fission.md` fechou I com um asterisco: Fission desligado no v1, mas desligar
não garante processo único — cabeçalho COOP/COEP do site ainda força separação. O
asterisco era: *"checar se desligar também COOP/COEP mata `SharedArrayBuffer`"*.

**Decidido não desligar. O asterisco cai sem a checagem ser feita**, porque ela é
irrelevante para a decisão:

- desligar provavelmente mata `SharedArrayBuffer`, o que quebra uma classe inteira
  de site;
- e o ganho seria marginal, porque **o produtor já tolera** documento em outro
  processo — foi assim que I fechou.

Mesmo que a checagem voltasse favorável, não valeria usar. Não mexer em
`browser.tabs.remote.useCrossOriginOpenerPolicy` nem em
`useCrossOriginEmbedderPolicy`.

## 2. Não existe injeção

O produtor é **código do nosso fork, no lado de content process**. Todo content
process nasce com ele; ele apenas ativa quando recebe um documento para observar.

Não existe "injetar em processo estrangeiro", porque não existe processo
estrangeiro — o binário é nosso do começo ao fim. Esta era a pergunta que o
asterisco parecia levantar, e ela se dissolve.

## 3. A ponte

O produtor vive no content process. O socket com o supervisor pertence ao
**processo pai** (nossa aplicação embedder, item B).

```
content process  ──IPC do Gecko──▶  processo pai (embedder)  ──socket──▶  supervisor
   produtor                              dono da ponte
```

**Um socket só**, independente de quantos content processes existirem. O supervisor
não sabe e não precisa saber quantos processos há do outro lado.

Morte de content process vem de graça: o Gecko já reporta ao pai, e isso vira
`ContextDestroyed` no vocabulário fechado em `12-ponte-controle-vocabulario.md`.

## 4. Identidade não colide

Cada contexto tem espaço de id próprio, e `contextId` já está no prefixo do frame
(`CONTEXT_ID_ROOT = 1`, `0` inválido). Contexto 5 do processo A e contexto 5 do
processo B nunca se cruzam. Multiprocesso não exige nada novo do ABI.

## 5. Custo, e onde ele é medido

O hop content → pai **existe sempre**, não só no caso COOP/COEP: o DOM está sempre
em content e o socket sempre no pai.

Isso é exatamente o que o item **O** mede. Não é motivo para mudar o desenho antes
de ter número.

Alternativa descartada por ora: dar socket próprio ao content process para o plano
de dados. Evitaria o hop, mas o supervisor passaria a gerenciar N conexões com
ciclo de vida atrelado a processos que nascem e morrem. Mais complexidade por menos
clareza, contra a regra do item E.

## 6. Nota de confiança

A forma acima é o desenho padrão do Gecko e a confiança nela é alta. **O ator IPDL
específico não foi verificado na árvore** — é detalhe de implementação e não altera
o desenho.

## 7. Item H — relógio de frame, fechado sem mudança

**Continua o timer.** A alternativa (emitir no commit de style/layout do motor) foi
levantada por mim, não pelo projeto, e acopla o relógio ao ciclo de pintura —
justamente a parte que o item E pretende mexer.

Tick vazio custa zero, porque o acumulador de conjunto sujo já resolve isso. Não
havia decisão a tomar aqui.
