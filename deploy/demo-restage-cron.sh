#!/usr/bin/env bash
# Host cron for the demo escrow pool (decision 0021): runs scripts/demo-restage.ts on mainnet every
# pool.restageEveryMinutes (config/demo.json; the card counts the minutes to the next staging from the same value).
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

# The crontab line exactly as given is installed already (read only). CRON_FAIL = a fake crontab file for tests, the
# same variable the host cron tools read (decision 0029).
cron_ada() {
  if [ -n "${CRON_FAIL:-}" ]; then grep -qxF -- "$1" "$CRON_FAIL" 2>/dev/null
  else grep -qxF -- "$1" <<<"$(crontab -l 2>/dev/null)"; fi
}

case "${1:-run}" in
  pasang)
    every=$("$NODE_BIN" -p "JSON.parse(require('node:fs').readFileSync('$REPO/config/demo.json', 'utf8')).pool.restageEveryMinutes")
    line="*/$every * * * * $HERE/demo-restage-cron.sh >> $REPO/state/demo-restage.log 2>&1 $TAG"
    cron_ada "$line" && { echo "already installed: $line"; exit 0; }
    rc=0; /home/claude/bin/cron-buang-tag "$TAG" || rc=$?
    case $rc in 0|3) ;; *) echo "cron-buang-tag failed (rc $rc); crontab left as it was"; exit "$rc" ;; esac
    rc=0; /home/claude/bin/cron-tambah-baris "$TAG" "$line" || rc=$?
    case $rc in 0|3) ;; *) echo "cron-tambah-baris failed (rc $rc)"; exit "$rc" ;; esac
    echo "installed: $line"; exit 0 ;;
  buang)
    rc=0; /home/claude/bin/cron-buang-tag "$TAG" || rc=$?
    case $rc in 0) echo "removed the $TAG line"; exit 0 ;; 3) exit 0 ;; *) echo "cron-buang-tag failed (rc $rc); crontab left as it was"; exit "$rc" ;; esac ;;
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
