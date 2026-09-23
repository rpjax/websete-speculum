# live-frames — bootstrap real (IPC, contextId no pai)

Fixtures congelados da captura devpath `20260912-145435-ctxpai`.

- **Commit Speculum:** `eba3bf8622a1fadc064e8e5f6faf116071355402` (docToken + contextId atribuído no processo pai).
- **URL navegada:** `https://example.com/` (headless; frames extras vêm de documentos do browser).
- **Conteúdo:** 9 frames `.bin` + `frames.ndjson` — cada um é bootstrap de um **documento distinto** (9 contextId distintos após o pai).

Regressão: `gecko-engine/speculum-wire/run-tests.sh` (passo `live-frames`).

**Fase 9 / redesign:** este corpus é **ISA frame-protocol** (`0x5050`), pré-envelope do
`schema/speculum.wire.toml`. Continua como regressão do caminho ISA. Regravação sob
mensagem `Patch` (schema) é captura nova — não se adapta o decoder “só para passar”.
