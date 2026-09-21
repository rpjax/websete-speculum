# Viabilidade Gecko vs WebKit — evidência lado a lado

Avaliação **lado B** (Gecko ESR 153.2.0). Branch `feat/gecko-eval`.
WebKit = lado A (`feat/webkit-engine`), medido/verificado onde indicado.

Pin Gecko: tag `FIREFOX_153_2_0esr_RELEASE`, commit `feec67e62a5148b41fd017ccbbc463e8a6f9e83d`.
Clone shallow em `~/speculum-gecko/checkout`: **266,7 s**, **5,7 GB** (ext4).

Pin WebKit: tag `wpewebkit-2.52.6`, commit `3bcefb149bd7e5645d18c3f0b9abd515b274649f`.
Clone em ext4: **113 s**, **7,5 GB** (medido sessão [9]).

Sem opinião sobre qual escolher — só evidência.

---

## Tabela comparativa

| critério | WebKit (medido/verificado) | Gecko (verificado) | quem ganha |
|---|---|---|---|
| **Observação de DOM** | `MutationObserver` em `Source/WebCore/dom/MutationObserver.h`; mutações DOM via pipeline WebCore. Registro C++ interno ao engine (não API pública de embedder documentada). | `nsIMutationObserver` (`dom/base/nsIMutationObserver.h`): callbacks `AttributeChanged`, `ContentInserted`, `ContentAppended`, etc. Registro C++ via `nsINode::AddMutationObserver()` (`dom/base/nsINode.h`). | **Gecko** — hook C++ explícito e documentado na árvore |
| **Observação de CSSOM** | `StyleScope::didChangeStyleSheetContents()` chamado de `CSSStyleSheet.cpp` — notificação de conteúdo de stylesheet no C++. | `StyleSheet::RuleChanged()` + `ServoStyleSet::RuleChanged()` — invalidação de estilo; **sem** callback público de conteúdo de stylesheet equivalente a `didChangeStyleSheetContents`. | **WebKit** — hook de conteúdo de stylesheet mais direto |
| **Embedding** | WPEPlatform headless (`ENABLE_WPE_PLATFORM_HEADLESS=ON`); `MiniBrowser --headless` sobe (GBM/DRM falham na WSL). API legada libwpe **OFF**. | Três caminhos: `--headless` + `HeadlessWidget` (`widget/headless/`), `nsWebBrowser` (`@mozilla.org/embedding/browser/nsWebBrowser;1`), GeckoView (Android). Desktop sem UI = headless ou host widget. | **Empate técnico** — ambos têm headless; Gecko tem `nsWebBrowser` congelado; WebKit tem WPEPlatform moderna |
| **Headless** | `MiniBrowser --headless`: processo vivo 15 s; erros GBM/DRM na WSL (sem GPU). | `MOZ_HEADLESS=1` via `--headless` (`nsAppRunner.cpp`); `HeadlessWidget` sem native data (`GetNativeData` → nullptr). Win/GTK/macOS. | **Gecko** — headless first-class com widget dedicado; WebKit WSL ainda instável |
| **Injeção de input** | `ENABLE_TOUCH_EVENTS=ON`; caminho de produto = touch via WPEPlatform (não medido end-to-end). WebDriver **OFF** por decisão. | `nsIWidget::SynthesizeNativeMouseEvent` / `SynthesizeNativeKeyEvent` (`widget/nsIWidget.h`); XPCOM `nsIDOMWindowUtils.sendNativeKeyEvent` (chrome only). `HeadlessWidget` implementa síntese. | **Gecko** — API nativa de síntese documentada (privilegiada) |
| **Suíte de baseline** | `run-bindings-tests` PASS; layout **85179/85179** 1ª passagem mas baseline **BLOQUEADA** (retry incompleto, bucket ambiente 61%). `TestExpectations` WPE 1297 linhas. | `mach test` / mochitest / xpcshell / wpt (`testing/mach_commands.py`). Expectativas: `.toml` (mochitest `fail-if`/`skip-if`) + `testing/web-platform/meta/**/*.ini` (`expected:` condicional). Chromium-style `TestExpectations`: **não encontrado**. | **WebKit** — modelo de expectations centralizado mais próximo do que rodamos; Gecko distribuído em `.ini`/`.toml` |
| **Tamanho do clone** | **113 s**, **7,5 GB** (ext4 shallow/tag) | **266,7 s**, **5,7 GB** (shallow `FIREFOX_153_2_0esr_RELEASE`) | **WebKit** — clone mais rápido; Gecko menor em disco neste shallow |
| **Sistema de build** | cmake + ninja; build frio **8098 s** (~2h15m), pico **7,5 GB** RSS; **ccache obrigatório** (`build.sh` aborta sem). | `mach` + mozbuild; docs: **4 GB RAM min / 8 GB+**, **30 GB disco** (`docs/setup/linux_build.rst`). **ccache e sccache** via `--with-ccache` (`build/moz.configure/toolchain.configure`, `docs/setup/configuring_build_options.rst`). Build frio: **não medido**. | **Indeterminado** — WebKit medido nesta máquina; Gecko só documentação oficial nesta rodada |

---

## Evidências Gecko (referência rápida)

| # | pergunta | arquivo | trecho-chave |
|---|---|---|---|
| 1 | DOM | `dom/base/nsIMutationObserver.h` | callbacks `AttributeChanged`, `ContentInserted`, … |
| 1 | registro | `dom/base/nsINode.h` | `AddMutationObserver(nsIMutationObserver*)` |
| 2 | CSSOM | `layout/style/CSSStyleSheet.cpp` N/A | `StyleSheet::RuleChanged` em `layout/style/StyleSheet.h` |
| 3 | embedding | `toolkit/components/browser/nsEmbedCID.h` | `NS_WEBBROWSER_CONTRACTID` |
| 3 | headless | `toolkit/xre/nsAppRunner.cpp` | `PR_SetEnv("MOZ_HEADLESS=1")` |
| 4 | headless widget | `widget/headless/HeadlessWidget.h` | `GetNativeData` → nullptr |
| 5 | input | `widget/nsIWidget.h` | `SynthesizeNativeMouseEvent` |
| 5 | input XPCOM | `dom/interfaces/base/nsIDOMWindowUtils.idl` | `sendNativeKeyEvent` (chrome) |
| 6 | tests | `testing/mochitest/`, `testing/xpcshell/`, `testing/web-platform/` | `./mach test` |
| 6 | expectations | `testing/web-platform/meta/**/*.ini` | chave `expected:` |
| 7 | build | `docs/setup/linux_build.rst` | RAM/disco |
| 7 | ccache | `build/moz.configure/toolchain.configure` | `--with-ccache`, detecção sccache |

---

## Evidências WebKit (referência rápida)

| # | item | arquivo | nota |
|---|---|---|---|
| DOM | `Source/WebCore/dom/MutationObserver.h` | verificado no checkout pinado |
| CSSOM | `Source/WebCore/css/CSSStyleSheet.cpp` | chama `didChangeStyleSheetContents()` |
| embedding | `docs/webkit-engine/02-build.md` | WPEPlatform headless ON |
| headless | `docs/webkit-engine/02-build.md` sessão [9] | MiniBrowser parcial na WSL |
| baseline | `docs/webkit-engine/05-baseline.md` | **PARCIAL / BLOQUEADA** |
| build | `docs/webkit-engine/02-build.md` | 8098 s, ccache obrigatório |
| iteracao | `docs/webkit-engine/02-build.md` sessão [10] | 93 s / 1,18 s |

---

## O que não foi feito nesta rodada

- Build Gecko: **não executado** (teto respeitado)
- Baseline Gecko (mochitest/xpcshell/wpt): **não executado**
- Fork remoto: `https://github.com/rpjax/firefox` (`gh repo fork`, clone=false)
