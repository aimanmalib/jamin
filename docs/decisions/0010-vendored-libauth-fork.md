# 0010: Install the libauth fork from a vendored tarball instead of a git URL

Date: 2026-11-18. Status: accepted.

## Context

`@solidcash/{solidc,solidcash,testing,utils}` 0.51.1 and `@mem-cash/{core,electrum,server,storage,types,validation}`
0.0.11 each depend on `@bitauth/libauth` through
`git+https://github.com/mainnet-pat/libauth.git#1cf4b432864b3a4ed9f33d1992355d7286f3dab8`. The lockfile held ten
nested copies resolved to that git URL. Every `npm ci` therefore cloned the whole fork history (about 640 MB per
clone) into the npm cache's temporary folder, and npm then ran the package's build. On a shared machine with little
free disk this filled the disk in an afternoon of installs, and CI depended on GitHub git access at install time.

The fork is not the published `@bitauth/libauth@3.1.0-next.8`: the registry tarball differs from the installed fork
in 28 files, among them the VM arithmetic, inspection and push operations (`build/lib/vm/instruction-sets/...`).
SolidCash compiles and evaluates contracts with this VM, so the published version is not a substitute.

Options considered:

1. Depend on the published 3.1.0-next.8. Rejected: different VM code (above).
2. Switch to pnpm or yarn and their patch or catalog features. Rejected: changes the package manager of the
   project for one dependency.
3. `npm-force-resolutions` or `patch-package`. Rejected: npm's own `overrides` covers the case.
4. Pack the fork once at the same commit, keep the tarball in `vendor/`, and point the ten parents at it with nested
   npm `overrides`. Chosen.

## Decision

- `vendor/bitauth-libauth-3.1.0-next.8-mainnet-pat-1cf4b43.tgz` (1352548 bytes) holds the fork at commit `1cf4b43`.
- `package.json` `overrides` maps `@bitauth/libauth` to `file:vendor/<tarball>` under each of the ten parents. The
  root dependency `@bitauth/libauth` 3.0.0 from the registry, which `src/` imports, is untouched.
- `package-lock.json` resolves all ten nested entries to `file:vendor/<tarball>`; no entry is resolved to `git+`.
- The Dockerfile copies `vendor/` before `npm ci`. `.dockerignore` does not exclude it.

## How the tarball was made and checked

`npm pack 'git+https://github.com/mainnet-pat/libauth.git#1cf4b43...'` with npm 10.9.8 fails after the clone with
`GitFetcher requires an Arborist constructor to pack a tarball`. The tarball was instead packed with
`npm pack --ignore-scripts` from the package folder npm had installed from that git URL (the ten installed copies
were compared with `diff -rq` and are identical). Checks:

- `diff -r` between the installed copy and the unpacked tarball: empty output; 1006 files on both sides.
- The tarball's sha512 is `sha512-bo/I5E+uRAyBtpwHAeB9/pq1kHgfmKeTs+1z8EUU1FSEz51BKsSS30f88Lz13UIAnamsxfOmskX7f+flSZaPpw==`,
  the same integrity the previous lockfile recorded for the git dependency. The bytes are the ones npm built from
  the commit.
- In a clean `git archive` copy with the new `package.json`, lockfile and `vendor/`, `npm ci` with a fresh cache and a
  fake `git` first on `PATH` (it records any call and exits 1) installed 215 packages in about 30 s; the fake `git`
  was never called and the cache had no `git-clone*` folder. `npm ls @bitauth/libauth` reported no error and a
  following `npm install` left the lockfile unchanged.
- In that copy, `npm run solidhat:test` (92 tests) and `npx vitest run` (82 tests) passed.

## Install check in CI

`scripts/npm-ci-no-git.sh` replaces the plain `npm ci` step of `.depot/workflows/gerbang.yml`. It fails when
`package-lock.json` has a `"resolved": "git+` entry, when npm calls `git` (a fake `git` first on `PATH` records each
call and exits 1), or when npm leaves a `git-clone*` folder in its cache (a fresh `--cache` in a temporary folder).
The temporary folder is removed on exit; on an interrupt the script stops npm's whole process group first, so
nothing is written into the folder after it is gone.

Checks of the script, each in a `git archive` copy with a fresh cache (Node 22.23.1, npm 10.9.8):

- Current lockfile: `npm-ci-no-git: ok (no git calls, no git-clone* in the cache)`, 215 packages, 40 to 52 s.
- One nested entry set back to its old `git+ssh://...libauth.git#1cf4b43...` value:
  `package-lock.json resolves a package to a git URL`, exit 1, before npm runs.
- The `package.json` and lockfile from before this record, with the `"resolved": "git+` text respaced so that the
  lockfile check misses it: the fake `git` was never called, because npm 10 fetches a GitHub dependency as an
  https tarball and then runs its `prepare` build. That build is what fills the cache: after 400 s the temporary
  cache held 9 `git-clone*` folders, 6.3 GB, and the run had not finished. The `git-clone*` check is the one that
  catches this case; the run was stopped there.
- A stand-in `npm` that runs `git clone`: `npm called git 1 time(s)`, exit 1.
- A stand-in `npm` that creates `_cacache/tmp/git-clone*` and exits 0: `npm left 1 git-clone* folder(s) in its
  cache`, exit 1.
- `timeout 25` on the old-lockfile case: the script exited, no `npm` process was left and its temporary folder was
  removed.

## Consequences

- Installs no longer need git or network access to GitHub, and no longer write a clone to the npm cache.
- The repository carries a 1.3 MB binary. It changes only when SolidCash or mem-cash move to another libauth
  commit; then a new tarball is packed the same way and the overrides and this record are updated.
- npm resolves a `file:` override relative to the project root when validating, but relative to the parent when
  fetching an unresolved entry. `vendor/README.md` describes the workaround if a future lockfile regeneration hits it.
- Undo: revert the commit that added this record. The git URL entries return to the lockfile and so do the clones.
