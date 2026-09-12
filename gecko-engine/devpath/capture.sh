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
# vem em base64 nas linhas [SPECULUM-FRAME-PART] (pid+seq). Andaime: IPC no pai.
EXTRACT_NOTE="$OUT/stderr_extract_failures.txt"
: > "$EXTRACT_NOTE"
python3 - "$OUT/logs/stdout.log" "$OUT/frames" "$EXTRACT_NOTE" <<'PYEOF'
import base64, re, sys, pathlib

log, outdir, note_path = sys.argv[1], pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
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

part_re = re.compile(
    r"^\[SPECULUM-FRAME-PART\] pid=(\d+) seq=(\d+) idx=(\d+) de=(\d+) (.+)\s*$",
    re.M,
)
# Legado (sem pid): trata pid=0 para nao misturar processos distintos com seq igual.
legacy_re = re.compile(
    r"^\[SPECULUM-FRAME-PART\] seq=(\d+) idx=(\d+) de=(\d+) (.+)\s*$", re.M
)

failures: list[str] = []
inflight: dict[tuple[int, int], dict] = {}
completed: list[tuple[int, tuple[int, int], bytes]] = []


def fail_incomplete(key: tuple[int, int], state: dict, reason: str) -> None:
    pid, seq = key
    got = len(state.get("parts", {}))
    need = state.get("total", 0)
    failures.append(
        f"stderr_frame_incomplete pid={pid} seq={seq} got={got} de={need} reason={reason}"
    )


def try_complete(key: tuple[int, int], state: dict) -> None:
    total = state["total"]
    parts = state["parts"]
    if len(parts) != total:
        return
    if set(parts.keys()) != set(range(total)):
        fail_incomplete(key, state, "missing_idx")
        return
    try:
        data = decode_b64("".join(parts[i] for i in range(total)))
    except Exception as exc:
        pid, seq = key
        failures.append(f"stderr_frame_decode_fail pid={pid} seq={seq} err={exc}")
        return
    completed.append((state["first_pos"], key, data))


for m in part_re.finditer(text):
    pid, seq, idx, total, chunk = m.groups()
    key = (int(pid), int(seq))
    idx_i, total_i = int(idx), int(total)
    if idx_i == 0 and key in inflight:
        fail_incomplete(key, inflight.pop(key), "superseded")
    if key not in inflight:
        inflight[key] = {"total": total_i, "parts": {}, "first_pos": m.start()}
    state = inflight[key]
    if total_i != state["total"]:
        fail_incomplete(key, state, "de_mismatch")
        inflight.pop(key, None)
        continue
    state["parts"][idx_i] = chunk
    try_complete(key, state)
    if len(state["parts"]) == state["total"]:
        inflight.pop(key, None)

for m in legacy_re.finditer(text):
    if part_re.match(m.group(0)):
        continue
    seq, idx, total, chunk = m.groups()
    key = (0, int(seq))
    idx_i, total_i = int(idx), int(total)
    if idx_i == 0 and key in inflight:
        fail_incomplete(key, inflight.pop(key), "superseded")
    if key not in inflight:
        inflight[key] = {"total": total_i, "parts": {}, "first_pos": m.start()}
    state = inflight[key]
    if total_i != state["total"]:
        fail_incomplete(key, state, "de_mismatch")
        inflight.pop(key, None)
        continue
    state["parts"][idx_i] = chunk
    try_complete(key, state)
    if len(state["parts"]) == state["total"]:
        inflight.pop(key, None)

for key, state in list(inflight.items()):
    fail_incomplete(key, state, "eof")
    inflight.pop(key, None)

completed.sort(key=lambda x: x[0])
written = 0
for _pos, key, data in completed:
    written += 1
    (outdir / f"stderr_{written:04d}.bin").write_bytes(data)

if failures:
    note_path.write_text("\n".join(failures) + "\n", encoding="utf-8")
if written:
    print(f"extraidos do stderr: {written} frame(s)")
if failures:
    print(f"  {len(failures)} frame(s) incompleto(s) — ver MANIFEST.txt")
PYEOF

{
  echo "url=$URL"
  echo "label=$LABEL"
  echo "stamp=$STAMP"
  echo "gecko=$GECKO"
  echo "gecko_commit=$(cd "$GECKO" && git rev-parse HEAD 2>/dev/null || echo '?')"
  echo "speculum_commit=$(cd "$REPO" && git rev-parse HEAD)"
  echo "binary_mtime=$(stat -c %y "$BIN" 2>/dev/null || echo '?')"
  if [ -s "$EXTRACT_NOTE" ]; then
    echo ""
    echo "[stderr_extract_failures]"
    cat "$EXTRACT_NOTE"
  fi
} > "$OUT/MANIFEST.txt"
rm -f "$EXTRACT_NOTE"

echo "--- frames ---"; ls -l "$OUT/frames" || true
echo "--- logs ---";   ls -l "$OUT/logs"   || true
echo
echo "capturado em: $OUT"
echo "agora rode:   ./verify.sh $OUT"
