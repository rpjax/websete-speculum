# O roteiro

**Status:** ESTABELECIDO. Formato de teste, de replay e do oráculo — **um só**.
Exemplo: [`exemplo.spec`](exemplo.spec)

---

## 1. O que é

Tudo que entra no domínio entra por porta. Então a lista de **eventos de entrada** é a
descrição completa do que aconteceu, e reexecutá-la reproduz a saída exatamente.

```
produção    engines/gecko + gravador  →  roteiro.spec
reprodução  engines/sim   + roteiro.spec  →  os mesmos bytes, em milissegundos
```

Três papéis, um formato. Três formatos divergiriam.

## 2. Entrada e saída no mesmo arquivo

```
> evento de entrada        o que o mundo fez
< saída esperada           o que o sistema tem que produzir
@ tempo                    avanço do relógio, em ms monotônicos
! diretiva                 metadado do arquivo
#                          comentário
```

Intercalado, não em dois arquivos: **a divergência aparece na primeira linha `<` que não
bate, com a causa nas linhas `>` logo acima.** É a linha do diff que responde a pergunta.

## 3. Símbolos, nunca endereços

Handle de produção é ponteiro. No roteiro vira símbolo sequencial, atribuído pelo gravador na
ordem de aparição:

| prefixo | o quê | | prefixo | o quê |
|---|---|---|---|---|
| `p` | processo | | `n` | nó |
| `v` | viewport | | `s` | folha |
| `f` | frame | | `r` | regra |
| `d` | documento | | `t` | timer |
| `x` | stream de ativo | | | |

Sem isso não há replay — e, de brinde, dois roteiros do mesmo cenário ficam idênticos byte a
byte, então o diff serve para comparar execuções.

## 4. Eventos

Nome pontuado, com o prefixo dizendo a porta de origem. Sem evento genérico: se não está na
lista, não entra no domínio.

### Entrada
| evento | argumentos |
|---|---|
| `link.in` | `<Mensagem> <alvo> <campos…>` — mensagem já decodificada |
| `link.raw` | `<hex>` — bytes crus, para exercitar o enquadrador |
| `link.writable` | — |
| `link.broken` | — |
| `host.process.attach` \| `.gone` | `p1` |
| `host.viewport.open` \| `.close` | `v1 f1 1280x720` |
| `host.frame.attach` \| `.detach` | `f2 parent=f1 viewport=v1` |
| `frame.load.start` \| `.stop` | `f1 [ok\|fail]` |
| `frame.location` | `f1 "url"` |
| `frame.document.install` \| `.discard` | `f1 d1 process=p1` |
| `frame.prompt.request` \| `.abandon` | `f1 req=3 kind=Dialog <hex>` |
| `doc.child.insert` \| `.removing` | `d1 parent=n1 child=n5` |
| `doc.attr` | `d1 n5 ns=0 name=class` |
| `doc.text` | `d1 n7` |
| `doc.node.destroy` | `d1 n5` |
| `doc.shadow.attach` | `d1 host=n5 root=n6` |
| `doc.sheet.add` \| `.remove` \| `.applicable` | `d1 s2 [owner=n3]` |
| `doc.rule.add` \| `.remove` \| `.text` | `d1 s2 r7` |
| `doc.childframe.attach` \| `.detach` | `d1 host=n9 f2` |
| `doc.closing` | `d1` |
| `clock.fire` | `t1` |
| `asset.chunk` \| `.end` \| `.error` | `x1 offset=0 <hex>` |

### Saída
| evento | argumentos |
|---|---|
| `link.out` | `<Mensagem> <alvo> <campos…>` |
| `patch` | `d1 seq=4 <hex>` |
| `fault` | `<Código> origin=… <chaves>` |
| `clock.arm` \| `.cancel` | `t1 +16` |
| `asset.open` \| `.cancel` | `x1 "url"` |

Bytes acima de 256 vão para `blobs/<sha256>.bin` e a linha carrega `#<sha256>`. O arquivo
continua legível.

## 5. Diretivas

```
!roteiro 1
!schema  9f3a1c2b…     hash do schema do fio; replay recusa se não bater
!seed    1             qualquer fonte pseudoaleatória
```

## 6. O que torna replay possível

Cada item já é invariante do desenho. O roteiro só cobra:

1. **Nenhum relógio de parede.** Só `IClock`, dirigido por `@`.
2. **Nenhum ponteiro em valor observável.** Identidade é id mintado, não endereço.
3. **Nenhuma iteração sobre contêiner sem ordem.** O ledger drena em ordem estável e definida.
4. **Nenhuma thread.** Uma só, e nenhuma travessia.
5. **Nenhuma aleatoriedade** fora de `!seed`.

Quebrar qualquer um quebra o replay — e é por isso que o roteiro também **prova** que os cinco
valem: um cenário que reexecuta idêntico é a evidência.

## 7. Modos

| modo | faz |
|---|---|
| `check` | roda contra `engines/sim` e compara com as linhas `<`. É o teste |
| `record` | roda contra `engines/gecko` e emite `>` e `<`. É o replay e o vetor dourado |

O oráculo é os dois: `record` no Gecko, `check` no sim, mesmo arquivo.

## 8. Custo declarado

O gravador escreve tudo que atravessa porta — **inclusive conteúdo de página**. Ferramenta de
laboratório, ligada por parâmetro de lançamento, nunca padrão.

## 9. Descartados

**9.1 Formato binário.** Compacto e ilegível no diff, e o diff é metade do valor.
**9.2 Arquivos separados de entrada e esperado.** §2.
**9.3 Evento genérico (`port.call <nome> <args>`).** Fecharia a lista e mataria a validação —
um evento que o domínio não conhece deixaria de ser erro de parse.
**9.4 Gravar bytes crus por padrão.** `link.in` decodificado lê melhor; `link.raw` existe para
o caso específico do enquadrador.
