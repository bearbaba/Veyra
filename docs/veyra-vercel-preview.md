# Veyra on Vercel — preview deployment and acceptance gates

**Status (2026-10-11):** frontend build configuration is in the repository.
**No actual Vercel deployment URL has been verified.** A successful GitHub CI
build is not a Vercel deployment and does not prove that an authenticated BFF
or live cross-chain bridge works.

## Deployment architecture

```text
Browser -- HTTPS --> Vercel static Vite frontend (dist/)
                        |
                        +-- /api/* --> authenticated Veyra Express BFF (separate)
                                           |
                                           +-- PostgreSQL with migrations 0000–0012
                                           +-- Arc and destination chain RPCs
                                           +-- Circle attestation service
                                           +-- optional server-side agent credentials
```

Vercel's Git deployment supports Vite build output; this repository now
contains `vercel.json` for **the static frontend only**, with a mandatory
`VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 bun run build` command. The build-time lock cannot be
turned off by a browser query param or a missing backend. The canonical
financial execution gate rejects signing, and Pay/Convert/Bridge use
read-only preview screens. Activity disables wallet-signing recovery. The local Vite
development proxy (`vite.config.ts`, `/api` to `localhost:3001`) is NOT
active on Vercel. There is intentionally **no production `/api` rewrite**
in the initial config: silently forwarding user credentials or signed wallet
workflows to an unapproved origin is unsafe. Missing BFF requests must fail,
not return an HTML SPA fallback masquerading as JSON. Veyra's
`WebPreviewBanner` checks `/api/health` and reports UI-only/offline status.

The same repository contains `server/bff.ts` (Express) with many authenticated
and database-backed routes. Its normal entrypoint calls `app.listen`;
**do not assume Vercel serves it simply because a static Vite build succeeds**.
For the integrated preview, first deploy and validate the BFF independently
under HTTPS, or implement and verify an explicit Vercel Functions adapter.
Do not put DB, API or relay secrets into the frontend.

## First milestone: inspect Veyra UI on a Vercel Preview URL

1. In Vercel, **Add New → Project → Import Git Repository**
   `bearbaba/Veyra`, authorize GitHub access if requested.
2. Select **Vite** with the repository root as Root Directory. The checked-in
   `vercel.json` sets `bun install --frozen-lockfile`, `bun run build`,
   and `dist` output. Vercel has Bun support; use the repository's pinned
   `.bun-version` as the reference for consistent builds.
3. Under **Environment Variables**, choose the Preview environment and add
   `VITE_VEYRA_ENV=testnet`. Do not set `VITE_DEV_TOOLS=true` in preview.
   Do not set `VITE_VEYRA_ENV=mainnet`.
4. Keep PR #7 open. Configure a preview deployment for
   `phase5-production-bridge-flow` (or have Vercel build PR #7). The Vercel
   production branch and mainnet release must not be changed for this test.
5. Check that the deployed URL serves the Veyra Home and navigation, CSS and
   assets load with no browser console errors, and `/api/health` correctly
   reports unavailable until the BFF is deployed. Do **not** treat a
   UI-only preview as a working payment/bridge demonstration.

**UI-only preview restrictions:** this specific Vercel build cannot sign
money-moving actions via Veyra's canonical execution pipeline. Pay, Convert
and Bridge routes display read-only interactive flows. The Activity recovery
button is suppressed, and the recovery runtime separately rejects resumption.
Home may still display wallet-connection and identity controls; connecting a
wallet is not a transfer. The Agent degrades to local fallback when the
backend is unavailable. Do not treat identities, remote receipts or bridge
execution as functional without an independently verified BFF. Keep the
first deployment private/restricted if testing with real accounts.

## Second milestone: connected testnet preview

Provision a separate deployment for the BFF (or add a fully tested Functions
adapter) and a secure managed PostgreSQL database. The BFF must start with
strict testnet configuration, verified HTTPS and auth settings, and a trusted
wallet-session origin. Configure server-side secrets **only in the backend**:

| Environment variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | BFF only | Persistent PostgreSQL, HTTPS/TLS-backed credentials |
| `ARC_TESTNET_RPC_URL` | BFF only | Arc source receipt and transaction verification |
| `ETH_SEPOLIA_RPC_URL` | BFF only | Ethereum Sepolia destination proof |
| `BASE_SEPOLIA_RPC_URL` | BFF only | Base Sepolia destination proof |
| `CIRCLE_API_KEY` | BFF only, optional by feature | Authenticated Circle integration |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | BFF only, optional by feature | Agent/LLM integration |
| `VEYRA_APP_ORIGIN` | BFF only, if social login used | Approved redirect/application origin |
| `VITE_VEYRA_ENV=testnet` | Vercel frontend Preview | Explicit testnet UI configuration |

This table is **not exhaustive** for optional X OAuth, Circle App Kit,
session signing, KMS/HSM or mainnet provider activation. Validate each
integration separately against the actual runtime configuration. Never commit
private keys or tokens; never use `VITE_*` for secrets.

Database migrations are a separate, deliberately authorized operation.
Against a disposable preview DB, run `bun run db:migrate`, then
`bun run db:verify` from a trusted administrative environment and check
the schema and required initial data. Never aim preview at an active
production database. The BFF should serve `GET /api/health` and
`GET /api/health/database` successfully and authenticate an identity session.
Testing just the health endpoint is not sufficient for bridge readiness.

Only **after the BFF is independently deployed and approved**, add a
Vercel external rewrite or same-origin API gateway:
```json
{
  "source": "/api/:path*",
  "destination": "https://YOUR-VERIFIED-BFF-HOST/api/:path*"
}
```
Place this rewrite before any future generic SPA fallback. Do not paste the
placeholder into production; do not point the gateway at an arbitrary external
server. Check authorization-header handling, TLS, request size/timeouts,
CSRF/session expectations and the BFF response for each feature. See Vercel's
official [rewrite documentation](https://vercel.com/docs/routing/rewrites).

## Third milestone: actual CCTP acceptance, not just preview UI

The authenticated testnet journey must demonstrate:

- an approved source burn on Arc Testnet, a unique Circle attestation, and
  a verified USDC mint on Ethereum Sepolia or Base Sepolia;
- no duplicate source burn across reload, tab/device races or intermittent RPC;
- original attempt #1 hash preserved, chain-verified revert finality,
  immutable second attempt audit and successful second-mint settlement where applicable;
- an authenticated `ActivityReceipt` with canonical `COMPLETE` evidence,
  a separate settlement hash when attempt #2 succeeds, and consistent recovery
  after browser reload;
- correct session ownership, rate limits, secrets isolation, failure handling,
  on-chain balance change, and independent security review.

**Important:** migration 0010–0012 supports second-attempt recovery and
settlement proofs, but the second wallet-signing/broadcast boundary remains
intentionally disabled. A testnet E2E transfer requires the wallet owner's
approval and signature. Do not expose production/mainnet actions or merge PR #7
until those gates have verified results.

## Pre-deploy and post-deploy checks

Pre-deploy:
```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test -- --run
bun run build
bun run check:prod-bundle
```

Post-deploy checks:

1. Open the Vercel Preview URL on desktop and mobile, verify correct assets,
   title, navigation and no blank page.
2. Verify `/api/health` explicitly reports unavailable for a UI-only preview,
   or returns JSON and valid BFF state after approved backend routing.
3. Verify login/session and DB health against a disposable testnet DB only.
4. Verify no `VITE_*` variable carries wallet private keys, Circle secrets,
   PostgreSQL credentials, provider API keys or signing credentials.
5. Test erroneous RPC/Circle responses, duplicate submissions, and cross-device
   recovery independently before asking a tester to sign CCTP.
6. Link the actual Vercel deployment URL, branch SHA, backend revision and
   real testnet transaction receipts in PR #7 as acceptance evidence.

## Current blockers

- Actual Vercel project connection and deployment URL need a Vercel account.
- Static Vite preview does not deploy the Express BFF or PostgreSQL by itself.
- Authenticated CCTP end-to-end production-UI transaction and security review
  remain unverified. No proof from a local build or GitHub CI replaces them.

**Do not report a public Vercel demo as live until its actual URL is deployed
and checked.**
