# live-incremental — mutação real com seq>1

Fixtures da captura devpath `20260912-163640-mutacoes2`.

- **Commit Speculum (captura):** `569c80a9637646dc5960b21390167437b00491ad` (produtor por documento + timer 16 ms).
- **Página:** `gecko-engine/devpath/fixtures/mutacoes.html` (`file://`, script com mutações DOM ~200 ms).
- **Conteúdo:** 18 frames + `frames.ndjson`, incluindo **incrementais** (`sequence` > 1) após bootstrap — p.ex. contextId 3 com seq 1..9.

Regressão: `run-tests.sh` (passo `live-incremental`).
