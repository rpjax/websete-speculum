# `domain/interaction` — entrada

**Escopo:** chamada (tudo puro) · **Thread:** main

Todo este módulo é lógica pura. Nenhum componente aqui é contrato — nenhum cruza fronteira de
motor, nenhum precisa de injeção de falha, nenhum tem segunda implementação.

**É a prova de que a fronteira antiga era resíduo histórico, não desenho:** hoje `InputHit.h`,
com 30 linhas de aritmética trivial, tem teste; e `LegacyKeyCode`, com 66 linhas de tabela
pura e alta densidade de bug, não tem — só porque mora num arquivo que precisa de libxul.

---

## `Decoder` — payload → gesto

```cpp
enum class GestureKind : uint8_t { PointerDown=1, PointerUp=2, KeyDown=3, KeyUp=4, ScrollSet=5 };
struct Gesture { GestureKind kind; NodeId node; Fraction x, y; MouseButton button; KeyStroke key; };
Result<Gesture> decode(Reader&);
```

Frações `0…65535` mapeando `[0,1]`, origem no canto superior esquerdo da caixa do nó. **Sem
pixel inventado em nenhum ponto do caminho.** `node == 0` significa viewport em `ScrollSet`, e
não aplica em ponteiro.

Nenhum default escondido: campo ausente é falha, nunca valor assumido. Tipo fora do conjunto
não aplica e **não derruba a ponte** — é rejeição catalogada.

## `KeyMap`

```cpp
static uint32_t   legacyKeyCode(std::string_view key, std::string_view code);
static bool       isPrintable(std::string_view key);
static Modifiers  modifiersOf(uint8_t bits);   // ctrl shift alt meta
```

Tabela pura. `0` para tecla sem equivalente legado é resposta válida, não falha.
**Teste:** tabela completa, incluindo `Dead`, `Unidentified` e teclado numérico com e sem
NumLock.

## `HitGeometry`

```cpp
static Point    pointIn(const Box&, Fraction x, Fraction y);
static Fraction toFraction(float normalized);   // satura em [0,1]
```

Centro é `32768, 32768` — o valor usado quando o fio não traz coordenada local. Saturação nas
bordas, nunca envolvimento. Arredondamento definido, não dependente de modo de FPU.

## `FormEdit`

```cpp
struct EditState  { std::string_view value; uint32_t selStart, selEnd; };
struct EditResult { std::string value; uint32_t selStart, selEnd; bool changed; };
static EditResult apply(const EditState&, const KeyStroke&);
```

Existe porque evento de teclado sozinho frequentemente não insere em `<input>` e
`<textarea>`. A correção é real e precisa existir; o que o desenho recusa é ela ficar
escondida dentro do despacho de tecla, virando comportamento implícito que ninguém aponta num
arquivo.

Trabalha em **code points**, não em bytes. Cobre imprimível, `Backspace`, `Delete`,
`Home`/`End`, setas, e seleção não vazia sendo substituída.

## `Admission`

```cpp
enum class Rejection : uint8_t { None, UnknownKind, NoIdentity, NodeGone, NotElement,
                                 DocumentHalted, NoViewport };
Rejection admit(const Gesture&, const Identity&, const IDocumentView&);
```

Consulta **pura**: não muta, não despacha.

Todo caminho termina em `InputAdmitted` ou `InputRejected` catalogado. **Não existe gesto que
some em silêncio** — silêncio é o modo de falha mais caro de diagnosticar num sistema de
entrada remota.

`DocumentHalted`: entrada durante halt é rejeitada, não enfileirada. Enfileirar produziria
gesto aplicado fora de ordem em relação ao que o usuário viu.

Nenhuma rejeição escala para falha de sessão.
