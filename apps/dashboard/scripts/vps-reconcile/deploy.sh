#!/bin/bash
# Publica a reconciliacao na VPS. hotmartSync.ts NAO e versionado aqui: e copiado
# de lib/ a cada deploy, pra nao existir duas copias divergindo em silencio.
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${1:-equipe}"

cp lib/hotmartSync.ts scripts/vps-reconcile/hotmartSync.ts
trap 'rm -f scripts/vps-reconcile/hotmartSync.ts' EXIT

rsync -az --no-perms --no-owner --no-group \
  scripts/vps-reconcile/reconcile.ts scripts/vps-reconcile/hotmartSync.ts \
  scripts/vps-reconcile/alerta.sh "$HOST":/tmp/hmrec/
rsync -az --no-perms --no-owner --no-group \
  scripts/vps-reconcile/*.service scripts/vps-reconcile/*.timer "$HOST":/tmp/hmunits/

ssh "$HOST" 'set -e
  sudo cp /tmp/hmrec/* /opt/hotmart-reconcile/
  sudo chmod +x /opt/hotmart-reconcile/alerta.sh
  sudo chown -R hotmartrec:hotmartrec /opt/hotmart-reconcile
  sudo cp /tmp/hmunits/*.service /tmp/hmunits/*.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  rm -rf /tmp/hmrec /tmp/hmunits
  echo "deploy ok"'
