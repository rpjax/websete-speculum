# 10 — O que falta, e o que eu aposto que está errado

**Status:** registro honesto de lacuna. Escrito para que ninguém leia 40 arquivos e conclua
que o desenho está fechado.

---

## 1. O que está declarado mas não existe

### 1.1 A declaração de mensagens do fio

`08-fio.md` diz "um schema, três lados gerados". **Estado 2026-09:** o schema existe
(`docs/gecko-engine/redesign/schema/speculum.wire.toml`) e o `wiregen` emite C++/TS/C#.
Falta o último salto vivo nas três pontas de produto (Fase 9–10); o gen no cliente de
projeção começa na Fase 9 (`packages/page-projection/src/wire/`).

### 1.2 O formato do roteiro
`09-observabilidade.md` dá três papéis a um formato — teste, replay, oráculo — e o formato não
está especificado. Um formato servindo três donos é exatamente o tipo de coisa que parece
elegante no papel e racha no primeiro conflito de requisito.

### 1.3 O protocolo de patch — NÃO é buraco (corrigido 2026-09-21)

Eu listei isto como o maior buraco do conjunto **sem ter lido**. Lido, é o artefato mais
maduro do repositório: `docs/page-projection/spec/frame-protocol.md`, V4 CANON, 16 opcodes
lacrados em 2026-08-20, com log de decisão que passou por profiling real, bugs achados e
corrigidos, e medição em site de verdade.

Ele já contém, por princípio nomeado, tudo que estas dez iterações derivaram — e em dois
pontos está **à frente** do que eu ia propor:

| lá | aqui |
|---|---|
| **P0** tabela é a estrutura replicada; o DOM é projeção dela | o que eu ia propor |
| **P1** instrução autocontida, sem cursor nem estado implícito | idem |
| **P2** `preTableHash` como **pré-condição**: o cliente recusa aplicar se não bater | eu ia propor digest **no fim**, que só detecta depois. A pré-condição é mais forte |
| **P5** largura fixa, sem varint — **porque o orçamento é CPU por operação, não bytes** (medido) | eu teria otimizado bytes. Errado |
| **P6** uma forma de dizer uma coisa; sem `MOVE`, sem `REPLACE` | meu "mínimo e ortogonal" |
| **P7** estrito, não tolerante: desconhecido dessincroniza | idem |
| **P8** sem ramo de ciclo de vida | igual ao "não existe documento especial" |

Decisões que eu não teria tomado tão bem, todas com medição por trás: máquina de instrução
com cursor **considerada e rejeitada** (otimiza bytes, e a restrição é CPU); topologia por
`parent + prevSibling` em vez de índice posicional (posicional renumera e re-hasheia todos os
irmãos seguintes — O(n) na lista longa); `tableHash` por soma e não XOR, para matar a classe
de cancelamento por duplicata; folha e regra como linhas da **mesma** tabela e mesmo espaço de
id, uma topologia e um hash cobrindo DOM e CSSOM.

**O que ele precisa não é redesenho. São três alinhamentos:**

1. **Vocabulário.** `contextId` → `hostId` / `documentRef`. E `generation` sai do cabeçalho:
   no modelo novo, documento trocado é `DocumentRef` novo. Eles já haviam aposentado
   `EPOCH_RESET` pelo mesmo raciocínio — é o passo seguinte do mesmo caminho.
2. **Codec gerado.** Hoje é escrito à mão nos dois lados. Entra na declaração do
   `schema/`, com uma restrição dura: o gerador tem de emitir **despacho por tabela sobre
   leituras alinhadas** (P5), não um decodificador genérico. Se o gerador não conseguir, o
   gerador está errado — não o protocolo.
3. **Multi-documento.** O `OPEN-6` deles pede exatamente o que o modelo novo entrega:
   identidade, `sequence` e registro independentes por documento, e relação host↔documento
   filho explícita. Nosso redesenho **fecha** aquele item; não abre um novo.

### 1.4 A única decisão de performance ainda aberta

Interning de string (`STR_DEF`). Medido em 22% da CPU do produtor num fixture, mas naquele
fixture o conteúdo é gerado e não se repete — então 22% é teto, não estimativa. Eles
registraram o que falta para decidir: **um fixture com vocabulário de marcação realista**
(classes, tags, atributos repetidos). Sem esse número, decidir é chutar.

Sondagem em site real (Wikipedia, BBC, e-commerce com 3237 linhas): o construtor de patch não
aparece nos 25 maiores consumidores de CPU. O custo acompanha **volume de mutação**, não
tamanho de tabela. Ou seja: não há trabalho de performance pendente além deste item.

## 2. O que nenhuma iteração tocou

| assunto | por que importa |
|---|---|
| **Orçamento de memória** | a tabela de identidade cresce com o documento; DOM gigante não tem teto declarado nem política |
| **Rajada na entrada** | a saída foi resolvida por coalescência; a direção supervisor → motor nunca foi discutida sob rajada de entrada |
| **Superfície do socket** | quem pode conectar no link local? Assumido confiável, nunca escrito |
| **Ordem de boot** | `Ready`, abertura do viewport e primeira navegação estão parte aqui, parte nos docs antigos |
| **Atomicidade no cliente** | patch aplicado pela metade quando o processo morre — o protocolo define, o desenho não diz |

## 3. O que eu aposto que quebra primeiro

Apostas explícitas, para poderem ser conferidas depois:

1. **`IDocumentView` vai crescer.** Vai faltar coisa que o produtor precisa e que eu não
   antecipei. A forma vai aguentar; a lista de métodos, não.
2. **A janela em que `IEngineHost::document()` é nulo** vai ser mais bagunçada do que o doc
   sugere. Entre descartar um documento e instalar o outro há estado real, e eu o descrevi em
   uma frase.
3. **Um `Fault` urgente vai querer furar um patch de 4 MB drenando.** A regra de um envelope em
   voo não tem exceção, e essa é a primeira que alguém vai pedir. A resposta certa
   provavelmente é continuar sem exceção — mas é onde o desenho vai ser testado.
4. **A tabela de handles do CSSOM** possuída pelo processo vai ter um caso de vida que eu
   simplifiquei.

## 4. O risco de fechar aqui

Quarenta arquivos e ~3.300 linhas de especificação com **zero linha de código**. Enquanto não
há código, cada doc é hipótese bem escrita. Passado esse ponto, o volume vira passivo: quanto
mais spec sem implementação, mais caro reconciliar quando a realidade discordar.

Todo desenho nesta fase está errado em algum lugar. A única pergunta é onde, e papel não
responde.

## 5. A forma barata de descobrir

Uma fatia vertical, na ordem que maximiza aprendizado por linha escrita:

| passo | o que prova | precisa de Gecko? |
|---|---|---|
| 1. schema + codec gerado + `Framer` | §1.1, e o enquadramento sob particionamento maldoso | não |
| 2. `ILink` + `Session` + `Router`, ligar e morrer | um envelope em voo, a única porta de morte, o dump na morte | não |
| 3. engine `sim`: viewport, árvore de hosts, navegar | o modelo inteiro, sem motor | não |
| 4. produtor sobre documento simulado, publicando patch | coalescência, `isDrained`, patch no mesmo turno | não |
| 5. gravador + replay do que os passos 2–4 produziram | §1.2, e o oráculo | não |
| 6. **primeiro adaptador Gecko real** | tudo que o papel não sabe | sim |

**Os cinco primeiros passos não tocam o Gecko.** Se a sessão inteira roda no `sim` antes de
existir uma linha de fork, a arquitetura está provada; se ela brigar, o desenho está errado e
descobrir custou dias em vez de meses.

É o alvo de `01-alvo.md` sendo usado como **primeiro passo**, não como critério final.
