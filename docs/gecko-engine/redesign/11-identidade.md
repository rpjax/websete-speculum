# 11 — Identidade: `hostId` + `generation`

**Status:** DECIDIDO. Corrige `07-modelo.md` e a iteração 7.

---

## 1. O nome certo é `hostId`

`contextId` era ruim porque não dizia o que era. Eu propus `hostId`, que era melhor mas
colidia — "frame" já significava o lote de deltas, e no Gecko significa caixa de layout.

**`hostId` é o certo:** ele nomeia *o que hospeda um documento*. E o vocabulário já existe no
repositório — `isNestedHost`, `pierce host`, o nó hospedeiro de um documento aninhado. O nome
não é inventado, é o que já se usa.

É o pilar do multi-documento: a árvore do cliente é chaveada por `hostId`, que é estável
atravessando qualquer navegação.

## 2. `generation` fica, e `documentRef` morre

Eu tinha proposto mintar um `documentRef` global por carga e matar `generation`. Errado, por
dois motivos:

**Carregam a mesma informação.** "O documento deste host foi trocado" é dito igualmente bem
por id novo ou por geração incrementada. Ter os dois é duas identidades para um fato.

**`generation` é a mais barata para quem consome.** A pergunta do cliente é sempre *"este
quadro é do documento que estou espelhando neste host?"*. Com `(hostId, generation)` isso é
comparar dois inteiros locais. Com um id global, o cliente passa a manter um mapa.

**Decisão:** a identidade de documento é o par `(hostId, generation)`. Não há mint global.
Internamente, no C++, o documento é um objeto — sua identidade **é** esse par, e não precisa
de terceiro espaço de id.

| eixo | o quê | estável em navegação |
|---|---|---|
| `hostId` | o slot que hospeda | **sim** |
| `generation` | qual documento está nele agora | não — incrementa |
| `sequence` | qual quadro dentro deste documento | não — reinicia por geração |

## 3. Geração nova não precisa de mecanismo novo

Documento novo ⇒ o produtor começa de **tabela vazia**. O primeiro quadro daquela geração é,
por construção, o estado completo — não porque alguém programou "se for o primeiro, emita
tudo", mas porque é o que o algoritmo produz partindo do zero (**P8**, sem ramo de ciclo de
vida).

Então "emitir resync quando a geração muda" **já acontece** e não custa código. O que falta é
só o quadro dizer isso de si: um bit `complete` no cabeçalho, para o cliente saber que pode
descartar o que tinha daquele host sem precisar deduzir.

## 4. Sincronia é do cliente. O produtor indexa.

Regra de fronteira, e ela decide várias coisas de uma vez:

> **O produtor produz e indexa. Manter sincronia é do cliente.**

O produtor **não** rastreia o que o cliente tem, não guarda histórico, não reenvia, não tem
política de recuperação. Ele carimba `(hostId, generation, sequence)` e o hash de
pré-condição, e isso é tudo que o cliente precisa para se virar.

### 4.1 O que o cliente faz, e o que ele precisa para fazer

Cliente detecta divergência (o hash de pré-condição não bate) → pede resync → **entra em modo
resync**: continua recebendo quadros e os **bufferiza** em vez de aplicar.

Quando o quadro de resync chega, o cliente precisa decidir o que fazer com o buffer. A
resposta vem de um campo, não de heurística:

> O quadro de resync carrega o `sequence` em que foi construído.
> Buffer com `sequence ≤ esse` já está contido nele → descarta.
> Buffer com `sequence >` esse é delta válido em cima dele → aplica em ordem.

Um campo. É exatamente "deixar bem indexado": o produtor não decide nada, só diz de que ponto
aquele retrato é.

### 4.2 O que isso proíbe

- produtor com buffer de reenvio;
- produtor com estado "este cliente está atrasado";
- produtor com retry;
- qualquer ramo no produtor que dependa de quem está consumindo.

Se algum desses aparecer, a fronteira foi violada.
