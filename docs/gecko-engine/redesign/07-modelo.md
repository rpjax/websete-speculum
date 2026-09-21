# 07 — O modelo: multi-documento primeiro

**Status:** EM DESENHO. Substitui a identidade de contexto dos docs 12/17 inteiramente.

---

## 1. Não existe documento especial

O desenho anterior tratava a aba como **categoria** — `contextId = 1`, só ela no registro, só
ela anunciando nascimento, `parentContextId` sempre zero, campo vestigial que nunca carregou
informação — e o iframe como **exceção**: mintado, não registrado, sem anúncio, com o id
guardado num campo do motor.

Dois mecanismos de identidade para a mesma coisa, e uma pergunta que todo caminho do código
precisava fazer: *"isto é a raiz?"*. Toda pergunta dessas é um lugar onde a resposta pode estar
errada.

**O modelo novo não tem a pergunta.**

```
Sessão
 ├─ Viewport                    um retângulo com uma árvore de FRAMES
 │   └─ Host (raiz) ── Documento        o slot, e o que está carregado nele agora
 │       ├─ Frame ── Documento           iframe — mesma coisa, outra posição
 │       │   └─ Frame ── Documento
 │       └─ Frame ── Documento
 └─ Viewport …                  N desde o primeiro dia, sem ramo novo
```

**Frame é o slot; documento é o conteúdo.** Navegar troca o documento do host, não o host —
é assim que o motor funciona (o contexto de navegação sobrevive, o documento não) e é assim
que a plataforma web fala. O desenho anterior tinha um `generation` que sobrevivia à
destruição do documento: o tipo mentia, e `generation` existia para consertar a mentira por
fora. Ver [iteração 7](iteracoes/ITERACAO-07-frame-e-documento.md).

Raiz é **posição na árvore**, não tipo. Todo host tem a mesma identidade, o mesmo ciclo de
vida, e navega — porque iframe navega. Todo documento tem a mesma projeção. Toda operação toma um documento;
as que fazem sentido em subárvore tomam um host **e um alcance** (`Self` ou `Subtree`),
o que apaga a assimetria antiga entre "halt é de aba" e "flush é de contexto".

A linguagem do domínio deixa de ser "aba e contexto" e passa a ser **viewport, documento,
árvore**. Ninguém precisa traduzir nada.

Efeito colateral de graça: **N viewports desde o primeiro dia.** O V1 abre um, e nenhuma linha
do domínio sabe disso, porque não existe ramo "o viewport" contra "os viewports".

## 2. Dois eixos que não se misturam

Um documento aninhado pode viver em **outro processo** (isolamento por site), e navegar pode
trocar o processo de um documento sem trocar o host. Há então duas
relações, e confundi-las é a origem clássica de bug nesta classe de sistema:

| eixo | relação | responde |
|---|---|---|
| **posse** | processo → documentos | quem morre com quem |
| **estrutura** | frame → frame pai | quem está dentro de quem |

Declarados separados, nenhum implícito. `IDocumentView::childHostOf` é a **única** operação
que cruza de estrutura de nó para estrutura de frame — existir um lugar só para isso é o
que impede o cruzamento de virar implícito.

## 3. Processo é um objeto que se possui

Cada processo de conteúdo é um **handle vivo**: um objeto que implementa `IEngineProcess` e é
dono dos documentos que vivem nele.

Isso troca um invariante por um fato:

> **Antes:** *"morte de processo destrói seus documentos exatamente uma vez"* — invariante que
> precisa de teste, de cuidado, e de alguém lembrando de chamar a limpeza na ordem certa.
>
> **Agora:** o handle é destruído. Os documentos eram dele. Morreram.

Não há rotina de limpeza a esquecer nem ordem a errar. E some a categoria inteira de erro
"documento cujo processo já morreu": ela é **inalcançável**, porque o único caminho até o
documento passa pelo processo.

O mesmo mecanismo resolve o observador: ele é anexado **ao documento** e morre com ele. Não há
`detach` a lembrar.

**Processo nunca aparece no fio.** É detalhe de como o motor arruma as coisas por dentro; o
supervisor fala viewport e documento, que é linguagem de domínio. Morte de processo chega ao
supervisor como o que ela significa para ele: uma leva de documentos fechados.

## 4. Ler, ser avisado, agir — três capacidades separadas

É onde a incapacidade vira estrutura, e é o motivo de o handle de documento ser fatiado:

```cpp
IEngineHost                           // AGIR no slot — navegar, recarregar, redimensionar
  ├─ document() → IEngineDocument*     // o conteúdo de agora
  │     ├─ view()  → const IDocumentView&   // LER — DOM e CSSOM
  │     ├─ attach(IDocumentObserver*)       // SER AVISADO — mutação
  │     └─ dispatch(gesto)                  // AGIR no conteúdo
  └─ attach(IHostObserver*)           // SER AVISADO — carga, diálogo, troca de documento
```

A projeção recebe **quatro coisas**: `const IDocumentView&`, `IClock`, `IPatchUplink`, e a si
mesma como `IDocumentObserver`. É a lista inteira de portas do seu diretório — logo a
incapacidade deixa de ser argumento e vira algo que se confere com um `ls`. Ela não tem
`IEngineHost` nem `IEngineDocument`: não navega, não redimensiona, não despacha entrada.

Por isso `IDocumentView` continua separado mesmo sendo sempre o mesmo objeto por trás: **a
separação não é de implementação, é de capacidade.**

## 5. Identidade

Três espaços mintados, opacos, monotônicos, sem reuso: `ViewportId`, `HostId`, `generation`
(`ProcessId` vem do motor). Um minter genérico por espaço.

- **Sem reuso** ⇒ mensagem atrasada de algo morto nunca é aceita como sendo de algo vivo. É a
  classe de bug mais cara que este sistema consegue produzir, e custa um `uint32_t` torná-la
  impossível.
- **Sem reuso** ⇒ o espaço tem **lacunas**. Documento que nasce e morre antes de emitir consome
  um id que nunca aparece no fio. O supervisor tolera lacunas; é propriedade do protocolo, não
  defeito.
- **`generation` não existe.** Era o eixo inventado para dizer "o conteúdo do slot foi
  trocado" quando o id sobrevivia à navegação. Agora o `HostId` é o slot e o `generation` é
  novo a cada carga: o id do documento ter mudado **é** a troca.
- A palavra `contextId` morre. O domínio diz `hostId` ou `documentRef`, conforme o eixo.

## 6. Órfão deixou de ser categoria

Pai morre num processo, filho vive em outro. No desenho antigo isso não tinha regra escrita.
Agora `Hosts::detach` fecha a **subárvore**, atravessando processos. Uma regra, explícita,
sem caso especial.

## 7. O que morreu junto

| morreu | porque |
|---|---|
| `contextId = 1` é a aba | não há documento especial |
| "aninhado não anuncia nascimento" | todo documento anuncia, com o pai de verdade |
| `parentContextId` sempre `0` | o pai é real |
| registro só da aba | registro de todos, mais a árvore |
| dois minters (aba × aninhado) | um minter por espaço |
| halt de aba × flush de contexto | uma operação, um alcance |
| `IContextTopology` | absorvido pelos handles |
| `PeerRef` opaco + sink global | o processo é um objeto que se possui |
| época como **mecanismo próprio** | geração nova ⇒ tabela vazia ⇒ o primeiro quadro já é completo (P8). `generation` **fica**; o que morreu foi o opcode de reset |
| a pergunta "isto é a raiz?" | não há resposta possível — logo não há resposta errada |
