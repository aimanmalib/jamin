#!/usr/bin/env bash
# Host cron for the demo escrow pool (decision 0021): runs scripts/demo-restage.ts on mainnet every 10 minutes.
#   deploy/demo-restage-cron.sh            one run (what the crontab line calls)
#   deploy/demo-restage-cron.sh --kering   count and plan only: nothing is sent, the ledger is not written
#   deploy/demo-restage-cron.sh pasang     install the crontab line (idempotent; tagged # jamin-demo-restage)
#   deploy/demo-restage-cron.sh buang      remove that line again (the way back)
# NODE_BIN (a Node 22 binary; cron's PATH may hold an older node) and NOTIFY_CMD come from deploy/hos.env, which is
# not tracked. One run at a time (flock), low priority (nice), at most 10 minutes (timeout). The script stops by
# itself after pool.restageUntil and never writes a tracked file.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
TAG='# jamin-demo-restage'
[ -r "$HERE/hos.env" ] || { echo "deploy/hos.env missing (copy hos.env.example)"; exit 1; }
# shellcheck disable=SC1091
. "$HERE/hos.env"
: "${NODE_BIN:?set NODE_BIN in deploy/hos.env to a Node 22 binary}"
[ -x "$NODE_BIN" ] || { echo "NODE_BIN $NODE_BIN is not executable"; exit 1; }
major=$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || { echo "NODE_BIN is Node $major; Node 22 or later is needed"; exit 1; }

case "${1:-run}" in
  pasang)
    line="*/10 * * * * $HERE/demo-restage-cron.sh >> $REPO/state/demo-restage.log 2>&1 $TAG"
    { crontab -l 2>/dev/null | grep -vF "$TAG" || true; echo "$line"; } | crontab -
    echo "installed: $line"; exit 0 ;;
  buang)
    { crontab -l 2>/dev/null | grep -vF "$TAG" || true; } | crontab -
    echo "removed the $TAG line"; exit 0 ;;
  --kering) extra=(--kering) ;;
  run) extra=() ;;
  *) echo "usage: demo-restage-cron.sh [--kering|pasang|buang]"; exit 2 ;;
esac

mkdir -p "$REPO/state"
cd "$REPO"
export NOTIFY_CMD="${NOTIFY_CMD:-}"
echo "$(date -u +%FT%TZ) demo restage ${extra[*]:-}"
exec flock -n "$REPO/state/demo-restage.lock" nice -n 10 timeout 600 \
  "$NODE_BIN" --import tsx scripts/demo-restage.ts --network mainnet "${extra[@]}"
