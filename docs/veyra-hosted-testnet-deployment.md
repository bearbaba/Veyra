# Hosted Veyra Testnet backend (Phase 5) — controlled activation

**Current state: configuration and CI candidate only. No Render resources,
PostgreSQL instances or real-wallet transactions have been created by adding
this file. Public traffic must stay disconnected until live acceptance passes.**

This runbook prepares an independently hosted Express BFF and private Postgres
for the existing *testnet* Vercel frontend; it does not authorize mainnet.

## Why a separate backend?

The root `vercel.json` intentionally builds a static **testnet UI-only** bundle
with a standalone opt-in Arc Testnet USDC payment. It does **not** deploy the
Express BFF, PostgreSQL, Veyra identity or CCTP execution. Never add a
wildcard `/api/*` rewrite to that Vercel site until the hosted BFF passes
its independent security acceptance checks.

## 1. Review external hosting costs and create the Render Blueprint

- Review `render.yaml` on the `phase5-production-bridge-flow` branch, and
  [Render's current plans](https://render.com/pricing). This Blueprint
  deliberately chooses a paid single-instance web compute plan and paid
  Postgres plan to support a safe, distinct pre-deploy migration job and a
  nonexpiring database; creating it **may incur charges**.
- In your own Render account, import this GitHub repository as a Blueprint,
  review every resource and approve it explicitly. No external resources
  exist just because this configuration is committed.
- Render uses a Singapore-region **private** Postgres, a separate Docker web
  service and `autoDeployTrigger: off`: subsequent deployments remain manual.
- Set `VEYRA_APP_ORIGIN` in the Render form to the **exact stable HTTPS
  frontend origin you control** (e.g. a dedicated Vercel staging hostname,
  without any path or trailing slash). Do not use an arbitrary preview ID
  or a wildcard. Do not enable public browser API integration just yet.
- Other safety-critical settings are configured by the Blueprint:
  `VEYRA_ENV=testnet`, `NODE_ENV=production`,
  `VEYRA_HOSTED_BACKEND=1`, private `DATABASE_URL`,
  `VEYRA_DATABASE_PRIVATE_NETWORK=1`, generated session secret and
  three explicitly pinned testnet RPC endpoints.
- The Blueprint intentionally leaves `CIRCLE_API_KEY`,
  `OPENAI_API_KEY`, all mainnet signing variables and
  `RELAY_PRIVATE_KEY` **unset**. Enable specific integrations only
  after their separate acceptance gates.

## 2. Check automated pre-deploy

`preDeployCommand: bun server/db/hostedTestnetPredeploy.ts` is a separate
one-shot migration/verification step:

1. Refuses any `VEYRA_ENV` other than `testnet`, any
   `NODE_ENV` other than `production`, or missing
   `VEYRA_HOSTED_BACKEND=1`.
2. Enforces non-local private/TLS PostgreSQL URL, exact HTTPS frontend
   origin and a sufficiently strong session secret.
3. Applies Drizzle migrations `0000` through `0012` once as a
   controlled release step (**not on concurrent server boot**).
4. Checks required tables and immutable receipt columns before service
   rollout. Any failure blocks the deployment.

Check Render's deploy logs for the testnet pre-deploy PASS line. **Do not
run these migrations against an existing production database.** For any
pre-existing database, review migration changes and take a backup first.

## 3. Prove infrastructure works; do not confuse it with financial E2E

- `GET /api/health` returning 200 means only that the Express process runs.
- `GET /api/health/database` returns only booleans for each DB check;
  it must never expose connection URLs, credentials or schema details.
- `GET /api/health/readiness` should return HTTP 200 with
  `scope: "infrastructure-only"`, `environment: "testnet"`,
  `financialAcceptanceReady: false` and all checks passing **only
  after** Postgres and live Arc/Sepolia RPC probes succeed.
- A deployment with a missing DB/schema/RPC must return HTTP 503.
  Capture sanitized evidence and match it to the actual Git commit.

## 4. Full E2E acceptance before connecting the frontend

- Confirm exact CORS: the chosen frontend origin is allowed and arbitrary
  origins are not. Verify no unauthenticated `X-Veyra-User-Id` bypass.
- Exercise a disposable testnet identity with a wallet-signed challenge and
  owner-only sessions; reject forged/expired proofs and cross-account reads.
- Perform a tiny real **Arc Testnet USDC** Pay transaction in a
  disposable wallet and independently check chain, recipient, amount,
  block, event logs and durable owner receipt. Capture tx IDs as evidence.
- Perform testnet CCTP source burn → Circle attestation → verified destination
  receive, including reload/device race and unknown-submission cases.
  Do not unlock retries or bridge on insufficient evidence.
- Test agent with an actual server-side API credential only when available;
  absent credentials must generate a clear failure, not fake AI responses.
- Finish a separate security and MetaMask classification review before
  opening unrestricted browser traffic.

## 5. Only after gates pass

- Configure a reviewed HTTPS routing rule to the *exact* BFF origin in a
  dedicated frontend preview deployment; avoid broad forwarding rules.
- Redeploy and rerun all live acceptance checks from the browser.
- Leave Vercel Production unchanged and Mainnet providers disabled.
- For Mainnet, use the separate `docs/veyra-mainnet-release-gates.md`.

## Operator handoff

Required external action: connect a Render account and explicitly authorize
resource provisioning and any hosting charges. Never paste credentials into
GitHub, screenshots, chat or browser-visible `VITE_*` variables.

Render blueprint spec: https://render.com/docs/blueprint-spec
Render health checks: https://render.com/docs/health-checks

## 23 Oct 2026: one Veyra app, two *explicitly trusted* testnet frontends

The temporary Identity Beta and the integrated full Veyra Testnet acceptance URL may share the **same Veyra ID database and wallet-bound user records**, without enabling wildcard origins. The primary `VEYRA_APP_ORIGIN` stays pinned to the existing Identity Beta origin during acceptance. Once a stable integrated HTTPS staging URL exists, the Render operator may configure **one** `VEYRA_TESTNET_ADDITIONAL_ORIGIN=https://<exact-host>`, with no path, trailing slash, wildcard or comma-separated values.

The runtime rejects malformed or duplicate secondary origins and forbids the variable entirely under Mainnet. Requests with a foreign browser `Origin` are rejected before any identity route, regardless of headers or bearer tokens. This does not deploy the integrated frontend or activate financial signers. Database migrations, authenticated Render redeploy, and two-wallet HTTPS acceptance remain independent conditions.

**Do not manually rewrite or spoof Origin headers to evade the backend gate.** When the main Veyra website has passed acceptance, replace the primary origin deliberately and remove the temporary secondary origin.
