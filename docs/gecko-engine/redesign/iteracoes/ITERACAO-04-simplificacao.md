# Iteração 4 — o corte: onze decisões viraram zero

**Gatilho:** "é muita coisa pra decidir" — e onze decisões abertas é sintoma, não pauta.
Desenho bom entrega decisão tomada e sobe só o que é de fato contestável.

---

## O erro de fundo: interface pequena ≠ muitas interfaces

A propriedade que o redesign persegue — compartimentalização por incapacidade — vem **do que
um componente recebe injetado**, não de quão fino o contrato está fatiado. O observador é
incapaz de emitir porque ninguém lhe entrega o link. Isso é igualmente verdade com nove portas
ou com quinze.

Fatiar mais não compra incapacidade. Compra fragmentação.

Pior: a regra certa tinha sido aplicada uma vez, na iteração 1, ao fundir ingresso de frame em
morte de peer — *"separar transforma uma ordem garantida em coordenação"* — e depois não foi
aplicada no resto.

| virou | era | por quê |
|---|---|---|
| `ILink` | `IEgressLink` + `IIngressSink` | **é o mesmo socket** — mesma vida, mesma morte, mesmo dono |
| `IDocumentView` | `IDomTree` + `ICssomTree` | mesmo escopo, mesma thread, sempre o mesmo implementador |
| `IDocumentObserver` | `IMutationSink` + `IStyleSink` | a ordem entre folha e nó importa; dois contratos viram coordenação |
| família de handles | `INavigationControl` + `IViewportControl` + `IContextTopology` + `IPeerSink` | ver iteração 5 |

## As onze decisões

| # | era | virou |
|---|---|---|
| 1 | forma do `Result<T>` | **decidida:** um `Fault` genérico para qualquer erro, sem alocação |
| 2 | forma do handle opaco | **não era decisão de arquitetura** — detalhe promovido indevidamente; template |
| 3 | neutralidade de motor | **objetivo declarado**, entregue pela regra de "nenhum tipo de motor na assinatura" |
| 4 | granularidade de porta | **decidida:** 9, pela regra acima |
| 5 | passe top-down antes de codar | meta-processo, não arquitetura; cortada |
| 6 | `sim` arnês ou engine | **ambos** |
| 7 | sequenciamento contra o w7s | **do zero**, sem preservar nada |
| 8 | saturação da fila de saída | **inexistente** — ver abaixo |
| 9 | `RetryOnce` no C++ | **não** — situacional, vai para o supervisor, igual ao resync |
| 10–11 | números (cadência, teto de streams) | afinação, não desenho |

## O achado: saturação não tinha que existir

Vazão é responsabilidade do supervisor. Se o motor não tem política de saturação, então também
não pode ter fila que cresce — senão a política existe por omissão, que é a pior forma.

A saída cai sozinha: **um envelope em voo**, e a sujeira **coalesce no ledger** em vez de
enfileirar no fio. O ledger é limitado pelo tamanho do documento, não pelo tempo. Se o anterior
não drenou, o próximo frame sai maior depois.

Sumiram quatro coisas: a fila, o teto, a decisão de política, e a thread de saída — porque
`ILink::onWritable` vem do laço de eventos que o motor já tem. Com ela some a única travessia
de thread do sistema.

## O outro achado: eu tratei o cliente como restrição sem ninguém pedir

Assumi compatibilidade com o cliente TypeScript e usei isso para justificar congelar o fio.
Ninguém pediu compatibilidade; o cliente é código da casa e muda junto. Com o fio aberto:

- **um schema, três lados gerados** — ataca a causa raiz de divergência de protocolo em vez do
  sintoma;
- uma taxonomia em vez de `Kind` **e** faixas de opcode;
- `Hello` morre (`Ready` já era a mesma mensagem);
- ativo deixa de ser sub-protocolo com byte de fase embutido;
- cabeçalho alinhado em 12 bytes;
- correlação só onde correlaciona;
- id do documento uma vez, não no envelope **e** no prefixo do frame;
- o `Fault` do domínio é a mensagem de falha do fio, sem segunda serialização.

## Volume

48 docs de contrato → **9 portas + 7 módulos**. Documentação é uma segunda base de código para
manter em sincronia; oito seções para descrever vinte linhas de função pura é dívida, não rigor.
