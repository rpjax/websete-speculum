# 13 — Plano de ativos (item J, fechado)

Status: **fechado 2026-09-10**. Fecha o item **J**.

Decisão em uma linha: **service worker no cliente intercepta tudo; o navegador
Virtual age como proxy de rede; ninguém reescreve URL em lugar nenhum.**

---

## 1. A colisão que abriu o tema

O caminho atual (`page-projection/spec/virtual-assets.md` §6.1) tem um hop em que o
**sidecar decodifica o frame, reescreve as strings de URL e recodifica**
(`rewritePart`).

Isso é incompatível com a regra fechada em `11-supervisor-linguagem.md` §7: **o
supervisor é cego ao conteúdo do frame.** Um dos dois tinha que cair. Caiu o hop.

## 2. Quem precisa dos bytes — a observação que dissolve o problema

O medo era busca dupla: o Virtual baixa o ativo para renderizar, e o serve plane
baixa de novo para servir ao cliente. Duas requisições à origem, com as quebras que
isso traz (URL assinada expirada, URL de uso único, tráfego dobrado com padrão que
navegador nenhum tem).

Mas os conjuntos quase não se cruzam:

| tipo | Virtual precisa? | Cliente precisa? |
|---|---|---|
| HTML | sim | **não** — o DOM é replicado |
| JS | sim, executa | **não** — não executa nada |
| CSS | sim (CSSOM, layout) | **não** — regras são replicadas |
| XHR / fetch / SSE / WebSocket | sim, é o JS dele | **não** |
| fontes | sim (métrica de texto afeta layout que o JS lê) | **sim** (renderiza) |
| imagens | só dimensão intrínseca | **sim** |
| vídeo / áudio | **não** | **sim** |

**Conclusão:** a sobreposição real é imagem e fonte. Todo o resto é exclusivo de um
lado ou do outro. A busca dupla nunca foi um problema geral — era um problema de dois
tipos de ativo.

## 3. A regra

1. **Só o cliente pede** (mídia acima de tudo): o Virtual **nunca busca**. O cliente
   busca **através** dele — proxy, com `Range` repassado. Uma requisição, feita pela
   identidade certa.
2. **Os dois precisam** (imagem, fonte): o Virtual busca uma vez; os bytes daquela
   busca servem o cliente.
3. **Só o Virtual precisa** (HTML, JS, CSS, XHR): nunca sai de lá. Não é servido.

## 4. Service worker no cliente — e a reescrita de URL deixa de existir

A página projetada registra um service worker que intercepta toda requisição de
sub-recurso de origem estrangeira e a roteia para o nosso plano de ativos.

**O DOM projetado carrega as URLs originais, exatamente como a página real.**

Três ganhos, e o terceiro é o maior:

1. **Ninguém reescreve URL.** Nem o C++, nem o supervisor, nem o sidecar. O hop
   morre e a pergunta "onde a reescrita mora" deixa de existir.
2. **O token de auth sai da URL.** O SW o põe em header. Some o
   `speculum-session-token` de dentro de cada URL e some toda a preocupação de
   colisão com a query do site (`virtual-assets.md` §1.1).
3. **Mata uma categoria inteira de bug.** O contrato atual exige carimbar *cada*
   sink de URL: `src`, `href`, `xlink:href`, `poster`, `srcset`, `imagesrcset`,
   `style` inline, `url()` em CSS, `@import`, `image-set()`. Essa lista nunca está
   completa — sempre falta um sink, e cada um que falta é um vazamento para a origem
   real. O SW intercepta no ponto em que a requisição **nasce**, não onde a URL foi
   escrita, então a lista deixa de existir.

Evidência experimental em §7. O risco que justificava dúvida (`<video>` +
`Range` através de SW) foi testado e **não se confirmou**.

## 5. Plano de ativos — um plano novo, de mão dupla

O desenho hoje só tem saída (frames). Proxy exige **entrada**: o cliente pede, os
bytes voltam em stream.

**Precisa atravessar até a rede do Gecko.** Não serve o supervisor buscar por conta
própria: assinatura TLS, jar de cookie e conexão HTTP/2 seriam outros, e a origem
veria um cliente diferente. **A razão de proxiar pelo navegador é a identidade** —
é o único motivo, e é suficiente.

Então o Gecko ganha uma entrada nova: *"busque esta URL com o contexto de rede da
sessão e devolva o corpo em stream"*. Mecânica, sem decisão — coerente com a
marionete (`06-runtime.md` §7.7).

O supervisor **relaya opaco**, igual ao frame. Não abre, não interpreta.

### 5.1 Tee de stream por offset — não cache de corpo inteiro

O requisito difícil aqui não é o corpo, é o **tempo**: o cliente pode pedir antes,
durante ou depois de o Virtual ter terminado de baixar.

Portanto o plano de ativos é **tee de stream com assinatura por offset**: um
consumidor entra em qualquer ponto e recebe do offset dele em diante enquanto os
bytes chegam. Nunca "junta tudo, guarda, serve" — isso quebra `chunked`, quebra
resposta sem `Content-Length`, e adiciona latência artificial em tudo.

O spec atual resolve metade disso ("aguarda o fill em voo; timeout → 404"). É o
ponto que precisa ser escrito direito.

## 6. Limites escritos como limites, não como pendências

**Stream de script nunca é servido.** SSE e WebSocket são consumidos por JS, e JS só
existe no Virtual. Tentar bufferizar um stream que não termina é erro de categoria.
Regra explícita para ninguém tentar.

**MSE não atravessa.** Site que alimenta `<video>` por buffer via JS (hls.js e
afins): o JS que monta o buffer roda no Virtual, e o cliente não tem JS. Isto é
**limite estrutural do modelo de projeção**, não item de backlog. `virtual-assets.md`
§5 já marcava MSE como não-objetivo; aqui fica registrado o *motivo*.

**HLS/DASH nativo funciona** e se divide pela regra do §3: o manifesto o Virtual tem
(foi o JS ou o elemento que buscou) → serve daquilo, com as URLs internas apontando
para o nosso plano; os segmentos só o cliente pede → proxy.

## 7. Evidência experimental — 2026-09-10

Testado em Chromium headless (Playwright), harness reproduzível em
`evidence/sw-range/`.

**Cenário:** página em `localhost:8099` registra um SW. O DOM aponta para uma
origem estrangeira, `127.0.0.1:8098`, onde **nada está escutando** — se algo
escapar da interceptação, falha em vez de funcionar por acidente. O SW roteia todo
pedido estrangeiro para o próprio endpoint da página. Vídeo de 37 MB / 300 s.

| verificação | resultado |
|---|---|
| requisição de vídeo cross-origin interceptada pelo SW | **sim** (`mode: no-cors`, `destination: video`) |
| header `Range` visível dentro do SW | **sim** — `bytes=0-` |
| `loadedmetadata` / duração correta | **sim** — 300 s |
| `play()` avança | **sim** |
| **seek longe (270 s)** | **sim**, `currentTime` = 270.0 |
| **novas requisições `Range` reais geradas pelo seek** | **2** — `bytes=38469632-` e `bytes=34603008-`, ambas vistas pelo SW, repassadas, respondidas `206`, honradas |
| imagem cross-origin interceptada | **sim** |
| `fetch(..., {mode:'cors'})` cross-origin interceptado | **sim** — resposta `type: basic`, `ok: true` |

Dois achados que mudam o desenho para melhor:

1. **`Range` não é problema.** O seek gerou requisições `Range` de verdade (não foi
   servido de buffer já baixado), o header chegou intacto ao SW, e a resposta `206`
   foi aceita pelo motor de mídia. Era o único item que justificava dúvida.
2. **Requisição em modo CORS não precisa de cabeçalho de CORS.** Eu havia dito que o
   nosso endpoint precisaria devolver `Access-Control-Allow-Origin`. **Errado** —
   quando o SW substitui a resposta, a checagem de CORS não é reaplicada; a resposta
   chega como `basic`. Um requisito a menos.

**O que o teste NÃO cobre** (honestidade sobre o alcance): codec proprietário
(H.264 não existe no Chromium do container — a primeira rodada falhou por
`DEMUXER_ERROR_NO_SUPPORTED_STREAMS`, não por SW; refeito em VP9), Safari/WebKit no
lado cliente, e a corrida de primeira carga em condição de rede real.

### 7.1 A corrida de primeira carga

O SW precisa estar ativo **antes** do primeiro frame ser pintado. Controlável,
porque quem decide quando começar a pintar é o nosso cliente: registra, espera
`navigator.serviceWorker.ready` e a posse do controle, **depois** pinta.

No teste isto ficou visível de forma útil: na primeira carga, antes de o SW assumir,
a requisição do vídeo **escapou** e deu 404. Exatamente o comportamento a evitar em
produção — e a prova de que a ordem importa.

## 8. Dívida de documentação criada por esta decisão

`page-projection/spec/virtual-assets.md` fica **parcialmente obsoleto** e precisa de
revisão dirigida:

- **§1.1** (contrato de auth por parâmetro reservado na URL, e a lista de sinks a
  carimbar) — substituído pelo SW com header. A lista de sinks deixa de existir.
- **§6.1** (hop `rewritePart` de decode → reescreve → re-encode) — morto.
- **§2 / §3** (modos `cache` e `pass-through`) — a ideia sobrevive, mas o vocabulário
  muda: o eixo não é "cache vs pass-through", é **"os dois precisam" vs "só o
  cliente pede"** (§3 deste doc), e o mecanismo é tee por offset (§5.1).
- **§4** (HLS/DASH) — sobrevive.
- **§5** (MSE/DRM) — sobrevive, agora com o motivo registrado (§6 deste doc).

## 9. Como os bytes saem do Gecko — fechado 2026-09-14

**Um pedido de rede do Firefox, N leitores.** O cliente lê o cano HTTP, não a
foto já pintada, não um segundo download, não um GET do supervisor.

- A página pediu (imagem, fonte) → o cliente entra nesse pedido. Quem chega no
  meio pega do offset dele pra frente (§5.1).
- A página não pediu (vídeo/áudio, ou o cliente chegou antes) → o Firefox abre
  o pedido **como a página abriria** (mesma cookie, mesmo TLS) e só encaminha.
- `Range` é pedido de verdade no canal, como um `<video>` pediria.

**Pode sair:** imagem, fonte, áudio, vídeo, segmento HLS/DASH.  
**Não sai:** HTML, JS, CSS, XHR, SSE, WebSocket. Dúvida = recusa.

**Proibido:** segunda ida à origem “porque é mais fácil”; copiar bitmap/decode;
lista de sinks; o supervisor baixar com outra identidade.

A cola no fork é o canal (`nsIChannel` / listener): tee se a página já pediu; senão abre com o principal do documento. Não é cache de corpo inteiro e não é `fetch` paralelo. Zero `NullPrincipal` no registry.

## 10. Ainda evidência de cliente (não reabre o §9)

1. **Cliente WebKit/Safari.** O teste de `Range` via SW foi em Chromium.
2. **Iframe de origem estrangeira.** Réplicas same-origin devem cair no SW; não
   testado.
