# Evidência — `<video>` + `Range` através de service worker

Harness do teste citado em `docs/gecko-engine/13-plano-de-ativos.md` §7.
Roda em 2026-09-10, Chromium headless via Playwright.

## Pergunta

O item J dependia de uma dúvida: um `<video>` cross-origin, interceptado por service
worker e servido de outro endpoint, consegue **buscar por `Range` e fazer seek**?
Se não, a reescrita de URL voltaria à mesa.

## Como rodar

```
ffmpeg -f lavfi -i testsrc=size=640x480:rate=24:duration=300 \
  -c:v libvpx-vp9 -b:v 2M -deadline realtime -cpu-used 8 -g 48 big.webm
npm i playwright
node server2.js & node test2.js
```

**Use VP9/WebM, não H.264.** O Chromium do container não tem codec proprietário; a
primeira rodada falhou com `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`, que **não** é falha
de service worker e custou uma rodada de diagnóstico.

## Desenho

- `localhost:8099` — página, `sw.js`, e o endpoint `/proxy` que serve os bytes com
  suporte a `Range`.
- O DOM aponta para `127.0.0.1:8098`, **onde nada escuta**. Origem estrangeira de
  verdade: se algo escapar da interceptação, o teste falha em vez de passar por
  acidente.
- O SW intercepta tudo cujo `origin !== self.location.origin` e roteia para
  `/proxy?u=<url original>`, repassando o header `Range` quando existe.

## Resultado

Metadados, `play()` e **seek para 270 s** funcionaram. O seek gerou **duas
requisições `Range` reais** (`bytes=38469632-`, `bytes=34603008-`) — visíveis dentro
do SW, repassadas, respondidas `206`, honradas pelo motor de mídia. Imagem
cross-origin e `fetch` em modo `cors` também interceptados; a resposta chega como
`type: basic` **sem precisar de cabeçalho de CORS**.

## Alcance

Não cobre Safari/WebKit no cliente, codec proprietário, nem rede real.
