#!/usr/bin/env bash
# Speculum devpath — captura uma execucao real do Gecko: frames + logs, num
# diretorio carimbado DENTRO do repo. Captura nao vive em /tmp: se nao esta no
# repo, nao existe, e foi assim que a gente perdeu um bootstrap funcionando sem
# ninguem perceber.
#
#   ./capture.sh [url] [rotulo]
#
# Variaveis: GECKO=<checkout do gecko>  (default ~/speculum-gecko/checkout)
set -euo pipefail

URL="${1:-https://example.com}"
LABEL="${2:-captura}"
GECKO="${GECKO:-$HOME/speculum-gecko/checkout}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && git rev-parse --show-toplevel)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$REPO/gecko-engine/devpath/captures/$STAMP-$LABEL"

if [ ! -d "$GECKO" ]; then
  echo "checkout do Gecko nao encontrado em $GECKO (defina GECKO=...)" >&2
  exit 1
fi

mkdir -p "$OUT/frames" "$OUT/logs"

# O binario escreve nesses caminhos fixos (SpeculumNodeSource.cpp / Document.cpp).
rm -rf /tmp/speculum-frames /tmp/speculum-docs
mkdir -p /tmp/speculum-frames /tmp/speculum-docs

OBJ="$(cd "$GECKO" && ./mach environment --format=json \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["topobjdir"])')"
BIN="$OBJ/dist/bin/firefox"
PROFILE="$(mktemp -d)"

echo "capturando $URL -> $OUT"
MOZ_CRASHREPORTER_DISABLE=1 timeout "${TIMEOUT:-30}" "$BIN" --headless \
  -profile "$PROFILE" -no-remote "$URL" > "$OUT/logs/stdout.log" 2>&1 || true

cp -a /tmp/speculum-frames/. "$OUT/frames/" 2>/dev/null || true
cp -a /tmp/speculum-docs/.   "$OUT/logs/"   2>/dev/null || true

# O processo de conteudo roda em chroot: nao enxerga o /tmp do host e nao
# consegue gravar arquivo. O caminho que atravessa e' o stderr, entao os frames
# vem em base64 nas linhas [SPECULUM-FRAME]. Andaime: o definitivo e' o frame
# subir por IPC ate o pai (docs/gecko-engine/16-multiprocesso.md ss3).
python3 - "$OUT/logs/stdout.log" "$OUT/frames" <<'PYEOF'
import base64, re, sys, pathlib

log, outdir = sys.argv[1], pathlib.Path(sys.argv[2])
try:
    text = pathlib.Path(log).read_text(errors="replace")
except FileNotFoundError:
    sys.exit(0)

whole = re.findall(r"\[SPECULUM-FRAME\] seq=(\d+) bytes=(\d+) (\S+)", text)
parts = {}
for seq, idx, total, chunk in re.findall(
        r"\[SPECULUM-FRAME-PART\] seq=(\d+) idx=(\d+) de=(\d+) (\S+)", text):
    parts.setdefault(int(seq), {})[int(idx)] = (int(total), chunk)

written = 0
for seq, declared, b64 in whole:
    data = base64.b64decode(b64)
    if len(data) != int(declared):
        print(f"  AVISO seq={seq}: declarou {declared} bytes, decodificou {len(data)}")
    (outdir / f"stderr_{int(seq):04d}.bin").write_bytes(data)
    written += 1

for seq, chunks in parts.items():
    total = next(iter(chunks.values()))[0]
    if len(chunks) != total:
        print(f"  AVISO seq={seq}: {len(chunks)} de {total} partes — frame descartado")
        continue
    data = base64.b64decode("".join(chunks[i][1] for i in sorted(chunks)))
    (outdir / f"stderr_{int(seq):04d}.bin").write_bytes(data)
    written += 1

if written:
    print(f"extraidos do stderr: {written} frame(s)")
PYEOF

{
  echo "url=$URL"
  echo "label=$LABEL"
  echo "stamp=$STAMP"
  echo "gecko=$GECKO"
  echo "gecko_commit=$(cd "$GECKO" && git rev-parse HEAD 2>/dev/null || echo '?')"
  echo "speculum_commit=$(cd "$REPO" && git rev-parse HEAD)"
  echo "binary_mtime=$(stat -c %y "$BIN" 2>/dev/null || echo '?')"
} > "$OUT/MANIFEST.txt"

echo "--- frames ---"; ls -l "$OUT/frames" || true
echo "--- logs ---";   ls -l "$OUT/logs"   || true
echo
echo "capturado em: $OUT"
echo "agora rode:   ./verify.sh $OUT"
