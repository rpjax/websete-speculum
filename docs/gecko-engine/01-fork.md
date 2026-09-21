# Fork do Gecko — pin e politica

Lado **B** da avaliacao. O lado A (WebKit) esta em `docs/webkit-engine/`, congelado
como registro. Nada dele foi descartado.

## Pin atual

| campo | valor |
|---|---|
| remote | `https://github.com/mozilla-firefox/firefox.git` |
| tag | `FIREFOX_153_2_0esr_RELEASE` |
| commit | `feec67e62a5148b41fd017ccbbc463e8a6f9e83d` |
| serie | ESR 153 (patch 153.2.0, 2026-09-01) |
| fork | `https://github.com/rpjax/firefox` |
| checkout | `~/speculum-gecko/checkout` (ext4, **nunca** /mnt/c) |

Clone shallow medido: **266,7 s**, **5,7 GB**.

Commit verificado de forma independente em duas maquinas — bate.

## Por que ESR e nao release normal

O Firefox normal muda a cada ~4 semanas. Basear um fork nele significa rebase
perpetuo. **ESR e' o analogo do "minor par" do WebKit**: e' a linha de suporte
estendido, e' onde forks se apoiam.

Cuidado registrado: a **ESR 140 sai de suporte em 2026-09-29**. Nao pinar nela.
A ESR corrente na hora do pin era a 153.

## Politica de rebase

Mesma do lado A (`docs/webkit-engine/01-fork.md`), e vale integral:

1. Ficar na ESR pinada. Patch novo entra so por correcao que nos afeta, ou security fix.
2. Subir de ESR e' **decisao com janela agendada**, nunca inercia.
3. **Nenhum rebase sem o teste diferencial verde.** Compilar nao e' criterio.
4. Um patch, um proposito, um arquivo em `patches/`.

## O checkout nao entra no repo

Igual ao lado A. `checkout/`, `build/` e `.ccache/` sao gitignored. O repo guarda
o pin, os scripts e os nossos patches — nunca a arvore do upstream.
