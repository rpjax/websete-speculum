# Fork do WebKit — pin e politica

## Pin atual

| campo | valor |
|---|---|
| remote | `https://github.com/WebKit/WebKit.git` |
| tag | `wpewebkit-2.52.6` |
| commit | `3bcefb149bd7e5645d18c3f0b9abd515b274649f` |
| objeto da tag | `0ab8bdd335d26a0c94193ac6695aeba6a481d84a` |
| lancada | 2026-08-19 |
| port | WPE |
| branch do fork | `speculum/2.52.6` |

Fonte de verdade: `webkit-engine/UPSTREAM`. **Trocar aquele arquivo e' o unico jeito de mudar a base.**

Verificado: clone na tag resolve para exatamente esse commit.

## Como escolher a serie

WebKit usa minor **par para estavel** e **impar para desenvolvimento**. Na hora do pin existiam
`2.52.6` (estavel, mais recente da serie) e `2.53.x` / `2.53.9x` (desenvolvimento e betas rumo
a 2.54). O fork **so** baseia em serie par. `fork-init.sh` aborta se o pin tiver minor impar.

## O checkout nao entra no repo

`webkit-engine/checkout/` e' materializado por `scripts/fork-init.sh` e e' gitignored. O repo
guarda o pin, os scripts e (quando existirem) os patches — nunca a arvore do WebKit.

Motivo: a arvore do WebKit e' ordens de magnitude maior que este repo inteiro, e o que importa
versionar sao **nossos patches**, nao a copia do upstream.

O clone e' `--depth 1 --single-branch`. Consequencia: **nao ha historico**. Isso e' de proposito
enquanto nao existem patches. No dia em que houver patch nosso, o clone passa a precisar de
historico para rebase — ver abaixo.

## Politica de rebase

**O imposto do fork e' agendavel, nao continuo.** Nada obriga a acompanhar o upstream. A regra:

1. **Ficar na serie estavel pinada.** Patch releases (2.52.7, 2.52.8...) entram so quando
   trouxerem correcao que nos afeta, ou por security fix.
2. **Subir de serie (2.52 -> 2.54) e' uma decisao, com janela agendada.** Nao acontece por
   inercia nem por "esta desatualizado".
3. **Nenhum rebase sem o teste diferencial verde.** Compilar nao e' o critério. O critério e' o
   stream de frames continuar byte-compativel (ver `00-foundation.md` §3). Erro de compilacao e'
   a falha barata; hook que silenciosamente para de disparar e' a caro, e so o diferencial pega.
4. **Um patch, um proposito, um arquivo em `patches/`.** Patch que mistura dois motivos e' patch
   que ninguem consegue rebasear depois.

Quando o primeiro patch nosso existir, trocar o clone shallow por um com historico suficiente
para rebase (`--shallow-since` na data da serie anterior, ou unshallow) e mover os patches para
`patches/` versionados aqui.

## Fork no GitHub

Ainda **nao** foi criado. Nao ha credencial de GitHub disponivel no shell desta sessao, e
`gh` nao esta instalado. O pin acima aponta direto para o upstream, o que e' suficiente para
`fork-init.sh` funcionar hoje.

Quando o fork no GitHub existir, ele entra como um segundo remote (`origin`), com `upstream`
seguindo apontando para `WebKit/WebKit`. O `UPSTREAM` continua descrevendo a base, nao o fork.
