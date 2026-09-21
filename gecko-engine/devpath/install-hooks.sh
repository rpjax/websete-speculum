#!/usr/bin/env bash
# Instala no checkout do Gecko um hook que espelha os arquivos tocados no repo
# Speculum antes de cada commit. Espelho por disciplina quebra; por hook, nao.
set -euo pipefail
GECKO="${GECKO:-$HOME/speculum-gecko/checkout}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$GECKO/.git/hooks/pre-commit"

[ -d "$GECKO/.git" ] || { echo "sem repo git em $GECKO" >&2; exit 1; }

cat > "$HOOK" <<HOOKEOF
#!/usr/bin/env bash
# gerado por gecko-engine/devpath/install-hooks.sh
set -euo pipefail
GECKO="$GECKO" "$HERE/mirror.sh" || {
  echo "ESPELHO FALHOU — commit abortado. O repo Speculum precisa refletir o fork." >&2
  exit 1
}
echo "espelho atualizado no repo Speculum; lembre de commitar la tambem."
HOOKEOF

chmod +x "$HOOK"
echo "hook instalado em $HOOK"
