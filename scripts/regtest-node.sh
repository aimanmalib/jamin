#!/usr/bin/env bash
# Start or stop a throwaway BCHN regtest node with stock consensus and standardness limits (no relaxed build).
# The chain lives in tmpfs and the container is removed on stop, so every run starts from block 0.
#   bash scripts/regtest-node.sh start | stop | status
set -euo pipefail
cd "$(dirname "$0")/.."
cfg() { node -p "require('./config/jamin.json').regtest.$1"; }
IMAGE=$(cfg image); NAME=$(cfg container); PORT=$(cfg rpcPort); CPUS=$(cfg cpus)
UPGRADE=$(cfg upgrade12ActivationTime)
USER_=${REGTEST_RPC_USER:-user}; PASS=${REGTEST_RPC_PASSWORD:-password}

cli() { docker exec "$NAME" bitcoin-cli -regtest -rpcuser="$USER_" -rpcpassword="$PASS" "$@"; }

case "${1:-}" in
  start)
    docker run -d --rm --name "$NAME" --cpus="$CPUS" --tmpfs /data:rw,size=1g \
      -p "127.0.0.1:$PORT:18443" "$IMAGE" bitcoind -regtest -server=1 -txindex=1 \
      -rpcuser="$USER_" -rpcpassword="$PASS" -rpcbind=0.0.0.0 -rpcallowip=0.0.0.0/0 \
      -acceptnonstdtxn=0 -fallbackfee=0.00001 -upgrade12activationtime="$UPGRADE" >/dev/null
    for _ in $(seq 1 30); do cli getblockchaininfo >/dev/null 2>&1 && break; sleep 1; done
    cli generatetoaddress 201 "$(cli getnewaddress)" >/dev/null
    printf 'node %s up on 127.0.0.1:%s, height %s\n' "$(cli getnetworkinfo | jq -r .subversion)" "$PORT" \
      "$(cli getblockcount)"
    ;;
  stop) docker rm -fv "$NAME" >/dev/null 2>&1 || true; echo "stopped $NAME" ;;
  status) cli getnetworkinfo | jq -c '{subversion, version}'; cli getblockcount ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
