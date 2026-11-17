#!/usr/bin/env bash
# Deploy jamin as one static web container behind the host's reverse proxy.
#   deploy/deploy.sh              build HEAD from a clean `git archive`, run it, install the route, verify
#   deploy/deploy.sh --rollback   run the previous image again (held by the stopped `jamin-undur` container)
#   deploy/deploy.sh --status     container, tags, rollback image and the public health code
# Verification: /healthz through the public URL (retried), then the Playwright suite (Chromium desktop and WebKit
# iPhone 13) against the public URL. A failed browser check rolls back.
# Host values live in deploy/hos.env (not tracked; see deploy/hos.env.example). The container holds no keys.
set -euo pipefail
cd "$(dirname "$0")"
[ -r hos.env ] || { echo "deploy/hos.env missing (copy hos.env.example)"; exit 1; }
# shellcheck disable=SC1091
. ./hos.env
: "${JAMIN_NETWORK:?}" "${JAMIN_DOMAIN:?}" "${PROXY_CONTAINER:?}" "${PROXY_DYNAMIC_DIR:?}" "${CERT_RESOLVER:?}"
BUILD_CMD=${BUILD_CMD:-docker build}
MIN_FREE_GB=${MIN_FREE_GB:-8}
BROWSER_CMD=${BROWSER_CMD:-}
export JAMIN_NETWORK
DC="docker compose -f compose.yaml"
URL="https://$JAMIN_DOMAIN"
HOLDER=jamin-undur

# Certificates use the HTTP-01 challenge: a name that does not resolve fails it.
dns_ok() { getent ahosts "$JAMIN_DOMAIN" >/dev/null; }
health_code() { curl -s -m 20 -o /dev/null -w '%{http_code}' "$URL/healthz" || true; }

hold_previous() {  # $1 = image ID the replaced container ran: keep it by ID in a stopped container
  local prev id=${1:-}
  prev=$(cat PREVIOUS_TAG 2>/dev/null) || { echo "note: first deploy, no rollback image yet"; return 0; }
  [ -n "$id" ] || id=$(docker image inspect -f '{{.Id}}' "jamin:$prev" 2>/dev/null) || id=""
  [ -n "$id" ] || { echo "WARNING: rollback image jamin:$prev not found; --rollback will fail" >&2; return 1; }
  docker rm -fv "$HOLDER" >/dev/null 2>&1 || true
  docker tag "$id" "jamin:$prev"
  docker create --name "$HOLDER" --network none --restart no --label "sasateguh.tag=$prev" "jamin:$prev" >/dev/null
  echo "rollback image held: jamin:$prev (${id:7:12})"
}

browser_check() {  # the end-to-end suite only reads pages; the simulator runs inside the browser
  (cd .. && E2E_BASE_URL="$URL" $BROWSER_CMD npx playwright test --reporter=line)
}

mode=${1:-deploy}
case "$mode" in
  --status)
    $DC ps
    echo "current $(cat CURRENT_TAG 2>/dev/null || echo -) · previous $(cat PREVIOUS_TAG 2>/dev/null || echo -)"
    docker inspect -f 'rollback holder: {{index .Config.Labels "sasateguh.tag"}}' "$HOLDER" 2>/dev/null || echo "rollback holder: none"
    echo "public /healthz $(health_code)"; exit 0 ;;
  --rollback)
    dns_ok || { echo "$JAMIN_DOMAIN does not resolve, nothing was changed"; exit 1; }
    TAG=$(cat PREVIOUS_TAG 2>/dev/null) || { echo "no PREVIOUS_TAG"; exit 1; }
    if ! docker image inspect "jamin:$TAG" >/dev/null 2>&1; then
      id=$(docker inspect -f '{{.Image}}' "$HOLDER" 2>/dev/null) || { echo "image jamin:$TAG is gone"; exit 1; }
      docker tag "$id" "jamin:$TAG"
    fi
    [ -r CURRENT_TAG ] && cp CURRENT_TAG PREVIOUS_TAG ;;
  deploy)
    dns_ok || { echo "$JAMIN_DOMAIN does not resolve: create the DNS record first, nothing was changed"; exit 1; }
    [ -z "$(git -C .. status --porcelain)" ] || { echo "working tree not clean: commit first (the image is built from HEAD)"; exit 1; }
    free=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
    [ "$free" -ge "$MIN_FREE_GB" ] || { echo "less than ${MIN_FREE_GB} GB free on /, stopping"; exit 1; }
    TAG=$(git -C .. rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M)
    ctx=$(mktemp -d); trap 'rm -rf "$ctx"' EXIT
    git -C .. archive HEAD | tar -x -C "$ctx"   # clean tree: untracked and ignored files never reach the image
    $BUILD_CMD -t "jamin:$TAG" "$ctx"
    [ -r CURRENT_TAG ] && cp CURRENT_TAG PREVIOUS_TAG ;;
  *) echo "usage: deploy.sh [--rollback|--status]"; exit 2 ;;
esac

old_id=$(docker inspect -f '{{.Image}}' jamin 2>/dev/null || true)
JAMIN_TAG=$TAG $DC up -d --force-recreate jamin
echo "$TAG" > CURRENT_TAG

route=$(mktemp)
sed -e "s|@DOMAIN@|$JAMIN_DOMAIN|g" -e "s|@CERT_RESOLVER@|$CERT_RESOLVER|g" traefik.yaml.tmpl > "$route"
chmod 644 "$route"
docker cp "$route" "$PROXY_CONTAINER:$PROXY_DYNAMIC_DIR/jamin.yaml"; rm -f "$route"

for _ in $(seq 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' jamin)" = healthy ] && break; sleep 3; done
no_rollback=0; [ "$mode" = --rollback ] || hold_previous "$old_id" || no_rollback=1

# Keep only the current and previous images of this project; the host disk is shared.
docker images jamin --format '{{.Tag}}' | grep -vxF -e "$TAG" -e "$(cat PREVIOUS_TAG 2>/dev/null || echo -)" \
  | sed 's/^/jamin:/' | xargs -r docker rmi >/dev/null 2>&1 || true

# A new route or certificate can take a little while: wait and retry before calling it a failure.
code=000
for _ in $(seq 9); do code=$(health_code); [ "$code" = 200 ] && break; sleep 10; done
echo "tag $TAG · public /healthz $code"
[ "$code" = 200 ] || { echo "public health is not 200: check the certificate and route; undo with deploy/deploy.sh --rollback"; exit 1; }

if [ "$mode" = deploy ] && ! browser_check; then
  if [ -r PREVIOUS_TAG ] && [ "$no_rollback" = 0 ]; then echo "browser check failed: rolling back"; exec "$0" --rollback; fi
  echo "browser check failed and there is no previous image to return to"; exit 1
fi
[ "$no_rollback" = 0 ] || { echo "live, but no rollback image is held (warning above)"; exit 1; }
