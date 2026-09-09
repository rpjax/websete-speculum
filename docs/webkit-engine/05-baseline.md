# Baseline upstream WebKit — PARCIAL / INTERROMPIDA

**Status: PARCIAL / INTERROMPIDA** (2026-09-09). Baseline **não estabelecida**.
Captura bruta: `05-baseline-partial-capture.txt`.

Regra de re-baselinizar: mudou tag, flag, ambiente ou runner → re-baselinizar do zero.

---

## Pin

| campo | valor |
|---|---|
| tag | `wpewebkit-2.52.6` |
| commit | `3bcefb149bd7e5645d18c3f0b9abd515b274649f` |
| remote | `https://github.com/WebKit/WebKit.git` |
| TestExpectations WPE | 1297 linhas (`LayoutTests/platform/wpe/TestExpectations`) |

Código nosso no checkout: **zero linhas** (upstream puro em `~/speculum-webkit/checkout`).

---

## Flags de build (Speculum)

| flag | valor |
|---|---|
| `ENABLE_WPE_PLATFORM` | ON |
| `ENABLE_WPE_PLATFORM_HEADLESS` | ON |
| `ENABLE_WPE_PLATFORM_WAYLAND` | ON |
| `ENABLE_WPE_LEGACY_API` | OFF |
| `ENABLE_WEBDRIVER` | OFF |
| `ENABLE_WEBDRIVER_BIDI` | OFF |
| `ENABLE_TOUCH_EVENTS` | ON |
| `ENABLE_ENCRYPTED_MEDIA` | OFF |
| `USE_LIBBACKTRACE` | OFF |
| `ENABLE_UNIFIED_BUILDS` | ON (default upstream; não alterado) |
| `CMAKE_CXX_FLAGS` / `CMAKE_C_FLAGS` | `-g0` |
| `CMAKE_*_LINKER_FLAGS` | `-fuse-ld=lld` |

---

## Ambiente

| item | valor |
|---|---|
| host | WSL Ubuntu 24.04 |
| RAM / swap / cores | 21 GB / 32 GB / 6 |
| GPU | ausente (GBM/DRM falham; compositing/webgl instáveis) |
| checkout/build | `~/speculum-webkit` (ext4, **nunca** `/mnt/c`) |
| usuário layout tests | `webkit` (Apache recusa root) |
| deps extras descobertas | `/tmp/WebKit` gravável; permissão em `layout-test-results` |

---

## Tempos de build e iteração

| métrica | valor | notas |
|---|---|---|
| build completo a frio | **8098 s** (~2h15m) | pico RSS ~7,5 GB |
| edição 1 linha (run 1) | **93,01 s** | `Node.cpp`, unified ON |
| edição 1 linha (run 2) | **1,18 s** | |
| A3 (unified OFF) | **não medido** | pulado (A2: ciclo viável) |

Detalhe iteração: `02-build.md` sessão [10].

---

## Resultados das suítes

### run-bindings-tests — **PASS**

| | |
|---|---|
| tempo | 24,64 s |
| rc | 0 |
| contagem | All tests PASS! |

### run-javascriptcore-tests — **INCOMPLETO**

| tentativa | tempo | rc | resultado |
|---|---|---|---|
| 1ª (path errado) | 5,13 s | 2 | abortou: `WebKitBuild/Release/bin` inexistente |
| rerun completo | 2700 s | 124 | **timeout**; binários JIT passaram; stress incompleta |
| `--quick` | 2700 s | 124 | **timeout**; binários JIT passaram; 4 FAIL em stress |

Subconjunto usado após estourar 45 min: **`--quick`** (default parcial do runner).

Passes observados (ambas tentativas longas): testmasm, testair, testb3, testdfg, testapi, testwasmdebugger.

FAILs observados antes do timeout:
- rerun: `stress/ftl-osr-exit-materialize-phantom-array-with-live-butterfly.js.default`, `stress/typed-array-set.js.default`
- `--quick`: + `stress/array-prototype-flat-reentrant-mutation.js.default`, `stress/many-substrings-of-rope-shouldnt-use-excessive-memory.js.default`, `stress/many-substrings-of-rope-shouldnt-use-excessive-memory-2.js.default`

Contagem total pass/fail da suíte: **não medido** (timeout).

### run-api-tests — **FAIL** (parcial)

| | |
|---|---|
| tempo | 119,73 s |
| rc | 3 |
| total | 2088 |
| pass | 2039 |
| fail | 3 |
| crash | 1 |
| timeout | 0 |

Falhas: `TestWTF.StackTraceTest.*` (2), `TestWebCore.GStreamerTest.capsFromCodecString`, crash em `ImageBufferTests/...SinkIntoNativeImageWorks/51byteobject01`; timeouts parking lot no final do log.

### run-webkit-tests --wpe --release — **INTERROMPIDO**

| fase | progresso | tempo | rc |
|---|---|---|---|
| 1ª passagem | **85179 / 85179** | — | — |
| retry unexpected | **268 / 419** | 14416 s total | 124 (timeout 4 h) |

1ª tentativa como root: abortou (Apache). Rerun como `webkit`: passagem completa; retry cortado pelo teto.

Classificação B4 (**só 1ª passagem**, antes do retry):

| bucket | contagem | proporção |
|---|---|---|
| 1 — ESPERADA (TestExpectations) | 79 | 16,6% |
| 2 — AMBIENTE | 290 | 60,9% |
| 3 — INEXPLICADA | 107 | 22,5% |
| **total unexpected 1ª passagem** | **476** | |

**Achado:** bucket 2 ≈ 61% — esta WSL **não serve** para baseline layout confiável sem isolar ambiente (GPU, WebRTC, codecs).

Classificação pós-retry: **não medida**.

---

## Bucket 3 — inexplicadas (1ª passagem)

Lista completa em `05-baseline-bucket3.txt` (107 itens). Amostra:

```
editing/selection/triple-click-in-pre.html failed (text diff)
fast/css/vertical-align-rem-on-root.html failed (test timed out, text diff)
fullscreen/empty-anonymous-block-continuation-crash.html failed (WPEWebProcess crashed)
imported/w3c/web-platform-tests/content-security-policy/webrtc/webrtc-allowed-default-src-none.html failed (WPEWebProcess crashed [pid=680161])
...
```

---

## Veredito

**BLOQUEADA (baseline não estabelecida).**

Motivos:
1. Layout retry incompleto (268/419) — classificação final não fechada.
2. Bucket 2 dominante (61%) — ambiente WSL headless sem GPU/WebRTC/codecs.
3. Bucket 3 com 107 itens sem explicação de ambiente — impede veredito “funcionando = bate TestExpectations”.
4. JSC e api-tests sem contagem fechada.

---

## O que faltou

- [ ] Layout retry 419 até o fim
- [ ] Classificação B4 pós-retry
- [ ] JSC suite completa ou `--quick` com contagem final
- [ ] Veredito ESTABELECIDA vs BLOQUEADA definitivo
