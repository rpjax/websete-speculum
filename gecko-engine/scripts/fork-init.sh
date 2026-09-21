#!/usr/bin/env bash
# Materializa o checkout do Gecko na tag pinada em UPSTREAM e cria o branch do fork.
# Idempotente: se checkout/ ja existe na tag certa, nao faz nada.
# NAO roda build. Ver scripts/build.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${SPECULUM_GECKO_ROOT:-$HERE}"
# shellcheck disable=SC1091
source "$HERE/UPSTREAM"

CHECKOUT="$ROOT/checkout"
mkdir -p "$ROOT"

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
echo "Para rebase futuro ver docs/gecko-engine/01-fork.md."
