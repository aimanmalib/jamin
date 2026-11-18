# vendor/

`bitauth-libauth-3.1.0-next.8-mainnet-pat-1cf4b43.tgz` is `@bitauth/libauth` 3.1.0-next.8 as built from the
`mainnet-pat` fork of libauth at commit `1cf4b432864b3a4ed9f33d1992355d7286f3dab8`
(https://github.com/mainnet-pat/libauth). The SolidCash and mem-cash packages depend on that commit through a git
URL; `package.json` `overrides` point each of them at this tarball instead, so `npm ci` installs it from disk and
never clones the fork. Why, and what was compared: `docs/decisions/0010-vendored-libauth-fork.md`.

- License: MIT, Copyright (c) Jason Dreyzehner (the `LICENSE` file inside the tarball; see also `NOTICE`).
- Size: 1352548 bytes, 1006 files once unpacked.
- sha512 (hex): `6e8fc8e44fae440c81b69c0701e07dfe9ab590781f98a793b3ed73f04514d45484cf9d412ac492df47fcf0bcf5dd42009da9acc5f3a6b245fb7fe7e549968fa7`
- sha512 (npm integrity, as in `package-lock.json`):
  `sha512-bo/I5E+uRAyBtpwHAeB9/pq1kHgfmKeTs+1z8EUU1FSEz51BKsSS30f88Lz13UIAnamsxfOmskX7f+flSZaPpw==`.
  This is the same integrity the lockfile recorded for the git dependency before the change.

The root dependency `@bitauth/libauth` 3.0.0, which Jamin's own code imports, still comes from the npm registry and
is not affected.

## Rebuilding

The tarball is the output of `npm pack --ignore-scripts` run on the package folder that npm 10 installed from the
git URL above. To rebuild it on a machine that still has such an install (for example a checkout of a commit before
this folder existed, after `npm ci`):

```sh
t=$(mktemp -d)
cp -a node_modules/@mem-cash/core/node_modules/@bitauth/libauth "$t/src"
npm pack "$t/src" --ignore-scripts --cache "$t/cache" --pack-destination "$t"
sha512sum "$t/bitauth-libauth-3.1.0-next.8.tgz"   # must print the hex digest above
```

`npm pack` sets fixed timestamps and file order, so the digest is reproducible.

## Updating the lockfile

npm resolves a `file:` override relative to the project root when it validates the tree, but relative to the parent
package when it fetches a dependency it has not resolved yet. With the nested entries already in `package-lock.json`,
`npm ci`, `npm install` and `npm ls` all work. If an upgrade of SolidCash or mem-cash drops those entries and
`npm install` fails with `ENOENT ... node_modules/<parent>/vendor/...`, temporarily set the override values to
`file:../../../vendor/<tarball>` (relative to `node_modules/@scope/name`), run `npm install --package-lock-only`, then
set them back to `file:vendor/<tarball>`; the lockfile keeps the root-relative `resolved` value either way.
