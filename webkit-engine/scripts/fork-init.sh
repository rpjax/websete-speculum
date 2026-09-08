#!/usr/bin/env bash
# Materializa o checkout do WebKit na tag pinada em UPSTREAM e cria o branch do fork.
# Idempotente: se checkout/ ja existe na tag certa, nao faz nada.
# NAO roda build. Ver scripts/build.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/UPSTREAM"

CHECKOUT="$HERE/checkout"

# Serie estavel = minor PAR. Guarda contra pinar acidentalmente uma serie de desenvolvimento.
MINOR="$(printf '%s' "$UPSTREAM_TAG" | sed -E 's/^wpewebkit-[0-9]+\.([0-9]+)\..*$/\1/')"
if [ $((MINOR % 2)) -ne 0 ]; then
  echo "ABORT: $UPSTREAM_TAG tem minor impar ($MINOR) = serie de desenvolvimento." >&2
  echo "       O fork so baseia em serie estavel (minor par)." >&2
  exit 1
fi

if [ -d "$CHECKOUT/.git" ]; then
  cd "$CHECKOUT"
  CUR="$(git rev-parse HEAD)"
  if [ "$CUR" = "$UPSTREAM_COMMIT" ] || git merge-base --is-ancestor "$UPSTREAM_COMMIT" HEAD 2>/dev/null; then
    echo "checkout/ ja esta em $UPSTREAM_TAG (ou a frente). Nada a fazer."
    exit 0
  fi
  echo "ABORT: checkout/ existe mas esta em $CUR, nao em $UPSTREAM_COMMIT." >&2
  echo "       Isso significa pin trocado com patches locais em cima. Resolver a mao." >&2
  exit 1
fi

echo ">> clonando $UPSTREAM_TAG (shallow, single-branch)"
git clone --depth 1 --branch "$UPSTREAM_TAG" --single-branch "$UPSTREAM_REMOTE" "$CHECKOUT"

cd "$CHECKOUT"
GOT="$(git rev-parse HEAD)"
if [ "$GOT" != "$UPSTREAM_COMMIT" ]; then
  echo "ABORT: HEAD=$GOT nao casa com UPSTREAM_COMMIT=$UPSTREAM_COMMIT." >&2
  echo "       Tag foi movida no upstream. NAO prosseguir sem revisar." >&2
  exit 1
fi
echo ">> commit confere: $GOT"

git remote set-url origin "$UPSTREAM_REMOTE"
git remote rename origin upstream
git checkout -b "$FORK_BRANCH"

echo
echo "OK. checkout/ em $UPSTREAM_TAG, branch $FORK_BRANCH."
echo "Remote 'upstream' = $UPSTREAM_REMOTE (shallow: sem historico)."
echo "Para rebase futuro ver docs/webkit-engine/01-fork.md."
