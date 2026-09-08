# Build do port WPE

Tudo aqui foi lido da arvore real em `wpewebkit-2.52.6`, nao de memoria.

## Maquina de build

**Nenhuma das maquinas alcancaveis hoje serve.** Registrado pra nao se descobrir isso no meio:

| ambiente | disco | RAM | cores | cmake/ninja | veredito |
|---|---|---|---|---|---|
| VM local do desktop | ~9 GB | — | — | ausentes | nao serve |
| container de nuvem da sessao | ~30 GB | 7 GB | 2 | presentes | nao serve (RAM/cores) |

WebKit precisa de maquina dedicada: muitos cores, RAM alta (link de `libWebKit` e' o pico),
disco em dezenas de GB por configuracao de build, e **ccache obrigatorio**.

`scripts/build.sh` aborta se `ccache` nao existir. Isso e' de proposito: sem ccache o ciclo de
feedback vira dezenas de minutos e o projeto morre pelo loop, nao pelo codigo. Esse e' o modo
de falha mais comum de projeto de fork.

## Dependencias

`Tools/wpe/install-dependencies` no checkout. Suporta `apt-get` (Debian/Ubuntu), `dnf` (Fedora)
e `pacman` (Arch). Fora dessas tres o script recusa.

Alternativa do upstream para deps isoladas: jhbuild (`Tools/wpe/jhbuild.modules`,
`jhbuild-minimal.modules`, `jhbuild-minimal-plus-gstreamer.modules`).

## Entrada de build

    Tools/Scripts/build-webkit --wpe --release

`build-webkit` expoe `--gtk` e `--wpe` como portas. `scripts/build.sh` chama isso e passa
`--cmakeargs` com as flags abaixo.

## Flags do Speculum e por que

Lidas de `Source/cmake/OptionsWPE.cmake` na tag pinada.

| flag | default upstream | nosso | motivo |
|---|---|---|---|
| `ENABLE_WPE_PLATFORM` | `${ENABLE_DEVELOPER_MODE}` | **ON** | WPEPlatform e' a API de embedding moderna. Em build de release o default deixa ela **desligada** — tem que ligar explicito. Upstream tambem exige que ao menos uma de `ENABLE_WPE_PLATFORM` ou `ENABLE_WPE_LEGACY_API` esteja ligada. |
| `ENABLE_WPE_PLATFORM_HEADLESS` | ON | ON | Plataforma headless e' opcao de primeira classe. E' o modo de producao. |
| `ENABLE_WPE_PLATFORM_WAYLAND` | ON | ON | Util pra debug com janela. |
| `ENABLE_WEBDRIVER` | **ON (PUBLIC)** | **OFF** | O upstream liga WebDriver por default no WPE. Somos o embedder, nao precisamos, e e' superficie de automacao — exatamente o sinal que o port existe pra nao emitir. |
| `ENABLE_WEBDRIVER_BIDI` | experimental (off) | OFF | idem, explicito. |
| `ENABLE_TOUCH_EVENTS` | ON | ON | E' o caminho de input do produto. |
| `ENABLE_ENCRYPTED_MEDIA` | experimental (off) | OFF | O Virtual nao decodifica midia: o sidecar proxia assets e quem da play e' o cliente projetado. DRM e codec sao irrelevantes aqui. |

Notas de flags que **nao** mexemos mas importam saber:

- `ENABLE_GPU_PROCESS` ON, e depende de `USE_GBM`, que depende de `USE_LIBDRM`.
- `ENABLE_BUBBLEWRAP_SANDBOX` ON no Linux. Relevante quando isso for pra container.
- `ENABLE_WPE_PLATFORM` **conflita** com `ENABLE_WPE_1_1_API`.
- `ENABLE_WK_WEB_EXTENSIONS` fica atras de experimental — e' a API de WebExtensions do WebKit,
  nao tem relacao com o que chamamos de "extensao" hoje (a MV3 do Chromium morre no port).

## Backend de view

`Tools/wpe/backends/` traz `HeadlessViewBackend.{cpp,h}` (caminho da API legada) alem de `fdo`.
Com `ENABLE_WPE_PLATFORM=ON` o caminho e' a plataforma headless do WPEPlatform, nao esse backend.
Decidir qual dos dois antes de escrever C1 — os dois existem e nao sao a mesma coisa.

## Ordem

1. Provisionar maquina de build (bloqueia tudo).
2. `scripts/fork-init.sh`
3. `Tools/wpe/install-dependencies`
4. `scripts/build.sh` — primeiro build a frio, medir. Esse numero define a cadencia do projeto.
5. Rodar o MiniBrowser do WPE headless e navegar uma pagina. Esse e' o primeiro sinal de vida.

Nada de C1 antes do passo 5 passar.
