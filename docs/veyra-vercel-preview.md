# Veyra on Vercel — preview deployment and acceptance gates

**Status (2026-10-11):** frontend build configuration is in the repository.
**An initial user-provided Vercel Preview URL exists but has not been independently verified as public/accessible to this runtime.** A successful GitHub CI
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
`VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1 bun run build` command. The build-time lock cannot be
turned off by a browser query param or a missing backend. Vite selects
`preview.html` as the **initial Rollup HTML input**, which imports
`src/preview/main.tsx` and only dedicated offline Home, Agent, Activity, Settings and
read-only Pay/Convert/Bridge routes. It now includes **real injected
wallet account connection** via EIP-6963/EIP-1193 (`eth_requestAccounts`,
`eth_accounts`, `eth_chainId`) and Arc Testnet **read-only USDC balance**
queries using the generated on-chain facts registry (RPC `eth_chainId`
plus `eth_call balanceOf`). No wallet signer, message signature, general payment execution hooks, backend clients or ActivityReceipt
recovery modules are imported into this published React entry. One
independently constrained direct Arc Testnet ERC-20 transfer signer is
imported ONLY into the beta Pay page; no blanket approve or CCTP signing. The resulting
`dist/preview.html` is renamed to `dist/index.html` only after build;
trying to build both a live and preview HTML entry fails. The canonical financial
execution gate remains fail-closed in the full application as defense in
depth. CI scans the emitted static JavaScript bundle after a dedicated
preview build using `bun run check:vercel-preview-bundle`. The local Vite
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

**UI-only preview restrictions:** the standalone Vercel Preview never imports Veyra's general money-moving
execution pipeline. **Pay supports one capped direct Arc Testnet USDC
wallet-signed transfer per explicit user approval.** Convert and Bridge
remain read-only; no CCTP source burn can be initiated. The Activity recovery
button is suppressed, and the recovery runtime separately rejects resumption.
The updated Preview uses a dedicated responsive dark-fintech dashboard,
real **browser-injected wallet connection** (MetaMask/Rabby/Coinbase Wallet
when injected into the browser), and Arc Testnet USDC balanceOf reads through
an independent public RPC. The wallet may be connected on any network because
Arc balances are read from the known Arc RPC — Veyra does not request a chain
switch. Browser-extension permission prompts are for **account visibility
only**, not a spending authorization or verified Veyra ID. WalletConnect QR
and server-signed identity are not available in this version. Public RPC
readouts may fail if the remote RPC is unavailable or blocks browser CORS;
the UI displays an error rather than inventing a balance.

Pay, Convert and Bridge now expose interactive input/review forms; the review is *non-signing* for Convert/Bridge. Pay has a separate,
clearly labeled live testnet-only route with user-signed wallet transfer
and on-chain verification, but no identity resolution.
Agent calls a token-gated server-side OpenAI model when configured (otherwise it explicitly fails); Activity
shows an honest empty state (not fictional transactions for a connected
wallet). Do not treat identities, remote receipts or bridge execution as
functional without an independently verified BFF. Keep the
first deployment private/restricted if testing with real accounts.

## Live Veyra AI on Vercel (NO scripted answers)

The Preview's Agent screen now calls a **real server-side Vercel Function**
at `GET/POST /api/agent/chat`, implemented in `api/agent/chat.ts`.
This is independent of the large Express BFF and **does not require
PostgreSQL** just to get AI answers. The UI will no longer produce
deterministic, canned or fallback responses.

In **Vercel → veyra → Settings → Environment Variables**, configure
all three variables in the **Preview** environment (server-only):

| Name | Value / rule |
|---|---|
| `VEYRA_AGENT_ENABLED` | `1` |
| `OPENAI_API_KEY` | your actual OpenAI API key, stored as a secret; **never** prefix with `VITE_` |
| `VEYRA_AGENT_BETA_TOKEN` | a separate user-generated random access string, **at least 24 characters**, stored as a secret |

Redeploy the latest **`phase5-production-bridge-flow` commit** as a
Preview Deployment (environment changes require a redeploy). Test
`/api/agent/chat` with GET: it must return
`{"ok":true,"live":true,"provider":"openai",...}` before the
UI accepts a chat. In Agent, enter the **beta token only** into the
password field; **never** enter the OpenAI API key into any website
input. Its value stays in page memory, not localStorage. The assistant
then forwards the user's text to OpenAI from the Vercel Function and
renders **only verified `live:true` replies**.

The backend checks the bearer beta token with constant-time equality,
rejects oversized messages, truncates history, caps completion tokens
per request, has an upstream timeout, requests `store:false` from the
provider, and does not expose API keys or upstream error details.
Missing/wrong config, invalid beta access, API credit exhaustion,
timeouts and upstream errors fail closed with an explicit error, not a
pretend conversation. The model cannot execute transfers or fetch
authenticated data.

**Cost/security:** a beta access token protects the paid provider
from random website visitors but is not distributed global rate
limiting. Keep this deployment access-restricted, configure Vercel WAF
rate limits and provider spending limits, share the beta token only
with trusted testers, and rotate it if exposed. An OpenAI account/API
key with credit is required; ChatGPT subscription access alone does
not provide API billing. The Express BFF later supersedes this minimal
AI-only function when independent identity/session validation is live.

Convert and Bridge **no longer show simulated review/results**: their
pages explain that the actual backend/settlement service is not deployed
and do not offer transaction-signing or fabricated quotes. Direct capped
Arc Testnet USDC Pay remains a separate real-wallet testnet feature.

## Live direct USDC payment beta (limited, opt-in testnet-only)

The Vercel Git Preview build now explicitly sets
`VITE_VEYRA_TESTNET_PAY=1` **alongside**
`VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1`. That flag selects a
**separate, independently coded** `PreviewTestnetPayPage` inside
`src/preview/PreviewApp.tsx`; it does NOT load the full Veyra finance
execution runtime or override the original `assertExecutionReady` gate.

Scope and requirements:

- **Actually sends:** direct wallet-authorized ERC-20
  `transfer(recipient, amount)` on Arc Testnet 5042002 to a complete
  EVM wallet address; uses the canonical onchain-facts USDC contract
  `0x3600000000000000000000000000000000000000`.
- **Hard per-transaction cap:** 1.000000 *testnet* USDC maximum, six
  decimal places, no approvals, no permits and no arbitrary contract
  or token selection; not a daily quota or a multi-wallet spend limit.
- **Human-in-the-loop:** the user must connect their own injected wallet,
  manually switch it to Arc Testnet, enter a recipient/amount, inspect a
  visible immutable review, check the explicit acknowledgement and
  **personally accept the wallet's transaction request**. Veyra does not
  sign on the user's behalf.
- **RPC preflight:** independent Arc Testnet `eth_chainId` read, wallet
  `eth_chainId`, `eth_accounts` and the reviewed USDC `balanceOf`
  must all agree before requesting `eth_sendTransaction`.
- **Receipt verification:** no green result from a returned hash alone.
  `eth_getTransactionByHash` must exactly match the sender,
  recipient-transmitter contract and reviewed calldata;
  `eth_getTransactionReceipt` must be successful, include the
  matching ERC-20 `Transfer(from, to, amount)`, have a canonical
  block hash and at least two confirmations. A revert, mismatched log,
  wrong chain, RPC error or reorg never produces VERIFIED.
- **Lost response:** the browser saves a local per-account submission
  journal before calling the wallet. A known hash survives reload and
  can be rechecked; an uncertain wallet response stays locked until
  the original transaction hash can be recovered independently.
  The app does **not** repeat the send automatically. LocalStorage is
  a recovery convenience only, not authoritative cross-device history.
- **Still disabled:** payments to Veyra IDs, real StableFX conversions,
  CCTP source burns/destination relays, cloud ActivityReceipt,
  identity-based sessions and mainnet. Those require the authenticated
  backend and separate live security acceptance.

Do a disposable-wallet test with a very small Arc Testnet USDC amount.
The account also needs sufficient native Arc Testnet gas token (its gas
decimals differ from ERC-20 USDC decimals). Wallet and Arc RPC availability
or browser CORS can prevent a transaction; never infer success from a
missing response. A green GitHub CI with mocked RPC **is not** proof that
a hosted user has completed a live transaction. Capture the real explorer
link/tx receipt in the PR before calling this path field-accepted.

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
# The real Vercel frontend build:
VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1 bun run build
bun run check:vercel-preview-bundle
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
