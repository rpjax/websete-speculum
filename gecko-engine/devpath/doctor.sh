#!/usr/bin/env bash
# Speculum devpath — responde, a partir de uma captura, as perguntas que a gente
# ficou repetindo na mao:
#   quais documentos apareceram, em que processo, qual passou no gate,
#   o observer anexou, o bootstrap rodou, quantos frames sairam.
#
#   ./doctor.sh [diretorio-da-captura]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP="${1:-$(ls -d "$HERE"/captures/*/ 2>/dev/null | tail -1)}"
[ -n "${CAP:-}" ] || { echo "nenhuma captura" >&2; exit 1; }

echo "== captura =="
cat "$CAP/MANIFEST.txt" 2>/dev/null || echo "(sem MANIFEST)"

echo
echo "== frames vindos do stderr (processo de conteudo) =="
nstderr=$(grep -c 'SPECULUM-FRAME' "$CAP/logs/stdout.log" 2>/dev/null || echo 0)
echo "  $nstderr linha(s) [SPECULUM-FRAME] no stdout.log"
if [ "$nstderr" -eq 0 ]; then
  echo "  -> o processo de conteudo roda em chroot e NAO escreve arquivo."
  echo "     Se aqui esta zero, o produtor nao rodou la — nao adianta procurar arquivo."
fi

echo
echo "== processos que construiram DOM (via arquivo; so o pai consegue) =="
shopt -s nullglob
docs=("$CAP"/logs/*.log)
if [ ${#docs[@]} -eq 0 ]; then
  echo "NENHUM log de documento."
  echo "  -> ou o attach nao roda, ou o processo nao consegue escrever o log."
else
  for f in "${docs[@]}"; do
    pid="$(basename "$f" .log)"
    n=$(grep -c 'SPECULUM-DOC' "$f" || true)
    proc=$(grep -o 'proc=[a-z]*' "$f" | head -1 | cut -d= -f2)
    echo "  pid=$pid proc=${proc:-?} documentos=$n"
  done
fi

echo
echo "== documentos vistos (uri | conteudo? | chrome?) =="
grep -h 'SPECULUM-DOC' "$CAP"/logs/*.log 2>/dev/null \
  | sed -E 's/.*uri=([^ ]*).*contentDoc=([0-9]*).*chromeShell=([0-9-]*).*/  \1 | content=\2 | chrome=\3/' \
  | sort | uniq -c | sort -rn || echo "  (nenhum)"

echo
echo "== bootstrap =="
if grep -qh 'SPECULUM-BOOT' "$CAP"/logs/*.log 2>/dev/null; then
  grep -h 'SPECULUM-BOOT' "$CAP"/logs/*.log
else
  echo "  nenhuma linha de bootstrap."
fi

echo
echo "== frames =="
n=$(ls "$CAP"/frames/*.bin 2>/dev/null | wc -l)
echo "  $n frame(s)"
[ "$n" -gt 0 ] && ls -l "$CAP"/frames/*.bin

echo
echo "== veredito =="
if [ "$n" -eq 0 ]; then
  echo "  Sem frame. Ordem de investigacao, de cima para baixo:"
  echo "   1. algum log de documento existe?  (se nao: attach nao roda)"
  echo "   2. algum documento com content=1?  (se nao: so chrome chegou)"
  echo "   3. alguma linha de bootstrap?      (se nao: bootstrap nao dispara)"
  echo "  Responda NA ORDEM. Nao pule para hipotese sem fechar a anterior."
else
  echo "  Ha frames. Rode ./verify.sh \"$CAP\" para o veredito do cliente."
fi
