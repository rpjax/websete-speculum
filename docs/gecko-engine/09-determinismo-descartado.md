# Determinismo / replay — DESCARTADO

Fecha o item **L** de `07-decisoes-pendentes.md`. **Nao adiado — descartado.**

Este doc existe para o tema **nao voltar**.

---

## O que era a proposta

Ser dono do motor significa ser dono dos relogios, do RNG, da ordem de chegada de rede
e do agendamento de tarefa. Logo daria para fazer sessao reproduzivel: mesma entrada →
mesma saida, sempre. E replay: gravar as entradas e rodar de novo identico.

Foi apresentada como "a maior alavancagem tecnica da lista".

## Por que esta errado

**A projecao nao e' re-execucao. E' replicacao de estado observado.**

O cliente **nao roda a pagina**. Ele nao re-deriva nada. Ele recebe "a arvore agora e'
assim" e aplica. **Nao existe nada a reproduzir.**

Seja o que a pagina fez — aleatorio, timing, ordem de rede — o produtor **observou o
resultado real** e emitiu. O trabalho do cliente e' casar com aquele resultado
observado, nao chegar nele por conta propria.

Logo a sequencia de mutacao ser diferente entre execucoes e' **irrelevante**: nunca
precisamos que duas execucoes concordem.

## O que a gente precisa de verdade, e ja tem

**Que o produtor e o cliente da MESMA execucao concordem.**

E' exatamente o que o `hash` garante (`08-costura.md`, secao de integridade). O hash e'
**por-execucao**. Determinismo faria execucoes **diferentes** concordarem — problema que
nao existe aqui.

O teste diferencial (incremental contra snapshot completo) tambem e' **dentro de uma
execucao**, sobre a mesma arvore viva. Nao depende de determinismo.

## De onde veio o erro

**Conveniencia de debug.** Replay ajuda a reproduzir bug intermitente — e a sessao em
que a proposta nasceu foi uma caca a bug de timing.

Mas isso e' **ferramenta de desenvolvedor, nao requisito de arquitetura.** A
conveniencia foi inflada em pilar de desenho.

## Se alguem quiser gravar/replayar depois

E' decisao de **ferramenta**, nao de arquitetura. Nao amarra nada no desenho, nao pede
costura reservada, e nao justifica tocar em relogio nem em RNG dentro do fork.

Tocar nessas fontes espalhadas pelo motor briga direto com a regra do item **A** —
minimizar a superficie do fork — e nao compra correcao nenhuma que o `hash` ja nao de'.
