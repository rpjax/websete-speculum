# Otimizacao — o que se corta, e QUANDO

Fecha o item **E** de `07-decisoes-pendentes.md`.

---

## Principio, e ele governa a ordem do projeto

**Fazer funcionar primeiro. Otimizar depois.**

Nao e' slogan: e' a ordem de execucao. Nenhuma otimizacao entra antes de existir
produtor funcionando e baseline estabelecida.

## Duas categorias, e a diferenca importa

### 1. Ausencia — entra desde o dia 1

Nao e' corte. E' **nao fazer trabalho para hardware que nao existe.**

- Nao apresentar em tela — nao ha tela
- Sink de audio nulo — nao ha alto-falante
- Nao decodificar frame de video — quem toca e' o cliente projetado

Isso nao arrisca nada porque nao remove capacidade: remove destino.

### 2. Corte de verdade — espera o C3 e a baseline

Rasterizacao de glifo, decode de imagem preguicoso, arvore de acessibilidade,
desenho de scrollbar, e o que a medicao apontar.

**Espera por tres motivos:**

1. **Nao se sabe onde esta o custo ainda.** Sem o produtor rodando, e' possivel que
   ele domine e a pintura da pagina seja irrelevante. Otimizar antes de medir e'
   otimizar o lugar errado.
2. **Nao existe juiz.** A baseline e' quem diz se um corte foi observavel, e ela nao
   esta pronta.
3. **E' a unica categoria de trabalho onde errar custa a vantagem de fingerprint.**
   Cada corte e' um lugar para deixar de ser um Firefox — e "a gente E' um Firefox"
   e' o motivo pelo qual o Gecko ganhou (`00-decisao.md`).

## A regra do corte

**Corta por observabilidade, nao por custo.** Mantem-se todo estagio cujo resultado
o JS da pagina consegue ler; descarta-se todo estagio cujo unico consumidor seria um
olho humano.

Aplicada, decide sozinha casos que ninguem listou — que e' o que uma regra entrega e
uma lista de patches nao.

## Descarta o resultado, nao o ciclo

Detalhe que derruba a otimizacao ingenua: muita coisa observavel e' dirigida pelo
relogio de quadro.

- cadencia de `requestAnimationFrame`
- `PerformancePaintTiming` (first-paint, first-contentful-paint)
- progresso de animacao e transicao CSS
- `visibilityState`, `IntersectionObserver`

**O ciclo continua rodando. So o pixel final vai para o lixo.**

E o alvo **nao** e' "aba em background" — background e' estado detectavel
(`visibilityState` = hidden, timers estrangulados). O alvo e' **janela visivel, em
primeiro plano, que simplesmente nao apresenta em lugar nenhum.**

## O juiz existe de graca

**A baseline e' a ferramenta de aceite de cada corte:**

- cortou e a suite do upstream quebrou → o corte era observavel, **reverte**
- cortou e o snapshot de identidade mudou → o corte era observavel, **reverte**
- passou nos dois → era seguro

Isso torna a passada de otimizacao **mecanica em vez de arriscada**. Corta, roda, e o
motor diz se errou.

## Expectativa calibrada

Em pagina de DOM pesado quem domina e' **style e layout**, nao pintura. O ganho e'
real e vale a passada, mas nao e' ordem de magnitude.

O ganho grande de memoria provavelmente vem de outro lugar: **nao retinar bitmap
decodificado.** Decodificar e' necessario; guardar decodificado, nao.

## Quando

Depois do **C3** (produtor nativo) e com **baseline estabelecida**. E' passada de
otimizacao, com medicao antes e baseline como juiz.

**Nao e' fundacao. Nao entra no caminho critico.**
