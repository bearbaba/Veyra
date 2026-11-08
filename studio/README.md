# Studio workspace tooling

Environment tooling for developing Veyra inside an Arc Studio sandbox. Nothing in the
application imports anything under `studio/`; it can be deleted without affecting a
build. It exists so a fresh sandbox can be made correct from GitHub alone.

## The problem it solves

Studio runs `bun run dev`, `bun run server` and friends in the **workspace root**. That
directory can hold an outdated snapshot of the app. Without this tooling those commands
silently serve the snapshot instead of this repository.

## Set up a workspace

```bash
# inside the Studio workspace root
git clone https://github.com/bearbaba/Veyra.git Veyra-github
bash Veyra-github/studio/bootstrap.sh --install
```

`bootstrap.sh` rewrites only the root `package.json` `scripts`, keeps the original once
as `package.json.snapshot-original`, and then verifies the result. It is idempotent.
`bash Veyra-github/studio/bootstrap.sh --verify` re-checks without changing anything.

## What each root command does afterwards

| Root command | Behaviour |
| --- | --- |
| `bun run dev` | `studio/dev.sh`: Preview of this repo with the Mainnet profile read from `scripts/build-mainnet-pilot.ts`, one Vite process, `--strictPort`, esbuild heap capped |
| `bun run server` | `studio/local-backend.sh`: isolated local backend (see below) |
| `bun run build` | `studio/build.sh`: refuses when memory is too low for a production build; `STUDIO_ALLOW_BUILD=1` overrides |
| `bun run lint`, `typecheck`, `check`, `test`, `test:watch`, `lint:fix`, `contracts:*`, `check:*` | delegated to this repo with `bun run --cwd` |
| anything else (`deploy:self`, `db:*`, `production:*`, `providers:health`, ...) | **refuses** with an explanation; run it inside the repo deliberately if intended |

The mapping is `studio/rootScripts.ts`, and a test fails if any root script could run
the snapshot.

## Isolation from Production

- **Frontend:** `vite.config.ts` proxies `/api` to `http://localhost:3001` only. Dev mode
  never sets `VERCEL_ENV=production`, so Mainnet signing is disabled in the Preview.
- **Mainnet identity:** the backend grants Mainnet identity authority only when the
  request `Origin` is the official production origin and the process is a hosted
  production mainnet backend (`server/services/mainnetIdentityCapability.ts`). A Preview,
  `localhost` or any other origin is refused, so it cannot reach live identity or
  payment routes even if misconfigured.
- **Local backend:** `local-backend.sh` builds its environment from scratch (`env -i`).
  It sets `VEYRA_ENV=local`, a dedicated database `veyra_studio_dev` on `127.0.0.1`
  inside the local Postgres container, and a per-machine random session secret. No Circle,
  X, LLM, relay or signer keys and no Render/Vercel tokens are passed. It refuses to start
  when a `.env*` file would be auto-loaded, and never touches the `veyra` database.
- Mainnet identity therefore cannot be exercised against any non-production backend.
  `studio/e2e/identity-session.mjs` instead drives the real frontend in a browser that
  presents the official origin while serving files from the local Preview. The backend is a
  fake inside the test (it verifies EIP-712 signatures and wallet-bound sessions), the
  wallet is a freshly generated throwaway key that refuses every transaction method, every
  non-local request is aborted, and WebSockets are blocked.

## Resource limits (3.9 GB sandbox)

esbuild is a Go program; uncapped, its heap grows to about 2 GB and the kernel kills it.
Vite does not restart it, so uncached modules then fail with
"The service is no longer running". `dev.sh` sets `GOMEMLIMIT=700MiB GOGC=50`.
If the Preview shows that error but `curl localhost:5173/src/onchain-facts.ts` returns
200, the server is healthy and the browser holds a stale overlay: reload.
A full production build does not fit next to the Preview; Vercel builds Production.

## Real-browser checks

```bash
bash Veyra-github/studio/browser/setup.sh              # once per sandbox, no root needed
bash Veyra-github/studio/browser/run-render-check.sh   # every page at 1280, 390 and 320 px
bun   Veyra-github/studio/browser/module-crawl.ts      # every module reachable from main.tsx
node  Veyra-github/studio/e2e/identity-session.mjs     # wallet + Veyra ID session scenarios (54 checks)
```

`setup.sh` downloads Chromium, unpacks its Debian libraries and a fallback font under
`/tmp` (lost on a sandbox reset; re-run it). Screenshots go to `/tmp/shots`.
