# Iteração 5 — multi-documento primeiro, e o processo como objeto

**Gatilho:** o modelo tinha que ser multi-documento por natureza, não por acomodação — e a
ideia de representar cada processo Gecko como um handle que implementa uma interface.

As duas coisas resolvem o mesmo problema por ângulos diferentes: **tirar do código as
perguntas que ele pode responder errado.**

---

## 1. O caso especial que sustentava o desenho antigo

A aba era categoria: `contextId = 1`, só ela no registro, só ela anunciando nascimento,
`parentContextId` sempre zero. O iframe era exceção: mintado, não registrado, sem anúncio, com
o id guardado num campo do motor.

Dois mecanismos de identidade para a mesma coisa, e uma pergunta — *"isto é a raiz?"* — que
todo caminho precisava fazer. Toda pergunta dessas é um lugar onde a resposta pode estar
errada.

**Agora não há documento especial.** Raiz é posição na árvore. Todo documento tem a mesma
identidade, o mesmo ciclo de vida, a mesma projeção, e navega — porque iframe navega.

Efeito colateral de graça: **N viewports desde o primeiro dia**. O V1 abre um e nenhuma linha
do domínio sabe disso, porque não existe ramo "o viewport" contra "os viewports".

## 2. Dois eixos que estavam misturados

Documento aninhado pode viver em outro processo. Logo há duas relações, e colapsá-las é a
origem clássica de bug aqui:

| eixo | relação | responde |
|---|---|---|
| posse | processo → documentos | quem morre com quem |
| estrutura | documento → documento pai | quem está dentro de quem |

Declarados separados, nenhum implícito. `IDocumentView::childDocumentOf` é a **única**
operação que cruza de nó para documento — um lugar só, para o cruzamento nunca virar implícito.

## 3. O handle de processo troca invariante por fato

Era:

> *"morte de processo destrói seus documentos exatamente uma vez"* — invariante que precisa de
> teste, de cuidado, e de alguém lembrando de chamar a limpeza na ordem certa.

Virou:

> **O handle é destruído. Os documentos eram dele. Morreram.**

Não há rotina de limpeza a esquecer nem ordem a errar. E some a categoria inteira de erro
"documento cujo processo já morreu", porque o único caminho até o documento passa pelo
processo.

O mesmo mecanismo resolve o observador: ele é anexado **ao documento** e morre com ele. Não há
`detach` a lembrar.

**Processo não aparece no fio.** É detalhe de como o motor arruma as coisas; o supervisor fala
viewport e documento. Expor processo misturaria responsabilidade — a mesma lição de
"saturação é do supervisor".

## 4. Ler, ser avisado, agir — separados de propósito

```
IEngineDocument                       AGIR
  ├─ view()  → const IDocumentView&   LER
  └─ attach(IDocumentObserver*)       SER AVISADO
```

A projeção recebe a visão e implementa o observador. **Nunca vê `IEngineDocument`.** Logo é
estruturalmente incapaz de navegar, redimensionar e despachar entrada — não por regra escrita,
mas por não ter recebido.

Esta é a razão de `IDocumentView` continuar separado apesar de ser sempre o mesmo objeto por
trás: **a separação não é de implementação, é de capacidade.**

## 5. O que morreu

| morreu | porque |
|---|---|
| `contextId = 1` é a aba | não há documento especial |
| "aninhado não anuncia" | todo documento anuncia |
| `parentContextId` sempre `0` | o pai é real |
| registro só da aba | registro de todos, mais a árvore |
| dois minters | um minter por espaço |
| halt de aba × flush de contexto | uma operação, um alcance (`Self` \| `Subtree`) |
| `IContextTopology` | absorvido pelos handles |
| `PeerRef` opaco + sink global | o processo é um objeto que se possui |
| a palavra `contextId` | o domínio diz `documentId` |

## 6. Teste do modelo contra os cenários da iteração 3

Refiz os quatro cenários contra o modelo novo:

**A — navegação comita durante montagem de frame.** Aguenta, e melhor: projeção tem escopo
documento, e o documento morrendo destrói os componentes. A invariante de "enfileirar no mesmo
turno em que fecha" continua necessária e continua escrita.

**B — ponte rompe no meio de um stream.** Aguenta com a fase `Cancelled` e
`cancelAllOfDocument`. Melhorou: o registro agora é por documento, e documento morto limpa os
seus por posse.

**C — iframe nasce e morre dentro de um intervalo.** Aguenta, **e ficou uniforme**: antes era
o cenário do caso especial; agora é o cenário comum, exercitado por todo teste que use árvore.

**D — dois `Navigate` em rajada.** Aguenta, e agora vale para qualquer documento, não só para
a aba — o teste roda no nível 3 da árvore e prova que não há caso especial.

**Achado novo:** pai morre num processo, filho vive em outro. Antes isso não tinha regra.
Agora `Documents::close` fecha a **subárvore**, atravessando processos — uma regra, explícita,
sem caso especial. Órfão deixou de ser categoria.
