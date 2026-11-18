#!/usr/bin/env bash
# Runs `npm ci` and fails if npm needs git for any dependency.
# The libauth fork is installed from vendor/ (docs/decisions/0010-vendored-libauth-fork.md); this check keeps it so.
# Fails when:
#   1. package-lock.json resolves any package to a git URL,
#   2. npm calls git (a fake git first on PATH records every call and exits 1),
#   3. npm leaves a git-clone* folder in its cache (a fresh cache in a temporary folder, removed on exit).
# Extra arguments are passed to `npm ci`.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { printf 'npm-ci-no-git: FAIL: %s\n' "$1" >&2; exit 1; }

lock=package-lock.json
[ -f "$lock" ] || fail "$lock not found"
if grep -n '"resolved": "git+' "$lock" >&2; then
  fail "$lock resolves a package to a git URL (lines above)"
fi

t=$(mktemp -d)
pid=
# On interrupt, stop npm and the installs it spawned (own process group), then clean up.
# Waits up to 10 s for the group to exit so that nothing writes into the folder after it is removed.
stop() {
  if [ -n "$pid" ]; then
    kill -- "-$pid" 2>/dev/null || true
    for _ in $(seq 50); do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  exit "$1"
}
trap 'rm -rf "$t"' EXIT
trap 'stop 143' TERM
trap 'stop 130' INT
mkdir "$t/bin"
cat > "$t/bin/git" <<EOF
#!/bin/sh
printf '%s\n' "git \$*" >> "$t/git-calls"
exit 1
EOF
chmod +x "$t/bin/git"

rc=0
PATH="$t/bin:$PATH" setsid npm ci --cache "$t/cache" --no-audit --no-fund "$@" &
pid=$!
wait "$pid" || rc=$?
pid=

if [ -s "$t/git-calls" ]; then
  head -n 5 "$t/git-calls" >&2
  fail "npm called git $(wc -l < "$t/git-calls") time(s) (first calls above)"
fi
clones=$(find "$t/cache" -maxdepth 3 -name 'git-clone*' 2>/dev/null | wc -l)
[ "$clones" -eq 0 ] || fail "npm left $clones git-clone* folder(s) in its cache"
[ "$rc" -eq 0 ] || fail "npm ci exited with $rc"
printf 'npm-ci-no-git: ok (no git calls, no git-clone* in the cache)\n'
