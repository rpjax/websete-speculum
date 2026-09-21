# 14 — Fronteira autor / UA (item F, fechado)

Status: **fechado 2026-09-10**. Fecha o item **F**.

---

## 1. A regra

**O elemento é o contrato. O interior é trabalho do navegador — dos dois lados.**

Componente que a especificação obriga todo navegador a implementar (`<video>`,
`<input>`, `<select>`, `<details>`…): projeta-se **o nó raiz** com seus atributos e
propriedades. O navegador projetado constrói o interior sozinho, como faria em
qualquer página.

Nada que o navegador criou por conta própria é projetado. Sem exceção e sem
enumeração.

## 2. Por que isso precisou virar regra escrita agora

No produtor em JS a plataforma protegia: `.shadowRoot` simplesmente não expunha
shadow de UA. **No C++ dentro do Gecko isso é visível.** A proteção sumiu junto com
a mudança de camada.

E o modo de falhar é ruim e específico: replicar os controles internos de um
`<video>` faz o cliente exibir **os controles replicados mais os controles que o
navegador dele constrói sozinho**. Controle duplicado. Idem thumb de
`<input type=range>`, marcador de `<details>`, barra de rolagem.

## 3. Consequência de forma

Esta é a formulação certa. A anterior — "filtrar conteúdo de UA" — descrevia a
mesma coisa pelo lado errado, como exclusão. Enunciada como contrato do elemento,
a regra não depende de conhecer o catálogo de coisas que cada motor cria por
conta própria.

**Efeito prático:** o design não precisa enumerar tipos de conteúdo de UA. A
checagem exata no C++ (`nsINode::IsInNativeAnonymousSubtree()`, mais a marca
correspondente em `ShadowRoot` para UA Widget — nome a confirmar na árvore) é
**detalhe de implementação**, não decisão de arquitetura.

Duas exigências permanecem sobre essa checagem, porque são erros clássicos:

1. **Vale na admissão e em cada mutação.** Filtrar só na descoberta deixa vazar
   mutação posterior dentro de conteúdo de UA.
2. **Shadow fechado do autor continua sendo replicado.** Do C++ dá para ver
   (`GetShadowRoot()` não filtra por modo), e o comportamento já especificado em
   `page-projection/spec/shadow.md` é replicar com `mode: 'closed'`. "Fechado" é
   escolha do autor, não fronteira de UA — não confundir os dois.

## 4. Estado que não é atributo

Parte do estado desses componentes não vive em atributo: `currentTime`, `paused`,
`volume` de mídia; `value` de input depois de digitação; `checked` após interação.

Isso já tem opcode: **`PropSet` (0x63)**. A regra do §1 se lê como "raiz + atributos
+ propriedades", não só atributos.

## 5. Limite conhecido — registrado, não a resolver

Se a página estiliza interno de UA por pseudo-elemento (`::-moz-range-thumb`,
`::-webkit-slider-thumb`), a regra CSS é replicada e o cliente a aplica sobre o
interno de UA **dele**. Funciona quando o motor do cliente conhece aquele
pseudo-elemento; entre motores diferentes, não funciona.

Limite estrutural do modelo, da mesma família do MSE (`13-plano-de-ativos.md` §6).
Não é pendência.
