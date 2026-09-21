# IEngineHost

**Tipo:** contrato/dirigida · **Escopo:** host · **Thread:** main (processo pai) · **Camada:** ports

## Responsabilidade
Um **slot** na árvore do viewport: sua posição, e as ordens que trocam o que está dentro dele.

## Não é responsável por
- ler ou observar conteúdo — isso é do documento que está nele agora
- decidir se a ordem faz sentido no estado atual (`NavigationState`)
- sobreviver ao viewport
- conhecer o fio

## Contrato
```cpp
struct IEngineHost {
  virtual HostId    id() const = 0;
  virtual HostId    parent() const = 0;        // 0 = raiz de um viewport
  virtual ViewportId viewport() const = 0;
  virtual bool       isAlive() const = 0;
  virtual void       forEachChild(HostVisitor&) const = 0;

  virtual IEngineDocument* document() = 0;      // o de agora; troca ao navegar
  virtual void             attach(IHostObserver*) = 0;

  virtual Result<void> navigate(std::string_view url) = 0;
  virtual Result<void> reload() = 0;
  virtual Result<void> stop() = 0;
  virtual Result<void> historyGo(int32_t delta) = 0;
  virtual Result<void> resize(Extent) = 0;
  virtual ~IEngineHost() = default;
};
```

## Semântica
- **O frame é o que sobrevive à navegação.** No motor é o contexto de navegação canônico, do
  lado do processo pai; o documento é o que está carregado nele agora, do lado de um processo
  de conteúdo. Por isso navegar mora aqui: antes morava num objeto que a própria operação
  destrói.
- `document()` devolve nulo entre a destruição de um e a criação do outro — estado normal,
  curto, não é erro.
- **Todo host navega**, raiz ou não, porque iframe navega. Não existe operação que só a raiz
  aceite, logo não existe checagem de "sou a raiz" para alguém esquecer.
- `parent() == 0` é posição, não categoria.
- Isolamento por site pode trocar o processo do documento ao navegar. O frame fica; o
  documento muda de lado. Nada aqui precisa saber disso.
- Sucesso significa **aceite**, não conclusão.

## Falhas
Por `Fault`: `NoSuchFrame`, `FrameGone`, `MalformedUrl`, `NavigateRefused`, `ResizeRefused`.
Nenhuma é fatal.

## Invariantes
1. `id` é estável por toda a vida do slot, atravessando quantas navegações houver.
2. Nenhuma operação daqui lê ou muta conteúdo.
3. Fechar um host fecha a subárvore, atravessando processos.
4. O observador anexado morre com o host.

## Testabilidade
O `sim` constrói árvores de qualquer profundidade. O teste central: **o mesmo roteiro aplicado
à raiz e a um host de terceiro nível produz a mesma sequência de efeitos** — a prova mecânica
de que não há caso especial.

## Colabora com
[IEngineDocument](IEngineDocument.md) · [IHostObserver](IHostObserver.md) · [documents](../dominio/documents.md)
