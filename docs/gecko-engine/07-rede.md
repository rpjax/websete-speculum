# Identidade de rede — TLS e HTTP/2

Fecha o item **M** de `07-decisoes-pendentes.md`.

---

## E' proibicao, nao tarefa

A camada de rede e' a primeira que o antibot le, **antes de qualquer JavaScript
rodar**: ClientHello do TLS (ordem de cipher, extensoes, ALPN, GREASE → JA3/JA4), e no
HTTP/2 os valores e a ordem do SETTINGS e a ordem de header e pseudo-header.

**Com Gecko isso e' de graca.** Nos usamos NSS; o Firefox usa NSS. Mesmo codigo, mesmo
ClientHello. No HTTP/2, a ordem vem do Necko, que e' o do Firefox.

Nao existe nada a construir. Existe coisa a **nao fazer**.

## As proibicoes

- **Nao mexer em pref de `security.tls.*`.**
- **Nao "endurecer" nada.** Qualquer melhoria de seguranca que a gente invente quebra a
  coerencia, porque nos afasta do que o Firefox de fabrica manda.
- **Nao trocar o NSS que o upstream builda.**
- **Nao mexer na ordem de header nem em `Accept*`.**

Regra geral: **na camada de rede, o default do upstream E' a resposta certa.** Desvio
e' bug, nao configuracao.

## A verificacao, uma vez

Captura o JA3/JA4 e o fingerprint de HTTP/2 da nossa aplicacao e compara com Firefox
de fabrica, mesma versao. Bateu, o item fecha para sempre.

Entra na baseline como campo: mudou o build ou uma pref de rede → **re-verificar**.

## Por que isto importa registrar

No plano WebKit/Linux isto era **projeto grande**: forjar o ClientHello no libsoup e no
GnuTLS para parecer Safari, e manter esse disfarce contra cada atualizacao.

E' o mesmo padrao do canvas, das fontes e do kernel (`00-decisao.md`): **a vantagem do
Gecko nao e' poder mentir melhor, e' nao precisar mentir.**

Cada camada descoberta assim e' um projeto que deixa de existir.
