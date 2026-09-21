# O schema do fio

**Status:** ESTABELECIDO. Artefato de origem de três codecs.
Arquivo: [`speculum.wire.toml`](speculum.wire.toml) · modelo: [`../08-fio.md`](../08-fio.md)

---

## 1. Por que existe

Protocolo binário não diverge por causa do formato. Diverge porque **cada ponta escreve o
codec à mão**. Hoje são três implementações só no C++, mais TypeScript, mais .NET.

Aqui a declaração é a fonte e os três codecs são **gerados**. A classe de bug "os dois lados
discordam do formato" deixa de ser algo a evitar e passa a ser inalcançável.

## 2. TOML, não DSL

Um formato próprio custa um parser próprio — mais código, mais teste, sem editor. TOML tem
parser pronto nas três linguagens, lê como tabela em revisão, e diffa linha a linha.

**A simplicidade aqui é o que dá robustez:** não há parser nosso para ter bug.

## 3. Sistema de tipos — nove, e só

| tipo | fio |
|---|---|
| `u8` `u16` `u32` `u64` `i32` | little-endian, largura fixa |
| `bool` | `u8`, 0 ou 1 |
| `str` | `u32` bytes + UTF-8, sem terminador |
| `bytes` | `u32` len + cru |
| `enum<Nome>` | largura declarada, valores explícitos |
| `struct<Nome>` | campos em ordem |
| `list<T> max=N` | `u8` contagem + itens, `N ≤ 255` |

Sem união, sem opcional, sem campo com valor padrão. Campo ausente não existe: **a mensagem
ou tem o campo, ou é outra mensagem.**

É por isso que entrada não é uma mensagem com variante — são cinco mensagens
(`InputPointerDown`, `InputPointerUp`, `InputKeyDown`, `InputKeyUp`, `InputScroll`), cada uma
com exatamente os seus campos. Variante no schema significaria ramo no codec gerado, e ramo no
codec é onde mora o bug de protocolo.

## 4. Direção é o bit alto do opcode

```
0x0xxx … 0x7xxx   supervisor → motor
0x8xxx … 0xFxxx   motor → supervisor
```

`opcode & 0x8000` responde a direção sem tabela. O gerador **recusa** declaração cujo
`direction` discorde do bit — a regra deixa de depender de alguém lembrar.

Faixas por alvo, para que a leitura de um dump bruto já diga do que se trata:

| faixa | alvo | | faixa | alvo |
|---|---|---|---|---|
| `0x01xx` | sessão | | `0x81xx` | sessão |
| `0x02xx` | viewport | | `0x82xx` | viewport |
| `0x03xx` | host | | `0x83xx` | host |
| `0x04xx` | documento | | `0x84xx` | documento |
| | | | `0x8Fxx` | diagnóstico |

## 5. Envelope fixo, sem flags, sem ramo

16 bytes sempre: opcode, reservado, alvo, tamanho, correlação. `correlation = 0` significa
espontânea.

Correlação opcional custaria um bit de flag e um **ramo no decoder**, e ramo no decoder é
onde mora bug de protocolo. Quatro bytes sempre presentes são mais baratos que isso, e o
caminho quente (`Patch`) carrega payload de deltas ao lado deles.

`pairs_with` declara quem responde quem. É verificado no build e **não vai ao fio** — quem
identifica a resposta é o `correlation`.

## 6. O que o gerador recusa

Erro de build, não de runtime:

1. opcode duplicado ou ausente;
2. `direction` discordando do bit alto;
3. faixa discordando do `target`;
4. nome de mensagem, enum, struct ou campo duplicado;
5. valor de enum duplicado ou implícito;
6. tipo desconhecido, ou `list` com `max > 255`;
7. `pairs_with` apontando para mensagem inexistente, de direção igual, ou não recíproco.

## 7. O que o gerador emite

| alvo | forma |
|---|---|
| C++ | header único, `-fno-exceptions -fno-rtti`, zero alocação; `str`/`bytes` como vista |
| TypeScript | módulo sobre `DataView`, sem dependência |
| C# | `Span<byte>`, sem alocação em decode de escalar |

Todo arquivo nasce com cabeçalho de "gerado — não edite". **Não existe parte escrita à mão**:
se falta algo, muda-se o schema.

O gerador emite também o **hash do schema**, gravado no metadado de build dos três lados. Não
há negociação de versão — o par é implantado junto — mas divergência vira erro de implantação
diagnosticável em vez de mistério.

## 8. Testes do gerador

| teste | prova |
|---|---|
| round-trip por mensagem, nas três linguagens | encoder e decoder concordam |
| cruzado: C++ codifica → TS e C# decodificam | os três concordam entre si |
| vetores dourados, versionados | mudança de formato não passa despercebida |
| cada recusa da §6, uma por uma | o portão realmente fecha |
| particionamento maldoso na entrada | o enquadrador independe de fronteira de leitura |

## 9. Descartados

**9.1 DSL própria.** §2.
**9.2 União e campo opcional.** §3 — mensagem distinta é mais barata que ramo no codec.
**9.3 Negociação de versão, `schema = N`, e lista de opcodes aposentados.** As três resolvem
o mesmo problema — pontas implantadas em versões diferentes — que **este protocolo não tem**:
o par é construído e implantado junto. Roteiro gravado e vetor dourado são o único caso real
de artefato antigo encontrando codec novo, e o **hash do schema** (§7) já os recusa.

**9.5 Flags no envelope.** §5.
**9.4 Codec escrito à mão em qualquer lado.** §7.
