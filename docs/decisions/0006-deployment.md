# 0006: Static container behind the host's reverse proxy

Date: 2026-11-17. Status: accepted.

## Context

The web app (ADR 0005) is a static site: the simulator runs in the visitor's browser and the Lifecycle page reads
Electrum from the browser. It needs a public URL but no backend, no keys and no state.

## Decision

- One image built from a clean `git archive` of HEAD (`deploy/deploy.sh`), so untracked and ignored files (`.env`,
  `state/`, notes) never reach the build context; `.dockerignore` excludes them as well.
- Build stage: Node 22, `npm ci`, `npm run build` (compile the contracts, then Vite). Run stage: `nginx:1.30.6-alpine`
  as the unprivileged `nginx` user on a read-only file system, with `/tmp` as tmpfs for the pid and temp files.
- The web server config is a template (`deploy/nginx.conf.tmpl`) filled at build time by `scripts/nginx-conf.ts`
  from `config/jamin.json`: the Content-Security-Policy directives live in `deploy.contentSecurityPolicy`, and the
  mainnet Electrum origin is added to `connect-src` from `electrum.mainnet`, so changing the server changes the
  policy. `script-src` allows `'wasm-unsafe-eval'` because the SDK runs secp256k1 and the VM as WebAssembly; no
  inline scripts or styles are allowed.
- HTML is sent with `Cache-Control: no-cache, no-transform`; hashed files under `/assets/` are `immutable` for
  `deploy.assetMaxAgeSeconds`. nginx compresses responses itself.
- `/healthz` answers `ok`. After the switch, the script retries the public `/healthz` for up to 90 seconds, then
  runs the whole Playwright suite (Chromium desktop and WebKit iPhone 13) plus the header checks in
  `e2e/live.spec.ts` against the public URL. A failed browser check runs `deploy/deploy.sh --rollback`, which starts
  the previous image held by the stopped `jamin-undur` container.
- Host values (domain, proxy container, network, certificate resolver, build command) live in `deploy/hos.env`,
  which is not tracked; `deploy/hos.env.example` lists them.

## Consequences

- Changing the Electrum server or the security policy needs a new image, not a code change.
- The container has nothing to protect: a compromise of it can change the page but cannot move coins.
- Undo: `deploy/deploy.sh --rollback`; to remove the site, stop the container and delete the route file from the
  proxy's dynamic folder.
