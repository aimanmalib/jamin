#!/usr/bin/env bash
# Offline test gate: lint, types, SolidHat contract tests, unit tests, build.
# No network access and no wallet: contracts run on the SolidCash mock network.
set -euo pipefail
cd "$(dirname "$0")/.."
# Git hooks export GIT_DIR and friends; tests that create temporary repositories must not inherit them.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export NO_COLOR=1 CI=1
step() { printf '\n== %s\n' "$1"; }
step lint;          npm run --silent lint
step typecheck;     npm run --silent typecheck
step solidhat:test; npm run --silent solidhat:test
step solidhat:list; npx tsx scripts/solidhat-list.ts --check
step unit;          npm run --silent test
step build;         npm run --silent build
printf '\ngate passed\n'
