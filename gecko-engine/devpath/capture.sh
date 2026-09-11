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

def decode_b64(raw: str) -> bytes:
    s = re.sub(r"[^A-Za-z0-9+/=]", "", raw)
    s = s.rstrip("=")
    pad = (-len(s)) % 4
    if pad:
        s += "=" * pad
    return base64.b64decode(s, validate=False)

whole_re = re.compile(r"^\[SPECULUM-FRAME\] seq=(\d+) bytes=(\d+) (.+)\s*$", re.M)
part_re = re.compile(
    r"^\[SPECULUM-FRAME-PART\] seq=(\d+) idx=(\d+) de=(\d+) (.+)\s*$", re.M
)

events: list[tuple[int, str, tuple]] = []
for m in whole_re.finditer(text):
    events.append((m.start(), "whole", m.groups()))
for m in part_re.finditer(text):
    events.append((m.start(), "part", m.groups()))
events.sort(key=lambda e: e[0])

written = 0
cur_parts: dict[int, str] = {}
cur_total = 0


def flush_part_frame() -> None:
    global written, cur_parts, cur_total
    if not cur_total:
        return
    if len(cur_parts) != cur_total:
        print(
            f"  AVISO: {len(cur_parts)} de {cur_total} partes — frame descartado"
        )
        cur_parts = {}
        cur_total = 0
        return
    try:
        data = decode_b64("".join(cur_parts[i] for i in sorted(cur_parts)))
    except Exception as exc:
        print(f"  AVISO: base64 invalido ({exc}) — frame descartado")
    else:
        written += 1
        (outdir / f"stderr_{written:04d}.bin").write_bytes(data)
    cur_parts = {}
    cur_total = 0


for _pos, kind, groups in events:
    if kind == "whole":
        flush_part_frame()
        seq, declared, b64 = groups
        try:
            data = decode_b64(b64)
        except Exception as exc:
            print(f"  AVISO seq={seq}: base64 invalido ({exc}) — frame descartado")
            continue
        if len(data) != int(declared):
            print(
                f"  AVISO seq={seq}: declarou {declared} bytes, decodificou {len(data)}"
            )
        written += 1
        (outdir / f"stderr_{written:04d}.bin").write_bytes(data)
        continue

    _seq_s, idx_s, total_s, chunk = groups
    idx_i, total_i = int(idx_s), int(total_s)
    if idx_i == 0:
        flush_part_frame()
        cur_total = total_i
        cur_parts = {}
    elif total_i != cur_total:
        print("  AVISO: parte com de= inesperado — frame descartado")
        cur_parts = {}
        cur_total = 0
        continue
    cur_parts[idx_i] = chunk
    if len(cur_parts) == cur_total:
        flush_part_frame()

flush_part_frame()

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
